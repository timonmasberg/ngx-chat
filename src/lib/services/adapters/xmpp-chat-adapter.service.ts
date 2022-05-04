import {Inject, Injectable, NgZone} from '@angular/core';
import {jid as parseJid} from '@xmpp/client';
import {BehaviorSubject, combineLatest, merge, Observable, Subject} from 'rxjs';
import {filter, first, map} from 'rxjs/operators';
import {Contact} from '../../core/contact';
import {dummyAvatarContact} from '../../core/contact-avatar';
import {LogInRequest} from '../../core/log-in-request';
import {Recipient} from '../../core/recipient';
import {Room} from '../../core/room';
import {Message, MessageState} from '../../core/message';
import {Form} from '../../core/form';
import {Translations} from '../../core/translations';
import {defaultTranslations} from '../../core/translations-default';
import {
    ChatActionContext,
    ChatService,
    ConnectionStates,
    JidToNumber,
    RoomCreationOptions,
    RoomSummary,
    RoomUser
} from './xmpp/interface/chat.service';
import {ContactFactoryService} from './xmpp/service/contact-factory.service';
import {LogService} from './xmpp/service/log.service';
import {MessageArchivePlugin} from './xmpp/plugins/message-archive.plugin';
import {MessagePlugin} from './xmpp/plugins/message.plugin';
import {MultiUserChatPlugin} from './xmpp/plugins/multi-user-chat/multi-user-chat.plugin';
import {RosterPlugin} from './xmpp/plugins/roster.plugin';
import {CHAT_CONNECTION_FACTORY_TOKEN, ChatConnection, ChatConnectionFactory, ChatStates} from './xmpp/interface/chat-connection';
import {XmppHttpFileUploadHandler} from './xmpp/plugins/xmpp-http-file-upload.handler';
import {JID} from '@xmpp/jid';
import {MucSubPlugin} from './xmpp/plugins/muc-sub.plugin';
import {RegistrationPlugin} from './xmpp/plugins/registration.plugin';
import {MessageStatePlugin} from './xmpp/plugins/message-state.plugin';
import {BlockPlugin} from './xmpp/plugins/block.plugin';
import {UnreadMessageCountService} from './xmpp/service/unread-message-count.service';
import {FileUploadHandler} from '../../hooks/file-upload-handler';
import {BookmarkPlugin} from './xmpp/plugins/bookmark.plugin';
import {EntityCapabilitiesPlugin} from './xmpp/plugins/entity-capabilities.plugin';
import {EntityTimePlugin} from './xmpp/plugins/entity-time.plugin';
import {MessageCarbonsPlugin} from './xmpp/plugins/message-carbons.plugin';
import {MessageUuidPlugin} from './xmpp/plugins/message-uuid.plugin';
import {PingPlugin} from './xmpp/plugins/ping.plugin';
import {PublishSubscribePlugin} from './xmpp/plugins/publish-subscribe.plugin';
import {PushPlugin} from './xmpp/plugins/push.plugin';
import {ServiceDiscoveryPlugin} from './xmpp/plugins/service-discovery.plugin';
import {ChatMessageListRegistryService} from '../components/chat-message-list-registry.service';
import {HttpClient} from '@angular/common/http';

@Injectable()
export class XmppChatAdapter implements ChatService {
    readonly chatConnectionService: ChatConnection;

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

    /**
     * Observable for plugins to clear up data.
     */
    readonly afterReceiveMessage$: Observable<Element>;
    readonly afterSendMessage$: Observable<Element>;
    readonly beforeSendMessage$: Observable<Element>;
    readonly onBeforeOnline$: Observable<void>;
    readonly onOffline$: Observable<void>;

    private readonly afterReceiveMessageSubject = new Subject<Element>();
    private readonly afterSendMessageSubject = new Subject<Element>();
    private readonly beforeSendMessageSubject = new Subject<Element>();
    private readonly onBeforeOnlineSubject = new Subject<void>();
    private readonly onOfflineSubject = new Subject<void>();


    readonly plugins: {
        muc: MultiUserChatPlugin,
        block: BlockPlugin,
        bookmark: BookmarkPlugin,
        entityCapabilities: EntityCapabilitiesPlugin,
        entityTime: EntityTimePlugin,
        message: MessagePlugin,
        mam: MessageArchivePlugin,
        messageCarbon: MessageCarbonsPlugin,
        messageState: MessageStatePlugin,
        messageUuid: MessageUuidPlugin,
        mucSub: MucSubPlugin,
        ping: PingPlugin,
        pubSub: PublishSubscribePlugin,
        push: PushPlugin,
        roster: RosterPlugin,
        register: RegistrationPlugin,
        disco: ServiceDiscoveryPlugin,
        unreadMessageCount: UnreadMessageCountService,
        xmppFileUpload: XmppHttpFileUploadHandler,
    };
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
        return this.plugins.xmppFileUpload;
    }

    get rooms$(): Observable<Room[]> {
        return this.plugins.muc.rooms$;
    }

    get jidToUnreadCount$(): Observable<JidToNumber> {
        return this.plugins.unreadMessageCount.jidToUnreadCount$;
    }

    get unreadMessageCountSum$(): Observable<number> {
        return this.plugins.unreadMessageCount.unreadMessageCountSum$;
    }

    private lastLogInRequest: LogInRequest;

    private readonly currentLoggedInUserJid$: Observable<string>;

    private readonly currentLoggedInUserJidSubject = new BehaviorSubject<string>(null);

    constructor(
        private logService: LogService,
        private contactFactory: ContactFactoryService,
        @Inject(CHAT_CONNECTION_FACTORY_TOKEN) private connectionFactory: ChatConnectionFactory,
        private chatMessageListRegistryService: ChatMessageListRegistryService,
        private ngZone: NgZone,
        private httpClient: HttpClient,
    ) {
        this.chatConnectionService = connectionFactory.create(
            logService,
            this.afterReceiveMessageSubject,
            this.afterSendMessageSubject,
            this.beforeSendMessageSubject,
            this.onBeforeOnlineSubject,
            this.onOfflineSubject
        );

        this.state$.subscribe((state) => this.logService.info('state changed to:', state));
        this.chatConnectionService.state$
            .pipe(filter(nextState => nextState !== this.state$.getValue()))
            .subscribe((nextState) => this.handleInternalStateChange(nextState));
        this.chatConnectionService.stanzaUnknown$.subscribe((stanza) => this.logService.warn('unknown stanza <=', stanza.toString()));

        merge(this.messageSent$, this.message$).subscribe(() => {
            // re-emit contacts when sending or receiving a message to refresh contact groups
            // if the sending contact was in 'other', he still is in other now, but passes the 'messages.length > 0' predicate, so that
            // he should be seen now.
            this.contacts$.next(this.contacts$.getValue());
        });

        this.afterReceiveMessage$ = this.afterReceiveMessageSubject.asObservable();
        this.afterSendMessage$ = this.afterSendMessageSubject.asObservable();
        this.beforeSendMessage$ = this.beforeSendMessageSubject.asObservable();
        this.onOffline$ = this.onOfflineSubject.asObservable();

        const serviceDiscoveryPlugin = new ServiceDiscoveryPlugin(this);
        const publishSubscribePlugin = new PublishSubscribePlugin(this);
        const entityTimePlugin = new EntityTimePlugin(this, serviceDiscoveryPlugin, logService);
        const multiUserChatPlugin = new MultiUserChatPlugin(this, logService, serviceDiscoveryPlugin);
        multiUserChatPlugin.message$.subscribe(this.groupMessage$.next);
        const unreadMessageCountPlugin = new UnreadMessageCountService(this, chatMessageListRegistryService, publishSubscribePlugin, entityTimePlugin, multiUserChatPlugin);
        const messagePlugin = new MessagePlugin(this, logService);

        const uploadServicePromise = XmppHttpFileUploadHandler.getUploadServiceThroughServiceDiscovery(serviceDiscoveryPlugin);
        this.plugins = {
            muc: multiUserChatPlugin,
            block: new BlockPlugin(this),
            bookmark: new BookmarkPlugin(publishSubscribePlugin),
            entityCapabilities: new EntityCapabilitiesPlugin(this),
            entityTime: entityTimePlugin,
            message: messagePlugin,
            mam: new MessageArchivePlugin(this, serviceDiscoveryPlugin, multiUserChatPlugin, logService, messagePlugin),
            messageCarbon: new MessageCarbonsPlugin(this),
            messageState: new MessageStatePlugin(publishSubscribePlugin, this, chatMessageListRegistryService, logService, entityTimePlugin),
            messageUuid: new MessageUuidPlugin(),
            mucSub: new MucSubPlugin(this, serviceDiscoveryPlugin),
            ping: new PingPlugin(this, logService, ngZone),
            pubSub: publishSubscribePlugin,
            push: new PushPlugin(this, serviceDiscoveryPlugin),
            roster: new RosterPlugin(this, logService),
            register: new RegistrationPlugin(logService, ngZone, this.chatConnectionService),
            disco: serviceDiscoveryPlugin,
            unreadMessageCount: unreadMessageCountPlugin,
            xmppFileUpload: new XmppHttpFileUploadHandler(httpClient, this, uploadServicePromise),
        };

        this.currentLoggedInUserJid$ = combineLatest([this.chatConnectionService.state$, this.currentLoggedInUserJidSubject])
            .pipe(filter(([state, jid]) => state === 'online' && jid != null), map(([, jid]) => jid));
    }

    async blockJid(bareJid: string): Promise<void> {
        const from = await this.currentLoggedInUserJid$.pipe(first()).toPromise();
        await this.plugins.block.blockJid(from, bareJid);
    }

    async unblockJid(bareJid: string): Promise<void> {
        await this.plugins.block.unblockJid(bareJid);
    }

    async joinRoom(jid: JID): Promise<Room> {
        return await this.plugins.muc.joinRoom(jid);
    }

    async declineRoomInvite(jid: JID): Promise<void> {
        await this.plugins.muc.declineRoomInvite(jid);
    }

    async queryRoomUserList(roomJid: JID): Promise<RoomUser[]> {
        return await this.plugins.muc.queryUserList(roomJid);
    }

    async getRoomConfiguration(roomJid: JID): Promise<Form> {
        return await this.plugins.muc.getRoomConfiguration(roomJid);
    }

    async loadMostRecentUnloadedMessages(recipient: Recipient) {
        return await this.plugins.mam.loadMostRecentUnloadedMessages(recipient);
    }

    getContactMessageState(message: Message, contactJid: string): MessageState {
        const states = this.plugins.messageState.getContactMessageState(contactJid);
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
        // TODO make unnecessary
        /* if (newState === 'online') {
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
         }*/
    }

    private onOffline() {
        this.contacts$.next([]);
    }

    private async announceAvailability() {
        this.logService.info('announcing availability');
        await this.chatConnectionService.$pres().send();
        this.state$.next('online');
    }

    async reloadContacts(): Promise<void> {
        await this.plugins.roster.refreshRosterContacts();
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
        await this.plugins.roster.addRosterContact(identifier);
    }

    async removeContact(identifier: string) {
        await this.plugins.roster.removeRosterContact(identifier);
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
                await this.plugins.muc.sendMessage(recipient, trimmedBody);
                break;
            case 'contact':
                await this.plugins.message.sendMessage(recipient, trimmedBody);
                this.messageSent$.next(recipient);
                break;
            default:
                throw new Error('invalid recipient type: ' + (recipient as any)?.recipientType);
        }
    }

    async loadCompleteHistory() {
        return await this.plugins.mam.loadAllMessages();
    }

    async reconnectSilently(): Promise<void> {
        this.chatConnectionService.reconnectSilently();
        return Promise.resolve();
    }

    async reconnect() {
        return await this.logIn(this.lastLogInRequest);
    }

    async register(user: { username: string, password: string, service: string, domain: string }): Promise<void> {
        const {username, password, service, domain} = user;
        return await this.plugins.register.register(username, password, service, domain);
    }

    async banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.banUser(occupantJid, roomJid, reason);
    }

    async unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<void> {
        await this.plugins.muc.unbanUser(occupantJid, roomJid);
    }

    async createRoom(options: RoomCreationOptions): Promise<Room> {
        return await this.plugins.muc.createRoom(options);
    }

    async destroyRoom(roomJid: JID): Promise<void> {
        await this.plugins.muc.destroyRoom(roomJid);
    }

    async kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.kickOccupant(nick, roomJid, reason);
    }

    async leaveRoom(occupantJid: JID, status?: string): Promise<void> {
        await this.plugins.muc.leaveRoom(occupantJid, status);
    }

    async retrieveSubscriptions(): Promise<Map<string, string[]>> {
        return await this.plugins.mucSub.retrieveSubscriptions();
    }

    async subscribeRoom(roomJid: string, nodes: string[]): Promise<void> {
        return await this.plugins.mucSub.subscribeRoom(roomJid, nodes);
    }

    async unsubscribeRoom(roomJid: string): Promise<void> {
        return await this.plugins.mucSub.unsubscribeRoom(roomJid);
    }

    async kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.kickOccupant(nick, roomJid, reason);
    }

    async queryAllRooms(): Promise<RoomSummary[]> {
        return await this.plugins.muc.queryAllRooms();
    }

    async changeRoomSubject(roomJid: JID, subject: string): Promise<void> {
        await this.plugins.muc.changeRoomSubject(roomJid, subject);
    }

    async changeUserNicknameForRoom(newNick: string, roomJid: JID): Promise<void> {
        await this.plugins.muc.changeUserNickname(newNick, roomJid);
    }

    async grantAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.grantAdmin(userJid, roomJid, reason);
    }

    async grantMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.grantMembership(userJid, roomJid, reason);
    }

    async grantModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.grantModeratorStatus(occupantNick, roomJid, reason);
    }

    async inviteUserToRoom(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void> {
        await this.plugins.muc.inviteUser(inviteeJid, roomJid, invitationMessage);
    }

    async revokeAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.revokeAdmin(userJid, roomJid, reason);
    }

    async revokeMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.revokeMembership(userJid, roomJid, reason);
    }

    async revokeModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        await this.plugins.muc.revokeModeratorStatus(occupantNick, roomJid, reason);
    }
}
