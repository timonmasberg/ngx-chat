import {JID} from '@xmpp/jid';
import {ReplaySubject, Subject} from 'rxjs';
import {dummyAvatarRoom} from './contact-avatar';
import {DateMessagesGroup, MessageStore} from './message-store';
import {LogService} from '../services/adapters/xmpp/service/log.service';
import {jid as parseJid} from '@xmpp/client';
import {isJid, Recipient} from './recipient';
import {RoomOccupant} from '../services/adapters/xmpp/plugins/multi-user-chat/room-occupant';
import {RoomMessage} from '../services/adapters/xmpp/plugins/multi-user-chat/room-message';
import {OccupantChange} from '../services/adapters/xmpp/plugins/multi-user-chat/occupant-change';
import {Form} from './form';

export class Room {
    readonly recipientType = 'room';
    readonly jid: JID;
    occupantJid: JID | undefined;
    description = '';
    subject = '';
    avatar = dummyAvatarRoom;
    // Room configuration
    info: Form | null;
    private readonly messageStore: MessageStore<RoomMessage>;
    private readonly roomOccupants = new Map<string, RoomOccupant>();
    private readonly onOccupantChangeSubject = new ReplaySubject<OccupantChange>(Infinity, 1000);
    readonly onOccupantChange$ = this.onOccupantChangeSubject.asObservable();
    private readonly occupantsSubject = new ReplaySubject<RoomOccupant[]>(1);
    readonly occupants$ = this.occupantsSubject.asObservable();

    constructor(roomJid: JID, private readonly logService: LogService, name?: string) {
        this.jid = roomJid.bare();
        this.name = name;
        this.messageStore = new MessageStore<RoomMessage>(logService);
    }

    get nick(): string | undefined {
        return this.occupantJid?.resource;
    }

    set nick(nick: string) {
        const occupantJid = parseJid(this.jid.toString());
        occupantJid.resource = nick;
        this.occupantJid = occupantJid;
    }

    // tslint:disable-next-line:variable-name
    private _name: string;

    get name(): string {
        return this._name;
    }

    set name(name: string | undefined) {
        this._name = !!name ? name : this.jid.local;
    }

    get jidBare(): JID {
        return this.jid;
    }

    get messages$(): Subject<RoomMessage> {
        return this.messageStore.messages$;
    }

    get messages(): RoomMessage[] {
        return this.messageStore.messages;
    }

    get dateMessagesGroups(): DateMessagesGroup<RoomMessage>[] {
        return this.messageStore.dateMessageGroups;
    }

    get oldestMessage(): RoomMessage {
        return this.messageStore.oldestMessage;
    }

    get mostRecentMessage(): RoomMessage {
        return this.messageStore.mostRecentMessage;
    }

    get mostRecentMessageReceived(): RoomMessage {
        return this.messageStore.mostRecentMessageReceived;
    }

    get mostRecentMessageSent(): RoomMessage {
        return this.messageStore.mostRecentMessageSent;
    }

    addMessage(message: RoomMessage): void {
        this.messageStore.addMessage(message);
    }

    equalsBareJid(other: Recipient | JID): boolean {
        if (other instanceof Room || isJid(other)) {
            const otherJid = other instanceof Room ? other.jid : other.bare();
            return this.jid.equals(otherJid);
        }
        return false;
    }

    hasOccupant(occupantJid: JID): boolean {
        return this.roomOccupants.has(occupantJid.toString());
    }

    getOccupant(occupantJid: JID): RoomOccupant | undefined {
        return this.roomOccupants.get(occupantJid.toString());
    }

    handleOccupantJoined(occupant: RoomOccupant, isCurrentUser: boolean) {
        this.addOccupant(occupant);

        this.onOccupantChangeSubject.next({change: 'joined', occupant, isCurrentUser});
        this.logService.debug(`occupant joined room: occupantJid=${occupant.jid.toString()}, roomJid=${this.jid.toString()}`);
    }

    handleOccupantLeft(occupant: RoomOccupant, isCurrentUser: boolean) {
        this.removeOccupant(occupant, isCurrentUser);
        this.logService.debug(`occupant left room: occupantJid=${occupant.jid.toString()}, roomJid=${this.jid.toString()}`);
        this.onOccupantChangeSubject.next({change: 'left', occupant, isCurrentUser});
    }

    handleOccupantConnectionError(occupant: RoomOccupant, isCurrentUser: boolean) {
        this.removeOccupant(occupant, isCurrentUser);
        this.logService.debug(`occupant left room due to connection error: occupantJid=${occupant.jid.toString()}, roomJid=${this.jid.toString()}`);
        this.onOccupantChangeSubject.next({change: 'leftOnConnectionError', occupant, isCurrentUser});
    }

    handleOccupantKicked(occupant: RoomOccupant, isCurrentUser: boolean, actor?: string, reason?: string) {
        this.removeOccupant(occupant, isCurrentUser);
        if (isCurrentUser) {
            this.logService.info(`you got kicked from room! roomJid=${this.jid.toString()}, by=${actor}, reason=${reason}`);
        }
        this.logService.debug(`occupant got kicked: occupantJid=${occupant.jid.toString()}, roomJid=${this.jid.toString()}`);
        this.onOccupantChangeSubject.next({change: 'kicked', occupant, isCurrentUser, actor, reason});
    }

    handleOccupantBanned(occupant: RoomOccupant, isCurrentUser: boolean, actor?: string, reason?: string) {
        this.removeOccupant(occupant, isCurrentUser);
        if (isCurrentUser) {
            this.logService.info(`you got banned from room! roomJid=${this.jid.toString()}, by=${actor}, reason=${reason}`);
        }
        this.logService.debug(`occupant got banned: occupantJid=${occupant.jid.toString()}, roomJid=${this.jid.toString()}`);
        this.onOccupantChangeSubject.next({change: 'banned', occupant, isCurrentUser, actor, reason});
    }

    handleOccupantLostMembership(occupant: RoomOccupant, isCurrentUser: boolean) {
        this.removeOccupant(occupant, isCurrentUser);
        if (isCurrentUser) {
            this.logService.info(`your membership got revoked and you got kicked from member-only room: ${this.jid.toString()}`);
        }
        // TODO: we should emit the Status Codes
        this.onOccupantChangeSubject.next({change: 'lostMembership', occupant, isCurrentUser});
    }

    handleOccupantRoomMembersOnly(occupant: RoomOccupant, isCurrentUser: boolean): void {
        this.removeOccupant(occupant, isCurrentUser);
        if (isCurrentUser) {
            this.logService.info(`you got kicked from member-only room: ${this.jid.toString()}`);
        }
        // TODO: we should emit the Status Codes
        this.onOccupantChangeSubject.next({change: 'roomMemberOnly', occupant, isCurrentUser});
    }

    handleOccupantChangedNick(occupant: RoomOccupant, isCurrentUser: boolean, newNick: string) {
        if (isCurrentUser) {
            this.nick = newNick;
        }
        let existingOccupant = this.roomOccupants.get(occupant.jid.toString());
        if (!existingOccupant) {
            existingOccupant = {...occupant};
            existingOccupant.jid = parseJid(occupant.jid.toString());
        }
        existingOccupant.jid.resource = newNick;
        existingOccupant.nick = newNick;
        this.roomOccupants.delete(occupant.jid.toString());
        this.roomOccupants.set(existingOccupant.jid.toString(), existingOccupant);

        this.logService.debug(`occupant changed nick: from=${occupant.nick}, to=${newNick}, occupantJid=${occupant.jid.toString()}, roomJid=${this.jid.toString()}`);
        this.onOccupantChangeSubject.next({change: 'changedNick', occupant, newNick, isCurrentUser});
    }

    handleOccupantModified(occupant: RoomOccupant, oldOccupant: RoomOccupant, isCurrentUser: boolean) {
        this.logService.debug(`occupant changed: from=${JSON.stringify(oldOccupant)}, to=${JSON.stringify(occupant)}`);
        this.onOccupantChangeSubject.next({change: 'modified', occupant, oldOccupant, isCurrentUser});
    }

    equals(other: Room | null | undefined): boolean {
        if (this === other) {
            return true;
        }

        if (other == null || !(other instanceof Room)) {
            return false;
        }

        return this.jid.equals(other.jid);
    }

    private addOccupant(occupant: RoomOccupant) {
        this.roomOccupants.set(occupant.jid.toString(), occupant);
        this.occupantsSubject.next([...this.roomOccupants.values()]);
    }

    private removeOccupant(occupant: RoomOccupant, isCurrentUser: boolean) {
        if (isCurrentUser) {
            this.roomOccupants.clear();
            this.occupantsSubject.next([]);
        } else {
            if (this.roomOccupants.delete(occupant.jid.toString())) {
                this.occupantsSubject.next([...this.roomOccupants.values()]);
            }
        }
    }
}
