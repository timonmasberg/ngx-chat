import {Injectable} from '@angular/core';
import {JID} from '@xmpp/jid';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {LogInRequest} from '../../../../core/log-in-request';
import {Stanza} from '../../../../core/stanza';
import {LogService} from './log.service';
import {Strophe} from 'strophe.js';
import {ChatConnection, ChatConnectionFactory} from '../interface/chat-connection';
import {StropheStanzaBuilder} from '../strophe-stanza-builder';
import {StropheConnection} from '../strophe-connection';

export type XmppChatStates = 'disconnected' | 'online' | 'reconnecting';

@Injectable()
export class StropheChatConnectionFactory implements ChatConnectionFactory {
    create(logService: LogService, afterReceiveMessageSubject: Subject<Element>, afterSendMessageSubject: Subject<Element>, beforeSendMessageSubject: Subject<Element>, onBeforeOnlineSubject: Subject<void>, onOfflineSubject: Subject<void>): ChatConnection {
        return new StropheChatConnectionService(
            logService,
            afterReceiveMessageSubject,
            afterSendMessageSubject,
            beforeSendMessageSubject,
            onBeforeOnlineSubject,
            onOfflineSubject
        )
    }
}

/**
 * Implementation of the XMPP specification according to RFC 6121.
 * @see https://xmpp.org/rfcs/rfc6121.html
 * @see https://xmpp.org/rfcs/rfc3920.html
 * @see https://xmpp.org/rfcs/rfc3921.html
 */
export class StropheChatConnectionService implements ChatConnection {

    readonly state$ = new BehaviorSubject<XmppChatStates>('disconnected');
    readonly stanzaUnknown$ = new Subject<Stanza>();

    /**
     * User JID with resource, not bare.
     */
    userJid?: JID;
    userJid$: Observable<string>;
    connection?: Strophe.Connection;

    constructor(
        protected readonly logService: LogService,
        protected readonly afterReceiveMessageSubject: Subject<Element>,
        protected readonly afterSendMessageSubject: Subject<Element>,
        protected readonly beforeSendMessageSubject: Subject<Element>,
        protected readonly onBeforeOnlineSubject: Subject<void>,
        protected readonly onOfflineSubject: Subject<void>,
    ) {
    }

    addHandler(handler: (stanza: Element) => boolean, identifier?: { ns?: string, name?: string, type?: string, id?: string, from?: string }, options?: { matchBareFromJid: boolean, ignoreNamespaceFragment: boolean }) {
        const {ns, name, type, id, from} = identifier;
        return this.connection.addHandler(handler, ns, name, type, id, from, options);
    }

    deleteHandler(handlerRef: object) {
        this.connection.deleteHandler(handlerRef);
    }

    onOnline(jid: JID): void {
        this.logService.info('online =', 'online as', jid.toString());
        this.addHandler((stanza) => {
            this.stanzaUnknown$.next(stanza);
            return true;
        });
        this.userJid = jid;
        this.state$.next('online');
    }

    protected onOffline(): void {
        this.onOfflineSubject.next();
    }

    /*** TODO: reuse client for same Domain **/
    async logIn(logInRequest: LogInRequest): Promise<void> {
        if (logInRequest.username.indexOf('@') > -1) {
            this.logService.warn('username should not contain domain, only local part, this can lead to errors!');
        }
        this.onBeforeOnlineSubject.next();
        this.connection = await StropheConnection.createConnection(this.logService, {domain: logInRequest.domain});
        // @TODO: Check if necessary
        this.connection.addHandler((el) => this.afterReceiveMessageSubject.next(el), null, 'message')

        return new Promise((resolve, reject) => {
            const jid = logInRequest.username + '@' + logInRequest.domain;
            this.connection.connect(jid, logInRequest.password, (status: Strophe.Status, value: string) => {
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
            await this.$pres({type: 'unavailable'}).send();
            this.state$.next('disconnected'); // after last send
            this.connection.disconnect('regular logout');
            this.connection.reset();
        } catch (e) {
            this.logService.error('error sending presence unavailable');
        }
        this.onOffline();
    }

    reconnectSilently(): void {
        this.logService.warn('hard reconnect...');
        this.state$.next('disconnected');
        this.connection.restore();
    }

    private $build(
        name: string,
        attrs: Record<string, string>,
        sendInner: (content: Element) => Promise<void>,
        sendInnerAwaitingResponse: (content: Element) => Promise<Element>,
    ): StropheStanzaBuilder {
        return new StropheStanzaBuilder($build(name, attrs), sendInner, sendInnerAwaitingResponse);
    }

    $iq(attrs?: Record<string, string>): StropheStanzaBuilder {
        return this.$build(
            'iq',
            attrs,
            async (el: Element) => this.connection.send(el),
            async (el: Element) => new Promise<Element>((resolve, reject) => this.connection.sendIQ(el, resolve, reject))
        );
    }

    $msg(attrs?: Record<string, string>): StropheStanzaBuilder {
        const sendInner = async (el: Element) => {
            this.beforeSendMessageSubject.next(el);
            this.connection.send(el);
            this.afterSendMessageSubject.next(el);
        };

        const sendInnerAwaitingResponse = async (el: Element) => {
            this.beforeSendMessageSubject.next(el);
            this.connection.send(el);
            this.afterSendMessageSubject.next(el);
            return Promise.resolve(el);
        };

        return this.$build('message', attrs, sendInner, sendInnerAwaitingResponse);
    }

    $pres(attrs?: Record<string, string>): StropheStanzaBuilder {
        return this.$build(
            'presence',
            attrs,
            async (el: Element) => this.connection.send(el),
            async (el: Element) => new Promise<Element>((resolve, reject) => this.connection.sendPresence(el, resolve, reject))
        );
    }
}
