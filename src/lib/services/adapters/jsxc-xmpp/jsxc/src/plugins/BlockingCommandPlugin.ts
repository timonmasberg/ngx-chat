import { AbstractPlugin, IMetaData } from '../plugin/AbstractPlugin';
import PluginAPI from '../plugin/PluginAPI';
import Translation from '../util/Translation';
import {IContact} from '../Contact.interface';
import {IMessage} from '../Message.interface';

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '99.0.0';

const NAMESPACE_BLOCKING_COMMAND = 'urn:xmpp:blocking';

export default class BlockingCommandPlugin extends AbstractPlugin {
   private static rosterMenuEntryAdded = false;

   public static getId(): string {
      return 'blocking-command';
   }

   public static getName(): string {
      return 'Blocking Command';
   }

   public static getMetaData(): IMetaData {
      return {
         description: Translation.t('setting-blocking-command-enable'),
         xeps: [
            {
               id: 'XEP-0191',
               name: 'Blocking Command',
               version: '1.3',
            },
         ],
      };
   }

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      pluginAPI.getSessionStorage().registerHook('blocklist', this.onBlocklistChanged);

      const connection = pluginAPI.getConnection();

      pluginAPI.addFeature(NAMESPACE_BLOCKING_COMMAND);
      pluginAPI.addAfterReceiveErrorMessageProcessor(this.errorMessageProcessor);

      connection.registerHandler(this.onBlocklistUpdate, NAMESPACE_BLOCKING_COMMAND, 'iq', 'set');

      pluginAPI.registerConnectionHook(status => {
         if (status === Strophe.Status.ATTACHED) {
            this.getBlocklist().then(list => this.onBlocklistChanged(list));
         }
      });

      if (!BlockingCommandPlugin.rosterMenuEntryAdded) {
         BlockingCommandPlugin.rosterMenuEntryAdded = true;
      }
   }

   public async getBlocklist(): Promise<string[]> {
      const sessionStorage = this.pluginAPI.getSessionStorage();
      let blocklist: string[] = sessionStorage.getItem('blocklist');

      if (!blocklist) {
         blocklist = await this.requestBlocklist();

         sessionStorage.setItem('blocklist', blocklist);
      }

      return blocklist;
   }

   private async requestBlocklist(): Promise<string[]> {
      const iq = $iq({
         type: 'get',
      }).c('blocklist', {
         xmlns: NAMESPACE_BLOCKING_COMMAND,
      });

      if (!(await this.hasSupport())) {
         this.pluginAPI.Log.info('This server does not support blocking command');

         return [];
      }

      const stanza = await this.pluginAPI.sendIQ(iq);
      const blocklistElement = $(stanza).find(`blocklist[xmlns="${NAMESPACE_BLOCKING_COMMAND}"]`);

      return blocklistElement
         .find('> item')
         .map((index, item) => $(item).attr('jid').toLowerCase())
         .get();
   }

   public hasSupport(): Promise<boolean> {
      return this.pluginAPI.getDiscoInfoRepository().hasFeature(undefined, NAMESPACE_BLOCKING_COMMAND);
   }

   public block(jids: string[]): Promise<Element> {
      if (!jids || jids.length === 0) {
         return Promise.reject();
      }

      const iq = $iq({
         type: 'set',
      }).c('block', {
         xmlns: NAMESPACE_BLOCKING_COMMAND,
      });

      for (const jid of jids) {
         iq.c('item', { jid: jid }).up();
      }

      return this.pluginAPI.sendIQ(iq);
   }

   public unblock(items: string[]): Promise<Element> {
      const iq = $iq({
         type: 'set',
      }).c('unblock', {
         xmlns: NAMESPACE_BLOCKING_COMMAND,
      });

      for (const itm of items) {
         iq.c('item', { jid: itm }).up();
      }

      return this.pluginAPI.sendIQ(iq);
   }

   private onBlocklistChanged = (newList, oldList = []) => {
      const accountUid = this.pluginAPI.getAccountUid();
      const unblockedJids: string[] = $(oldList)
         .not(newList as any)
         .get() as any;
      const blockedJids: string[] = $(newList)
         .not(oldList as any)
         .get() as any;

      const getElements = (jid: string) => {
         return jid.includes('@')
            ? $(`[data-account-uid="${accountUid}"][data-jid="${jid}"]`)
            : $(`[data-account-uid="${accountUid}"][data-jid$="${jid}"]`);
      };

      unblockedJids.forEach(jid => {
         if (!newList.includes(jid)) {
            getElements(jid).removeClass('jsxc-blocked');
         }
      });

      blockedJids.forEach(jid => getElements(jid).addClass('jsxc-blocked'));
   }

   private onBlocklistUpdate = (stanza: string) => {
      const sessionStorage = this.pluginAPI.getSessionStorage();
      let blocklist = sessionStorage.getItem('blocklist') || [];

      if ($(stanza).children('unblock').length > 0) {
         if ($(stanza).find('unblock > item').length === 0) {
            blocklist = [];
         }

         $(stanza)
            .find('unblock > item')
            .each((index, item) => {
               const jidString = $(item).attr('jid');

               if (blocklist.includes(jidString)) {
                  blocklist = blocklist.filter(entry => entry !== jidString);
               }
            });
      }

      if ($(stanza).children('block').length > 0) {
         $(stanza)
            .find('block > item')
            .each((index, item) => {
               const jidString = $(item).attr('jid');

               if (!blocklist.includes(jidString)) {
                  blocklist.push(jidString);
               }
            });
      }

      sessionStorage.setItem('blocklist', blocklist);

      return true;
   }

   private errorMessageProcessor = async (
      contact: IContact,
      message: IMessage,
      stanza: Element
   ): Promise<[IContact, IMessage, Element]> => {
      if (message && $(stanza).find(`blocked[xmlns="${NAMESPACE_BLOCKING_COMMAND}:errors"]`).length === 1) {
         message.setErrorMessage(Translation.t('You_have_blocked_this_JID'));
      }

      return [contact, message, stanza];
   }
}
