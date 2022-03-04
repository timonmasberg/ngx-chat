import Log from '../../../../util/Log';
import JID from '../../../../JID';
import MultiUserContact from '../../../../MultiUserContact';
import AbstractHandler from '../../AbstractHandler';
import MultiUserPresenceProcessor from './PresenceProcessor';
import Translation from '../../../../util/Translation';

const possibleErrorConditions = [
   'not-authorized',
   'forbidden',
   'item-not-found',
   'not-allowed',
   'not-acceptable',
   'registration-required',
   'conflict',
   'service-unavailable',
];

export default class extends AbstractHandler {
   public processStanza(stanza: Element): boolean {
      Log.debug('onMultiUserPresence', stanza);

      const from = new JID($(stanza).attr('from'));
      const type = $(stanza).attr('type');

      const multiUserContact = this.account.getContact(from);

      if (!(multiUserContact instanceof MultiUserContact)) {
         return this.PRESERVE_HANDLER;
      }

      const nickname = from.resource;

      if (type === 'error') {
         if (from.resource === multiUserContact.getNickname()) {
             const errorElement = $(stanza).find('error');
             const errorReason = errorElement
                 .find('[xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"]')
                 .first()
                 ?.prop('tagName')
                 ?.toLowerCase();

             if (possibleErrorConditions.includes(errorReason)) {
               multiUserContact.addSystemMessage(Translation.t('muc_' + errorReason));
            }
         }

         return this.PRESERVE_HANDLER;
      }

      const xElement = $(stanza).find('x[xmlns="http://jabber.org/protocol/muc#user"]');

      if (xElement.length === 0) {
         return this.PRESERVE_HANDLER;
      }

      new MultiUserPresenceProcessor(multiUserContact, xElement, nickname, type);

      return this.PRESERVE_HANDLER;
   }
}
