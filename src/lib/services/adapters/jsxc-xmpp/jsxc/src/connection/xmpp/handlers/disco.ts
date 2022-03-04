import * as NS from '../namespace';
import AbstractHandler from '../AbstractHandler';

export class DiscoInfoHandler extends AbstractHandler {
   constructor(account) {
      super(account);

      account.getDiscoInfo().addFeature(NS.get('DISCO_INFO'));
   }

   public processStanza(stanza: Element): boolean {
       const id = stanza.getAttribute('id');
       const from = stanza.getAttribute('from');
       const node = stanza.getElementsByTagName('query')[0].getAttribute('node');

       let iq = $iq({
         type: 'result',
         id,
         to: from,
      }).c('query', {
         xmlns: NS.get('DISCO_INFO'),
         node: node ? node : undefined,
      });

       iq = this.addIdentitiesToStanza(iq);
       iq = this.addFeaturesToStanza(iq);

       (this.account.getConnection() as any).send(iq.tree()); // @REVIEW

       return true;
   }

   private addIdentitiesToStanza(iq) {
      for (const identity of this.account.getDiscoInfo().getIdentities()) {
          const attrs = {
              category: identity.category,
              type: identity.type,
              name: identity.name ? identity.name : null,
              'xml:lang': identity.lang ? identity.lang : null,
          };

          iq.c('identity', attrs).up();
      }

      return iq;
   }

   private addFeaturesToStanza(iq) {
      for (const feature of this.account.getDiscoInfo().getFeatures()) {
         iq.c('feature', {
            var: feature,
         }).up();
      }

      return iq;
   }
}

export class DiscoItemsHandler extends AbstractHandler {
   public processStanza(stanza: Element): boolean {
       const id = stanza.getAttribute('id');
       const from = stanza.getAttribute('from');
       const node = stanza.getElementsByTagName('query')[0].getAttribute('node');

       const iq = $iq({
           type: 'result',
           id,
           to: from,
       }).c('query', {
           xmlns: NS.get('DISCO_ITEMS'),
           node: node ? node : undefined,
       });

       // We return an empty set, because we dont support disco items

       (this.account.getConnection() as any).send(iq.tree());

       return true;
   }
}
