import {NS} from '../../connection/xmpp/Namespace';
import { ContactSubscription } from '../../Contact.interface';
import JID from '../../JID';
import { IJID } from '../../JID.interface';
import Message from '../../Message';
import { DIRECTION } from '../../Message.interface';
import { AbstractPlugin, IMetaData } from '../../plugin/AbstractPlugin';
import PluginAPI from '../../plugin/PluginAPI';
import Translation from '../../util/Translation';

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '99.0.0';

// frequently used strings
const CHATMARKERS = 'CHATMARKERS';
const MARKABLE = 'markable';
const RECEIVED = 'received';
const DISPLAYED = 'displayed';
const ACKNOWLEDGED = 'acknowledged';
const ID = 'id';
const FROM = 'from';

export default class ChatMarkersPlugin extends AbstractPlugin {
   public static getId(): string {
      return 'chat-markers';
   }

   public static getName(): string {
      return 'Chat Markers';
   }

   public static getMetaData(): IMetaData {
      return {
         description: Translation.t('chatmarkers-description'),
         xeps: [
            {
               id: 'XEP-0333',
               name: 'Chat Markers',
               version: '0.3',
            },
         ],
      };
   }

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      NS.register(CHATMARKERS, 'urn:xmpp:chat-markers:0');

      this.pluginAPI.addFeature(NS.get(CHATMARKERS));

      this.pluginAPI.addPreSendMessageStanzaProcessor(this.preSendMessageStanzaProcessor);

      this.pluginAPI.getConnection().registerHandler(this.onChatMarkersMessage, null, 'message');
   }

   private async supportsChatMarkers(jid: IJID) {
      if (jid.isBare()) {
         // if bare JID, sender MAY send chat markers

         return true;
      }

      // if full JID, sender SHOULD try to determine if recipient supports chat markers
      const repository = this.pluginAPI.getDiscoInfoRepository();

      try {
         return repository.hasFeature(jid, [NS.get(CHATMARKERS)]);
      } catch (err) {
         return false;
      }
   }

   private hasSubscription(jid: IJID): boolean {
      const contact = this.pluginAPI.getContact(jid);
      if (!contact) {
         return false;
      }

      const subscription = contact.getSubscription();

      return subscription === ContactSubscription.FROM || subscription === ContactSubscription.BOTH;
   }

   // add "markable" element according to XEP-0333
   private addMarkable(xmlStanza: Strophe.Builder) {
      xmlStanza
         .c(MARKABLE, {
            xmlns: NS.get(CHATMARKERS),
         })
         .up();
   }

   // send "received" message according to XEP-0333
   private sendReceived(lastReceivedMsgId: string, to: IJID) {
      this.pluginAPI.Log.debug(`sending ${RECEIVED} message. Yaay! =)`);

      this.pluginAPI.send(
         $msg({
            to: to.full,
            type: 'chat',
         })
            .c(RECEIVED, {
               xmlns: NS.get(CHATMARKERS),
               id: lastReceivedMsgId,
            })
            .up()
            .c('store', {
               xmlns: 'urn:xmpp:hints',
            })
      );
   }

   // send "displayed" message according to XEP-0333
   private sendDisplayed(lastDisplayedMsgId: string, to: IJID) {
      this.pluginAPI.Log.debug(`sending ${DISPLAYED} message. Yaay! =)`);

      this.pluginAPI.send(
         $msg({
            to: to.full,
            type: 'chat',
         })
            .c(DISPLAYED, {
               xmlns: NS.get(CHATMARKERS),
               id: lastDisplayedMsgId,
            })
            .up()
            .c('store', {
               xmlns: 'urn:xmpp:hints',
            })
      );
   }

   // send "acknowledged" message according to XEP-0333
   // private sendAcknowledged(lastAcknowledgedMsgId: string, to: IJID) {
   //    this.pluginAPI.Log.debug(`sending ${ACKNOWLEDGED} message. Yaay! =)`);

   //    this.pluginAPI.send($msg({
   //       to: to.full
   //    }).c(ACKNOWLEDGED, {
   //       xmlns: NS.get(CHATMARKERS),
   //       id: lastAcknowledgedMsgId
   //    }).up().c('store', {
   //    xmlns: 'urn:xmpp:hints'
   // }));
   // }

   private preSendMessageStanzaProcessor = (msg: Message, stanza: Strophe.Builder): Promise<any> => {
      if (msg.getType() === Message.MSGTYPE.CHAT) {
         return this.supportsChatMarkers(msg.getPeer()).then(hasFeature => {
            if (hasFeature) {
               this.addMarkable(stanza);
            }

            return [msg, stanza];
         });
      }

      return Promise.resolve([msg, stanza]);
   }

   private onChatMarkersMessage = (stanza: string) => {
      const stanzaElement = $(stanza);
      const markerElement = stanzaElement.find(NS.getFilter(CHATMARKERS));

      if (markerElement.length === 0) {
         return true;
      }

      const mamResultElement =
         stanzaElement.find(NS.getFilter('MAM2', 'result')) ||
         stanzaElement.find(NS.getFilter('MAM1', 'result'));
      const isMam = mamResultElement.length > 0;

      const carbonReceivedElement = stanzaElement.find(NS.getFilter('CARBONS', 'received'));
      const carbonSentElement = stanzaElement.find(NS.getFilter('CARBONS', 'sent'));
      const isCarbon = carbonReceivedElement.length > 0 || carbonSentElement.length > 0;

      if (isCarbon && stanzaElement.attr('from') !== this.pluginAPI.getConnection().getJID.bare) {
         this.pluginAPI.Log.warn(`Received carbon copy from "${stanzaElement.attr('from')}". Ignoring.`);

         return true;
      }

      let messageElement: HTMLElement;

      if (carbonReceivedElement.length > 0) {
         messageElement = carbonReceivedElement.find('message').get(1);
      } else if (carbonSentElement.length > 0) {
         messageElement = carbonSentElement.find('message').get(1);
      } else if (mamResultElement.length > 0) {
         messageElement = mamResultElement.find('message').get(1);
      } else {
         messageElement = stanzaElement.get(1);
      }

      const idAttr = messageElement.attributes.getNamedItem(ID).value;
      const fromAttr = messageElement.attributes.getNamedItem(FROM).value;
      const toAttr = messageElement.attributes.getNamedItem('to').value;
      const typeAttr = messageElement.attributes.getNamedItem('type').value;

      if (typeAttr === Message.MSGTYPE.GROUPCHAT || typeAttr === 'error') {
         return true;
      }

      const markableMessageId = markerElement.attr(ID);
      const marker = markerElement.prop('tagName').toLowerCase() as string;

      this.pluginAPI.Log.debug(`"${marker}" marker received from "${fromAttr}" to "${toAttr}"`);

      if ([MARKABLE, RECEIVED, DISPLAYED, ACKNOWLEDGED].indexOf(marker) < 0) {
         this.pluginAPI.Log.info(`"${marker}" is no valid marker`);

         return true;
      }

      if (marker === MARKABLE) {
         if (!idAttr || !fromAttr) {
            return true;
         }

         if (!isCarbon && !isMam) {
            const peer = new JID(fromAttr);

            this.sendReceived(idAttr, peer);
         }
      } else {
         if (!markableMessageId || !fromAttr) {
            return true;
         }

         const peerJid = new JID(carbonSentElement.length > 0 ? toAttr : fromAttr);
         const direction = carbonSentElement.length > 0 ? DIRECTION.IN : DIRECTION.OUT;

         this.markMessages(markableMessageId, peerJid, marker, direction);
      }

      return true;
   }

   private markMessages(markableMessageId: string, peer: IJID, status: string, direction: DIRECTION) {
      const contact = this.pluginAPI.getContact(peer);

      if (!contact) {
         return;
      }

      const transcript = contact.getTranscript();
      let msg = transcript.getFirstMessage();

      while (msg && msg.getAttrId() !== markableMessageId) {
         try {
            msg = transcript.getMessage(msg.getNextId());
         } catch (error) {
            msg = undefined;

            break;
         }
      }

      // @REVIEW spec is not clear if only markable message from the same resource should be marked
      while (!!msg) {
         if (msg.getDirection() === direction && msg.isTransferred() && !msg.getErrorMessage()) {
            if (status === RECEIVED) {
               if (msg.isReceived()) {
                  // no need to traverse all messages
                  break;
               }

               msg.received();
            } else if (status === DISPLAYED) {
               if (msg.isDisplayed()) {
                  break;
               }

               msg.read();
               msg.displayed();
            } else if (status === ACKNOWLEDGED) {
               if (msg.isAcknowledged()) {
                  break;
               }

               msg.read();
               msg.acknowledged();
            }
         }

         try {
            msg = transcript.getMessage(msg.getNextId());
         } catch (error) {
            break;
         }
      }
   }
}
