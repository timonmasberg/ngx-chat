import {Injectable} from '@angular/core';
import {Affiliation, ChatAction, ChatService, ConnectionStates, RoomUser, Role, RoomCreationOptions, RoomSummary, JidToNumber} from '../../chat-service';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {Contact} from '../../../core/contact';
import {Room} from '../../../core/room';
import {Translations} from '../../../core/translations';
import {LogInRequest} from '../../../core/log-in-request';
import {Recipient} from '../../../core/recipient';
import {FileUploadHandler} from '../../../hooks/file-upload-handler';
import {Form, parseForm, toLtxElement} from '../../../core/form';
import {ContactFactoryService} from '../../contact-factory.service';
import JSXC from './jsxc/src';
import PluginRepository from './jsxc/src/plugin/PluginRepository';
import Client from './jsxc/src/Client';
import BlockingCommandPlugin from './jsxc/src/plugins/BlockingCommandPlugin';
import {AccountWrapper} from './jsxc/src/api/account-wrapper';
import {JID, jid} from '@xmpp/jid';
import Message from './jsxc/src/Message';
import MessageArchiveManagementPlugin from './jsxc/src/plugins/mam/Plugin';
import {AFFILIATION, ROLE} from './jsxc/src/MultiUserContact';
import {MUC_SUB_FEATURE_ID} from '../xmpp/plugins/muc-sub.plugin';
import {FormFromJSON} from './jsxc/src/connection/Form';
import {DIRECTION} from './jsxc/src/Message.interface';
import { LogService } from '../../log.service';
import { MessageState, Message as ApiMessage } from '../../../core/message';

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

    userAvatar$: BehaviorSubject<string>;
    translations: Translations;
    chatActions: ChatAction[];
    jidToUnreadCount$: Observable<JidToNumber>;
    rooms$: Observable<Room[]>;
    unreadMessageCountSum$: Observable<number>;

    fileUploadHandler: FileUploadHandler;

    enableDebugging = true;
    supportsPlugin: { block: boolean; messageState: boolean };

    private readonly jsxc = new JSXC({});

    private currentUserPluginRepository: PluginRepository;
    private currentUserAccountWrapper: AccountWrapper;

    constructor(private readonly logService: LogService, private readonly contactFactory: ContactFactoryService) {
    }

    async logIn(logInRequest: LogInRequest): Promise<void> {
        await this.jsxc.startWithCredentials(logInRequest.service, logInRequest.username, logInRequest.password);
        this.currentUserAccountWrapper = this.jsxc.getAccount(logInRequest.username);
        this.currentUserPluginRepository = Client.getAccountManager().getAccount(logInRequest.username).getPluginRepository();
    }

    logOut(): Promise<void> {
        return this.jsxc.disconnect();
    }

    async blockJid(bareJid: string): Promise<void> {
        const blockPlugin = this.currentUserPluginRepository.getPlugin<BlockingCommandPlugin>(BlockingCommandPlugin.getId());
        await blockPlugin.block([bareJid]);
    }

    declineRoomInvite(jid: JID) {
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

    joinRoom(jid: JID): Promise<Room> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(jid.toString());
        muc.join();

        return Promise.resolve(new Room(jid, this.logService));
    }

    loadMostRecentUnloadedMessages(recipient: Recipient) {
        const mamPlugin = this.currentUserPluginRepository.getPlugin<MessageArchiveManagementPlugin>(MessageArchiveManagementPlugin.getId());
        const archive = mamPlugin.getArchive(this.jsxc.toJid(recipient.jidBare.toString()));
        archive.nextMessages('100');
    }

    async getRoomConfiguration(roomJid: JID): Promise<Form> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        const form = await muc.getRoomConfigurationFormElement();
        return parseForm(toLtxElement(form));
    }

    queryRoomUserList(roomJid: JID): Promise<RoomUser[]> {
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

    banUserForRoom(occupantJid: JID, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.ban(this.jsxc.toJid(occupantJid.toString()), reason);
        return Promise.resolve();
    }

    async createRoom(options: RoomCreationOptions): Promise<Room> {
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
        const muc = this.currentUserAccountWrapper.getMultiUserContact(jid.toString());
        await muc.destroy();
    }

    kickOccupantFromRoom(nick: string, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.kick(nick, reason);
        return Promise.resolve();
    }

    leaveRoom(roomJid: JID, status?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.leave();
        return Promise.resolve();
    }

    async retrieveSubscriptions(): Promise<Map<string, string[]>> {
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
        // @TODO fix, probably different xml structure for room subs
        await Promise.all(nodes.map(node => this.currentUserAccountWrapper.innerAccount.getConnection().getPubSubService.subscribe(node, null)));
    }

    unbanUserForRoom(occupantJid: JID, roomJid: JID): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.unban(this.jsxc.toJid(occupantJid.toString()));
        return Promise.resolve();
    }

    async unsubscribeRoom(roomJid: string): Promise<void> {
        // @TODO fix
        await this.currentUserAccountWrapper.innerAccount.getConnection().getPubSubService.unsubscribe(null, this.jsxc.toJid(roomJid));
    }

    kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.kick(nick, reason);
        return Promise.resolve();
    }

    async queryAllRooms(): Promise<RoomSummary[]> {
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

    changeRoomSubject(roomJid: JID, subject: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeTopic(subject);
        return Promise.resolve();
    }

    changeUserNicknameForRoom(newNick: string, roomJid: JID): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeNickname(newNick);
        return Promise.resolve();
    }

    grantAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'admin');
        return Promise.resolve();
    }

    grantMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'member');
        return Promise.resolve();
    }

    grantModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeRole(occupantNick, 'moderator');
        return Promise.resolve();
    }

    async inviteUserToRoom(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        await muc.multiUserContact.invite(this.jsxc.toJid(inviteeJid.toString()), invitationMessage);
    }

    revokeAdminForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'member');
        return Promise.resolve();
    }

    revokeMembershipForRoom(userJid: JID, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeAffiliation(this.jsxc.toJid(userJid.toString()), 'none');
        return Promise.resolve();
    }

    revokeModeratorStatusForRoom(occupantNick: string, roomJid: JID, reason?: string): Promise<void> {
        const muc = this.currentUserAccountWrapper.getMultiUserContact(roomJid.toString());
        muc.multiUserContact.changeRole(occupantNick, 'participant');
        return Promise.resolve();
    }

    async addContact(identifier: string): Promise<void> {
        await this.currentUserAccountWrapper.innerAccount.getConnection().getRosterService.addContact(this.jsxc.toJid(identifier), identifier);
    }

    getContactById(id: string): Promise<Contact> {
        const contact = this.currentUserAccountWrapper.getContact(id);
        return Promise.resolve(this.contactFactory.createContact(contact.getJid().toString()));
    }

    getOrCreateContactById(id: string): Promise<Contact> {
        const contact = this.currentUserAccountWrapper.getContact(id);
        return Promise.resolve(this.contactFactory.createContact(contact.getJid().toString()));
    }

    loadCompleteHistory(): Promise<void> {
        const repo = this.currentUserAccountWrapper.innerAccount.getPluginRepository();
        const mam = repo.getPlugin<MessageArchiveManagementPlugin>(MessageArchiveManagementPlugin.getId());
        mam.getArchive(this.currentUserAccountWrapper.jid);
        return Promise.resolve();
    }

    reconnect(): Promise<void> {
        return Promise.resolve(this.jsxc.connect(this.currentUserAccountWrapper.innerAccount));
    }

    reconnectSilently(): Promise<void> {
        return Promise.resolve(this.jsxc.connect(this.currentUserAccountWrapper.innerAccount));
    }

    reloadContacts(): Promise<void> {
        this.jsxc.restoreAccounts();
        return Promise.resolve();
    }

    async removeContact(identifier: string): Promise<void> {
        await this.currentUserAccountWrapper.innerAccount.getConnection().getRosterService.removeContact(this.jsxc.toJid(identifier));
    }

    sendMessage(recipient: Recipient, body: string): Promise<void> {
        this.currentUserAccountWrapper.innerAccount.getConnection().sendMessage(new Message({
                peer: this.currentUserAccountWrapper.getContact(recipient.jidBare.toString()).getJid(),
                direction: DIRECTION.OUT,
                plaintextMessage: body,
            }
        ));
        return Promise.resolve();
    }

    async register(user: { username: string; password: string; service: string; domain: string }): Promise<void> {
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
}
