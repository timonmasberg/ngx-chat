import AbstractService from './AbstractService';
import { IJID } from '../../JID.interface';
import Form from '../Form';

// tslint:disable:unified-signatures
export default class Search extends AbstractService {
   public getSearchForm(jid: IJID): Promise<Element> {
      const iq = $iq({
         to: jid.bare,
         type: 'get',
      }).c('query', {
         xmlns: 'jabber:iq:search',
      });

      return this.sendIQ(iq);
   }

   public executeSearchForm(jid: IJID, form: Form): Promise<Element>;
   public executeSearchForm(
      jid: IJID,
      form: { first?: string; last?: string; nick?: string; email?: string }
   ): Promise<Element>;
   public executeSearchForm(jid: IJID, form) {
      const iq = $iq({
         to: jid.bare,
         type: 'set',
      }).c('query', {
         xmlns: 'jabber:iq:search',
      });

      if (typeof form.toXML === 'function') {
         iq.cnode(form.toXML());
      } else {
         Object.keys(form)
            .filter(key => ['first', 'last', 'nick', 'email'].includes(key))
            .forEach(key => {
               iq.c(key).t(form[key]).up();
            });
      }

      return this.sendIQ(iq);
   }
}
// tslint:enable:unified-signatures
