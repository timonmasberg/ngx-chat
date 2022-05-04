import {Injectable} from '@angular/core';
import {client, Client, xml} from '@xmpp/client';
import {JID} from '@xmpp/jid';
import {Element as XmppElement} from '@xmpp/xml';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {LogInRequest} from '../../../../core/log-in-request';
import {Stanza} from '../../../../core/stanza';
import {LogService} from './log.service';
import {XmppResponseError} from '../shared/xmpp-response.error';
import {first} from 'rxjs/operators';
import {ChatConnection, ChatConnectionFactory, ChatStates, ClientStatus} from '../interface/chat-connection';
import {XmppClientStanzaBuilder} from '../xmpp-client-stanza-builder';

@Injectable()
export class XmppChatConnectionFactory implements ChatConnectionFactory {
    create(logService: LogService, afterReceiveMessageSubject: Subject<Element>, afterSendMessageSubject: Subject<Element>, beforeSendMessageSubject: Subject<Element>, onBeforeOnlineSubject: Subject<void>, onOfflineSubject: Subject<void>): ChatConnection {
        return new XmppChatConnectionService(
            logService,
            afterReceiveMessageSubject,
            afterSendMessageSubject,
            beforeSendMessageSubject,
            onBeforeOnlineSubject,
            onOfflineSubject
        );
    }
}

/**
 * Implementation of the XMPP specification according to RFC 6121.
 * @see https://xmpp.org/rfcs/rfc6121.html
 * @see https://xmpp.org/rfcs/rfc3920.html
 * @see https://xmpp.org/rfcs/rfc3921.html
 */
export class XmppChatConnectionService implements ChatConnection {

    public readonly state$ = new BehaviorSubject<ChatStates>('disconnected');
    public readonly stanzaUnknown$ = new Subject<Element>();
    public readonly userJid$: Observable<string>;

    private readonly userJidSubject = new Subject<string>();
    private requestId = new Date().getTime();
    private readonly stanzaResponseHandlers = new Map<string, [(stanza: Stanza) => void, (e: Error) => void]>();
    private client?: Client;

    constructor(
        private readonly logService: LogService,
        private readonly afterReceiveMessageSubject: Subject<Element>,
        private readonly afterSendMessageSubject: Subject<Element>,
        private readonly beforeSendMessageSubject: Subject<Element>,
        private readonly onBeforeOnlineSubject: Subject<void>,
        private readonly onOfflineSubject: Subject<void>,
    ) {
        this.userJid$ = this.userJidSubject.asObservable();
    }

    public onOnline(jid: JID): void {
        this.logService.info('online =', 'online as', jid.toString());
        this.userJidSubject.next(jid.toString());
        this.state$.next('online');
    }

    private onOffline(): void {
        this.onOfflineSubject.next();
        this.stanzaResponseHandlers.forEach(([, reject]) => reject(new Error('offline')));
        this.stanzaResponseHandlers.clear();
    }

    public async send(content: XmppElement): Promise<void> {
        await this.client.send(content);
    }

    public async sendAwaitingResponse(request: XmppElement): Promise<Element> {
        const from = await this.userJid$.pipe(first()).toPromise();
        return new Promise((resolve, reject) => {
            const id = this.getNextRequestId();
            request.attr('id', id);
            request.attr('from', from);

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

    /*** TODO: reuse client for same Domain **/
    async logIn(logInRequest: LogInRequest): Promise<void> {
        this.onBeforeOnlineSubject.next();
        if (logInRequest.username.indexOf('@') > -1) {
            this.logService.warn('username should not contain domain, only local part, this can lead to errors!');
        }

        this.client = client(logInRequest);

        this.client.on('error', (err: any) => this.logService.error('chat service error =>', err.toString(), err));

        this.client.on('status', async (status: ClientStatus, value: any) => {
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

        this.client.on('stanza', (stanza: Stanza) => {
            if (this.skipXmppClientResponses(stanza)) {
                return;
            }
            this.onStanzaReceived(stanza);
        });

        await this.client.start();
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
            await this.client.stop();
        }
    }

    getNextRequestId(): string {
        return String(this.requestId++);
    }

    reconnectSilently(): void {
        this.logService.warn('hard reconnect...');
        this.state$.next('disconnected');
        void this.client.reconnect.reconnect();
    }

    private $build(
        name: string,
        attrs?: Record<string, string>,
        sendInner = (element) => this.send(element),
        sendInnerAwaitingResponse = (element) => this.sendAwaitingResponse(element)
    ): XmppClientStanzaBuilder {
        return new XmppClientStanzaBuilder(xml(name, attrs), () => this.getNextRequestId(), sendInner, sendInnerAwaitingResponse);
    }

    $iq(attrs?: Record<string, string>): XmppClientStanzaBuilder {
        // @TODO use iq callee from XMPP
        return this.$build('iq', attrs);
    }

    $msg(attrs?: Record<string, string>): XmppClientStanzaBuilder {
        return this.$build('message', attrs, (element) => {
                this.beforeSendMessageSubject.next();
                return this.send(element);
            },
            (element) => {
                this.beforeSendMessageSubject.next();
                return this.sendAwaitingResponse(element);
            });
    }

    $pres(attrs?: Record<string, string>): XmppClientStanzaBuilder {
        return this.$build('presence', attrs);
    }

    addHandler(handler: (stanza: Element) => boolean, identifier?: { ns?: string; name?: string; type?: string; id?: string; from?: string }, options?: { matchBareFromJid: boolean; ignoreNamespaceFragment: boolean }): object {
        return undefined;
    }

    deleteHandler(handlerRef: object): void {
    }
}
