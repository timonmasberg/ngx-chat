import ArrayBufferUtils from './ArrayBuffer';
import EncryptedDeviceMessage from '../model/EncryptedDeviceMessage';

export default class Stanza {
   public static buildEncryptedStanza(message, ownDeviceId: number) {
       const encryptedElement = $build('encrypted', {
           xmlns: 'eu.siacs.conversations.axolotl',
       });

       encryptedElement.c('header', {
         sid: ownDeviceId,
      });

       for (const key of message.keys as EncryptedDeviceMessage[]) {
          const attrs = {
              rid: key.getDeviceId(),
              prekey: undefined,
          };

          if (key.isPreKey()) {
            attrs.prekey = true;
         }

          encryptedElement.c('key', attrs).t(btoa(key.getCiphertext().body)).up();
      }

       encryptedElement.c('iv', ArrayBufferUtils.toBase64(message.iv)).up().up();

       encryptedElement.c('payload').t(ArrayBufferUtils.toBase64(message.payload));

       return encryptedElement;
   }

   public static parseEncryptedStanza(encryptedElement) {
      encryptedElement = $(encryptedElement);
      const headerElement = encryptedElement.find('>header');
      const payloadElement = encryptedElement.find('>payload');

      if (headerElement.length === 0) {
         return false;
      }

      const sourceDeviceId = headerElement.attr('sid');
      const iv = ArrayBufferUtils.fromBase64(headerElement.find('>iv').text());
      const payload = ArrayBufferUtils.fromBase64(payloadElement.text());

      const keys = headerElement
           .find('key')
           .get()
           .map(function(keyElement) {
               return {
                   preKey: $(keyElement).attr('prekey') === 'true',
                   ciphertext: atob($(keyElement).text()),
                   deviceId: parseInt($(keyElement).attr('rid'), 10),
               };
           }); // @REVIEW maybe index would be better

      return {
         sourceDeviceId,
         keys,
         iv,
         payload,
      };
   }
}
