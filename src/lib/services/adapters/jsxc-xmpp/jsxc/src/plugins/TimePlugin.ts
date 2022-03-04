import { AbstractPlugin, IMetaData } from '../plugin/AbstractPlugin';
import PluginAPI from '../plugin/PluginAPI';
import * as moment from 'moment';
import JID from '../JID';
import Translation from '../util/Translation';

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '99.0.0';

const NAMESPACE_TIME = 'urn:xmpp:time';

export default class TimePlugin extends AbstractPlugin {
   public static getId(): string {
      return 'time';
   }

   public static getName(): string {
      return 'Entity Time';
   }

   public static getMetaData(): IMetaData {
      return {
         description: Translation.t('setting-time'),
         xeps: [
            {
               id: 'XEP-0202',
               name: 'Entity Time',
               version: '2.0',
            },
         ],
      };
   }

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      pluginAPI.addFeature(NAMESPACE_TIME);

      const connection = pluginAPI.getConnection();

      connection.registerHandler(this.onReceiveQuery, NAMESPACE_TIME, 'iq', 'get');
   }

   public query(jid: JID): Promise<{ tzo?: string; utc?: string }> {
       const iq = $iq({
           type: 'get',
           to: jid.full,
           xmlns: 'jabber:client',
       }).c('time', {
           xmlns: NAMESPACE_TIME,
       });

       return this.pluginAPI.sendIQ(iq).then(stanza => {
          const timeElement = $(stanza).find(`time[xmlns="${NAMESPACE_TIME}"]`);

          return {
            utc: timeElement.find('>utc').text(),
            tzo: timeElement.find('>tzo').text(),
         };
      });
   }

   private onReceiveQuery = (stanza: string) => {
       const fromJid = new JID($(stanza).attr('from'));
       const toJid = new JID($(stanza).attr('to'));

       if (this.pluginAPI.getContact(fromJid) || toJid.domain === fromJid.bare) {
         this.sendResponse($(stanza).attr('id'), $(stanza).attr('from'));
      }

       return true;
   }

   private sendResponse(id: string, jid: string): Promise<Element> {
       const iq = $iq({
           type: 'result',
           to: jid,
           id,
           xmlns: 'jabber:client',
       }).c('time', {
           xmlns: NAMESPACE_TIME,
       });

       iq.c('tzo').t(moment().format('Z')).up();
       iq.c('utc').t(moment().toISOString()).up();

       return this.pluginAPI.sendIQ(iq);
   }
}
