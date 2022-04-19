import {Injectable, NgZone} from '@angular/core';
import {Client, xml} from '@xmpp/client';
import {JID} from '@xmpp/jid';
import {BehaviorSubject, combineLatest, Observable, Subject} from 'rxjs';
import {LogInRequest} from '../../../core/log-in-request';
import {IqResponseStanza, Stanza} from '../../../core/stanza';
import {LogService} from '../log.service';
import {XmppResponseError} from './xmpp-response.error';
import {XmppClientFactoryService} from './xmpp-client-factory.service';
import {filter, first} from 'rxjs/operators';
import {ChatConnectionService, ChatStates, ClientStatus} from './chat-connection.service';
import {XmppClientStanzaBuilder} from './xmpp-client-stanza-builder';

/**
 * Implementation of the XMPP specification according to RFC 6121.
 * @see https://xmpp.org/rfcs/rfc6121.html
 * @see https://xmpp.org/rfcs/rfc3920.html
 * @see https://xmpp.org/rfcs/rfc3921.html
 */
@Injectable()
export class XmppChatConnectionService implements ChatConnectionService {

    public readonly state$ = new BehaviorSubject<ChatStates>('disconnected');
    public readonly stanzaUnknown$ = new Subject<Element>();
    public readonly userJid$: Observable<string>;

    private readonly userJidSubject = new Subject<string>();
    private requestId = new Date().getTime();
    private readonly stanzaResponseHandlers = new Map<string, [(stanza: Stanza) => void, (e: Error) => void]>();
    private client?: Client;

    private readonly sendStanzaSubject = new Subject<Stanza>();

    private readonly afterReceiveMessageSubject = new Subject<void>();
    readonly afterReceiveMessage$: Observable<void>;
    private readonly afterSendMessageSubject = new Subject<void>();
    readonly afterSendMessage$: Observable<void>;
    private readonly beforeSendMessageSubject = new Subject<void>();
    readonly beforeSendMessage$: Observable<void>;
    readonly onBeforeOnlineHandlers: Array<() => Promise<void>> = [];
    private readonly onOfflineSubject = new Subject<void>();
    readonly onOffline$: Observable<void>;

    constructor(
        private readonly logService: LogService,
        private readonly ngZone: NgZone,
        private readonly xmppClientFactoryService: XmppClientFactoryService,
    ) {
        combineLatest([this.state$, this.sendStanzaSubject.asObservable()])
            .pipe(filter(([state]) => state === 'online'))
            .subscribe(async ([, stanza]) => {
                    this.logService.debug('>>>', stanza);
                    await this.client.send(stanza);
                }
            );

        this.userJid$ = this.userJidSubject.asObservable();
        this.afterReceiveMessage$ = this.afterReceiveMessageSubject.asObservable();
        this.afterSendMessage$ = this.afterSendMessageSubject.asObservable();
        this.beforeSendMessage$ = this.beforeSendMessageSubject.asObservable();
        this.onOffline$ = this.onOfflineSubject.asObservable();
    }

    public onOnline(jid: JID): void {
        this.logService.info('online =', 'online as', jid.toString());
        this.userJidSubject.next(jid.toString());
        this.state$.next('online');
    }

    private onOffline(): void {
        this.stanzaResponseHandlers.forEach(([, reject]) => reject(new Error('offline')));
        this.stanzaResponseHandlers.clear();
    }

    public async sendPresence(): Promise<void> {
        await this.send(xml('presence'));
    }

    public async send(content: any): Promise<void> {
        this.beforeSendMessageSubject.next();
        this.sendStanzaSubject.next(content);
    }

    public async sendAwaitingResponse(request: Element): Promise<Element> {
        this.beforeSendMessageSubject.next();
        const from = await this.userJid$.pipe(first()).toPromise();
        return new Promise((resolve, reject) => {
            const id = this.getNextRequestId();
            request.setAttribute('id', id);
            request.setAttribute('from', from);

            this.stanzaResponseHandlers.set(id, [
                (response) => {
                    if (response.getAttribute('type') === 'error') {
                        reject(new XmppResponseError(response));
                        return;
                    }

                    resolve(response);
                },
                reject,
            ]);

            this.send(request).catch((e: unknown) => {
                this.logService.error('error sending stanza', e);
                this.stanzaResponseHandlers.delete(id);
                reject(e);
            });
        });
    }

    public onStanzaReceived(stanza: Stanza): void {
        let handled = false;
        this.afterReceiveMessageSubject.next();

        const [handleResponse] = this.stanzaResponseHandlers.get(stanza.getAttribute('id')) ?? [];
        if (handleResponse) {
            this.logService.debug('<<<', stanza.toString(), 'handled by response handler');
            this.stanzaResponseHandlers.delete(stanza.getAttribute('id'));
            handleResponse(stanza);
            handled = true;
        }

        if (!handled) {
            this.stanzaUnknown$.next(stanza);
        }
    }

    public async sendIq(request: Element): Promise<IqResponseStanza<'result'>> {
        const requestType: string | undefined = request.getAttribute('type');
        // see https://datatracker.ietf.org/doc/html/draft-ietf-xmpp-3920bis#section-8.2.3
        if (!requestType || (requestType !== 'get' && requestType !== 'set')) {
            const message = `iq stanza without type: ${request.toString()}`;
            this.logService.error(message);
            throw new Error(message);
        }

        const response = await this.sendAwaitingResponse(request);
        /*
        if (!this.isIqStanzaResponse(response)) {
            const type = response.getAttribute('type');
            throw new Error(`received unexpected stanza as iq response: type=${type}, stanza=${response.toString()}`);
        }*/
        return response as IqResponseStanza<'result'>;
    }

    private isIqStanzaResponse(stanza: Stanza): stanza is IqResponseStanza {
        const stanzaType = stanza.getAttribute('type');
        return stanza.tagName === 'iq' && (stanzaType === 'result' || stanzaType === 'error');
    }

    public async sendIqAckResult(id: string): Promise<void> {
        const from = await this.userJid$.pipe(first()).toPromise();
        await this.send(
            xml('iq', {from, id, type: 'result'}),
        );
    }

    /*** TODO: reuse client for same Domain **/
    async logIn(logInRequest: LogInRequest): Promise<void> {
        await this.ngZone.runOutsideAngular(async () => {
            if (logInRequest.username.indexOf('@') > -1) {
                this.logService.warn('username should not contain domain, only local part, this can lead to errors!');
            }

            this.client = this.xmppClientFactoryService.client(logInRequest);

            this.client.on('error', (err: any) => {
                this.ngZone.run(() => {
                    this.logService.error('chat service error =>', err.toString(), err);
                });
            });

            this.client.on('status', (status: ClientStatus, value: any) => {
                this.ngZone.run(async () => {
                    this.logService.info('status update =', status, value ? JSON.stringify(value) : '');
                    switch (status) {
                        case ClientStatus.online:
                            this.onOnline(value);
                            break;
                        case ClientStatus.offline:
                            this.state$.next('disconnected');
                            this.onOffline();
                            await this.logOut();
                            break;
                        case ClientStatus.connecting:
                        case ClientStatus.connect:
                        case ClientStatus.opening:
                        case ClientStatus.open:
                        case ClientStatus.closing:
                        case ClientStatus.close:
                        case ClientStatus.disconnecting:
                        case ClientStatus.disconnect:
                            this.state$.next('reconnecting');
                            break;

                    }
                });
            });

            this.client.on('stanza', (stanza: Stanza) => {
                this.ngZone.run(() => {
                    if (this.skipXmppClientResponses(stanza)) {
                        return;
                    }
                    this.onStanzaReceived(stanza);
                });
            });

            await this.client.start();
        });
    }

    /**
     * We should skip our iq handling for the following xmpp/client response:
     * - resource bind on start by https://xmpp.org/rfcs/rfc6120.html#bind
     */
    private skipXmppClientResponses(stanza: Stanza) {
        const xmppBindNS = 'urn:ietf:params:xml:ns:xmpp-bind';
        return stanza.querySelector('bind')?.namespaceURI === xmppBindNS;
    }

    async logOut(): Promise<void> {
        if (!this.client) {
            return Promise.resolve();
        }
        // TODO: move this to a presence plugin in a handler
        this.logService.debug('logging out');
        try {
            await this.send(xml('presence', {type: 'unavailable'}));
            this.state$.next('disconnected'); // after last send
            this.client.reconnect.stop();
        } catch (e) {
            this.logService.error('error sending presence unavailable');
        } finally {
            this.client.stop();
        }
    }

    getNextRequestId(): string {
        return String(this.requestId++);
    }

    reconnectSilently(): void {
        this.logService.warn('hard reconnect...');
        this.state$.next('disconnected');
        this.client.reconnect.reconnect();
    }

    $build(name: string, attrs?: any): XmppClientStanzaBuilder {
        return new XmppClientStanzaBuilder(xml(name, attrs), () => this.getNextRequestId(), (element) => this.send(element), (element) => this.sendAwaitingResponse(element));
    }

    $iq(attrs?: any): XmppClientStanzaBuilder {
        return this.$build('iq', attrs);
    }

    $msg(attrs?: any): XmppClientStanzaBuilder {
        return this.$build('message', attrs);
    }

    $pres(attrs?: any): XmppClientStanzaBuilder {
        return this.$build('presence', attrs);
    }

    addHandler(handler: (stanza: Element) => boolean, identifier?: { ns?: string; name?: string; type?: string; id?: string; from?: string }, options?: { matchBare: boolean }) {
    }

    registerForOnBeforeOnline(handler: () => Promise<void>) {
    }
}
