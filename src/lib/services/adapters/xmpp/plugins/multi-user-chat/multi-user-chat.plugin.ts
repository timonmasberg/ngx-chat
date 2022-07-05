import {jid as parseJid} from '@xmpp/client';
import {jid, JID} from '@xmpp/jid';
import {combineLatest, mergeMap, Observable, startWith, Subject} from 'rxjs';
import {Direction} from '../../../../../core/message';
import {IqResponseStanza, Stanza} from '../../../../../core/stanza';
import {LogService} from '../../service/log.service';
import {Finder} from '../../shared/finder';
import {XmppChatAdapter} from '../../../xmpp-chat-adapter.service';
import {MessageReceivedEvent} from '../message.plugin';
import {nsDiscoInfo, nsDiscoItems, ServiceDiscoveryPlugin} from '../service-discovery.plugin';
import {Presence} from '../../../../../core/presence';
import {Room} from '../../../../../core/room';
import {Affiliation, AffiliationModification} from './affiliation';
import {Role} from './role';
import {RoomOccupant} from './room-occupant';
import {Invitation} from './invitation';
import {RoomMessage} from './room-message';
import {Form, FORM_NS, getField, parseForm, serializeToSubmitForm, setFieldValue, TextualFormField,} from '../../../../../core/form';
import {nsMuc, nsMucAdmin, nsMucOwner, nsMucRoomConfigForm, nsMucUser} from './multi-user-chat-constants';
import {first, map, scan, shareReplay} from 'rxjs/operators';
import {StanzaHandlerChatPlugin} from '../../../../../core/plugin';
import {ChatConnection} from '../../interface/chat-connection';
import {RoomConfiguration, RoomCreationOptions} from './room-creation-options';

export const nsRSM = 'http://jabber.org/protocol/rsm';

/* https://xmpp.org/extensions/xep-0045.html#registrar-statuscodes-init
 * ----------------------------------------
 * 100 message      Entering a room         Inform user that any occupant is allowed to see the user's full JID
 * 101 message (out of band)                     Affiliation change  Inform user that his or her affiliation changed while not in the room
 * 102 message      Configuration change         Inform occupants that room now shows unavailable members
 * 103 message      Configuration change         Inform occupants that room now does not show unavailable members
 * 104 message      Configuration change         Inform occupants that a non-privacy-related room configuration change has occurred
 * 110 presence     Any room presence       Inform user that presence refers to one of its own room occupants
 * 170 message or initial presence               Configuration change    Inform occupants that room logging is now enabled
 * 171 message      Configuration change         Inform occupants that room logging is now disabled
 * 172 message      Configuration change         Inform occupants that the room is now non-anonymous
 * 173 message      Configuration change         Inform occupants that the room is now semi-anonymous
 * 174 message      Configuration change         Inform occupants that the room is now fully-anonymous
 * 201 presence     Entering a room         Inform user that a new room has been created
 * 210 presence     Entering a room         Inform user that the service has assigned or modified the occupant's roomnick
 * 301 presence     Removal from room       Inform user that he or she has been banned from the room
 * 303 presence     Exiting a room          Inform all occupants of new room nickname
 * 307 presence     Removal from room       Inform user that he or she has been kicked from the room
 * 321 presence     Removal from room       Inform user that he or she is being removed from the room because of an affiliation change
 * 322 presence     Removal from room       Inform user that he or she is being removed from the room because the room has been changed to members-only and the user is not a member
 * 332 presence     Removal from room       Inform user that he or she is being removed from the room because of a system shutdown
 *
 * 'visibility_changes': ['100', '102', '103', '172', '173', '174'],
 * 'self': ['110'],
 * 'non_privacy_changes': ['104', '201'],
 * 'muc_logging_changes': ['170', '171'],
 * 'nickname_changes': ['210', '303'],
 * 'disconnected': ['301', '307', '321', '322', '332', '333'],
 */
export enum OtherStatusCode {
    AffiliationChange = '101',
    PresenceSelfRef = '110',
    // in Other as you don't leave the room upon nickName change
    NewNickNameInRoom = '303',
}

export enum ConfigurationChangeStatusCode {
    ShowsUnavailableMembers = '102',
    ShowsNotUnavailableMembers = '103',
    NonPrivacyRelatedChange = '104',
    Logging = '170',
    NoLogging = '171',
    RoomNonAnonymous = '172',
    RoomSemiAnonymous = '173',
}

export enum EnteringRoomStatusCode {
    ShareFullJid = '100',
    NewRoomCreated = '201',
    NickNameChanged = '210',
}

export enum ExitingRoomStatusCode {
    Banned = '301',
    Kicked = '307',
    AffiliationChange = '321',
    MembersOnly = '322',
    MUCShutdown = '332',
    ErrorReply = '333',
}

/**
 * The MultiUserChatPlugin tries to provide the necessary functionality for a multi-user text chat,
 * whereby multiple XMPP users can exchange messages in the context of a room or channel, similar to Internet Relay Chat (IRC).
 * For more details see:
 * @see https://xmpp.org/extensions/xep-0045.html
 */
export class MultiUserChatPlugin implements StanzaHandlerChatPlugin {

    readonly nameSpace = nsMuc;
    readonly message$ = new Subject<Room>();

    private readonly invitationSubject = new Subject<Invitation>();
    readonly invitation$ = this.invitationSubject.asObservable();

    private readonly leftRoomSubject = new Subject<JID>();
    readonly leftRoom$ = this.leftRoomSubject.asObservable();

    private readonly createdRoomSubject = new Subject<Room>();
    readonly createdRoom$ = this.createdRoomSubject.asObservable();

    private readonly clearRoomsSubject = new Subject<void>();

    private readonly allLeftRooms$ = this.clearRoomsSubject.pipe(
        map(() => new Set<string>()),
        mergeMap((initialSet) => this.leftRoom$.pipe(scan((acc, val) => acc.add(val.toString()), initialSet), startWith(initialSet)))
    );

    private readonly allCreatedRooms$ = this.clearRoomsSubject.pipe(
        map(() => new Map<string, Room>()),
        mergeMap((initialMap) => this.createdRoom$.pipe(scan((acc, val) => acc.set(val.jid.toString(), val), initialMap), startWith(initialMap)))
    );

    readonly rooms$ = combineLatest([this.allLeftRooms$, this.allCreatedRooms$])
        .pipe(
            map(([leftRoomSet, createdRoomMap]) => Array.from(createdRoomMap.values()).filter(val => !leftRoomSet.has(val.jid.toString()))),
            shareReplay(1),
        );

    private handlers = {destroy: null, presence: null, message: null};

    constructor(
        private readonly xmppChatAdapter: XmppChatAdapter,
        private readonly logService: LogService,
        private readonly serviceDiscoveryPlugin: ServiceDiscoveryPlugin,
    ) {
        xmppChatAdapter.onBeforeOnline$.subscribe(async () => {
            this.clearRoomsSubject.next();
            await this.registerHandler(xmppChatAdapter.chatConnectionService);
        });

        xmppChatAdapter.onOffline$.subscribe(async () => {
            await this.unregisterHandler(xmppChatAdapter.chatConnectionService);
            this.clearRoomsSubject.next();
        });
    }

    async registerHandler(chatConnection: ChatConnection): Promise<void> {
        this.handlers.destroy = this.xmppChatAdapter.chatConnectionService.addHandler((stanza) => this.handleRoomDestroyedStanza(stanza),
            {ns: nsMucUser, name: 'destroy'}
        );

        this.handlers.presence = this.xmppChatAdapter.chatConnectionService.addHandler((stanza) => this.handleRoomPresenceStanza(stanza),
            {ns: nsMuc, name: 'presence'},
            {ignoreNamespaceFragment: true, matchBareFromJid: true}
        );

        this.handlers.message = this.xmppChatAdapter.chatConnectionService.addHandler((stanza) => this.handleRoomMessageStanza(stanza),
            {type: 'groupchat', name: 'message'},
        );
    }

    async unregisterHandler(connection: ChatConnection): Promise<void> {
        connection.deleteHandler(this.handlers.destroy);
        connection.deleteHandler(this.handlers.presence);
        connection.deleteHandler(this.handlers.message);
    }

    /**
     * Resolves if room could be configured as requested, rejects if room did exist or server did not accept configuration.
     */
    async createRoom(options: RoomCreationOptions): Promise<Room> {
        const {roomId, nick} = options;
        const service = await this.serviceDiscoveryPlugin.findService('conference', 'text');
        const occupantJid = parseJid(roomId, service.jid, nick);
        const {presenceResponse, room} = await this.joinRoomInternal(occupantJid);

        const itemElement = presenceResponse.querySelector('x').querySelector('item');
        if (itemElement.getAttribute('affiliation') !== Affiliation.owner) {
            throw new Error('error creating room, user is not owner: ' + presenceResponse.toString());
        }

        try {
            await this.applyRoomConfiguration(room.jid, options);
            room.name = options.name || undefined;
            // TODO: WHY???
            // this.rooms$.next(this.rooms$.getValue());
        } catch (e) {
            this.logService.error('room configuration rejected', e);
            throw e;
        }

        return room;
    }

    handleRoomDestroyedStanza(stanza: Element): boolean {
        const roomJid = stanza.querySelector('destroy').getAttribute('jid');
        this.leftRoomSubject.next(jid(roomJid));
        return true;
    }

    async destroyRoom(roomJid: JID): Promise<void> {
        try {
            await this.xmppChatAdapter.chatConnectionService
                .$iq({type: 'set', to: roomJid.toString()})
                .c('query', {xmlns: nsMucOwner})
                .c('destroy')
                .sendAwaitingResponse();
        } catch (e) {
            this.logService.error('error destroying room');
            throw e;
        }
    }

    async joinRoom(occupantJid: JID): Promise<Room> {
        const {room} = await this.joinRoomInternal(occupantJid);

        // TODO: Why?
        // this.rooms$.next(this.rooms$.getValue());
        return room;
    }

    async getRoomInfo(roomJid: JID): Promise<Form | null> {
        const roomInfoResponse = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to: roomJid.toString()})
            .c('query', {xmlns: nsDiscoInfo})
            .sendAwaitingResponse();
        const formEl = Array.from(Array
            .from(roomInfoResponse.querySelectorAll('query'))
            .find(el => el.getAttribute('xmlns') === nsDiscoInfo)
            .querySelectorAll('x'))
            .find(el => el.getAttribute('xmlns') === FORM_NS);

        if (formEl) {
            return parseForm(formEl);
        }

        return null;
    }

    async getRooms(): Promise<Room[]> {
        const conferenceServer = await this.serviceDiscoveryPlugin.findService('conference', 'text');
        const to = conferenceServer.jid.toString();

        const roomQueryResponse = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to})
            .c('query', {xmlns: nsDiscoItems})
            .sendAwaitingResponse();

        return this.extractRoomSummariesFromResponse(roomQueryResponse);
    }

    async queryAllRooms(): Promise<Room[]> {
        const conferenceServer = await this.serviceDiscoveryPlugin.findService('conference', 'text');
        const to = conferenceServer.jid.toString();

        let roomQueryResponse = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to})
            .c('query', {xmlns: nsDiscoItems})
            .sendAwaitingResponse();

        const result: Room[] = this.extractRoomSummariesFromResponse(roomQueryResponse);

        const extractResultSet = (iq: IqResponseStanza) => Finder
            .create(iq)
            .searchByTag('query')
            .searchByNamespace(nsDiscoItems)
            .searchByTag('set')
            .searchByNamespace('http://jabber.org/protocol/rsm')
            .result;

        let resultSet = extractResultSet(roomQueryResponse);
        while (resultSet && resultSet.querySelector('last')) {
            const lastReceivedRoom = resultSet.querySelector('last').textContent;
            roomQueryResponse = await this.xmppChatAdapter.chatConnectionService
                .$iq({type: 'get', to})
                .c('query', {xmlns: nsDiscoItems})
                .c('set', {xmlns: nsRSM})
                .c('max', {}, String(250))
                .up().c('after', {}, lastReceivedRoom)
                .sendAwaitingResponse();
            result.push(...this.extractRoomSummariesFromResponse(roomQueryResponse));
            resultSet = extractResultSet(roomQueryResponse);
        }

        await Promise.all(
            result.map(async (summary) => {
                summary.info = await this.getRoomInfo(summary.jid);
            }),
        );

        return result;
    }

    /**
     * Get all members of a MUC-Room with their affiliation to the room using the rooms fullJid
     * @param roomJid jid of the room
     */
    async queryUserList(roomJid: JID): Promise<RoomOccupant[]> {
        const memberQueryResponses = await Promise.all(
            [
                ...Object
                    .values(Affiliation)
                    .map(affiliation =>
                        this.xmppChatAdapter.chatConnectionService
                            .$iq({type: 'get', to: roomJid.toString()})
                            .c('query', {xmlns: nsMucAdmin})
                            .c('item', {affiliation})
                            .sendAwaitingResponse(),
                    ),
                ...Object
                    .values(Role)
                    .map(role =>
                        this.xmppChatAdapter.chatConnectionService
                            .$iq({type: 'get', to: roomJid.toString()})
                            .c('query', {xmlns: nsMucAdmin})
                            .c('item', {role})
                            .sendAwaitingResponse(),
                    ),
            ],
        );
        const members = new Map<string, RoomOccupant>();
        for (const memberQueryResponse of memberQueryResponses) {
            Array.from(Array.from(memberQueryResponse
                .querySelectorAll('query'))
                .find(el => el.getAttribute('xmlns') === nsMucAdmin)
                .querySelectorAll('item'))
                .forEach((memberItem) => {
                    const userJid = parseJid(memberItem.getAttribute('jid'));
                    const roomUser = members.get(userJid.bare().toString()) || {
                        jid: userJid,
                        affiliation: Affiliation.none,
                        role: Role.none,
                        nick: memberItem.getAttribute('nick'),
                    };

                    // tslint:disable no-unused-expression
                    memberItem.getAttribute('affiliation') && (roomUser.affiliation = memberItem.getAttribute('affiliation') as Affiliation);
                    memberItem.getAttribute('role') && (roomUser.role = memberItem.getAttribute('role') as Role);
                    // tslint:enable no-unused-expression
                    members.set(userJid.bare().toString(), roomUser);
                });
        }

        return [...members.values()];
    }

    async sendMessage(room: Room, body: string, thread?: string): Promise<void> {
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const roomJid = room.jid.toString();
        const roomMessageBuilder = thread
            ? this.xmppChatAdapter.chatConnectionService
                .$msg({from, to: roomJid, type: 'groupchat'})
                .c('body', {}, body)
                .up().c('thread', {}, thread)
            : this.xmppChatAdapter.chatConnectionService
                .$msg({from, to: roomJid, type: 'groupchat'})
                .c('body', {}, body);

        return await roomMessageBuilder.send();
    }

    /**
     * requests a configuration form for a room which returns with the default values
     * for an example see:
     * https://xmpp.org/extensions/xep-0045.html#registrar-formtype-owner
     */
    async getRoomConfiguration(roomJid: JID): Promise<Form> {
        const configurationForm = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to: roomJid.toString()})
            .c('query', {xmlns: nsMucOwner})
            .sendAwaitingResponse();

        const formElement = Array.from(configurationForm.querySelector('query')
            .querySelectorAll('x'))
            .find(el => el.getAttribute('xmlns') === FORM_NS);

        return parseForm(formElement);
    }

    async applyRoomConfiguration(roomJid: JID, roomConfiguration: RoomConfiguration): Promise<void> {
        const roomConfigForm = await this.getRoomConfiguration(roomJid);

        const formTypeField = getField(roomConfigForm, 'FORM_TYPE') as TextualFormField | undefined;
        if (formTypeField.value !== nsMucRoomConfigForm) {
            throw new Error(`unexpected form type for room configuration form: formType=${formTypeField.value}, formTypeField=${JSON.stringify(formTypeField)}`);
        }

        if (typeof roomConfiguration.name === 'string') {
            setFieldValue(roomConfigForm, 'text-single', 'muc#roomconfig_roomname', roomConfiguration.name);
        }
        if (typeof roomConfiguration.nonAnonymous === 'boolean') {
            setFieldValue(
                roomConfigForm,
                'list-single',
                'muc#roomconfig_whois',
                roomConfiguration.nonAnonymous ? 'anyone' : 'moderators',
            );
        }
        if (typeof roomConfiguration.public === 'boolean') {
            setFieldValue(roomConfigForm, 'boolean', 'muc#roomconfig_publicroom', roomConfiguration.public);
        }
        if (typeof roomConfiguration.membersOnly === 'boolean') {
            setFieldValue(roomConfigForm, 'boolean', 'muc#roomconfig_membersonly', roomConfiguration.membersOnly);
        }
        if (typeof roomConfiguration.persistentRoom === 'boolean') {
            setFieldValue(roomConfigForm, 'boolean', 'muc#roomconfig_persistentroom', roomConfiguration.persistentRoom);
        }
        if (typeof roomConfiguration.allowSubscription === 'boolean') {
            setFieldValue(roomConfigForm, 'boolean', 'allow_subscription', roomConfiguration.allowSubscription);
        }

        await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set', to: roomJid.toString()})
            .c('query', {xmlns: nsMucOwner})
            .cCreateMethod(builder => serializeToSubmitForm(builder, roomConfigForm));
    }

    getRoomByJid(jid: JID): Observable<Room> {
        return this.rooms$.pipe(map(rooms => rooms.find(room => room.jid.equals(jid.bare()))), first());
    }

    async banUser(occupantJid: JID, roomJid: JID, reason?: string): Promise<IqResponseStanza> {
        const userJid = await this.getUserJidByOccupantJid(occupantJid, roomJid);

        const response = await this.xmppChatAdapter.chatConnectionService
            .$iq({to: roomJid.toString(), type: 'set'})
            .c('query', {xmlns: nsMucAdmin})
            .c('item', {jid: userJid.toString(), affiliation: Affiliation.outcast})
            .c('reason', {}, reason)
            .sendAwaitingResponse();
        this.logService.debug(`ban response ${response.toString()}`);

        return response;
    }

    async unbanUser(occupantJid: JID, roomJid: JID): Promise<IqResponseStanza> {
        const userJid = await this.getUserJidByOccupantJid(occupantJid, roomJid);

        const banList = (await this.getBanList(roomJid)).map(bannedUser => bannedUser.userJid);
        this.logService.debug(`ban list: ${JSON.stringify(banList)}`);

        if (!banList.find(bannedJid => bannedJid.equals(userJid))) {
            throw new Error(`error unbanning: ${userJid} isn't on the ban list`);
        }

        const response = await this.xmppChatAdapter.chatConnectionService
            .$iq({to: roomJid.toString(), type: 'set'})
            .c('query', {xmlns: nsMucAdmin})
            .c('item', {jid: userJid.toString(), affiliation: Affiliation.none})
            .sendAwaitingResponse();
        this.logService.debug('unban response: ' + response.toString());

        return response;
    }

    async getBanList(roomJid: JID): Promise<AffiliationModification[]> {
        const response = await this.xmppChatAdapter.chatConnectionService
            .$iq({to: roomJid.toString(), type: 'get'})
            .c('query', {xmlns: nsMucAdmin})
            .c('item', {affiliation: Affiliation.outcast})
            .sendAwaitingResponse();

        return Array.from(response.querySelector('query').querySelectorAll('item')).map(item => ({
            userJid: parseJid(item.getAttribute('jid')),
            affiliation: item.getAttribute('affiliation') as Affiliation,
            reason: item.querySelector('reason')?.textContent,
        }));
    }

    async inviteUser(inviteeJid: JID, roomJid: JID, invitationMessage?: string): Promise<void> {
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        await this.xmppChatAdapter.chatConnectionService
            .$msg({to: roomJid.toString(), from})
            .c('x', {xmlns: nsMucUser})
            .c('invite', {to: inviteeJid.toString()})
            .cCreateMethod(builder => invitationMessage ? builder.c('reason', {}, invitationMessage) : builder)
            .send();
    }

    async declineRoomInvite(occupantJid: JID, reason?: string) {
        const to = occupantJid.bare().toString();
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();

        await this.xmppChatAdapter.chatConnectionService
            .$msg({to, from})
            .c('x', {xmlns: nsMucUser})
            .c('decline', {to})
            .cCreateMethod(builder => reason ? builder.c('reason', {}, reason) : builder);
    }

    async kickOccupant(nick: string, roomJid: JID, reason?: string): Promise<IqResponseStanza> {
        const response = await this.xmppChatAdapter.chatConnectionService
            .$iq({to: roomJid.toString(), type: 'set'})
            .c('query', {xmlns: nsMucAdmin})
            .c('item', {nick, role: Role.none})
            .c('reason', {}, reason)
            .sendAwaitingResponse();
        this.logService.debug(`kick occupant response: ${response.toString()}`);
        return response;
    }

    async changeUserNickname(newNick: string, roomJid: JID): Promise<void> {
        const newRoomJid = parseJid(roomJid.toString());
        newRoomJid.resource = newNick;
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();

        await this.xmppChatAdapter.chatConnectionService
            .$pres({to: newRoomJid.toString(), from})
            .send();
    }

    async leaveRoom(occupantJid: JID, status?: string): Promise<void> {
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();

        await this.xmppChatAdapter.chatConnectionService
            .$pres({to: occupantJid.toString(), from, type: Presence[Presence.unavailable]})
            .cCreateMethod(builder => status ? builder.c('status', {}, status) : builder)
            .send();
        this.logService.debug(`occupant left room: occupantJid=${occupantJid.toString()}`);
    }

    async changeRoomSubject(roomJid: JID, subject: string): Promise<void> {
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        await this.xmppChatAdapter.chatConnectionService
            .$msg({to: roomJid.toString(), from, type: 'groupchat'})
            .c('subject', {}, subject)
            .send();
        this.logService.debug(`room subject changed: roomJid=${roomJid.toString()}, new subject=${subject}`);
    }

    isRoomInvitationStanza(stanza: Stanza): boolean {
        const x = Array.from(stanza.querySelectorAll('x')).find(el => el.getAttribute('xmlns') === nsMucUser);
        return x != null && (x.querySelector('invite') != null || x.querySelector('decline') != null);
    }

    async grantMembership(userJid: JID, roomJid: JID, reason?: string) {
        await this.setAffiliation(userJid, roomJid, Affiliation.member, reason);
    }

    async revokeMembership(userJid: JID, roomJid: JID, reason?: string) {
        await this.setAffiliation(userJid, roomJid, Affiliation.none, reason);
    }

    async grantAdmin(userJid: JID, roomJid: JID, reason?: string) {
        await this.setAffiliation(userJid, roomJid, Affiliation.admin, reason);
    }

    async revokeAdmin(userJid: JID, roomJid: JID, reason?: string) {
        await this.setAffiliation(userJid, roomJid, Affiliation.member, reason);
    }

    async grantModeratorStatus(occupantNick: string, roomJid: JID, reason?: string) {
        await this.setRole(occupantNick, roomJid, Role.moderator, reason);
    }

    async revokeModeratorStatus(occupantNick: string, roomJid: JID, reason?: string) {
        await this.setRole(occupantNick, roomJid, Role.participant, reason);
    }

    private handleRoomPresenceStanza(stanza: Stanza): boolean {
        const stanzaType = stanza.getAttribute('type');

        if (stanzaType === 'error') {
            this.logService.error(stanza);
            throw new Error('error handling message, stanza: ' + stanza);
        }

        const occupantJid = parseJid(stanza.getAttribute('from'));

        const xEl = Array.from(stanza.querySelectorAll('x')).find(el => el.getAttribute('xmlns') === nsMucUser);

        const itemEl = xEl.querySelector('item');
        const subjectOccupant: RoomOccupant = {
            jid: occupantJid,
            affiliation: itemEl.getAttribute('affiliation') as Affiliation,
            role: itemEl.getAttribute('role') as Role,
            nick: occupantJid.resource,
        };

        const isInCodes = (codes: string[], states: ExitingRoomStatusCode[]) => {
            return codes.some(code => states.includes(code as ExitingRoomStatusCode));
        };

        if (stanzaType && stanzaType !== 'unavailable') {
            return false;
        }

        this.getOrCreateRoom(occupantJid).then((room) => {
            const statusCodes: string[] = Array.from(xEl.querySelectorAll('status')).map(status => status.getAttribute('code'));
            const isCurrentUser = statusCodes.includes(OtherStatusCode.PresenceSelfRef);

            if (!stanzaType && room.hasOccupant(subjectOccupant.jid)) {
                const oldOccupant = room.getOccupant(subjectOccupant.jid);
                room.handleOccupantModified(subjectOccupant, oldOccupant, isCurrentUser);
                return;
            }

            if (!stanzaType) {
                room.handleOccupantJoined(subjectOccupant, isCurrentUser);
                return;
            }

            const shouldRemoveRoom = isInCodes(statusCodes, Object.values(ExitingRoomStatusCode));
            if (shouldRemoveRoom || isCurrentUser) {
                this.leftRoomSubject.next(room.jid);
            }

            // stanzaType is unavailable if the user is in the process of leaving the room or being removed from the room
            // https://xmpp.org/extensions/xep-0045.html#example-43
            const actor = itemEl.querySelector('actor')?.getAttribute('nick');
            const reason = itemEl.querySelector('reason')?.textContent;
            if (isInCodes(statusCodes, [ExitingRoomStatusCode.MUCShutdown, ExitingRoomStatusCode.ErrorReply])) {
                room.handleOccupantConnectionError(subjectOccupant, isCurrentUser);
                return;
            }

            if (statusCodes.includes(ExitingRoomStatusCode.Kicked)) {
                room.handleOccupantKicked(subjectOccupant, isCurrentUser, actor, reason);
                return;
            }

            if (statusCodes.includes(ExitingRoomStatusCode.Banned)) {
                room.handleOccupantBanned(subjectOccupant, isCurrentUser, actor, reason);
                return;
            }

            if (statusCodes.includes(OtherStatusCode.NewNickNameInRoom)) {
                room.handleOccupantChangedNick(subjectOccupant, isCurrentUser, xEl.querySelector('item').getAttribute('nick'));
                return;
            }

            if (statusCodes.includes(ExitingRoomStatusCode.AffiliationChange)) {
                room.handleOccupantLostMembership(subjectOccupant, isCurrentUser);
                return;
            }

            if (statusCodes.includes(ExitingRoomStatusCode.MembersOnly)) {
                room.handleOccupantRoomMembersOnly(subjectOccupant, isCurrentUser);
                return;
            }

            room.handleOccupantLeft(subjectOccupant, isCurrentUser);
            return;
        });
        return true;
    }

    private async getOrCreateRoom(roomJid: JID): Promise<Room> {
        roomJid = roomJid.bare();
        let room = await this.getRoomByJid(roomJid).toPromise();
        if (!room) {
            room = new Room(roomJid, this.logService);
            this.createdRoomSubject.next(room);
        }
        return room;
    }

    private async joinRoomInternal(roomJid: JID): Promise<{ presenceResponse: Stanza, room: Room }> {
        if (await this.getRoomByJid(roomJid.bare()).toPromise()) {
            throw new Error('can not join room more than once: ' + roomJid.bare().toString());
        }
        const userJid = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const occupantJid = parseJid(roomJid.local, roomJid.domain, roomJid.resource || userJid.split('@')[0]);

        try {
            const presenceResponse = await this.xmppChatAdapter.chatConnectionService
                .$pres({to: occupantJid.toString()})
                .c('x', {xmlns: nsMuc})
                .sendAwaitingResponse();
            this.handleRoomPresenceStanza(presenceResponse);

            const room = await this.getOrCreateRoom(occupantJid.bare());
            room.nick = occupantJid.resource;

            const roomInfo = await this.getRoomInfo(occupantJid.bare());
            room.name = getField<TextualFormField>(roomInfo, 'muc#roomconfig_roomname')?.value;
            room.description = getField<TextualFormField>(roomInfo, 'muc#roominfo_description')?.value;

            return {presenceResponse, room};
        } catch (e) {
            this.logService.error('error joining room', e);
            throw e;
        }
    }

    private extractRoomSummariesFromResponse(iq: IqResponseStanza): Room[] {
        return Finder.create(iq)
            .searchByTag('query')
            .searchByNamespace(nsDiscoItems)
            .searchByTag('item')
            .results
            .reduce<Room[]>((acc, item) => {
                const jid = item.getAttribute('jid');
                const name = item.getAttribute('name');

                acc.push(new Room(parseJid(jid), this.logService, name));

                return acc;
            }, []);
    }


    private handleRoomMessageStanza(stanza: Stanza, archiveDelayElement?: Stanza): boolean {
        if (!!stanza.querySelector('body')?.textContent.trim()) {
            const delayElement = archiveDelayElement ?? stanza.querySelector('delay');
            const stamp = delayElement?.getAttribute('stamp');
            const datetime = stamp ? new Date(stamp) : new Date() /* TODO: replace with entity time plugin */;

            const from = parseJid(stanza.getAttribute('from'));
            this.getRoomByJid(from.bare()).toPromise().then((room) => {
                if (!room) {
                    // there are several reasons why we can receive a message for an unknown room:
                    // - this is a message delivered via MAM/MUCSub but the room it was stored for
                    //   - is gone (was destroyed)
                    //   - user was banned from room
                    //   - room wasn't joined yet
                    // - this is some kind of error on developer's side
                    throw new Error(`received stanza for unknown room: ${from.bare().toString()}`);
                    // TODO: still needed?
                    // this.logService.warn(`received stanza for unknown room: ${from.bare().toString()}`);
                    // return false;
                }

                const message: RoomMessage = {
                    body: stanza.querySelector('body').textContent.trim(),
                    datetime,
                    id: stanza.getAttribute('id'),
                    from,
                    direction: from.equals(room.occupantJid) ? Direction.out : Direction.in,
                    delayed: !!delayElement,
                    fromArchive: archiveDelayElement != null,
                };

                const messageReceivedEvent = new MessageReceivedEvent();
                if (!messageReceivedEvent.discard) {
                    room.addMessage(message);
                }

                if (!message.delayed) {
                    this.message$.next(room);
                }
            });
            return true;
        }

        if (stanza.querySelector('subject') != null && stanza.querySelector('body') == null) {
            const roomJid = parseJid(stanza.getAttribute('from')).bare();
            // The archive only stores non-empty subjects. The current value of the subject is sent directly after entering a room by the room,
            // not the archive.
            // If a subject was first set, then unset, we would first receive the empty subject on room entry and then overwrite it with the
            // previous non-empty value from archive. This is why we want to always ignore subjects from archive.
            // This actually looks like a bug in MAM, it seems that MAM interprets messages with just subject in them as if they were chat
            // messages and not room metadata. This would explain why empty subjects are not stored.
            if (archiveDelayElement) {
                return true;
            }

            this.getRoomByJid(roomJid).toPromise().then((room) => {
                if (!room) {
                    throw new Error(`unknown room trying to change room subject: roomJid=${roomJid.toString()}`);
                }

                room.subject = stanza.querySelector('subject').textContent.trim();
                // TODO: Why?
                // this.rooms$.next(this.rooms$.getValue());
            });

            return true;
        }

        if (this.isRoomInvitationStanza(stanza)) {
            const xElFinder = Finder.create(stanza).searchByTag('x').searchByNamespace(nsMucUser);
            const invitationEl = xElFinder.searchByTag('invite').result ?? xElFinder.searchByTag('decline').result;

            this.invitationSubject.next({
                type: invitationEl.tagName as Invitation['type'],
                roomJid: parseJid(stanza.getAttribute('from')),
                roomPassword: xElFinder.searchByTag('password').result?.textContent,
                from: parseJid(invitationEl.getAttribute('from')),
                message: invitationEl.querySelector('reason')?.textContent,
            });

            return true;
        }

        return false;
    }

    private async setAffiliation(occupantJid: JID, roomJid: JID, affiliation: Affiliation, reason?: string): Promise<IqResponseStanza> {
        const userJid = await this.getUserJidByOccupantJid(occupantJid, roomJid);

        return await this.xmppChatAdapter.chatConnectionService
            .$iq({to: roomJid.toString(), type: 'set'})
            .c('query', {xmlns: nsMucAdmin})
            .c('item', {jid: userJid.toString(), affiliation})
            .c('reason', {}, reason)
            .sendAwaitingResponse();
    }

    private async setRole(occupantNick: string, roomJid: JID, role: Role, reason?: string): Promise<IqResponseStanza> {
        return await this.xmppChatAdapter.chatConnectionService
            .$iq({to: roomJid.toString(), type: 'set'})
            .c('query', {xmlns: nsMucAdmin})
            .c('item', {nick: occupantNick, role})
            .c('reason', {}, reason)
            .sendAwaitingResponse();
    }

    private async getUserJidByOccupantJid(occupantJid: JID, roomJid: JID): Promise<JID> {
        const users = await this.queryUserList(roomJid);
        return users.find(roomUser => roomUser.nick === occupantJid.resource || roomUser.jid.bare().equals(occupantJid.bare()),
        )?.jid;
    }
}
