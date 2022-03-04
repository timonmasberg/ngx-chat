import Message from './Message';
import { IMessage as IMessage, DIRECTION } from './Message.interface';
import Contact from './Contact';
import Storage from './Storage';
import PersistentMap from './util/PersistentMap';
import Client from './Client';

export default class Transcript {
   private properties: PersistentMap;

   private firstMessage: IMessage;

   private lastMessage: IMessage;

   private messages: { [index: string]: IMessage } = {};

   constructor(storage: Storage, private contact: Contact) {
      this.properties = new PersistentMap(storage, 'transcript', contact.getId());

      this.properties.registerHook('firstMessageId', firstMessageId => {
         this.firstMessage = this.getMessage(firstMessageId);
      });
   }

   public unshiftMessage(message: IMessage) {
      const lastMessage = this.getLastMessage();

      if (lastMessage) {
         lastMessage.setNext(message);
      } else {
         this.pushMessage(message);
      }

      message.setNext(undefined);

      this.lastMessage = message;
   }

   public pushMessage(message: IMessage) {
      if (!message.getNextId() && this.firstMessage) {
         message.setNext(this.firstMessage);
      }

      this.addMessage(message);

      if (message.getDirection() !== DIRECTION.SYS) {
         this.contact.setLastMessageDate(message.getStamp());
      }

      this.properties.set('firstMessageId', message.getUid());

      this.deleteLastMessages();
   }

   public getFirstChatMessage(): IMessage {
      for (const message of this.getGenerator()) {
         if (!message.isSystem() && !message.isReplacement()) {
            return message;
         }
      }
      return null;
   }

   public getFirstIncomingMessage(): IMessage {
      for (const message of this.getGenerator()) {
         if (message.isIncoming() && !message.isReplacement()) {
            return message;
         }
      }

      return null;
   }

   public getFirstOutgoingMessage(): IMessage {
      for (const message of this.getGenerator()) {
         if (message.isOutgoing() && !message.isReplacement()) {
            return message;
         }
      }
      return null;
   }

   public getFirstMessage(): IMessage {
      if (!this.firstMessage && this.properties.get('firstMessageId')) {
         this.firstMessage = this.getMessage(this.properties.get('firstMessageId'));
      }

      return this.firstMessage;
   }

   public getFirstOriginalMessage(): IMessage {
      for (const message of this.getGenerator()) {
         if (!message.isReplacement()) {
            return message;
         }
      }
      return null;
   }

   public getLastMessage(): IMessage {
      if (this.lastMessage) {
         return this.lastMessage;
      }

      const ids = [];
      let lastMessage = this.getFirstMessage();

      while (lastMessage && lastMessage.getNextId()) {
         const id = lastMessage.getNextId();

         if (ids.indexOf(id) > -1) {
            throw new Error('loop detected getting last message');
         }

         ids.push(id);

         lastMessage = this.getMessage(id);
      }

      return (this.lastMessage = lastMessage);
   }

   public getMessage(id: string): IMessage {
      if (!this.messages[id] && id) {
         try {
            this.messages[id] = new Message(id);

            this.messages[id].registerHook('unread', unread => {
               if (!unread) {
                  this.removeMessageFromUnreadMessages(this.messages[id]);
               }
            });
         } catch (err) {
            return undefined;
         }
      }

      return this.messages[id];
   }

   public *getGenerator() {
      let message = this.getFirstMessage();

      while (message) {
         yield message;

         const nextId = message.getNextId();

         message = nextId ? this.getMessage(nextId) : undefined;
      }
   }

   public findMessageByAttrId(attrId: string): IMessage {
      for (const message of this.getGenerator()) {
         if (message.getAttrId() === attrId) {
            return message;
         }
      }

      return null;
   }

   private deleteLastMessages() {
      const allowedNumberOfMessages = parseInt(Client.getOption('numberOfMessages'), 10);
      let numberOfMessages = 0;

      if (allowedNumberOfMessages <= 0 || isNaN(allowedNumberOfMessages)) {
         return;
      }

      let message = this.getFirstMessage();
      let nextMessage: IMessage;

      while (message) {
         nextMessage = this.getMessage(message.getNextId());

         numberOfMessages++;

         if (numberOfMessages === allowedNumberOfMessages) {
            message.setNext(undefined);
         } else if (numberOfMessages > allowedNumberOfMessages) {
            message.delete();
         }

         message = nextMessage;
      }
   }

   public clear() {
      let message = this.getFirstMessage();
      let nextMessage: IMessage;

      while (message) {
         nextMessage = this.getMessage(message.getNextId());

         message.delete();

         message = nextMessage;
      }

      this.messages = {};
      this.firstMessage = undefined;
      this.lastMessage = undefined;

      this.properties.remove('firstMessageId');
   }

   public registerNewMessageHook(func: (newValue: any, oldValue: any) => void) {
      this.registerHook('firstMessageId', func);
   }

   public registerHook(property: string, func: (newValue: any, oldValue: any) => void) {
      this.properties.registerHook(property, func);
   }

   public markAllMessagesAsRead() {
      const unreadMessageIds = this.properties.get('unreadMessageIds') || [];

      for (const id of unreadMessageIds) {
         const message = this.messages[id];

         if (message) {
            message.read();
         }
      }

      this.properties.set('unreadMessageIds', []);
   }

   public getNumberOfUnreadMessages(): number {
      const unreadMessageIds = this.properties.get('unreadMessageIds') || [];

      return unreadMessageIds.length;
   }

   private removeMessageFromUnreadMessages(message: IMessage) {
      const unreadMessageIds: string[] = this.properties.get('unreadMessageIds') || [];

      if (message && unreadMessageIds.includes(message.getUid())) {
         this.properties.set(
            'unreadMessageIds',
            unreadMessageIds.filter(id => id !== message.getUid())
         );
      }
   }

   private addMessage(message: IMessage) {
      const id = message.getUid();

      this.messages[id] = message;

      if (message.getDirection() !== DIRECTION.OUT && message.isUnread()) {
         const unreadMessageIds = this.properties.get('unreadMessageIds') || [];
         unreadMessageIds.push(id);
         this.properties.set('unreadMessageIds', unreadMessageIds);

         message.registerHook('unread', unread => {
            if (!unread) {
               this.removeMessageFromUnreadMessages(message);
            }
         });
      }
   }
}
