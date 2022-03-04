import RoomBookmark from '../RoomBookmark';
import {IJID} from '../../../JID.interface';

export default abstract class AbstractService {
   public abstract getName(): string;

   public abstract getRooms(): Promise<RoomBookmark[]>;

   public abstract addRoom(room: RoomBookmark): Promise<void>;

   public abstract removeRoom(id: IJID): Promise<void>;
}
