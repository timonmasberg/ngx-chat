import {Injectable} from '@angular/core';
import {jid as parseJid} from '@xmpp/client';
import {BehaviorSubject, combineLatest, merge, Observable, Subject} from 'rxjs';
import {filter, first, map} from 'rxjs/operators';
import {Contact} from '../../../core/contact';
import {dummyAvatarContact} from '../../../core/contact-avatar';
import {LogInRequest} from '../../../core/log-in-request';
import {ChatPlugin} from '../../../core/plugin';
import {Recipient} from '../../../core/recipient';
import {Room} from '../../../core/room';
import {Message, MessageState} from '../../../core/message';
import {Form} from '../../../core/form';
import {Stanza} from '../../../core/stanza';
import {Translations} from '../../../core/translations';
import {defaultTranslations} from '../../../core/translations-default';
import {
    ChatActionContext,
    ChatService,
    ConnectionStates,
    JidToNumber,
    RoomCreationOptions,
    RoomSummary,
    RoomUser
} from '../../chat-service';
import {ContactFactoryService} from '../contact-factory.service';
import {LogService} from '../log.service';
import {MessageArchivePlugin} from './plugins/message-archive.plugin';
import {MessagePlugin} from './plugins/message.plugin';
import {MultiUserChatPlugin} from './plugins/multi-user-chat/multi-user-chat.plugin';
import {RosterPlugin} from './plugins/roster.plugin';
import {ChatConnectionService, ChatStates} from './chat-connection.service';
import {XmppHttpFileUploadPlugin} from './plugins/xmpp-http-file-upload.plugin';
import {JID} from '@xmpp/jid';
import {MucSubPlugin} from './plugins/muc-sub.plugin';
import {RegistrationPlugin} from './plugins/registration.plugin';
import {MessageStatePlugin} from './plugins/message-state.plugin';
import {BlockPlugin} from './plugins/block.plugin';
import {UnreadMessageCountPlugin} from './plugins/unread-message-count.plugin';
import {FileUploadHandler} from '../../../hooks/file-upload-handler';

@Injectable()
export class XmppChatAdapter implements ChatService {

    readonly message$ = new Subject<Contact>();
    readonly groupMessage$ = new Subject<Room>();
    readonly messageSent$: Subject<Contact> = new Subject();

    readonly contacts$ = new BehaviorSubject<Contact[]>([]);
    readonly contactCreated$ = new Subject<Contact>();

    readonly blockedContactJids$ = new BehaviorSubject<Set<string>>(new Set<string>());
    readonly blockedContacts$ = combineLatest([this.contacts$, this.blockedContactJids$])
        .pipe(
            map(
                ([contacts, blockedJids]) =>
                    contacts.filter(contact => blockedJids.has(contact.jidBare.toString())),
            ),
        );
    readonly notBlockedContacts$ = combineLatest([this.contacts$, this.blockedContactJids$])
        .pipe(
            map(
                ([contacts, blockedJids]) =>
                    contacts.filter(contact => !blockedJids.has(contact.jidBare.toString())),
            ),
        );
    readonly contactsSubscribed$: Observable<Contact[]> = this.notBlockedContacts$.pipe(
        map(contacts => contacts.filter(contact => contact.isSubscribed())));
    readonly contactRequestsReceived$: Observable<Contact[]> = this.notBlockedContacts$.pipe(
        map(contacts => contacts.filter(contact => contact.pendingIn$.getValue())));
    readonly contactRequestsSent$: Observable<Contact[]> = this.notBlockedContacts$.pipe(
        map(contacts => contacts.filter(contact => contact.pendingOut$.getValue())));
    readonly contactsUnaffiliated$: Observable<Contact[]> = this.notBlockedContacts$.pipe(
        map(contacts => contacts.filter(contact => contact.isUnaffiliated() && contact.messages.length > 0)));
    readonly state$ = new BehaviorSubject<ConnectionStates>('disconnected');
    readonly plugins: ChatPlugin[] = [];
    enableDebugging = false;
    readonly userAvatar$ = new BehaviorSubject(dummyAvatarContact);
    translations: Translations = defaultTranslations();

    chatActions = [{
        id: 'sendMessage',
        cssClass: 'chat-window-send',
        html: '&raquo;',
        onClick: (chatActionContext: ChatActionContext) => {
            chatActionContext.chatWindow.sendMessage();
        },
    }];

    supportsPlugin = {block: true, messageState: true,};

    get fileUploadHandler(): FileUploadHandler {
        return this.plugins.find(plugin => plugin.constructor === XmppHttpFileUploadPlugin) as XmppHttpFileUploadPlugin;
    }

    get rooms$(): Observable<Room[]> {
        return this.getPlugin(MultiUserChatPlugin).rooms$;
    }

    get jidToUnreadCount$(): Observable<JidToNumber> {
        return this.getPlugin(UnreadMessageCountPlugin).jidToUnreadCount$;
    }

    get unreadMessageCountSum$(): Observable<number> {
        return this.getPlugin(UnreadMessageCountPlugin).unreadMessageCountSum$;
    }

    private lastLogInRequest: LogInRequest;

    private readonly currentLoggedInUserJid$: Observable<string>;

    private readonly currentLoggedInUserJidSubject = new BehaviorSubject<string>(null);

    constructor(
        public chatConnectionService: ChatConnectionService,
        private logService: LogService,
        private contactFactory: ContactFactoryService,
    ) {
        this.state$.subscribe((state) => this.logService.info('state changed to:', state));
        chatConnectionService.state$
            .pipe(filter(nextState => nextState !== this.state$.getValue()))
            .subscribe((nextState) => {
                this.handleInternalStateChange(nextState);
            });
        this.chatConnectionService.stanzaUnknown$.subscribe((stanza) => this.onUnknownStanza(stanza));

        merge(this.messageSent$, this.message$).subscribe(() => {
            // re-emit contacts when sending or receiving a message to refresh contact groups
            // if the sending contact was in 'other', he still is in other now, but passes the 'messages.length > 0' predicate, so that
            // he should be seen now.
            this.contacts$.next(this.contacts$.getValue());
        });

        this.currentLoggedInUserJid$ = combineLatest([chatConnectionService.state$, this.currentLoggedInUserJidSubject])
            .pipe(filter(([state, jid]) => state === 'online' && jid != null), map(([, jid]) => jid));
    }

    async blockJid(bareJid: string): Promise<void> {
        const from = await this.currentLoggedInUserJid$.pipe(first()).toPromise();
        await this.getPlugin(BlockPlugin).blockJid(from, bareJid);
    }

    async unblockJid(bareJid: string): Promise<void> {
        await this.getPlugin(BlockPlugin).unblockJid(bareJid);
    }

    async joinRoom(jid: JID): Promise<Room> {
        return await this.getPlugin(MultiUserChatPlugin).joinRoom(jid);
    }

    async declineRoomInvite(jid: JID): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).declineRoomInvite(jid);
    }

    async queryRoomUserList(roomJid: JID): Promise<RoomUser[]> {
        return await this.getPlugin(MultiUserChatPlugin).queryUserList(roomJid);
    }

    async getRoomConfiguration(roomJid: JID): Promise<Form> {
        return await this.getPlugin(MultiUserChatPlugin).getRoomConfiguration(roomJid);
    }

    async loadMostRecentUnloadedMessages(recipient: Recipient) {
        return await this.getPlugin(MessageArchivePlugin).loadMostRecentUnloadedMessages(recipient);
    }

    getContactMessageState(message: Message, contactJid: string): MessageState {
        const states = this.getPlugin(MessageStatePlugin).getContactMessageState(contactJid);
        const date = message.datetime;

        if (date <= states.lastRecipientSeen) {
            return MessageState.RECIPIENT_SEEN;
        } else if (date <= states.lastRecipientReceived) {
            return MessageState.RECIPIENT_RECEIVED;
        } else if (date <= states.lastSent) {
            return MessageState.SENT;
        }
        return MessageState.UNKNOWN;
    }

    private handleInternalStateChange(newState: ChatStates) {
        if (newState === 'online') {
            this.state$.next('connecting');
            Promise
                .all(this.plugins.map(plugin => plugin.onBeforeOnline()))
                .catch((e) => this.logService.error('error while connecting', e))
                .finally(async () => await this.announceAvailability());
        } else {
            if (this.state$.getValue() === 'online') {
                // clear data the first time we transition to a not-online state
                this.onOffline();
            }
            this.state$.next('disconnected');
        }
    }

    private onOffline() {
        this.contacts$.next([]);
        this.plugins.forEach(plugin => {
            try {
                plugin.onOffline();
            } catch (e) {
                this.logService.error('error while handling offline in ', plugin);
            }
        });
    }

    private async announceAvailability() {
        this.logService.info('announcing availability');
        await this.chatConnectionService.$pres().send();
        this.state$.next('online');
    }

    addPlugins(plugins: ChatPlugin[]) {
        plugins.forEach(plugin => {
            this.plugins.push(plugin);
            if (plugin.constructor === MultiUserChatPlugin) {
                (plugin as MultiUserChatPlugin).message$.subscribe(this.groupMessage$.next);
            }
        });
    }

    async reloadContacts(): Promise<void> {
        await this.getPlugin(RosterPlugin).refreshRosterContacts();
    }

    async getContactById(jidPlain: string): Promise<Contact> {
        return Promise.resolve(this.getContactByIdSync(jidPlain));
    }

    getContactByIdSync(jidPlain: string): Contact {
        const bareJidToFind = parseJid(jidPlain).bare();
        return this.contacts$.getValue().find(contact => contact.jidBare.equals(bareJidToFind));
    }

    async getOrCreateContactById(jidPlain: string, name?: string): Promise<Contact> {
        return Promise.resolve(this.getOrCreateContactByIdSync(jidPlain, name));
    }

    getOrCreateContactByIdSync(jidPlain: string, name?: string): Contact {
        let contact = this.getContactByIdSync(jidPlain);
        if (!contact) {
            contact = this.contactFactory.createContact(parseJid(jidPlain).bare().toString(), name);
            this.contacts$.next([contact, ...this.contacts$.getValue()]);
            this.contactCreated$.next(contact);
        }
        return contact;
    }

    async addContact(identifier: string) {
        await this.getPlugin(RosterPlugin).addRosterContact(identifier);
    }

    async removeContact(identifier: string) {
        await this.getPlugin(RosterPlugin).removeRosterContact(identifier);
    }

    async logIn(logInRequest: LogInRequest) {
        this.lastLogInRequest = logInRequest;
        if (this.state$.getValue() === 'disconnected') {
            await this.chatConnectionService.logIn(logInRequest);
            const {username, domain} = logInRequest;
            this.currentLoggedInUserJidSubject.next(`${username}@${domain}`.toLowerCase());
        }
    }

    async logOut(): Promise<void> {
        await this.chatConnectionService.logOut();
        this.currentLoggedInUserJidSubject.next(null);
    }

    async sendMessage(recipient: Recipient, body: string) {
        const trimmedBody = body.trim();
        if (trimmedBody.length === 0) {
            return;
        }
        switch (recipient.recipientType) {
            case 'room':
                await this.getPlugin(MultiUserChatPlugin).sendMessage(recipient, trimmedBody);
                break;
            case 'contact':
                await this.getPlugin(MessagePlugin).sendMessage(recipient, trimmedBody);
                this.messageSent$.next(recipient);
                break;
            default:
                throw new Error('invalid recipient type: ' + (recipient as any)?.recipientType);
        }
    }

    async loadCompleteHistory() {
        return await this.getPlugin(MessageArchivePlugin).loadAllMessages();
    }

    async reconnectSilently(): Promise<void> {
        this.chatConnectionService.reconnectSilently();
        return Promise.resolve();
    }

    async reconnect() {
        return await this.logIn(this.lastLogInRequest);
    }

    /**
     * Returns the plugin instance for the given constructor
     * @param constructor The plugin constructor, e.g. {@link RosterPlugin}
     */
    private getPlugin<T extends ChatPlugin>(constructor: new(...args: any[]) => T): T {
        for (const plugin of this.plugins) {
            if (plugin.constructor === constructor) {
                return plugin as T;
            }
        }
        throw new Error('plugin not found: ' + constructor);
    }

    private async onUnknownStanza(stanza: Stanza) {

        let handled = false;

        for (const plugin of this.plugins) {
            try {
                if (await plugin.registerHandler(stanza)) {
                    this.logService.debug(plugin.constructor.name, 'handled', stanza.toString());
                    handled = true;
                }
            } catch (e) {
                this.logService.error('error handling stanza in ', plugin.constructor.name, e);
            }
        }

        if (!handled) {
            this.logService.warn('unknown stanza <=', stanza.toString());
        }

    }

    async register(user: { username: string, password: string, service: string, domain: string }): Promise<void> {
        const {username, password, service, domain} = user;
        return await this.getPlugin(RegistrationPlugin).register(username, password, service, domain);
    }

    async banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).banUser(occupantJid, roomJid, reason);
    }

    async unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).unbanUser(occupantJid, roomJid);
    }

    async createRoom(options: RoomCreationOptions): Promise<Room> {
        return await this.getPlugin(MultiUserChatPlugin).createRoom(options);
    }

    async destroyRoom(roomJid: JID): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).destroyRoom(roomJid);
    }

    async kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).kickOccupant(nick, roomJid, reason);
    }

    async leaveRoom(occupantJid: JID, status?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).leaveRoom(occupantJid, status);
    }

    async retrieveSubscriptions(): Promise<Map<string, string[]>> {
        return await this.getPlugin(MucSubPlugin).retrieveSubscriptions();
    }

    async subscribeRoom(roomJid: string, nodes: string[]): Promise<void> {
        return await this.getPlugin(MucSubPlugin).subscribeRoom(roomJid, nodes);
    }

    async unsubscribeRoom(roomJid: string): Promise<void> {
        return await this.getPlugin(MucSubPlugin).unsubscribeRoom(roomJid);
    }

    async kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).kickOccupant(nick, roomJid, reason);
    }

    async queryAllRooms(): Promise<RoomSummary[]> {
        return await this.getPlugin(MultiUserChatPlugin).queryAllRooms();
    }

    async changeRoomSubject(roomJid: JID, subject: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).changeRoomSubject(roomJid, subject);
    }

    async changeUserNicknameForRoom(newNick: string, roomJid: JID): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).changeUserNickname(newNick, roomJid);
    }

    async grantAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).grantAdmin(userJid, roomJid, reason);
    }

    async grantMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).grantMembership(userJid, roomJid, reason);
    }

    async grantModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).grantModeratorStatus(occupantNick, roomJid, reason);
    }

    async inviteUserToRoom(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).inviteUser(inviteeJid, roomJid, invitationMessage);
    }

    async revokeAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).revokeAdmin(userJid, roomJid, reason);
    }

    async revokeMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).revokeMembership(userJid, roomJid, reason);
    }

    async revokeModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.getPlugin(MultiUserChatPlugin).revokeModeratorStatus(occupantNick, roomJid, reason);
    }
}
