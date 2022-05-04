import {Injectable} from '@angular/core';
import {ChatAction, ChatService, ConnectionStates, RoomCreationOptions, RoomSummary} from '../xmpp/interface/chat.service';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {LogInRequest} from '../../../core/log-in-request';
import {Contact} from '../../../core/contact';
import {Recipient} from '../../../core/recipient';
import {Room} from '../../../core/room';
import {ChatConnection, FileUploadHandler, Form, JidToNumber, Message, MessageState, RoomUser} from '../../../../public-api';
import {JID} from '@xmpp/jid';
import {defaultTranslations} from '../../../core/translations-default';

@Injectable()
export class ConverseXmppChatService implements ChatService {
    unreadMessageCountSum$: Observable<number>;
    private initializedConverse = false;

    readonly message$ = new Subject<Contact>();
    readonly messageSent$: Subject<Contact> = new Subject();
    readonly groupMessage$ = new Subject<Room>();
    readonly state$ = new BehaviorSubject<ConnectionStates>('disconnected');
    readonly contacts$ = new BehaviorSubject<Contact[]>(null);
    readonly contactCreated$ = new Subject<Contact>();
    readonly blockedContacts$ = new Subject<Contact[]>();
    readonly notBlockedContacts$ = new Subject<Contact[]>();
    readonly contactsSubscribed$ = new Subject<Contact[]>();
    readonly contactRequestsSent$ = new Subject<Contact[]>();
    readonly contactRequestsReceived$ = new Subject<Contact[]>();
    readonly contactsUnaffiliated$ = new Subject<Contact[]>();

    enableDebugging = true;
    userAvatar$: BehaviorSubject<string>;
    chatActions: ChatAction[];

    supportsPlugin = { block: false, messageState: false };
    translations = defaultTranslations();

    initialize(): void {
    }

    async logIn(logInRequest: LogInRequest): Promise<void> {
        if (!this.initializedConverse) {
            const pluginName = 'ngx-chat-plugin';
            // converse.plugins.add(pluginName, this);
            /*await converse.initialize(
                {
                    bosh_service_url: `https://${logInRequest.domain}`,
                    websocket_url: `wss://${logInRequest.domain}/ws`,
                    authentication: 'login',
                    jid: logInRequest.username,
                    password: logInRequest.password,
                    auto_login: true,
                    whitelisted_plugins: [pluginName],
                    debug: this.enableDebugging
                });*/
        }
        this.initializedConverse = true;
    }

    async logOut(): Promise<void> {
        await globalThis._converse.api.user.logout();
    }

    sendMessage(recipient: Recipient, body: string): Promise<void> {
        return Promise.resolve();
    }

    async loadCompleteHistory(): Promise<void> {
        // await _converse.ChatBox.fetchMessages();
    }

    reconnectSilently(): Promise<void> {
        globalThis._converse.api.connection.reconnect();
        return Promise.resolve();
    }

    reconnect(): Promise<void> {
        globalThis._converse.api.connection.reconnect();
        return Promise.resolve();
    }

    getFileUploadHandler(): FileUploadHandler {
        return undefined;
    }

    blockJid(bareJid: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    declineRoomInvite(jid: JID) {
    }


    joinRoom(jid: JID) {
        return null;
    }

    loadMostRecentUnloadedMessages(recipient: Recipient) {
    }

    jidToUnreadCount$: Observable<JidToNumber>;
    rooms$: Observable<Room[]>;

    getRoomConfiguration(roomJid: JID): Promise<Form> {
        return Promise.resolve(undefined);
    }

    queryRoomUserList(roomJid: JID): Promise<RoomUser[]> {
        return Promise.resolve([]);
    }


    createRoom(options: RoomCreationOptions): Promise<Room> {
        return Promise.resolve(undefined);
    }


    leaveRoom(occupantJid: JID, status?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    retrieveSubscriptions(): Promise<Map<string, string[]>> {
        return Promise.resolve(undefined);
    }

    subscribeRoom(roomJid: string, nodes: string[]): Promise<void> {
        return Promise.resolve(undefined);
    }


    unsubscribeRoom(roomJid: string): Promise<void> {
        return Promise.resolve(undefined);
    }


    queryAllRooms(): Promise<RoomSummary[]> {
        return Promise.resolve([]);
    }

    changeRoomSubject(roomJid: JID, subject: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    changeUserNicknameForRoom(newNick: string, roomJid: JID): Promise<void> {
        return Promise.resolve(undefined);
    }

    grantAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    grantMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    grantModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    inviteUserToRoom(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    revokeAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    revokeMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    revokeModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    fileUploadHandler: FileUploadHandler;

    addContact(identifier: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    getContactById(id: string): Promise<Contact> {
        return Promise.resolve(undefined);
    }

    getOrCreateContactById(id: string): Promise<Contact> {
        return Promise.resolve(undefined);
    }

    register(user: { username: string; password: string; service: string; domain: string }): Promise<void> {
        return Promise.resolve(undefined);
    }

    reloadContacts(): Promise<void> {
        return Promise.resolve(undefined);
    }

    removeContact(identifier: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    destroyRoom(roomJid: JID): Promise<void> {
        return Promise.resolve(undefined);
    }

    getContactMessageState(message: Message, contactJid: string): MessageState {
        return undefined;
    }

    kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<void> {
        return Promise.resolve(undefined);
    }

    unblockJid(bareJid: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    readonly afterReceiveMessage$: Observable<Element>;
    readonly afterSendMessage$: Observable<Element>;
    readonly beforeSendMessage$: Observable<Element>;
    readonly chatConnectionService: ChatConnection;
    readonly onBeforeOnline$: Observable<void>;
    readonly onOffline$: Observable<void>;

}
