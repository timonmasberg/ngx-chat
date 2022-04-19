import {Injectable} from '@angular/core';
import {JID} from '@xmpp/jid';
import {BehaviorSubject, combineLatest, Observable, Subject} from 'rxjs';
import {LogInRequest} from '../../../core/log-in-request';
import {IqResponseStanza, Stanza} from '../../../core/stanza';
import {LogService} from '../log.service';
import {XmppResponseError} from './xmpp-response.error';
import {filter} from 'rxjs/operators';
import {$pres, Strophe} from 'strophe.js';
import {ChatConnectionService} from './chat-connection.service';

export type XmppChatStates = 'disconnected' | 'online' | 'reconnecting';

/**
 * Implementation of the XMPP specification according to RFC 6121.
 * @see https://xmpp.org/rfcs/rfc6121.html
 * @see https://xmpp.org/rfcs/rfc3920.html
 * @see https://xmpp.org/rfcs/rfc3921.html
 */
@Injectable()
export class StropheChatConnectionService implements ChatConnectionService {

    public readonly state$ = new BehaviorSubject<XmppChatStates>('disconnected');
    public readonly stanzaUnknown$ = new Subject<Stanza>();

    /**
     * User JID with resource, not bare.
     */
    public userJid?: JID;
    private requestId = new Date().getTime();
    private readonly stanzaResponseHandlers = new Map<string, [(stanza: Stanza) => void, (e: Error) => void]>();
    public connection?: Strophe.Connection;

    private readonly sendStanzaSubject = new Subject<Element>();

    constructor(
        private readonly logService: LogService,
    ) {
        combineLatest([this.state$, this.sendStanzaSubject.asObservable()])
            .pipe(filter(([state]) => state === 'online'))
            .subscribe(async ([, stanza]) => {
                    this.logService.debug('>>>', stanza);
                    this.connection.send(stanza);
                }
            );
    }

    onBeforeOnlineHandlers: (() => Promise<void>)[];
    onOffline$: Observable<void>;
    afterSendMessage$: Observable<void>;
    beforeSendMessage$: Observable<void>;
    afterReceiveMessage$: Observable<void>;
    userJid$: Observable<string>;

    public addHandler(handler: (stanza: Element) => boolean, identifier?: { ns?: string, name?: string, type?: string, id?: string, from?: string }, options?: { matchBare: boolean }) {
        const {ns, name, type, id, from} = identifier;
        this.connection.addHandler(handler, ns, name, type, id, from, options);
    }

    public onOnline(jid: JID): void {
        this.logService.info('online =', 'online as', jid.toString());
        this.addHandler((stanza) => this.onStanzaReceived(stanza));
        this.userJid = jid;
        this.state$.next('online');
    }

    private onOffline(): void {
        this.stanzaResponseHandlers.forEach(([, reject]) => reject(new Error('offline')));
        this.stanzaResponseHandlers.clear();
    }

    public async sendPresence(): Promise<void> {
        await this.send($pres().tree());
    }

    public async send(content: Element): Promise<void> {
        this.sendStanzaSubject.next(content);
    }

    public async sendAwaitingResponse(request: Stanza): Promise<Stanza> {
        return new Promise((resolve, reject) => {
            const id = this.getNextRequestId();
            request.setAttribute('id', id);
            request.setAttribute('from', this.userJid.toString());

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

    public onStanzaReceived(stanza: Element): boolean {
        let handled = false;

        const [handleResponse] = this.stanzaResponseHandlers.get(stanza.getAttribute('id')) ?? [];
        if (handleResponse) {
            this.logService.debug('<<<', stanza.toString(), 'handled by response handler');
            this.stanzaResponseHandlers.delete(stanza.getAttribute('id'));
            handleResponse(stanza);
            handled = true;
        }

        if (!handled) {
            this.stanzaUnknown$.next(stanza as unknown as Stanza);
        }
        return handled;
    }

    public async sendIq(request: Stanza): Promise<IqResponseStanza<'result'>> {
        const requestType: string | undefined = request.getAttribute('type');
        // see https://datatracker.ietf.org/doc/html/draft-ietf-xmpp-3920bis#section-8.2.3
        if (!requestType || (requestType !== 'get' && requestType !== 'set')) {
            const message = `iq stanza without type: ${request.toString()}`;
            this.logService.error(message);
            throw new Error(message);
        }

        const response = await this.sendAwaitingResponse(request);
        return response as IqResponseStanza<'result'>;
    }

    public async sendIqAckResult(id: string): Promise<void> {
        await this.send($iq({from: this.userJid.toString(), id, type: 'result'}).tree());
    }

    /*** TODO: reuse client for same Domain **/
    async logIn(logInRequest: LogInRequest): Promise<void> {
        return new Promise((resolve, reject) => {
            if (logInRequest.username.indexOf('@') > -1) {
                this.logService.warn('username should not contain domain, only local part, this can lead to errors!');
            }

            this.connection = new Strophe.Connection(logInRequest.service);
            const jid = logInRequest.username + '@' + logInRequest.domain;
            this.connection.connect(jid, logInRequest.password, (status: Strophe.Status, value: any) => {
                this.logService.info('status update =', status, value ? JSON.stringify(value) : '');
                switch (status) {
                    case Strophe.Status.AUTHENTICATING:
                    case Strophe.Status.REDIRECT:
                    case Strophe.Status.ATTACHED:
                    case Strophe.Status.CONNECTING:
                        break;
                    case Strophe.Status.CONNECTED:
                        this.onOnline(new JID(logInRequest.username, logInRequest.domain));
                        resolve();
                        break;
                    case Strophe.Status.ERROR:
                    case Strophe.Status.CONNFAIL:
                    case Strophe.Status.AUTHFAIL:
                    case Strophe.Status.CONNTIMEOUT:
                        this.state$.next('disconnected');
                        this.onOffline();
                        reject('connection failed with status code: ' + status);
                        break;
                    case Strophe.Status.DISCONNECTING:
                    case Strophe.Status.DISCONNECTED:
                        break;
                }
            });
        });
    }

    async logOut(): Promise<void> {
        this.logService.debug('logging out');
        try {
            await this.send($pres({type: 'unavailable'}).tree());
            this.state$.next('disconnected'); // after last send
            this.connection.disconnect('regular logout');
            this.connection.reset();
        } catch (e) {
            this.logService.error('error sending presence unavailable');
        }
        this.onOffline();
    }

    getNextRequestId(): string {
        return String(this.requestId++);
    }

    reconnectSilently(): void {
        this.logService.warn('hard reconnect...');
        this.state$.next('disconnected');
        this.connection.restore();
    }

    registerForOnBeforeOnline(handler: () => Promise<void>) {
        throw new Error('Method not implemented.');
    }

    $build(name: string, attrs?: Record<string, string>): Strophe.Builder {
        return $build(name, attrs) as Strophe.Builder;
    }

    $iq(attrs?: Record<string, string>): Strophe.Builder {
        return this.$build('iq', attrs);
    }

    $msg(attrs?: Record<string, string>): Strophe.Builder {
        return this.$build('message', attrs);
    }

    $pres(attrs?: Record<string, string>): Strophe.Builder {
        return this.$build('presence', attrs);
    }
}
