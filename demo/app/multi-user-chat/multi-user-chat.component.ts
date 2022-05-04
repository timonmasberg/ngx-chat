import {Component, Inject, ViewChild} from '@angular/core';
import {
    Affiliation,
    CHAT_SERVICE_TOKEN,
    ChatService,
    Form,
    JID,
    Room,
    RoomCreationOptions,
} from '@pazznetwork/ngx-chat';
import {jid} from '@xmpp/jid';
import {NgModel} from '@angular/forms';
import {MUC_SUB_EVENT_TYPE, RoomOccupant} from 'src/public-api';

@Component({
    selector: 'app-multi-user-chat',
    templateUrl: './multi-user-chat.component.html',
    styleUrls: ['./multi-user-chat.component.css'],
})
export class MultiUserChatComponent {

    @ViewChild('occupantJidInput') occupantJidInput: NgModel;
    occupantJidText: string;
    occupantJid: JID | null = null;
    selectedRoom: Room;
    allRooms: Room[] = [];
    roomUserList: RoomOccupant[] = [];
    newRoom?: RoomCreationOptions;
    mucSubSubscriptions = new Map<string, string[]>();
    roomConfiguration: Form;

    constructor(@Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService) {
    }

    updateOccupantJid(enteredJid: string) {
        try {
            this.occupantJid = jid(enteredJid);
            this.occupantJidInput.control.setErrors(null);
        } catch (e) {
            this.occupantJidInput.control.setErrors({notAJid: true});
        }
    }

    async joinRoom(occupantJid: JID) {
        this.selectedRoom = await this.chatService.joinRoom(occupantJid);
        this.occupantJid = occupantJid;
        this.occupantJidText = occupantJid.toString();
    }

    async subscribeWithMucSub(occupantJid: JID): Promise<void> {
        await this.chatService.subscribeRoom(occupantJid.toString(), [MUC_SUB_EVENT_TYPE.messages]);
    }

    async unsubscribeFromMucSub(occupantJid: JID): Promise<void> {
        await this.chatService.unsubscribeRoom(occupantJid.toString());
    }

    async getSubscriptions() {
        this.mucSubSubscriptions = await this.chatService.retrieveSubscriptions();
    }

    async queryUserList(occupantJid: JID) {
        this.roomUserList = await this.chatService.queryRoomUserList(occupantJid.bare());
    }

    async getRoomConfiguration(occupantJid: JID) {
        this.roomConfiguration = await this.chatService.getRoomConfiguration(occupantJid.bare());
    }

    displayMemberJid(member: RoomOccupant): string {
        return member.jid.bare().toString();
    }

    displayMemberNicks(member: RoomOccupant): string {
        return member.nick;
    }

    async destroyRoom(occupantJid: JID) {
        await this.chatService.destroyRoom(occupantJid);
        await this.queryAllRooms();
    }

    async queryAllRooms() {
        this.allRooms = await this.chatService.queryAllRooms();
    }

    createNewRoom(): void {
        this.newRoom = {
            roomId: '',
            membersOnly: true,
            nonAnonymous: false,
            persistentRoom: true,
            public: false,
            allowSubscription: true,
        };
    }

    cancelRoomCreation(): void {
        this.newRoom = null;
    }

    async createRoomOnServer() {
        if (!this.newRoom?.roomId || this.newRoom.roomId === '') {
            return;
        }

        const createdRoom = await this.chatService.createRoom(this.newRoom);
        this.updateOccupantJid(createdRoom.occupantJid.toString());

        this.newRoom = undefined;
    }

    findIdWithNick(member: RoomOccupant) {
        return member;
    }

    async kick(member: RoomOccupant) {
        const {nick} = this.findIdWithNick(member);
        await this.chatService.kickOccupant(nick, this.selectedRoom.jidBare);
    }

    async banOrUnban(member: RoomOccupant) {
        const memberJid = member.jid.bare();
        if (member.affiliation === Affiliation.outcast) {
            await this.chatService.unbanUserForRoom(memberJid, this.selectedRoom.jidBare);
            return;
        }
        await this.chatService.banUserForRoom(memberJid, this.selectedRoom.jidBare);
    }

    async leaveRoom(roomJid: JID) {
        if (roomJid.equals(this.occupantJid.bare())) {
            this.occupantJidText = '';
            this.occupantJid = null;
            this.selectedRoom = null;
        }
        await this.chatService.leaveRoom(roomJid);
    }
}
