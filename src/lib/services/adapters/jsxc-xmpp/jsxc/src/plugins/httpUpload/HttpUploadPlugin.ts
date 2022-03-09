import Contact from '../../Contact';
import Message from '../../Message';
import { AbstractPlugin, IMetaData } from '../../plugin/AbstractPlugin';
import PluginAPI from '../../plugin/PluginAPI';
import JID from '../../JID';
import {NS} from '../../connection/xmpp/Namespace';
import Attachment from '../../Attachment';
import HttpUploadService from './HttpUploadService';
import { IConnection } from '../../connection/Connection.interface';
import Translation from '../../util/Translation';
import {IContact} from '../../Contact.interface';
import {IMessage} from '../../Message.interface';
import Client from '../../Client';

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '99.0.0';

const IMAGE_SUFFIXES = ['jpeg', 'jpg', 'png', 'svg', 'gif'];

export default class HttpUploadPlugin extends AbstractPlugin {

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      NS.register('HTTPUPLOAD', 'urn:xmpp:http:upload:0');

      pluginAPI.addPreSendMessageProcessor(this.preSendMessageProcessor, 20);

      pluginAPI.addPreSendMessageStanzaProcessor(this.addBitsOfBinary);

      pluginAPI.addAfterReceiveMessageProcessor(this.extractAttachmentFromStanza);
      pluginAPI.addAfterReceiveGroupMessageProcessor(this.extractAttachmentFromStanza);

      const connection = pluginAPI.getConnection();

      connection.registerHandler(this.onBitsOfBinary, 'urn:xmpp:bob', 'iq');
   }

   private services: HttpUploadService[];
   public static getId(): string {
      return 'http-upload';
   }

   public static getName(): string {
      return 'HTTP File Upload';
   }

   public static getMetaData(): IMetaData {
      return {
         description: Translation.t('setting-http-upload-enable'),
         xeps: [
            {
               id: 'XEP-0363',
               name: 'HTTP File Upload',
               version: '1.0.0',
            },
         ],
      };
   }

   private preSendMessageProcessor = (contact: Contact, message: Message): Promise<[Contact, Message]> => {
      if (!message.hasAttachment()) {
         return Promise.resolve([contact, message]);
      }

      const attachment = message.getAttachment();

      return this.getServices()
         .then(services => {
            for (const service of services) {
               if (service.isSuitable(attachment)) {
                  return service;
               }

               this.pluginAPI.Log.debug(
                  `${service.getJid()} only supports files up to ${service.getMaxFileSize()} bytes`
               );
            }

            throw new Error('Found no suitable http upload service. File probably too large.');
         })
         .then(service => {
            return service.sendFile(attachment.getFile(), (transferred, total) => {
               message.updateProgress(transferred, total);
            });
         })
         .then(downloadUrl => {
            this.addUrlToMessage(downloadUrl, attachment, message);
            attachment.setProcessed(true);

            if (!attachment.setData(downloadUrl)) {
               message.setErrorMessage(Translation.t('Attachment_too_large_to_store'));
            }
         })
         .catch(err => {
            this.pluginAPI.Log.debug(err);

            if (err) {
               setTimeout(() => {
                  contact.addSystemMessage(err.toString());
               }, 500);
            }
         })
         .then(() => {
            return [contact, message];
         });
   }

   private getServices(): Promise<HttpUploadService[]> {
      if (this.services) {
         return Promise.resolve(this.services);
      }

      return this.requestServices().then(services => {
         this.services = services;

         return services;
      });
   }

   private requestServices(): Promise<HttpUploadService[]> {
      const connection = this.getConnection();
      const ownJid = connection.getJID;
      const serverJid = new JID('', ownJid.domain, '');
      const discoInfoRepository = this.pluginAPI.getDiscoInfoRepository();

      return connection
         .getDiscoService
         .getDiscoItems(serverJid)
         .then(stanza => {
            const promises = [];

            $(stanza)
               .find('item')
               .each((index, element) => {
                  const jid = new JID('', $(element).attr('jid'), '');

                  // @TODO cache
                  const promise = discoInfoRepository.requestDiscoInfo(jid).then(discoInfo => {
                     const hasFeature = discoInfo.hasFeature(NS.get('HTTPUPLOAD'));

                     if (hasFeature) {
                        let maxFileSize = 0;
                        const form = discoInfo.getFormByType(NS.get('HTTPUPLOAD'));

                        if (form) {
                           const values = form.getValues('max-file-size') || [];
                           if (values.length === 1) {
                              maxFileSize = parseInt(values[0], 10);
                           }
                        }

                        return new HttpUploadService(this.pluginAPI, jid, maxFileSize);
                     }

                     return null;
                  });

                  promises.push(promise);
               });

            return Promise.all(promises).then(results => {
               return results.filter(service => typeof service !== 'undefined');
            });
         });
   }

   private getConnection(): IConnection {
      return this.pluginAPI.getConnection();
   }

   private addUrlToMessage(downloadUrl: string, attachment: Attachment, message: Message) {
      const plaintext = message.getPlaintextMessage();

      message.setPlaintextMessage(downloadUrl + '\n' + plaintext);

      const html = $('<div>').append(message.getHtmlMessage());

      const linkElement = $('<a>');
      linkElement.attr('href', downloadUrl);

      const imageElement = $('<img>');
      imageElement.attr('src', 'cid:' + attachment.getUid());
      imageElement.attr('alt', attachment.getName());

      linkElement.append(imageElement);

      html.append($('<p>').append(linkElement));
      // @TODO html !== empty ???
      if (plaintext) {
         html.append($('<p>').text(plaintext));
      }

      message.setHtmlMessage(html.html());
   }

   private onBitsOfBinary = (stanza: string): boolean => {
      const stanzaElement = $(stanza);
      const from = new JID(stanzaElement.attr('from'));
      const type = stanzaElement.attr('type');
      const id = stanzaElement.attr('id');
      const cid = stanzaElement.find('data[xmlns="urn:xmpp:bob"]').attr('cid');

      if (type !== 'get') {
         return true;
      }

      const attachment = new Attachment(cid); // @REVIEW security

      if (attachment.hasThumbnailData()) {
         const iq = $iq({
            to: from.full,
            id,
            type: 'result',
         })
            .c('data', {
               xmlns: 'urn:xmpp:bob',
               cid: attachment.getUid(),
               type: attachment.getMimeType(),
            })
            .t(attachment.getThumbnailData().replace(/^[^,],+/, ''));

         this.pluginAPI.sendIQ(iq);
      }

      return true;
   }

   private addBitsOfBinary = (message: Message, xmlStanza: Strophe.Builder): Promise<any> => {
      // @TODO check if element with cid exists

      if (message.hasAttachment() && message.getAttachment().hasThumbnailData()) {
         const attachment = message.getAttachment();
         const thumbnailData = attachment.getThumbnailData();

         xmlStanza
            .c('data', {
               xmlns: 'urn:xmpp:bob',
               cid: attachment.getUid(),
               type: thumbnailData.match(/data:(\w+\/[\w-+\d.]+)(?=;|,)/)[1],
            })
            .t(thumbnailData.replace(/^[^,],+/, ''))
            .up();
      }

      return Promise.resolve([message, xmlStanza]);
   }

   private extractAttachmentFromStanza = (
      contact: IContact,
      message: IMessage,
      stanza: Element
   ): Promise<[IContact, IMessage, Element]> => {
      const element = $(stanza);
      const bodyElement = element.find('html body[xmlns="' + Strophe.NS.XHTML + '"]').first();
      const dataElement = element.find('data[xmlns="urn:xmpp:bob"]');

      if (bodyElement.length && dataElement.length === 1 && !message.isEncrypted()) {
         const cid = dataElement.attr('cid');
         const mimeType = dataElement.attr('type');

         if (!/^[a-z]+\/[a-z0-9.\-+]+$/.test(mimeType)) {
            return Promise.resolve([contact, message, stanza]);
         }

         const linkElement = bodyElement.find('a');
         const imageElement = linkElement.find('img[src^="cid:"]');

         if (imageElement.length === 1 && 'cid:' + cid === imageElement.attr('src')) {
            const url = linkElement.attr('href');
            const name = imageElement.attr('alt');
            const thumbnailData = dataElement.text();

            if (
               /^data:image\/(jpeg|jpg|gif|png|svg);base64,[/+=a-z0-9]+$/i.test(thumbnailData) &&
               /^https?:\/\//.test(url)
            ) {
               const attachment = new Attachment(name, mimeType, url);
               attachment.setThumbnailData(thumbnailData);
               attachment.setData(url);
               message.setAttachment(attachment);
               message.setPlaintextMessage(bodyElement.text());
            }
         }
      } else {
         this.processLinks(message);
      }

      return Promise.resolve([contact, message, stanza]);
   }

   private processLinks(message: IMessage) {
      const plaintext = message.getPlaintextMessage();

      if (!plaintext) {
         return;
      }

      const pattern = new RegExp(/^(https?:\/\/[^\s]+)/);
      const match = plaintext.match(pattern);

      if (match) {
         const url = match[0];
         const extension = this.getFileExtensionFromUrl(url);

         if (IMAGE_SUFFIXES.includes(extension)) {
            const fileName = this.getFileNameFromUrl(url) || 'image';
            const attachment = new Attachment(decodeURIComponent(fileName), 'image/' + extension, url);
            attachment.setData(url);

            if (Client.isTrustedDomain(new URL(url))) {
               attachment.generateThumbnail();
            }

            message.setAttachment(attachment);
            message.setPlaintextMessage(plaintext.replace(url, ''));
         }
      }
   }

   private getFileExtensionFromUrl(url: string): string {
      return url.split(/[#?]/)[0].split('.').pop().trim().toLowerCase();
   }

   private getFileNameFromUrl(url: string): string {
      const parsedUrl = new URL(url);

      return parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1);
   }
}
