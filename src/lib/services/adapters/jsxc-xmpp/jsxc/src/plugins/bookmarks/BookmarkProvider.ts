import AbstractService from './services/AbstractService';
import RoomBookmark from './RoomBookmark';
import ContactProvider from '../../ContactProvider';
import ContactManager from '../../ContactManager';
import {IJID} from '../../JID.interface';
import MultiUserContact, {ROOMCONFIG} from '../../MultiUserContact';
import {ContactType, IContact} from '../../Contact.interface';
import RoleAllocator from '../../RoleAllocator';

export default class BookmarkProvider extends ContactProvider {
   private services: { [name: string]: AbstractService } = {};

   constructor(
      contactManager: ContactManager,
      private createMultiUserContact: (jid: IJID, name?: string) => MultiUserContact
   ) {
      super(contactManager);
   }

   public getUid(): string {
      return 'bookmark';
   }

   public async add(contact: MultiUserContact): Promise<boolean> {
      if (contact.getType() !== ContactType.GROUPCHAT) {
         return false;
      }

      const bookmark = this.contactToBookmark(contact);

      try {
         await this.addToServices(bookmark);
      } catch (err) {
         return false;
      }

      contact.setProvider(this);
      this.registerContact(contact);
      this.contactManager.addToCache(contact);

      return true;
   }

   public addToServices(bookmark: RoomBookmark): Promise<any> {
      const results = [];
      // tslint:disable-next-line:forin
      for (const name in this.services) {
         const service = this.services[name];

         results.push(service.addRoom(bookmark));
      }

      return Promise.all(results);
   }

   private contactToBookmark(contact: MultiUserContact): RoomBookmark {
      const id = contact.getJid();
      const alias = contact.hasName() ? contact.getName() : undefined;
      const nickname = contact.getNickname();
      const autoJoin = contact.isAutoJoin();
      const password = contact.getPassword();

      return new RoomBookmark(id, alias, nickname, autoJoin, password);
   }

   public createContact(jid: IJID, name?: string): MultiUserContact;
   public createContact(id: string): MultiUserContact;
   public createContact() {
      const contact = this.createMultiUserContact(arguments[0], arguments[1]);

      this.registerContact(contact);

      return contact;
   }

   private registerContact(contact: MultiUserContact) {
      // @TODO add hooks for more settings
      // @TODO delay update to aggregate changes
      contact.registerHook('name', () => {
         if (RoleAllocator.get().isMaster()) {
            this.updateContact(contact);
         }
      });
   }

   private updateContact(contact: MultiUserContact): Promise<any> {
      const bookmark = this.contactToBookmark(contact);

      return this.addToServices(bookmark);
   }

   public registerService(service: AbstractService) {
      this.services[service.getName()] = service;
   }

   public async deleteContact(jid: IJID): Promise<void> {
      const results = [];

      // tslint:disable-next-line:forin
      for (const name in this.services) {
         const service = this.services[name];

         results.push(service.removeRoom(jid));
      }

      await Promise.all(results);

      this.contactManager.deleteFromCache(jid.bare);
   }

   public async load(): Promise<IContact[]> {
      const bookmarks = await this.getReducedBookmarksFromServices();
      const contacts = [];

      // tslint:disable-next-line:forin
      for (const id in bookmarks) {
         const bookmark = bookmarks[id];
         contacts[contacts.length] = this.initBookmarkContact(bookmark.room, bookmark.service);
      }

      return contacts;
   }

   private async getReducedBookmarksFromServices(): Promise<{
      [id: string]: { room: RoomBookmark; service: AbstractService };
   }> {
      const bookmarks: {
         [id: string]: { room: RoomBookmark; service: AbstractService };
      } = {};

      // tslint:disable-next-line:forin
      for (const name in this.services) {
         const service = this.services[name];
         const rooms = await service.getRooms();

         for (const room of rooms) {
            bookmarks[room.getId()] = {
               room,
               service,
            };
         }
      }

      return bookmarks;
   }

   private initBookmarkContact(bookmark: RoomBookmark, service: AbstractService): IContact {
      const contact = this.createContact(bookmark.getJid());
      contact.setNickname(bookmark.getNickname());
      contact.setPassword(bookmark.getPassword());
      contact.setBookmark(true);
      contact.setAutoJoin(bookmark.isAutoJoin());
      contact.setProvider(this);

      if (bookmark.hasAlias()) {
         contact.setName(bookmark.getAlias());
      }

      if (bookmark.isAutoJoin()) {
         contact.setRoomConfiguration(ROOMCONFIG.INSTANT);
         contact.join();
      }

      return contact;
   }
}
