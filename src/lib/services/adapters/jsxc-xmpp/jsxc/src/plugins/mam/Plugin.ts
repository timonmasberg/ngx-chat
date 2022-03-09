import { AbstractPlugin, IMetaData } from '../../plugin/AbstractPlugin';
import Translation from '../../util/Translation';
import PersistentMap from '../../util/PersistentMap';
import JID from '../../JID';
import { IJID } from '../../JID.interface';
import {NS} from '../../connection/xmpp/Namespace';
import Archive from './Archive';
import PluginAPI from '../../plugin/PluginAPI';
import {IContact} from '../../Contact.interface';
import Contact from '../../Contact';

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '99.0.0';

const MAM1 = 'urn:xmpp:mam:1';
const MAM2 = 'urn:xmpp:mam:2';

NS.register('MAM1', MAM1);
NS.register('MAM2', MAM2);

export default class MessageArchiveManagementPlugin extends AbstractPlugin {

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      this.queryContactRelation = new PersistentMap(pluginAPI.getStorage(), 'mam', 'query');

      this.pluginAPI.getConnection().registerHandler(this.onMamMessage, null, 'message', null);
   }

   private archives: { [key: string]: Archive } = {};
   private queryContactRelation: PersistentMap;
   private supportCache: { [archiveJid: string]: string | boolean } = {};
   public static getId(): string {
      return 'mam';
   }

   public static getName(): string {
      return 'Message Archive Management';
   }

   public static getDescription(): string {
      return null;
   }

   public static getMetaData(): IMetaData {
      return {
         description: Translation.t('setting-mam-enable'),
         xeps: [
            {
               id: 'XEP-0313',
               name: 'Message Archive Management',
               version: '0.6.3',
            },
         ],
      };
   }

   public getStorage() {
      return this.pluginAPI.getStorage();
   }

   public getConnection() {
      return this.pluginAPI.getConnection();
   }

   public addQueryContactRelation(queryId: string, contact: IContact) {
      this.queryContactRelation.set(queryId, contact.getJid().bare);
   }

   public removeQueryContactRelation(queryId: string) {
      this.queryContactRelation.remove(queryId);
   }

   public async determineServerSupport(archivingJid: IJID) {
      if (typeof this.supportCache[archivingJid.bare] !== 'undefined') {
         return this.supportCache[archivingJid.bare];
      }

      const discoInfoRepository = this.pluginAPI.getDiscoInfoRepository();

      let version: string = null;
      try {
         const discoInfo = await discoInfoRepository.getCapabilities(archivingJid);

         if (discoInfo && discoInfo.hasFeature(MAM2)) {
            version = MAM2;
         } else if (discoInfo && discoInfo.hasFeature(MAM1)) {
            version = MAM1;
         }
      } catch (err) {
         this.pluginAPI.Log.warn('Could not determine MAM server support:', err);
      }

      if (version) {
         this.pluginAPI.Log.debug(archivingJid.bare + ' supports ' + version);
      } else {
         this.pluginAPI.Log.debug(archivingJid.bare + ' has no support for MAM');
      }

      this.supportCache[archivingJid.bare] = version;

      return version;
   }

   private getArchiveJid(contact: Contact) {
      const jid = contact.isGroupChat() ? contact.getJid() : this.getConnection().getJID;

      return new JID(jid.bare);
   }

   private loadMostRecentUnloadedMessages(jid: JID) {
      const archive = this.getArchive(jid);
      archive.nextMessages();
   }

   private onMamMessage = (stanza: string): boolean => {
      const stanzaElement = $(stanza);
      const resultElement = stanzaElement.find(`result[xmlns^="urn:xmpp:mam:"]`);
      const queryId = resultElement.attr('queryid');

      if (resultElement.length !== 1 || !queryId) {
         return true;
      }

      const forwardedElement = resultElement.find('forwarded[xmlns="urn:xmpp:forward:0"]');

      if (forwardedElement.length !== 1) {
         return true;
      }

      const bareJid = this.queryContactRelation.get(queryId);

      if (!bareJid) {
         return true;
      }

      const jid = new JID(bareJid);

      this.getArchive(jid).onForwardedMessage(forwardedElement);

      return true;
   }

   public getArchive(jid: IJID) {
      if (!this.archives[jid.bare]) {
         this.archives[jid.bare] = new Archive(this, this.pluginAPI.getContact(jid));
      }

      return this.archives[jid.bare];
   }
}
