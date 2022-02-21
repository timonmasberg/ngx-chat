import {Injectable} from '@angular/core';
import {ChatAction, ChatService, ConnectionStates, RoomCreationOptions, RoomSummary} from '../../chat-service';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {LogInRequest} from 'src/lib/core/log-in-request';
import {Contact} from '../../../core/contact';
import {Recipient} from '../../../core/recipient';
import {Room} from '../../../core/room';
import {Translations} from 'src/lib/core/translations';
import 'src/manual_typings/@converse';
import {_converse, converse, ConversePlugin} from '@converse/headless/core';
import {FileUploadHandler, Form, IqResponseStanza, JidToNumber, RoomUser} from 'src/public-api';
import {JID} from '@xmpp/jid';

@Injectable()
export class ConverseXmppChatService implements ChatService, ConversePlugin {
    unreadMessageCountSum$: Observable<number>;
    register(username: string, password: string, service: string, domain: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    private initializedConverse = false;

    readonly message$ = new Subject<Contact>();
    readonly groupMessage$ = new Subject<Room>();
    readonly state$ = new BehaviorSubject<ConnectionStates>('disconnected');
    readonly contacts$ = new BehaviorSubject<Contact[]>(null);
    readonly blockedContacts$ = new Subject<Contact[]>();
    readonly notBlockedContacts$ = new Subject<Contact[]>();
    readonly contactsSubscribed$ = new Subject<Contact[]>();
    readonly contactRequestsSent$ = new Subject<Contact[]>();
    readonly contactRequestsReceived$ = new Subject<Contact[]>();
    readonly contactsUnaffiliated$ = new Subject<Contact[]>();

    enableDebugging = true;
    userAvatar$: BehaviorSubject<string>;
    translations: Translations;
    chatActions: ChatAction[];

    supportsPlugin: { block: boolean; messageState: boolean };

    reloadContacts(): void {
        throw new Error('Method not implemented.');
    }

    getContactById(id: string): Contact {
        throw new Error('Method not implemented.');
    }

    getOrCreateContactById(id: string): Contact {
        throw new Error('Method not implemented.');
    }

    addContact(identifier: string): void {
        throw new Error('Method not implemented.');
    }

    removeContact(identifier: string): void {
        throw new Error('Method not implemented.');
    }

    initialize(): void {
    }

    async logIn(logInRequest: LogInRequest): Promise<void> {
        if (!this.initializedConverse) {
            const pluginName = 'ngx-chat-plugin';
            converse.plugins.add(pluginName, this);
            await converse.initialize(
                {
                    bosh_service_url: `https://${logInRequest.domain}`,
                    websocket_url: `wss://${logInRequest.domain}/ws`,
                    authentication: 'login',
                    jid: logInRequest.username,
                    password: logInRequest.password,
                    auto_login: true,
                    whitelisted_plugins: [pluginName],
                    debug: this.enableDebugging
                });
        }
        this.initializedConverse = true;
    }

    async logOut(): Promise<void> {
        await _converse.api.user.logout();
    }

    sendMessage(recipient: Recipient, body: string): void {
        throw new Error('Method not implemented.');
    }

    async loadCompleteHistory(): Promise<void> {
       // await _converse.ChatBox.fetchMessages();
    }

    reconnectSilently(): void {
        _converse.api.connection.reconnect();
    }

    reconnect(): void {
        _converse.api.connection.reconnect();
    }

    getFileUploadHandler(): FileUploadHandler {
        return undefined;
    }

    blockJid(bareJid: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    declineRoomInvite(jid: JID) {
    }

    getContactMessageState(bareJid: string) {
        return null;
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

    banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<IqResponseStanza> {
        return Promise.resolve(undefined);
    }

    createRoom(options: RoomCreationOptions): Promise<Room> {
        return Promise.resolve(undefined);
    }

    destroyRoom(roomJid: JID): Promise<IqResponseStanza<"result">> {
        return Promise.resolve(undefined);
    }

    kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<IqResponseStanza> {
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

    unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<IqResponseStanza> {
        return Promise.resolve(undefined);
    }

    unsubscribeRoom(roomJid: string): Promise<void> {
        return Promise.resolve(undefined);
    }

    kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<IqResponseStanza> {
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

}
