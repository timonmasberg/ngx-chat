import JID from '../../JID';
import { AbstractPlugin, IMetaData } from '../../plugin/AbstractPlugin';
import PluginAPI from '../../plugin/PluginAPI';
import Message from '../../Message';
import Contact from '../../Contact';
import Translation from '../../util/Translation';
import * as Namespace from '../../connection/xmpp/namespace';
import ChatStateConnection from './ChatStateConnection';
import ChatStateMachine from './ChatStateMachine';
import {ContactType} from '../../Contact.interface';
import IStorage from '../../Storage.interface';

/**
 * XEP-0085: Chat State Notifications
 *
 * @version
 * @see http://xmpp.org/extensions/xep-0085.html
 */

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '99.0.0';

export default class ChatStatePlugin extends AbstractPlugin {

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      Namespace.register('CHATSTATES', 'http://jabber.org/protocol/chatstates');

      pluginAPI.addPreSendMessageStanzaProcessor(this.preSendMessageStanzaProcessor);

      pluginAPI.registerChatRootElementInitializedHook((chatRootElement: Element, contact: Contact) => {
         if (contact.getType() === ContactType.CHAT) {
           this.chatStateMachine = new ChatStateMachine(this, chatRootElement, contact);
         }
      });

      const connection = pluginAPI.getConnection();

      connection.registerHandler(this.onChatState, Namespace.get('CHATSTATES'), 'message', 'chat');
   }

   private chatStateConnection: ChatStateConnection;
   private chatStateMachine: ChatStateMachine;
   public static getId(): string {
      return 'chat-state';
   }

   public static getName(): string {
      return 'Chat State Notifications';
   }

   public static getMetaData(): IMetaData {
      return {
         description: Translation.t('setting-explanation-chat-state'),
         xeps: [
            {
               id: 'XEP-0085',
               name: 'Chat State Notifications',
               version: '2.1',
            },
         ],
      };
   }

   public getStorage(): IStorage {
      return this.pluginAPI.getStorage();
   }

   public getChatStateConnection(): ChatStateConnection {
      if (!this.chatStateConnection) {
         this.chatStateConnection = new ChatStateConnection(this.pluginAPI.send);
      }
      return this.chatStateConnection;
   }

   public getDiscoInfoRepository() {
      return this.pluginAPI.getDiscoInfoRepository();
   }

   private preSendMessageStanzaProcessor = (message: Message, xmlStanza: Strophe.Builder): Promise<any> => {
      if (message.getType() === Message.MSGTYPE.CHAT) {
         xmlStanza
            .c('active', {
               xmlns: Namespace.get('CHATSTATES'),
            })
            .up();
      }

      return Promise.resolve([message, xmlStanza]);
   }

   private onChatState = (stanza): boolean => {
      stanza = $(stanza);
      const from = new JID(stanza.attr('from'));
      const composingElement = stanza.find('composing' + Namespace.getFilter('CHATSTATES'));
      const pausedElement = stanza.find('paused' + Namespace.getFilter('CHATSTATES'));
      const activeElement = stanza.find('active' + Namespace.getFilter('CHATSTATES'));

      if (composingElement.length > 0) {
         this.onComposing(from);
      }

      if (pausedElement.length > 0) {
         this.onPaused(from);
      }

      if (activeElement.length > 0) {
         this.onActive(from);
      }

      return true;
   }

   private onComposing(from: JID) {
      const contact = this.pluginAPI.getContact(from);

      if (!contact) {
         return;
      }

      const chatWindow = contact.getChatWindowController();

      // @TODO this doesn't work in all tabs
      chatWindow.setBarText(Translation.t('_is_composing'));
   }

   private onPaused(from: JID) {
      const contact = this.pluginAPI.getContact(from);

      if (!contact) {
         return;
      }

      const chatWindow = contact.getChatWindowController();

      chatWindow.setBarText('');
   }

   private onActive(from: JID) {
      this.onPaused(from);
   }
}
