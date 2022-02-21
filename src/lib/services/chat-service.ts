import {InjectionToken} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {Room} from '../core/room';
import {Contact} from '../core/contact';
import {LogInRequest} from '../core/log-in-request';
import {Recipient} from '../core/recipient';
import {Translations} from '../core/translations';
import {FileUploadHandler} from '../hooks/file-upload-handler';
import {JID} from '@xmpp/jid';
import {Form} from '../core/form';
import {IqResponseStanza} from '../core/stanza';

export interface StateDate {
    lastRecipientReceived: Date;
    lastRecipientSeen: Date;
    lastSent: Date;
}

export interface RoomSummary {
    jid: JID;
    name: string;
    roomInfo: Form | null;
}

export interface RoomUser {
    userIdentifiers: {
        userJid: JID,
        nick?: string
    }[];
    affiliation?: Affiliation;
    role?: Role;
}

export interface RoomOccupant {
    occupantJid: JID;
    affiliation: Affiliation;
    nick: string;
    role: Role;
}


export enum Affiliation {
    none = 'none',
    outcast = 'outcast',
    member = 'member',
    admin = 'admin',
    owner = 'owner',
}

export enum Role {
    none = 'none',
    visitor = 'visitor',
    participant = 'participant',
    moderator = 'moderator',
}


export enum MUC_SUB_EVENT_TYPE {
    presence = 'urn:xmpp:mucsub:nodes:presence',
    messages = 'urn:xmpp:mucsub:nodes:messages',
    affiliations = 'urn:xmpp:mucsub:nodes:affiliations',
    subscribers = 'urn:xmpp:mucsub:nodes:subscribers',
    config = 'urn:xmpp:mucsub:nodes:config',
    subject = 'urn:xmpp:mucsub:nodes:subject',
    system = 'urn:xmpp:mucsub:nodes:system',
}


/**
 * see:
 * https://xmpp.org/extensions/xep-0045.html#terms-rooms
 */
export interface RoomCreationOptions extends RoomConfiguration {
    /**
     * The room id to create the room with. This is the `local` part of the room JID.
     */
    roomId: string;
    /**
     * Optional nickname to use in the room. Current user's nickname will be used if not provided.
     */
    nick?: string;
}

export interface RoomConfiguration {
    /**
     * Optional name for the room. If none is provided, room will be only identified by its JID.
     */
    name?: string;
    /**
     * A room that can be found by any user through normal means such as searching and service discovery
     */
    public?: boolean;
    /**
     * for true:
     * A room that a user cannot enter without being on the member list.
     * for false:
     * A room that non-banned entities are allowed to enter without being on the member list.
     */
    membersOnly?: boolean;
    /**
     * for true:
     * A room in which an occupant's full JID is exposed to all other occupants,
     * although the occupant can request any desired room nickname.
     * for false:
     * A room in which an occupant's full JID can be discovered by room moderators only.
     */
    nonAnonymous?: boolean;
    /**
     * for true:
     * A room that is not destroyed if the last occupant exits.
     * for false:
     * A room that is destroyed if the last occupant exits.
     */
    persistentRoom?: boolean;
    /**
     * allow ejabberd MucSub subscriptions.
     * Room occupants are allowed to subscribe to message notifications being archived while they were offline
     */
    allowSubscription?: boolean;
}

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
 * you can always reuse the api and ui with a new service implementing the ChatService interface and providing the
 * said implementation with the token
 */
export const CHAT_SERVICE_TOKEN = new InjectionToken<ChatService>('ngxChatService');


export type ConnectionStates = 'disconnected' | 'connecting' | 'online';

/**
 * ChatService is your main API for using ngx-chat. Can be injected in your services like in the following example:
 *
 * ```
 * constructor(@Inject(CHAT_SERVICE_TOKEN) chatService: ChatService)
 * ```
 */
export interface ChatService {

    supportsPlugin: {
        block: boolean;
        messageState: boolean;
    };

    /**
     * Will emit the corresponding contact when a new message arrive.
     */
    message$: Observable<Contact>;

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

    rooms$: Observable<Room[]>;

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
     * Forces asynchronous reloading of your roster list from the server, {@link contacts$} will reflect this.
     */
    reloadContacts(): void;

    /**
     * Returns the contact with the given ID or undefined if no contact with the given ID is found. In case of XMPP it does not have to be
     * bare, the search will convert it to a bare JID.
     * @param id The ID of the contact.
     * @returns Either the Contact or undefined.
     */
    getContactById(id: string): Contact | undefined;

    /**
     * Always returns a contact with the given ID. If no contact exists, a new one is created and announced via contacts$. In case of XMPP
     * it does not have to be bare, the search will convert it to a bare JID.
     * @param id The ID of the contact.
     * @returns The new contact instance.
     */
    getOrCreateContactById(id: string): Contact;

    /**
     * Adds the given contact to the user roster. Will send a subscription request to the contact.
     * @param identifier The ID of the contact.
     */
    addContact(identifier: string): void;

    /**
     * Removes the given contact from the user roster. Will cancel a presence subscription from the user to the contact and will retract
     * accepted subscriptions from the contact to the user.
     * @param identifier The ID of the contact.
     */
    removeContact(identifier: string): void;

    /**
     * Logs the user in. Will modify state$ accordingly. If login fails, state will stay in 'disconnected'.
     */
    logIn(logInRequest: LogInRequest): Promise<void>;

    /**
     * Disconnects from the server, clears contacts$, sets state$ to 'disconnected'.
     */
    logOut(): void;

    /**
     * Sends a given message to a given contact.
     * @param recipient The recipient to which the message shall be sent.
     * @param body The message content.
     */
    sendMessage(recipient: Recipient, body: string): void;

    /**
     * Requests all archived messages for all contacts from the server.
     */
    loadCompleteHistory(): Promise<void>;

    /**
     * Tries to transparently (= without the user noticing) reconnect to the chat server.
     */
    reconnectSilently(): void;

    /**
     * Tries to reconnect with the same credentials the user logged in last.
     */
    reconnect(): void;

    /**
     * Returns the FileUploadHandler for the chosen interface as they have deep dependencies towards the chosen chat system they should
     * be handled separately.
     */
    getFileUploadHandler(): FileUploadHandler;

    blockJid(bareJid: string): Promise<void>;

    joinRoom(jid: JID): Promise<Room>;

    subscribeRoom(roomJid: string, nodes: string[]): Promise<void>;

    unsubscribeRoom(roomJid: string): Promise<void>;

    destroyRoom(roomJid: JID): Promise<IqResponseStanza<'result'>>;

    createRoom(options: RoomCreationOptions): Promise<Room>;

    kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<IqResponseStanza>;

    unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<IqResponseStanza>;

    banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<IqResponseStanza>;

    leaveRoom(occupantJid: JID, status?: string): Promise<void>;

    declineRoomInvite(jid: JID): void;

    queryRoomUserList(roomJid: JID): Promise<RoomUser[]>;

    getRoomConfiguration(roomJid: JID): Promise<Form>;

    kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<IqResponseStanza>;

    inviteUserToRoom(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void>;

    changeRoomSubject(roomJid: JID, subject: string): Promise<void>;

    changeUserNicknameForRoom(newNick: string, roomJid: JID): Promise<void>;

    grantMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    revokeMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    grantAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    revokeAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void>;

    grantModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void>;

    revokeModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void>;

    queryAllRooms(): Promise<RoomSummary[]>;

    loadMostRecentUnloadedMessages(recipient: Recipient);

    getContactMessageState(bareJid: string): StateDate;

    retrieveSubscriptions(): Promise<Map<string, string[]>>;

    /**
     * Promise resolves if user account is registered successfully,
     * rejects if an error happens while registering, e.g. the username is already taken.
     */
    register(username: string,
             password: string,
             service: string,
             domain: string): Promise<void>;

}
