import JID from '../../../JID';
import AbstractHandler from '../AbstractHandler';
import { MessageElement } from '../MessageElement';
import {IContact} from '../../../Contact.interface';
import Translation from '../../../util/Translation';
import Message from '../../../Message';
import Log from '../../../util/Log';
import {IMessage} from '../../../Message.interface';

export default class extends AbstractHandler {
   public processStanza(stanza: Element) {
      let message;
      let messageElement: MessageElement;

      try {
         messageElement = new MessageElement(stanza);
      } catch (err) {
         return this.PRESERVE_HANDLER;
      }

      let peer = messageElement.getPeer();

      // workaround for broken OpenFire implementation
      if (!peer || peer === this.account.getJID().full) {
         const attrId = messageElement.getId();

         if (Message.exists(attrId)) {
            message = new Message(attrId);

            peer = message.getPeer().bare;
         } else {
            peer = this.getPeerByMessageAttrId(attrId);
         }

         if (!peer) {
            return this.PRESERVE_HANDLER;
         }
      }

      const peerJid = new JID(peer);
      const peerContact = this.account.getContact(peerJid);

      if (typeof peerContact === 'undefined') {
         return this.PRESERVE_HANDLER;
      }

      message = peerContact.getTranscript().findMessageByAttrId(messageElement.getId());

      const errorElement = messageElement.find('error');

      Log.warn(
         'Message error: ',
         errorElement.find('text[xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"]').text() || 'no description provided'
      );


      const pipe = this.account.getPipe<[IContact, IMessage, Element]>('afterReceiveErrorMessage');

      pipe.run(peerContact, message, messageElement.get(0)).then(([contact, pipeMessage]) => {
         if (pipeMessage && !pipeMessage.getErrorMessage()) {
            pipeMessage.setErrorMessage(Translation.t('message_not_delivered'));
         }
      });

      return this.PRESERVE_HANDLER;
   }

   private getPeerByMessageAttrId(id: string) {
      return $('.jsxc-chatmessage[id="' + id + '"]')
         .closest('[data-jid]')
         .attr('data-jid');
   }
}
