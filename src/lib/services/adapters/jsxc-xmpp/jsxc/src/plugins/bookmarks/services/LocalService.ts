import AbstractService from './AbstractService';
import RoomBookmark from '../RoomBookmark';
import JID from '../../../JID';
import IStorage from '../../../Storage.interface';
import {IJID} from '../../../JID.interface';

export default class LocalService extends AbstractService {
   constructor(private storage: IStorage) {
      super();
   }

   public getName(): string {
      return 'local';
   }

   public async getRooms(): Promise<RoomBookmark[]> {
      const data = this.storage.getItem('rooms') || {};
      const rooms = [];

      // tslint:disable-next-line:forin
      for (const id in data) {
         const roomData = data[id];

         rooms.push(
            new RoomBookmark(new JID(id), roomData.alias, roomData.nickname, roomData.autoJoin, roomData.password)
         );
      }

      return rooms;
   }

   public async addRoom(room: RoomBookmark) {
      const data = this.storage.getItem('rooms') || {};
      const id = room.getJid().bare;

      data[id] = {
         alias: room.getAlias(),
         nickname: room.getNickname(),
         autoJoin: room.isAutoJoin(),
         password: room.getPassword(),
      };

      this.storage.setItem('rooms', data);
   }

   public async removeRoom(id: IJID) {
      const data = this.storage.getItem('rooms') || {};

      delete data[id.bare];

      this.storage.setItem('rooms', data);
   }
}
