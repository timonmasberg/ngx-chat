import { AbstractPlugin, IMetaData } from '../plugin/AbstractPlugin';
import PluginAPI from '../plugin/PluginAPI';
import Avatar from '../Avatar';
import JID from '../JID';
import Translation from '../util/Translation';
import {ContactType, IContact} from '../Contact.interface';
import {IAvatar} from '../Avatar.interface';
import Hash from '../util/Hash';
import {IJID} from '../JID.interface';

const MIN_VERSION = '4.0.0';
const MAX_VERSION = '99.0.0';

export default class AvatarVCardPlugin extends AbstractPlugin {
   public static getId(): string {
      return 'vcard-avatars';
   }

   public static getName(): string {
      return 'vCard-based Avatars';
   }

   public static getMetaData(): IMetaData {
      return {
         description: Translation.t('setting-vcard-avatar-enable'),
         xeps: [
            {
               id: 'XEP-0153',
               name: 'vCard-Based Avatars',
               version: '1.1',
            },
         ],
      };
   }

   constructor(pluginAPI: PluginAPI) {
      super(MIN_VERSION, MAX_VERSION, pluginAPI);

      const connection = pluginAPI.getConnection();

      connection.registerHandler(this.onPresenceVCardUpdate, 'vcard-temp:x:update', 'presence');

      pluginAPI.addPublishAvatarProcessor(this.publishAvatarProcessor);
      pluginAPI.addAvatarProcessor(this.avatarProcessor);
   }

   private getStorage() {
      return this.pluginAPI.getStorage();
   }

   private onPresenceVCardUpdate = stanza => {
      const from = new JID($(stanza).attr('from'));
      const xVCard = $(stanza).find('x[xmlns="vcard-temp:x:update"]');

      if (xVCard.length > 0) {
         const photo = xVCard.find('photo');

         if (photo.length > 0) {
            const contact = this.pluginAPI.getContact(from);

            if (contact && contact.getType() === ContactType.GROUPCHAT && from.resource) {
               return true;
            }

            const sha1OfAvatar = photo.text()?.trim() || null;

            this.getStorage().setItem(from.bare, sha1OfAvatar); // @REVIEW should we use this as trigger for all tabs?

            if (!contact) {
               this.pluginAPI.Log.warn('No contact found for', from);
               return true;
            }

         }
      }

      return true;
   }

   private publishAvatarProcessor = (avatar: IAvatar | null): Promise<[IAvatar]> => {
      if (typeof avatar === 'undefined') {
         return Promise.resolve([avatar]);
      }

      const vcardService = this.pluginAPI.getConnection().getVcardService;
      const jid = this.pluginAPI.getConnection().getJID;

      return vcardService
         .setAvatar(jid, avatar?.getData(), avatar?.getType())
         .then(() => {
            this.getStorage().setItem(jid.bare, avatar?.getHash() || '');

            return [undefined];
         })
         .catch(err => {
            this.pluginAPI.Log.error('Could not publish avatar', err);

            return [avatar];
         });
   }

   private avatarProcessor = async (contact: IContact, avatar: IAvatar): Promise<[IContact, IAvatar]> => {
      const storage = this.getStorage();
      const hash = storage.getItem(contact.getJid().bare);

      if (!hash && !avatar && this.shouldForceRetrieval(contact)) {
         try {
            const avatarObject = await this.getAvatar(contact.getJid());
            const data = avatarObject.src.replace(/^.+;base64,/, '');

            avatar = new Avatar(Hash.SHA1FromBase64(data), avatarObject.type, avatarObject.src);

            this.getStorage().setItem(contact.getJid().bare, avatar.getHash() || '');
         } catch (err) {
            // we could not find any avatar
         }
      }

      if (!hash || avatar) {
         return [contact, avatar];
      }

      try {
         avatar = new Avatar(hash);
      } catch (err) {
         try {
            const avatarObject = await this.getAvatar(contact.getJid());

            return [contact, new Avatar(hash, avatarObject.type, avatarObject.src)];
         } catch (err) {
            this.pluginAPI.Log.warn('Error during avatar retrieval', err);

            return [contact, avatar];
         }
      }

      return [contact, avatar];
   }

   private getAvatar(jid: IJID): Promise<{ src: string; type: string }> {
      const connection = this.pluginAPI.getConnection();

      return connection
         .getVcardService
         .loadVcard(jid)
         .then(vcard => {
            if (vcard.PHOTO && vcard.PHOTO.src) {
               return vcard.PHOTO;
            }

            throw new Error('No photo available');
         });
   }

   private shouldForceRetrieval(contact: IContact): boolean {
      if (contact.getJid().bare !== this.pluginAPI.getConnection().getJID.bare) {
         return false;
      }

      const sessionStorage = this.pluginAPI.getSessionStorage();

      if (sessionStorage.getItem('forced', contact.getJid().bare)) {
         return false;
      }

      sessionStorage.setItem('forced', contact.getJid().bare, true);

      return true;
   }
}
