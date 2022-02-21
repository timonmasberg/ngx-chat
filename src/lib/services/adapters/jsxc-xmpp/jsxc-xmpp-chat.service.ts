import {Injectable} from '@angular/core';
import {ChatAction, ChatService, ConnectionStates, RoomCreationOptions, RoomSummary} from '../../chat-service';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {Contact} from '../../../core/contact';
import {Room} from '../../../core/room';
import {Translations} from 'src/lib/core/translations';
import {LogInRequest} from 'src/lib/core/log-in-request';
import {Recipient} from 'src/lib/core/recipient';
import {FileUploadHandler} from 'src/lib/hooks/file-upload-handler';
import {Form, IqResponseStanza, JID, JidToNumber, RoomUser} from 'src/public-api';

@Injectable()
export class JSXCXmppChatService implements ChatService {
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

    logIn(logInRequest: LogInRequest): Promise<void> {
        throw new Error('Method not implemented.');
    }

    logOut(): void {
        throw new Error('Method not implemented.');
    }

    sendMessage(recipient: Recipient, body: string): void {
        throw new Error('Method not implemented.');
    }

    loadCompleteHistory(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    reconnectSilently(): void {
        throw new Error('Method not implemented.');
    }

    reconnect(): void {
        throw new Error('Method not implemented.');
    }

    getFileUploadHandler(): FileUploadHandler {
        throw new Error('Method not implemented.');
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
    unreadMessageCountSum$: Observable<number>;

    getRoomConfiguration(roomJid: JID): Promise<Form> {
        return Promise.resolve(undefined);
    }

    queryRoomUserList(roomJid: JID): Promise<RoomUser[]> {
        return Promise.resolve([]);
    }

    register(username: string, password: string, service: string, domain: string): Promise<void> {
        return Promise.resolve(undefined);
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
