import {jid as parseJid} from '@xmpp/client';
import {JID} from '@xmpp/jid';
import {BehaviorSubject, Subject} from 'rxjs';
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
import {RoomUser} from './room-user';
import {RoomOccupant} from './room-occupant';
import {Invitation} from './invitation';
import {RoomMessage} from './room-message';
import {Form, FORM_NS, getField, parseForm, serializeToSubmitForm, setFieldValue, TextualFormField,} from '../../../../../core/form';
import {XmppResponseError} from '../../shared/xmpp-response.error';
import {nsMucAdmin, nsMuc, nsMucOwner, nsMucRoomConfigForm, nsMucUser} from './multi-user-chat-constants';
import {RoomConfiguration, RoomCreationOptions, RoomSummary} from '../../interface/chat.service';
import {first} from 'rxjs/operators';
import {ChatPlugin} from '../../../../../core/plugin';

export interface RoomMetadata {
    [key: string]: any;
}

export const nsRSM = 'http://jabber.org/protocol/rsm';

/**
 * The MultiUserChatPlugin tries to provide the necessary functionality for a multi-user text chat,
 * whereby multiple XMPP users can exchange messages in the context of a room or channel, similar to Internet Relay Chat (IRC).
 * For more details see:
 * @see https://xmpp.org/extensions/xep-0045.html
 */
export class MultiUserChatPlugin implements ChatPlugin {

    readonly nameSpace = nsMuc
    readonly rooms$ = new BehaviorSubject<Room[]>([]);
    readonly message$ = new Subject<Room>();

    private onInvitationSubject = new Subject<Invitation>();
    readonly onInvitation$ = this.onInvitationSubject.asObservable();

    constructor(
        private readonly xmppChatAdapter: XmppChatAdapter,
        private readonly logService: LogService,
        private readonly serviceDiscoveryPlugin: ServiceDiscoveryPlugin,
    ) {
    }

    onOffline(): void {
        this.rooms$.next([]);
    }

    async registerHandler(stanza: Stanza, archiveDelayElement?: Stanza): Promise<boolean> {
        if (this.isRoomPresenceStanza(stanza)) {
            return this.handleRoomPresenceStanza(stanza);
        } else if (this.isRoomMessageStanza(stanza)) {
            return this.handleRoomMessageStanza(stanza, archiveDelayElement);
        } else if (this.isRoomSubjectStanza(stanza)) {
            return this.handleRoomSubjectStanza(stanza, archiveDelayElement);
        } else if (this.isRoomInvitationStanza(stanza)) {
            return this.handleRoomInvitationStanza(stanza);
        }
        return false;
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
            await this.applyRoomConfiguration(room.roomJid, options);
            room.name = options.name || undefined;
            this.rooms$.next(this.rooms$.getValue());
        } catch (e) {
            this.logService.error('room configuration rejected', e);
            throw e;
        }

        return room;
    }

    async destroyRoom(roomJid: JID): Promise<IqResponseStanza<'result'>> {
        let roomDestroyedResponse: IqResponseStanza<'result'>;
        try {
            roomDestroyedResponse = await this.xmppChatAdapter.chatConnectionService
                .$iq({type: 'set', to: roomJid.toString()})
                .c('query', {xmlns: nsMucOwner})
                .c('destroy')
                .sendAwaitingResponse();
        } catch (e) {
            this.logService.error('error destroying room');
            throw e;
        }

        // TODO: refactor so that we instead listen to the presence destroy stanza
        const allRoomsWithoutDestroyedRoom = this.rooms$.getValue().filter(
            room => !room.roomJid.equals(roomJid),
        );

        this.rooms$.next(allRoomsWithoutDestroyedRoom);

        return roomDestroyedResponse;
    }

    async joinRoom(occupantJid: JID): Promise<Room> {
        const {room} = await this.joinRoomInternal(occupantJid);
        this.rooms$.next(this.rooms$.getValue());
        return room;
    }

    async getRoomInfo(roomJid: JID): Promise<Form | null> {
        const roomInfoResponse = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to: roomJid.toString()})
            .c('query', {xmlns: nsDiscoInfo})
            .sendAwaitingResponse();
        const formEl = Array.from(Array
            .from(roomInfoResponse.querySelectorAll('query'))
            .find(el => el.namespaceURI === nsDiscoInfo)
            .querySelectorAll('x'))
            .find(el => el.namespaceURI === FORM_NS);

        if (formEl) {
            return parseForm(formEl);
        }

        return null;
    }

    async queryAllRooms(): Promise<RoomSummary[]> {
        const conferenceServer = await this.serviceDiscoveryPlugin.findService('conference', 'text');
        const to = conferenceServer.jid.toString();

        const result: RoomSummary[] = [];

        let roomQueryResponse = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to})
            .c('query', {xmlns: nsDiscoItems})
            .sendAwaitingResponse();
        result.push(...this.extractRoomSummariesFromResponse(roomQueryResponse));

        let resultSet = this.extractResultSetFromResponse(roomQueryResponse);
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
            resultSet = this.extractResultSetFromResponse(roomQueryResponse);
        }

        await Promise.all(
            result.map(async (summary) => {
                summary.roomInfo = await this.getRoomInfo(summary.jid);
            }),
        );

        return result;
    }

    /**
     * Get all members of a MUC-Room with their affiliation to the room using the rooms fullJid
     * @param roomJid jid of the room
     */
    async queryUserList(roomJid: JID): Promise<RoomUser[]> {
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
        const members = new Map<string, RoomUser>();
        for (const memberQueryResponse of memberQueryResponses) {
            Array.from(Array.from(memberQueryResponse
                .querySelectorAll('query'))
                .find(el => el.namespaceURI === nsMucAdmin)
                .querySelectorAll('item'))
                .forEach((memberItem) => {
                    const userJid = parseJid(memberItem.getAttribute('jid'));
                    const roomUser = members.get(userJid.bare().toString()) || {
                        userIdentifiers: [],
                        affiliation: Affiliation.none,
                        role: Role.none,
                    } as RoomUser;
                    roomUser.userIdentifiers.push({
                        userJid,
                        nick: memberItem.getAttribute('nick'),
                    });
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
        const roomJid = room.roomJid.toString();
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
            .find(el => el.namespaceURI === FORM_NS);
        if (!formElement) {
            throw new Error('room not configurable');
        }

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

    getRoomByJid(jid: JID): Room | undefined {
        return this.rooms$.getValue().find(room => room.roomJid.equals(jid.bare()));
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
        let x: Element | undefined;
        return stanza.tagName === 'message'
            && (x = Array.from(stanza.querySelectorAll('x')).find(el => el.namespaceURI === nsMucUser)) != null
            && (x.querySelector('invite') != null || x.querySelector('decline') != null);
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

    private isRoomPresenceStanza(stanza: Stanza): boolean {
        const xArray = Array.from(stanza.querySelectorAll('x'));
        return stanza.tagName === 'presence' && (
            xArray.find(el => el.namespaceURI === nsMuc)
            || xArray.find(el => el.namespaceURI === nsMucUser)
        ) != null;
    }

    private handleRoomPresenceStanza(stanza: Stanza): boolean {
        const stanzaType = stanza.getAttribute('type');

        if (stanzaType === 'error') {
            this.logService.error(stanza);
            throw new Error('error handling message, stanza: ' + stanza);
        }

        const occupantJid = parseJid(stanza.getAttribute('from'));
        const roomJid = occupantJid.bare();

        const xEl = Array.from(stanza.querySelectorAll('x')).find(el => el.namespaceURI === nsMucUser);

        const itemEl = xEl.querySelector('item');
        const subjectOccupant: RoomOccupant = {
            occupantJid,
            affiliation: itemEl.getAttribute('affiliation') as Affiliation,
            role: itemEl.getAttribute('role') as Role,
            nick: occupantJid.resource,
        };

        const room = this.getOrCreateRoom(occupantJid);
        const statusCodes: string[] = Array.from(xEl.querySelectorAll('status')).map(status => status.getAttribute('code'));
        const isCurrenUser = statusCodes.includes('110');
        if (stanzaType === 'unavailable') {
            const actor = itemEl.querySelector('actor')?.getAttribute('nick');
            const reason = itemEl.querySelector('reason')?.textContent;

            if (statusCodes.includes('333')) {
                if (isCurrenUser) {
                    this.rooms$.next(this.rooms$.getValue().filter(r => !r.jidBare.equals(roomJid)));
                }
                return room.handleOccupantConnectionError(subjectOccupant, isCurrenUser);
            } else if (statusCodes.includes('307')) {
                if (isCurrenUser) {
                    this.rooms$.next(this.rooms$.getValue().filter(r => !r.jidBare.equals(roomJid)));
                }
                return room.handleOccupantKicked(subjectOccupant, isCurrenUser, actor, reason);
            } else if (statusCodes.includes('301')) {
                if (isCurrenUser) {
                    this.rooms$.next(this.rooms$.getValue().filter(r => !r.jidBare.equals(roomJid)));
                }
                return room.handleOccupantBanned(subjectOccupant, isCurrenUser, actor, reason);
            } else if (statusCodes.includes('303')) {
                const handled = room.handleOccupantChangedNick(subjectOccupant, isCurrenUser, xEl.querySelector('item').getAttribute('nick'));
                if (handled && isCurrenUser) {
                    this.rooms$.next(this.rooms$.getValue());
                }
                return handled;
            } else if (statusCodes.includes('321')) {
                if (isCurrenUser) {
                    this.rooms$.next(this.rooms$.getValue().filter(r => !r.jidBare.equals(roomJid)));
                }
                return room.handleOccupantLostMembership(subjectOccupant, isCurrenUser);
            } else {
                if (isCurrenUser) {
                    this.rooms$.next(this.rooms$.getValue().filter(r => !r.jidBare.equals(roomJid)));
                }
                return room.handleOccupantLeft(subjectOccupant, isCurrenUser);
            }
        } else if (!stanzaType) {
            if (room.hasOccupant(subjectOccupant.occupantJid)) {
                const oldOccupant = room.getOccupant(subjectOccupant.occupantJid);
                return room.handleOccupantModified(subjectOccupant, oldOccupant, isCurrenUser);
            } else {
                return room.handleOccupantJoined(subjectOccupant, isCurrenUser);
            }
        }

        return false;
    }

    private getOrCreateRoom(roomJid: JID): Room {
        roomJid = roomJid.bare();
        let room = this.getRoomByJid(roomJid);
        if (!room) {
            room = new Room(roomJid, this.logService);
            this.rooms$.next([room, ...this.rooms$.getValue()]);
        }
        return room;
    }

    private async joinRoomInternal(roomJid: JID): Promise<{ presenceResponse: Stanza, room: Room }> {
        if (this.getRoomByJid(roomJid.bare())) {
            throw new Error('can not join room more than once: ' + roomJid.bare().toString());
        }
        const userJid = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const occupantJid = parseJid(roomJid.local, roomJid.domain, roomJid.resource || userJid.split('@')[0]);

        let roomInfo: Form | null = null;
        try {
            roomInfo = await this.getRoomInfo(occupantJid.bare());
        } catch (e) {
            if (!(e instanceof XmppResponseError) || e.errorCondition !== 'item-not-found') {
                throw e;
            }
        }

        try {
            const presenceResponse = await this.xmppChatAdapter.chatConnectionService
                .$pres({to: occupantJid.toString()})
                .c('x', {xmlns: nsMuc})
                .sendAwaitingResponse();
            this.handleRoomPresenceStanza(presenceResponse);

            const room = this.getOrCreateRoom(occupantJid.bare());
            room.nick = occupantJid.resource;
            if (roomInfo) {
                room.name = getField(roomInfo, 'muc#roomconfig_roomname')?.value as string | undefined;
                room.description = getField(roomInfo, 'muc#roominfo_description')?.value as string | undefined || '';
            }

            return {presenceResponse, room};
        } catch (e) {
            this.logService.error('error joining room', e);
            throw e;
        }
    }

    private extractRoomSummariesFromResponse(iq: IqResponseStanza): RoomSummary[] {
        return Array.from(Array.from(iq
            .querySelectorAll('query')).find(el => el.namespaceURI === nsDiscoItems)
            ?.querySelectorAll('item'))
            ?.reduce<RoomSummary[]>((acc, item) => {
                const jid = item.getAttribute('jid');
                const name = item.getAttribute('name');

                if (typeof jid === 'string' && typeof name === 'string') {
                    acc.push({
                        jid: parseJid(jid),
                        name,
                        roomInfo: null,
                    });
                }

                return acc;
            }, []) || [];
    }

    private extractResultSetFromResponse(iq: IqResponseStanza): Stanza {
        return Finder
            .create(iq)
            .searchByTag('query')
            .searchByNamespace(nsDiscoItems)
            .searchByTag('set')
            .searchByNamespace('http://jabber.org/protocol/rsm')
            .result;
    }

    private isRoomMessageStanza(stanza: Stanza): boolean {
        return stanza.tagName === 'message'
            && stanza.getAttribute('type') === 'groupchat'
            && !!stanza.querySelector('body')?.textContent.trim();
    }

    private handleRoomMessageStanza(messageStanza: Stanza, archiveDelayElement?: Stanza): boolean {
        const delayElement = archiveDelayElement ?? messageStanza.querySelector('delay');
        const stamp = delayElement?.getAttribute('stamp');
        const datetime = stamp ? new Date(stamp) : new Date() /* TODO: replace with entity time plugin */;

        const from = parseJid(messageStanza.getAttribute('from'));
        const room = this.getRoomByJid(from.bare());
        if (!room) {
            // there are several reasons why we can receive a message for an unknown room:
            // - this is a message delivered via MAM/MUCSub but the room it was stored for
            //   - is gone (was destroyed)
            //   - user was banned from room
            //   - room wasn't joined yet
            // - this is some kind of error on developer's side
            this.logService.warn(`received stanza for unknown room: ${from.bare().toString()}`);
            return false;
        }

        const message: RoomMessage = {
            body: messageStanza.querySelector('body').textContent.trim(),
            datetime,
            id: messageStanza.getAttribute('id'),
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

        return true;
    }

    private isRoomSubjectStanza(stanza: Stanza): boolean {
        return stanza.tagName === 'message'
            && stanza.getAttribute('type') === 'groupchat'
            && stanza.querySelector('subject') != null
            && stanza.querySelector('body') == null;
    }

    private handleRoomSubjectStanza(stanza: Stanza, archiveDelayElement: Stanza): boolean {
        const roomJid = parseJid(stanza.getAttribute('from')).bare();
        const room = this.getRoomByJid(roomJid);

        if (!room) {
            throw new Error(`unknown room trying to change room subject: roomJid=${roomJid.toString()}`);
        }

        // The archive only stores non-empty subjects. The current value of the subject is sent directly after entering a room by the room,
        // not the archive.
        // If a subject was first set, then unset, we would first receive the empty subject on room entry and then overwrite it with the
        // previous non-empty value from archive. This is why we want to always ignore subjects from archive.
        // This actually looks like a bug in MAM, it seems that MAM interprets messages with just subject in them as if they were chat
        // messages and not room metadata. This would explain why empty subjects are not stored.
        if (archiveDelayElement) {
            return true;
        }

        room.subject = stanza.querySelector('subject').textContent.trim();
        this.rooms$.next(this.rooms$.getValue());

        return true;
    }

    private handleRoomInvitationStanza(stanza: Stanza): boolean {
        const xElFinder = Finder.create(stanza).searchByTag('x').searchByNamespace(nsMucUser);
        const invitationEl = xElFinder.searchByTag('invite').result ?? xElFinder.searchByTag('decline').result;

        this.onInvitationSubject.next({
            type: invitationEl.tagName as Invitation['type'],
            roomJid: parseJid(stanza.getAttribute('from')),
            roomPassword: xElFinder.searchByTag('password').result?.textContent,
            from: parseJid(invitationEl.getAttribute('from')),
            message: invitationEl.querySelector('reason')?.textContent,
        });

        return true;
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
        return users.find(roomUser => roomUser.userIdentifiers.find(
            ids => ids.nick === occupantJid.resource || ids.userJid.bare().equals(occupantJid.bare())),
        )?.userIdentifiers?.[0].userJid;
    }
}
