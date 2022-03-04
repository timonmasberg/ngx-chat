import Log from '../../../util/Log';
import JID from '../../../JID';
import { IContact } from '../../../Contact.interface';
import { TYPE as NOTICETYPE, FUNCTION as NOTICEFUNCTION } from '../../../Notice';
import { Presence } from '../../AbstractConnection';
import 'jquery';
import AbstractHandler from '../AbstractHandler';
import { ContactSubscription as SUBSCRIPTION } from '../../../Contact.interface';
import Roster from '../../services/Roster';

const PRESENCE = {
   ERROR: 'error',
   SUBSCRIBE: 'subscribe',
   UNAVAILABLE: 'unavailable',
   UNSUBSCRIBED: 'unsubscribed',
};

export default class extends AbstractHandler {
   public processStanza(stanza: Element): boolean {
      Log.debug('onPresence', stanza);

      const presence = {
           type: $(stanza).attr('type'),
           from: new JID($(stanza).attr('from')),
           show: $(stanza).find('show').text(),
           status: $(stanza).find('status').text(),
       };

      const status: Presence = this.determinePresenceStatus(presence);

      if (presence.from.bare === this.account.getJID().bare) {
         if (presence.from.resource === this.account.getJID().resource) {
            this.account.setPresence(status);
         }

         return this.PRESERVE_HANDLER;
      }

      if (presence.type === PRESENCE.ERROR) {
          const errorStanza = $(stanza).find('error');
          const errorCode = errorStanza.attr('code') || '';
          const errorType = errorStanza.attr('type') || '';
          const errorBy = errorStanza.attr('by') || 'unkown';
          const errorReason = errorStanza.find('>:first-child').prop('tagName');
          const errorText = errorStanza.find('text').text();

          if (errorStanza.find('remote-server-not-found').length > 0) {
            Log.info(
               `You have an invalid contact (${presence.from.toString()}) in your contact list. The error message from ${errorBy} is: ${errorText}`
            );
         } else {
            Log.error('[XMPP] ' + errorType + ', ' + errorCode + ', ' + errorReason + ', ' + errorText);
         }

          return this.PRESERVE_HANDLER;
      }

      const contact = this.account.getContact(presence.from);

       // incoming friendship request
      if (presence.type === PRESENCE.SUBSCRIBE) {
         Log.debug('received subscription request');

         this.processSubscribtionRequest(presence.from, contact);

         return this.PRESERVE_HANDLER;
      }

      if (typeof contact === 'undefined') {
         Log.warn('Could not find contact object for ' + presence.from.full);

         return this.PRESERVE_HANDLER;
      }

      const oldPresence = contact.getPresence();

      contact.setStatus(presence.status);
      contact.setPresence(presence.from.resource, status);
      contact.setResource(''); // reset jid, so new messages go to the bare jid

      Log.debug('Presence (' + presence.from.full + '): ' + Presence[status]);

      this.account.triggerPresenceHook(contact, contact.getPresence(), oldPresence);

      // preserve handler
      return this.PRESERVE_HANDLER;
   }

   private processSubscribtionRequest(jid: JID, contact: IContact) {
      if (contact) {
         Log.debug('Auto approve contact request, because he is already in our contact list.');

         this.account.getConnection().getRosterService.sendSubscriptionAnswer(contact.getJid(), true);

         if (contact.getSubscription() !== SUBSCRIPTION.TO) {
            // Roster.get().add(contact);
         }

         return this.PRESERVE_HANDLER;
      }

      this.account.getNoticeManager().addNotice({
         title: 'Friendship_request',
         description: 'from ' + jid.bare,
         type: NOTICETYPE.contact,
         fnName: NOTICEFUNCTION.contactRequest,
         fnParams: [jid.bare],
      });

      return null;
   }

   private determinePresenceStatus(presence): Presence {
      let status;

      if (presence.type === PRESENCE.UNAVAILABLE || presence.type === PRESENCE.UNSUBSCRIBED) {
         status = Presence.offline;
      } else {
          const show = presence.show;

          if (show === '') {
            status = Presence.online;
         } else {
            status = Presence[show];
         }
      }

      return status;
   }
}
