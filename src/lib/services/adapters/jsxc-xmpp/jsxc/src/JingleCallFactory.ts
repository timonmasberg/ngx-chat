import {IContact} from './Contact.interface';
import JingleCallSession from './JingleCallSession';
import JingleHandler from './connection/JingleHandler';
import JID from './JID';

export function JingleCallFactory(
   jingleHandler: JingleHandler,
   stream: MediaStream,
   type: 'video' | 'audio' | 'screen',
   contact: IContact
) {
   const constraints = {
      offerToReceiveAudio: type === 'video' || type === 'audio' || type === 'screen',
      offerToReceiveVideo: type === 'video' || type === 'screen',
   };

   return async (resource: string, sessionId?: string) => {
      const peerJID = new JID(contact.getJid().bare + '/' + resource);

      const session = await jingleHandler.initiate(peerJID, stream, constraints, sessionId) as JingleCallSession;
      const contactOfflineTimeout = setTimeout(() => {
         session.cancel();
      }, 30000);

      session.on('accepted', () => {
         clearTimeout(contactOfflineTimeout);
      });

      session.on('terminated', () => {
         clearTimeout(contactOfflineTimeout);
      });

      return session;
   };
}
