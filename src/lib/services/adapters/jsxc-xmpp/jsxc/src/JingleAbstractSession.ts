import Account from './Account';
import JID from './JID';

import IStorage from './Storage.interface';
import { IOTalkJingleSession, OTalkEventNames, IEndReason } from './vendor/Jingle.interface';
import {IContact} from './Contact.interface';

export const JINGLE_FEATURES = {
   screen: ['urn:xmpp:jingle:transports:ice-udp:1', 'urn:xmpp:jingle:apps:dtls:0'],
   audio: [],
   video: [],
};
JINGLE_FEATURES.audio = [...JINGLE_FEATURES.screen, 'urn:xmpp:jingle:apps:rtp:audio'];
JINGLE_FEATURES.video = [...JINGLE_FEATURES.audio, 'urn:xmpp:jingle:apps:rtp:video'];

export default abstract class JingleAbstractSession {
   protected storage: IStorage;

   protected peerJID: JID;
   protected peerContact: IContact;
   protected peerChatRootElement: Element;

   public abstract getMediaRequest(): string[];
   public abstract onOnceIncoming();
   protected abstract onIncoming();

   constructor(protected account: Account, protected session: IOTalkJingleSession) {
      this.storage = this.account.getStorage();

      this.peerJID = new JID(session.peerID);
      this.peerContact = this.account.getContact(this.peerJID);
      this.peerChatRootElement = this.peerContact.getChatRootElement();

      if (!this.session.isInitiator) {
         this.onIncoming();
      }
   }

   public getId() {
      return this.session.sid;
   }

   public getPeer() {
      return this.peerContact;
   }

   public getCallType(): 'audio' | 'video' | 'stream' {
      const mediaRequested = this.getMediaRequest();

      if (mediaRequested.includes('video')) {
         return 'video';
      }

      if (mediaRequested.length === 0) {
         return 'stream';
      }

      return 'audio';
   }

   public on(eventName: OTalkEventNames | 'adopt', handler: (data: any) => void) {
      this.session.on(eventName as any, (session, data) => handler(data));
   }

   public cancel(): void {
      this.session.cancel();
   }

   public decline(): void {
      this.session.decline();
   }

   public end(reason?: string | IEndReason, silent?: boolean): void {
      this.session.end(reason, silent);
   }
}
