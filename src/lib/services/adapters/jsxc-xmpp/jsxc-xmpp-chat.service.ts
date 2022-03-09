import {Injectable} from '@angular/core';
import {
    Affiliation,
    ChatAction,
    ChatService,
    ConnectionStates,
    RoomUser,
    Role,
    RoomCreationOptions,
    RoomSummary,
    JidToNumber
} from '../../chat-service';
import {BehaviorSubject, combineLatest, merge, Observable, Subject} from 'rxjs';
import {Contact} from '../../../core/contact';
import {Room} from '../../../core/room';
import {LogInRequest} from '../../../core/log-in-request';
import {Recipient} from '../../../core/recipient';
import {FileUploadHandler} from '../../../hooks/file-upload-handler';
import {Form, parseForm, toLtxElement} from '../../../core/form';
import {ContactFactoryService} from '../contact-factory.service';
import JSXC from './jsxc/src';
import PluginRepository from './jsxc/src/plugin/PluginRepository';
import BlockingCommandPlugin from './jsxc/src/plugins/BlockingCommandPlugin';
import {AccountWrapper, ContactWrapper, MultiUserContactWrapper} from './jsxc/src/api/account-wrapper';
import {JID, jid} from '@xmpp/jid';
import Message from './jsxc/src/Message';
import MessageArchiveManagementPlugin from './jsxc/src/plugins/mam/Plugin';
import {AFFILIATION, ROLE} from './jsxc/src/MultiUserContact';
import {MUC_SUB_FEATURE_ID} from '../xmpp/plugins/muc-sub.plugin';
import {FormFromJSON} from './jsxc/src/connection/Form';
import {DIRECTION} from './jsxc/src/Message.interface';
import {LogService} from '../log.service';
import {MessageState, Message as ApiMessage} from '../../../core/message';
import {defaultTranslations} from '../../../core/translations-default';
import {dummyAvatarContact} from '../../../core/contact-avatar';
import {filter, map} from 'rxjs/operators';
import Client from './jsxc/src/Client';
import ReceiptPlugin from './jsxc/src/plugins/MessageDeliveryReceiptsPlugin';
import NotificationPlugin from './jsxc/src/plugins/NotificationPlugin';
import MeCommandPlugin from './jsxc/src/plugins/MeCommandPlugin';
import ChatStatePlugin from './jsxc/src/plugins/chatState/ChatStatePlugin';
import HttpUploadPlugin from './jsxc/src/plugins/httpUpload/HttpUploadPlugin';
import AvatarVCardPlugin from './jsxc/src/plugins/AvatarVCardPlugin';
import CarbonsPlugin from './jsxc/src/plugins/MessageCarbonsPlugin';
import BookmarksPlugin from './jsxc/src/plugins/bookmarks/BookmarksPlugin';
import ChatMarkersPlugin from './jsxc/src/plugins/chatMarkers/ChatMarkersPlugin';
import PingPlugin from './jsxc/src/plugins/PingPlugin';
import CommandPlugin from './jsxc/src/plugins/CommandPlugin';
import VersionPlugin from './jsxc/src/plugins/VersionPlugin';
import TimePlugin from './jsxc/src/plugins/TimePlugin';
import JingleMessageInitiationPlugin from './jsxc/src/plugins/JingleMessageInitiationPlugin';
import AvatarPEPPlugin from './jsxc/src/plugins/AvatarPEPPlugin';
import LastMessageCorrectionPlugin from './jsxc/src/plugins/LastMessageCorrectionPlugin';

@Injectable()
export class JSXCXmppChatService implements ChatService {
    readonly message$ = new Subject<Contact>();
    readonly messageSent$: Subject<Contact> = new Subject();

    readonly groupMessage$ = new Subject<Room>();
    readonly state$ = new BehaviorSubject<ConnectionStates>('disconnected');

    readonly contacts$ = new BehaviorSubject<Contact[]>([]);
    readonly contactCreated$ = new Subject<Contact>();

    readonly rooms$ = new BehaviorSubject<Room[]>([]);

    readonly blockedContactIds$ = new BehaviorSubject<Set<string>>(new Set<string>());
    readonly blockedContacts$ = combineLatest([this.contacts$, this.blockedContactIds$])
        .pipe(
            map(
                ([contacts, blockedJids]) =>
                    contacts.filter(contact => blockedJids.has(contact.jidBare.toString())),
            ),
        );
    readonly notBlockedContacts$ = combineLatest([this.contacts$, this.blockedContactIds$])
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

    readonly userAvatar$ = new BehaviorSubject(dummyAvatarContact);
    chatActions: ChatAction[];
    jidToUnreadCount$: Observable<JidToNumber>;
    unreadMessageCountSum$: Observable<number>;

    fileUploadHandler: FileUploadHandler;
    enableDebugging = true;
    supportsPlugin = {block: true, messageState: false};
    translations = defaultTranslations();

    private readonly jsxc = new JSXC({});

    private currentUserPluginRepository: PluginRepository;
    private currentUserAccountWrapper: AccountWrapper;
    private currentAccountSubject = new Subject<AccountWrapper>();

    constructor(private readonly logService: LogService, private readonly contactFactory: ContactFactoryService) {
        // Client.addPlugin(OTRPlugin);
        // Client.addPlugin(OMEMOPlugin);
        Client.addPlugin(ReceiptPlugin);
        Client.addPlugin(NotificationPlugin);
        Client.addPlugin(MeCommandPlugin);
        Client.addPlugin(MessageArchiveManagementPlugin);
        Client.addPlugin(ChatStatePlugin);
        Client.addPlugin(HttpUploadPlugin);
        Client.addPlugin(AvatarVCardPlugin);
        Client.addPlugin(BlockingCommandPlugin);
        Client.addPlugin(CarbonsPlugin);
        Client.addPlugin(BookmarksPlugin);
        Client.addPlugin(ChatMarkersPlugin);
        Client.addPlugin(PingPlugin);
        Client.addPlugin(CommandPlugin);
        Client.addPlugin(VersionPlugin);
        Client.addPlugin(TimePlugin);
        Client.addPlugin(JingleMessageInitiationPlugin);
        Client.addPlugin(AvatarPEPPlugin);
        Client.addPlugin(LastMessageCorrectionPlugin);
        merge(this.messageSent$, this.message$).subscribe(() => {
            // re-emit contacts when sending or receiving a message to refresh contact groups
            // if the sending contact was in 'other', he still is in other now, but passes the 'messages.length > 0' predicate, so that
            // he should be seen now.
            this.contacts$.next(this.contacts$.getValue());
        });
        combineLatest([this.state$, this.currentAccountSubject]).pipe(filter(([state]) => state === 'online'))
            .subscribe(async ([_, account]) => {
                this.currentUserPluginRepository = account.innerAccount.getPluginRepository();
                const blockedIds = await this.currentUserPluginRepository
                    .getPlugin<BlockingCommandPlugin>(BlockingCommandPlugin.getId())
                    .getBlocklist();
                this.blockedContactIds$.next(new Set(blockedIds));
                const contactManager = account.innerAccount.getContactManager();
                contactManager.registerNewContactHook((contact) => {
                    if (contact.isGroupChat) {
                        const newRoom = new Room(jid(contact.getJid().toString()), this.logService);
                        this.rooms$.next([newRoom, ...this.rooms$.getValue()]);
                        return;
                    }
                    const newContact = this.contactFactory.createContact(contact.getJid().toString());
                    this.contactCreated$.next(newContact);
                    return this.contacts$.next([newContact, ...this.contacts$.getValue()]);
                });
            });
    }

    async logIn(logInRequest: LogInRequest): Promise<void> {
        if (this.state$.getValue() === 'connecting') {
            return;
        }
        this.state$.next('connecting');
        await this.jsxc.startWithCredentials(logInRequest.service, logInRequest.username, logInRequest.password, (status) => {
            switch (status) {
                case Strophe.Status.CONNECTED:
                case Strophe.Status.DISCONNECTING:
                case Strophe.Status.ATTACHED:
                    this.state$.next('online');
                    break;
                case Strophe.Status.CONNECTING:
                case Strophe.Status.AUTHENTICATING:
                case Strophe.Status.REDIRECT:
                    this.state$.next('connecting');
                    break;
                case Strophe.Status.CONNFAIL:
                case Strophe.Status.ERROR:
                case Strophe.Status.CONNTIMEOUT:
                case Strophe.Status.AUTHFAIL:
                case Strophe.Status.DISCONNECTED:
                    this.contacts$.next([]);
                    this.state$.next('disconnected');
                    break;
            }
        });
        this.currentUserAccountWrapper = this.jsxc.getAccount(logInRequest.username);
        this.currentAccountSubject.next(this.currentUserAccountWrapper);
    }

    async logOut(): Promise<void> {
        await this.jsxc.disconnect();
        this.state$.next('disconnected');
    }

    async blockJid(bareJid: string): Promise<void> {
        const blockPlugin = this.currentUserPluginRepository.getPlugin<BlockingCommandPlugin>(BlockingCommandPlugin.getId());
        await blockPlugin.block([bareJid]);
    }

    async declineRoomInvite(jid: JID): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(jid.toString());
        muc.rejectInvitation();
    }

    getContactMessageState(message: ApiMessage, contactJid: string) {
        const msg = new Message(message.id);
        if (!msg.isUnread()) {
            return MessageState.RECIPIENT_SEEN;
        } else if (msg.isReceived()) {
            return MessageState.RECIPIENT_RECEIVED;
        } else if (msg.isTransferred()) {
            return MessageState.SENT;
        }
        return MessageState.UNKNOWN;
    }

    async joinRoom(jid: JID): Promise<Room> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(jid.toString());
        muc.join();

        return Promise.resolve(new Room(jid, this.logService));
    }

    async loadMostRecentUnloadedMessages(recipient: Recipient) {
        const mamPlugin = this.currentUserPluginRepository.getPlugin<MessageArchiveManagementPlugin>(MessageArchiveManagementPlugin.getId());
        const archive = mamPlugin.getArchive(this.jsxc.toJid(recipient.jidBare.toString()));
        archive.nextMessages('100');
    }

    async getRoomConfiguration(roomJid: JID): Promise<Form> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        const form = await muc.getRoomConfigurationFormElement();
        return parseForm(toLtxElement(form));
    }

    async queryRoomUserList(roomJid: JID): Promise<RoomUser[]> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        const mucUsers = muc.getRoomUsers().map(user => {
            return {
                userIdentifiers: user.userIdentifiers.map(userIdentifier => {
                    return {
                        userJid: jid(userIdentifier.userJid.toString()),
                        nick: userIdentifier.nick
                    };

                }),
                affiliation: JSXCXmppChatService.mapAffiliation(user.affiliation),
                role: JSXCXmppChatService.mapRole(user.role),
            };
        });
        return Promise.resolve(mucUsers);
    }

    private static mapAffiliation(affiliation: AFFILIATION) {
        switch (affiliation) {
            case AFFILIATION.ADMIN:
                return Affiliation.admin;
            case AFFILIATION.MEMBER:
                return Affiliation.member;
            case AFFILIATION.OUTCAST:
                return Affiliation.outcast;
            case AFFILIATION.OWNER:
                return Affiliation.owner;
            case AFFILIATION.NONE:
            default:
                return Affiliation.none;
        }

    }

    private static mapRole(role: ROLE) {
        switch (role) {
            case ROLE.MODERATOR:
                return Role.moderator;
            case ROLE.PARTICIPANT:
                return Role.participant;
            case ROLE.VISITOR:
                return Role.visitor;
            case ROLE.NONE:
            default:
                return Role.none;
        }
    }

    async banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.ban(this.jsxc.toJid(occupantJid.toString()), reason);
        return Promise.resolve();
    }

    async createRoom(options: RoomCreationOptions): Promise<Room> {
        if (this.isOffline()) {
            return null;
        }
        const mucWrapper = this.currentUserAccountWrapper.createMultiUserContact(options.roomId, options.nick, options.name);
        const defaultConfig = await mucWrapper.getRoomConfigurationForm();
        delete options.roomId;
        delete options.nick;
        delete options.name;
        Object.keys(options).forEach(key => defaultConfig.fields.find(field => field.name === key).values = [options[key].toString()]);
        await mucWrapper.submitRoomConfigurationForm(defaultConfig);
        return new Room(jid(mucWrapper.getJid().toString()), this.logService);
    }

    async destroyRoom(roomJid: JID): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(jid.toString());
        await muc.destroy();
    }

    async kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.kick(nick, reason);
        return Promise.resolve();
    }

    async leaveRoom(roomJid: JID, status?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.leave();
        return Promise.resolve();
    }

    async retrieveSubscriptions(): Promise<Map<string, string[]>> {
        if (this.isOffline()) {
            return new Map<string, string[]>();
        }
        const subscriptions = await this.currentUserAccountWrapper.innerAccount.getConnection().getPubSubService.getSubscriptions();

        const mapped = toLtxElement(subscriptions)
            .getChild('subscriptions', MUC_SUB_FEATURE_ID)
            ?.getChildren('subscription')
            ?.map(subscriptionElement => {
                const subscribedEvents: string[] = subscriptionElement
                    .getChildren('event')
                    ?.map(eventElement => eventElement.attrs.node) ?? [];
                return [subscriptionElement.attrs.jid as string, subscribedEvents] as const;
            });

        return new Map(mapped);
    }

    async subscribeRoom(roomJid: string, nodes: string[]): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        // @TODO fix, probably different xml structure for room subs
        await Promise.all(nodes.map(node => this.currentUserAccountWrapper.innerAccount.getConnection().getPubSubService.subscribe(node, null)));
    }

    async unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.unban(this.jsxc.toJid(occupantJid.toString()));
        return Promise.resolve();
    }

    async unsubscribeRoom(roomJid: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        // @TODO fix
        await this.currentUserAccountWrapper.innerAccount.getConnection().getPubSubService.unsubscribe(null, this.jsxc.toJid(roomJid));
    }

    async kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.kick(nick, reason);
        return Promise.resolve();
    }

    async queryAllRooms(): Promise<RoomSummary[]> {
        if (this.isOffline()) {
            return [];
        }
        const serverJid = this.currentUserAccountWrapper.innerAccount.getConnection().getServerJID;
        const jsxcRoomSummaries = await this.currentUserAccountWrapper.innerAccount.getConnection().getMUCService.queryAllRooms(serverJid);
        return jsxcRoomSummaries.map(summary => {
            return {
                roomInfo: parseForm(toLtxElement(summary.roomInfo.toXML())),
                jid: jid(summary.jid.toString()),
                name: summary.name
            };
        });
    }

    async changeRoomSubject(roomJid: JID, subject: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeTopic(subject);
        return Promise.resolve();
    }

    async changeUserNicknameForRoom(newNick: string, roomJid: JID): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeNickname(newNick);
        return Promise.resolve();
    }

    async grantAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'admin');
        return Promise.resolve();
    }

    async grantMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'member');
        return Promise.resolve();
    }

    async grantModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeRole(occupantNick, 'moderator');
        return Promise.resolve();
    }

    async inviteUserToRoom(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        await muc.multiUserContact.invite(this.jsxc.toJid(inviteeJid.toString()), invitationMessage);
    }

    async revokeAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'member');
        return Promise.resolve();
    }

    async revokeMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'none');
        return Promise.resolve();
    }

    async revokeModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeRole(occupantNick, 'participant');
        return Promise.resolve();
    }

    async addContact(identifier: string): Promise<void> {
        await this.currentUserAccountWrapper.innerAccount.getConnection().getRosterService.addContact(this.jsxc.toJid(identifier), identifier);
    }

    async getContactById(id: string): Promise<Contact> {
        if (this.isOffline()) {
            return null;
        }
        const contact = this.currentUserAccountWrapper.getContact(id);
        return Promise.resolve(this.contactFactory.createContact(contact.getJid().toString()));
    }

    async getOrCreateContactById(id: string): Promise<Contact> {
        if (this.isOffline()) {
            return null;
        }
        const contact = this.currentUserAccountWrapper.getContact(id);
        return Promise.resolve(this.contactFactory.createContact(contact.getJid().toString()));
    }

    async loadCompleteHistory(): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const repo = this.currentUserAccountWrapper.innerAccount.getPluginRepository();
        const mam = repo.getPlugin<MessageArchiveManagementPlugin>(MessageArchiveManagementPlugin.getId());
        mam.getArchive(this.currentUserAccountWrapper.jid);
        return Promise.resolve();
    }

    async reconnect(): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        return Promise.resolve(this.jsxc.connect(this.currentUserAccountWrapper.innerAccount));
    }

    async reconnectSilently(): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        return Promise.resolve(this.jsxc.connect(this.currentUserAccountWrapper.innerAccount));
    }

    async reloadContacts(): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        this.jsxc.restoreAccounts();
        return Promise.resolve();
    }

    async removeContact(identifier: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        await this.currentUserAccountWrapper.innerAccount.getConnection().getRosterService.removeContact(this.jsxc.toJid(identifier));
    }

    async sendMessage(recipient: Recipient, body: string): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        const contact = this.currentUserAccountWrapper.getContact(recipient.jidBare.toString());
        this.currentUserAccountWrapper.innerAccount.getConnection().sendMessage(new Message({
                peer: contact.getJid(),
                direction: DIRECTION.OUT,
                plaintextMessage: body,
            }
        ));
        if (isMultiChatWrapper(contact)) {
            return Promise.resolve();
        }
        this.messageSent$.next(this.contactFactory.createContact(contact.getJid().toString()));
        return Promise.resolve();
    }

    async register(user: { username: string; password: string; service: string; domain: string }): Promise<void> {
        if (this.isOffline()) {
            return;
        }
        await this.jsxc.register(user.service, user.domain, async form => {
            const json = form.toJSON();
            json.fields = json.fields.map(field => {
                if (field.name === 'username') {
                    field.values = [user.username];
                    return field;
                }
                if (field.name === 'password') {
                    field.values = [user.password];
                    return field;
                }
                return field;
            });

            return FormFromJSON(json);
        });
    }

    private isOffline(): boolean {
        return this.state$.getValue() !== 'online';
    }
}

function isMultiChatWrapper(contactWrapper: MultiUserContactWrapper | ContactWrapper): contactWrapper is MultiUserContactWrapper {
    return !!(contactWrapper as MultiUserContactWrapper).join;
}
