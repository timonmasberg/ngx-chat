import {InjectionToken} from '@angular/core';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {LogInRequest} from '../../../core/log-in-request';

export type ChatStates = 'disconnected' | 'online' | 'reconnecting';

export enum ClientStatus {
    /**
     * indicates that xmpp is authenticated and addressable. It is emitted every time there is a successfull (re)connection.
     */
    online = 'online',
    /**
     * indicates that xmpp disconnected and no automatic attempt to reconnect will happen (after calling xmpp.stop()).
     */
    offline = 'offline',
    /**
     * Socket is connecting
     */
    connecting = 'connecting',
    /**
     * Socket is connected
     */
    connect = 'connect',
    /**
     * Stream is opening
     */
    opening = 'connect',
    /**
     * Stream is open
     */
    open = 'open',
    /**
     * Stream is closing
     */
    closing = 'closing',
    /**
     * Stream is closed
     */
    close = 'close',
    /**
     * Socket is disconnecting
     */
    disconnecting = 'disconnecting',
    /**
     * Socket is disconnected
     */
    disconnect = 'disconnect',
}

export const CHAT_CONNECTION_SERVICE_TOKEN = new InjectionToken<ChatConnectionService>('ngxChatConnectionService');

/**
 * Implementation of the XMPP specification according to RFC 6121.
 * @see https://xmpp.org/rfcs/rfc6121.html
 * @see https://xmpp.org/rfcs/rfc3920.html
 * @see https://xmpp.org/rfcs/rfc3921.html
 */
export interface ChatConnectionService {
    readonly onBeforeOnlineHandlers: Array<() => Promise<void>>;

    readonly state$: BehaviorSubject<ChatStates>;
    readonly stanzaUnknown$: Subject<Element>;

    /**
     * Observable for plugins to clear up data.
     */
    readonly onOffline$: Observable<void>;
    readonly afterSendMessage$: Observable<void>;
    readonly beforeSendMessage$: Observable<void>;
    readonly afterReceiveMessage$: Observable<void>;

    /**
     * User JID with resource, not bare.
     */
    readonly userJid$: Observable<string>;

    logIn(logInRequest: LogInRequest): Promise<void>;
    logOut(): Promise<void>;
    reconnectSilently(): void;

    registerForOnBeforeOnline(handler: () => Promise<void>);

    addHandler(handler: (stanza: Element) => boolean, identifier?: { ns?: string, name?: string, type?: string, id?: string, from?: string }, options?: { matchBare: boolean });


    $build(name: string, attrs?: Record<string, string>): Builder;
    $msg(attrs?: Record<string, string>): Builder;
    $iq(attrs?: Record<string, string>): Builder;
    $pres(attrs?: Record<string, string>): Builder;
}

export interface Builder {
    tree(): Element;
    toString(): string;
    up(): Builder;
    attrs(moreAttrs: Record<string, string>): Builder;
    setNextId(): Builder;
    c(name: string, attrs?: Record<string, string>, text?: string): Builder;
    cNode(element: Element): Builder;
    cCreateMethod(create:(builder: Builder) => Builder): Builder;
    t(text: string): Builder;
    h(html: string): Builder;
    send(): Promise<void>;
    sendAwaitingResponse(): Promise<Element>;
}
