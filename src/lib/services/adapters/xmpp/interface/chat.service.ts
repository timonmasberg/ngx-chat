import {InjectionToken} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {Room} from '../../../../core/room';
import {Contact} from '../../../../core/contact';
import {LogInRequest} from '../../../../core/log-in-request';
import {Recipient} from '../../../../core/recipient';
import {Translations} from '../../../../core/translations';
import {FileUploadHandler} from '../../../../hooks/file-upload-handler';
import {JID} from '@xmpp/jid';
import {Form} from '../../../../core/form';
import {Message, MessageState} from '../../../../core/message';
import {ChatConnection} from './chat-connection';
import {Invitation} from '../plugins/multi-user-chat/invitation';
import {RoomCreationOptions} from '../plugins/multi-user-chat/room-creation-options';
import {RoomOccupant} from '../plugins/multi-user-chat/room-occupant';


export interface ChatAction {
    /**
     * to identify actions
     */
    id: string;
    cssClass: { [className: string]: boolean } | string | string[];
    html: string;

    onClick(chatActionContext: ChatActionContext): void;
}


export interface ChatActionContext {
    contact: string;
    chatWindow: {
        sendMessage?: () => void;
    };
}

export type JidToNumber = Map<string, number>;

/**
 * The chat service token gives you access to the main chat api and is implemented by default with an XMPP adapter,
 * you can always reuse the api and ui with a new service implementing the ChatServiceInterface interface and providing the
 * said implementation with the token
 */
export const CHAT_SERVICE_TOKEN = new InjectionToken<ChatService>('ngxChatService');


export type ConnectionStates = 'disconnected' | 'connecting' | 'online';

/**
 * ChatServiceInterface is your main API for using ngx-chat. Can be injected in your services like in the following example:
 *
 * ```
 * constructor(@Inject(CHAT_SERVICE_TOKEN) chatService: ChatServiceInterface)
 * ```
 */
export interface ChatService {
    /**
     * Current connection
     */
    readonly chatConnectionService: ChatConnection

    supportsPlugin: {
        block: boolean;
        messageState: boolean;
    };

    /**
     * Returns the FileUploadHandler for the chosen interface as they have deep dependencies towards the chosen chat system they should
     * be handled separately.
     */
    fileUploadHandler: FileUploadHandler;

    /**
     * Will emit the corresponding contact when a new message arrive.
     */
    message$: Observable<Contact>;

    /**
     * Will emit the corresponding contact to which a message was sent.
     */
    messageSent$: Observable<Contact>;

    /**
     * Will emit the corresponding room when a new message arrive.
     */
    groupMessage$: Observable<Room>;

    /**
     * Lifecycle state machine. Starts in the state "disconnected". When logging in, the state will change to "connecting".
     * Plugins may now initialize, for example load the contact list or request archived messages. When all plugins have completed the
     * initialization, the new state will be 'online'.
     */
    state$: BehaviorSubject<ConnectionStates>;

    /**
     * A BehaviorSubject of all known contacts. Contains for example Contacts that sent you a message or blocked contacts.
     * This does not represent your roster list.
     */
    contacts$: BehaviorSubject<Contact[]>;

    /**
     * Emits when a new contact was added to the roster / contact list
     */
    contactCreated$: Observable<Contact>;

    rooms$: Observable<Room[]>;

    onInvitation$: Observable<Invitation>;

    /**
     * A list of contacts which the current user has blocked.
     */
    blockedContacts$: Observable<Contact[]>;

    /**
     * contacts$ without the blockedContacts$.
     */
    notBlockedContacts$: Observable<Contact[]>;

    /**
     * A list of contacts to which the current user has accepted subscriptions to.
     */
    contactsSubscribed$: Observable<Contact[]>;

    /**
     * A list of contacts to which a subscription from the user is outstanding.
     */
    contactRequestsSent$: Observable<Contact[]>;

    /**
     * A list of contacts which have sent the user a subscription request.
     */
    contactRequestsReceived$: Observable<Contact[]>;

    /**
     * A list of contacts where the user is not subscribed to and neither a pending request is incoming or outgoing.
     */
    contactsUnaffiliated$: Observable<Contact[]>;

    /**
     * emits as soon as the unread message count changes, you might want to debounce it with e.g. half a a second, as
     * new messages might be acknowledged in another session.
     */
    jidToUnreadCount$: Observable<JidToNumber>;

    unreadMessageCountSum$: Observable<number>;

    /**
     * If set to true, debug information will be visible in the roster list.
     */
    enableDebugging: boolean;

    /**
     * The avatar of the user. Is used as src attribute of an img-element. Purely cosmetical. Should be set via the
     * [userAvatar$]{@link ChatComponent#userAvatar$} @Input-attribute of {@link ChatComponent}.
     */
    userAvatar$: BehaviorSubject<string>;

    /**
     * The current translation. Do NOT write to this attribute, use the [translations]{@link ChatComponent#translations} @Input-attribute
     * of {@link ChatComponent} instead.
     */
    translations: Translations;

    /**
     * The actions visible to users near to chat inputs, e.g. the send message button. Customize it for branding or to add
     * new actions, e.g. for file uploads.
     */
    chatActions: ChatAction[];

    /**
     * Observable for plugins to clear up data and manage the message state
     */
    readonly afterReceiveMessage$: Observable<Element>;
    /**
     * Observable for plugins to clear up data and manage the message state
     */
    readonly afterSendMessage$: Observable<Element>;
    /**
     * Observable for plugins to extend the message transformation pipeline
     */
    readonly beforeSendMessage$: Observable<Element>;
    /**
     * Observable to hook at before online actions, emitting the jid which will be used for the login
     */
    readonly onBeforeOnline$: Observable<string>;
    /**
     * Observable for clean up actions after going offline
     */
    readonly onOffline$: Observable<void>;

    /**
     * Forces asynchronous reloading of your roster list from the server, {@link contacts$} will reflect this.
     */
    reloadContacts(): Promise<void>;

    /**
     * Returns the contact with the given ID or undefined if no contact with the given ID is found. In case of XMPP it does not have to be
     * bare, the search will convert it to a bare JID.
     * @param id The ID of the contact.
     * @returns Either the Contact or null.
     */
    getContactById(id: string): Promise<Contact>;

    /**
     * Always returns a contact with the given ID. If no contact exists, a new one is created and announced via contacts$. In case of XMPP
     * it does not have to be bare, the search will convert it to a bare JID.
     * @param id The ID of the contact.
     * @returns The new contact instance.
     */
    getOrCreateContactById(id: string): Promise<Contact>;

    /**
     * Adds the given contact to the user roster. Will send a subscription request to the contact.
     * @param identifier The ID of the contact.
     */
    addContact(identifier: string): Promise<void>;

    /**
     * Removes the given contact from the user roster. Will cancel a presence subscription from the user to the contact and will retract
     * accepted subscriptions from the contact to the user.
     * @param identifier The ID of the contact.
     */
    removeContact(identifier: string): Promise<void>;

    /**
     * Logs the user in. Will modify state$ accordingly. If login fails, state will stay in 'disconnected'.
     */
    logIn(logInRequest: LogInRequest): Promise<void>;

    /**
     * Disconnects from the server, clears contacts$, sets state$ to 'disconnected'.
     */
    logOut(): Promise<void>;

    /**
     * Sends a given message to a given contact.
     * @param recipient The recipient to which the message shall be sent.
     * @param body The message content.
     */
    sendMessage(recipient: Recipient, body: string): Promise<void>;

    /**
     * Requests all archived messages for all contacts from the server.
     */
    loadCompleteHistory(): Promise<void>;

    /**
     * Tries to transparently (= without the user noticing) reconnect to the chat server.
     */
    reconnectSilently(): Promise<void>;

    /**
     * Tries to reconnect with the same credentials the user logged in last.
     */
    reconnect(): Promise<void>;

    blockJid(bareJid: string): Promise<void>;

    unblockJid(bareJid: string): Promise<void>;

    joinRoom(jid: JID): Promise<Room>;

    subscribeRoom(roomJid: string, nodes: string[]): Promise<void>;

    unsubscribeRoom(roomJid: string): Promise<void>;

    destroyRoom(roomJid: JID): Promise<void>;

    createRoom(options: RoomCreationOptions): Promise<Room>;

    kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<void>;

    unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<void>;

    banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<void>;

    leaveRoom(occupantJid: JID, status?: string): Promise<void>;

    declineRoomInvite(jid: JID): void;

    queryRoomUserList(roomJid: JID): Promise<RoomOccupant[]>;

    getRoomConfiguration(roomJid: JID): Promise<Form>;

    kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<void>;

    inviteUserToRoom(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void>;

    changeRoomSubject(roomJid: JID, subject: string): Promise<void>;

    changeUserNicknameForRoom(newNick: string, roomJid: JID): Promise<void>;

    grantMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    revokeMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    grantAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    revokeAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    grantModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void>;

    revokeModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void>;

    queryAllRooms(): Promise<Room[]>;

    loadMostRecentUnloadedMessages(recipient: Recipient): void;

    getContactMessageState(message: Message, contactJid: string): MessageState;

    retrieveSubscriptions(): Promise<Map<string, string[]>>;

    /**
     * Promise resolves if user account is registered successfully,
     * rejects if an error happens while registering, e.g. the username is already taken.
     */
    register(user: {
        username: string,
        password: string,
        service: string,
        domain: string
    }): Promise<void>;

}
