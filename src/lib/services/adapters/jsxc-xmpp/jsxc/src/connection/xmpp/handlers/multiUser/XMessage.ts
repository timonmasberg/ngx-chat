import JID from '../../../../JID';
import AbstractHandler from '../../AbstractHandler';
import { TYPE as NOTICETYPE, FUNCTION as NOTICEFUNCTION } from '../../../../Notice';

export default class extends AbstractHandler {
   public processStanza(stanza: Element) {
       const from = new JID($(stanza).attr('from'));
       const xElement = $(stanza).find('x[xmlns="http://jabber.org/protocol/muc#user"]');

       const inviteElement = xElement.find('invite');

       if (inviteElement.length === 1) {
          const host = new JID(inviteElement.attr('from'));
          const reason = inviteElement.find('reason').text();
          const password = inviteElement.find('password').text();

          this.account.getNoticeManager().addNotice({
            title: 'Invitation',
            description: `for ${from.bare}`,
            type: NOTICETYPE.invitation,
            fnName: NOTICEFUNCTION.multiUserInvitation,
            fnParams: ['direct', host.bare, from.bare, reason, password, this.account.getUid()],
         });
      }

       return this.PRESERVE_HANDLER;
   }
}
