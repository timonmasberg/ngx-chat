import AbstractService from './AbstractService';
import { IJID } from '../../JID.interface';
import {NS} from '../xmpp/Namespace';
import { parseXML } from '../../util/Utils';

NS.register('VCARD', 'vcard-temp');

type vCardData = {
   [tagName: string]: string | vCardData | vCardData[];
};

export default class Vcard extends AbstractService {
   public loadVcard(jid: IJID): Promise<vCardData> {
      return this.getVcard(jid).then(this.parseVcard);
   }

   public getVcard(jid: IJID): Promise<XMLDocument> {
      const iq = $iq({
         type: 'get',
         to: jid.bare,
      }).c('vCard', {
         xmlns: NS.get('VCARD'),
      });

      return this.sendIQ(iq).then(stanza => {
         (window as any).stanza = stanza;
         const vCard = stanza.querySelectorAll('vCard');

         if (vCard.length === 0) {
            // XML BECAUSE OF CASE SENSIVITY
            return parseXML('<vCard ' + NS.get('VCARD') + '/>');
         }

         return  parseXML(vCard.item(0).outerHTML).querySelector('>vCard') as any;
      });
   }

   public async setAvatar(jid: IJID, avatar: string, mimetype: string) {
      // first get the actual vcard to merge image into
      const vCard = await this.getVcard(jid);
      const photo = vCard.querySelectorAll('PHOTO');

      if (avatar && mimetype) {
         if (photo.length === 0) {
            // XML BECAUSE OF CASE SENSIVITY
            vCard.append('<PHOTO><TYPE/><BINVAL/></PHOTO>');
         }

         Array.from(photo).find(item => item.querySelector('TYPE')).append(mimetype);
         Array.from(photo).find(item => item.querySelector('BINVAL')).append(avatar.replace(/^.+;base64,/, ''));
      } else {
         Array.from(photo).forEach(child => vCard.removeChild(child));
      }

      return this.sendVCard(jid, vCard);
   }

   private async sendVCard(jid: IJID, newVCard: XMLDocument): Promise<any> {
      const setVcardIQStanza = $iq({
         type: 'set',
         to: jid.bare,
      }).cnode(newVCard.firstElementChild);

      return this.sendIQ(setVcardIQStanza);
   }

   private parseVcard = (vCardElement: XMLDocument): vCardData => {
      let data: vCardData = {};

      if (!vCardElement) {
         return data;
      }

      data = this.parseVcardChildren(vCardElement);

      return data;
   }

   private parseVcardChildren = (stanza: XMLDocument): vCardData => {
      const self = this;
      const data: vCardData = {};
      const children = stanza.children;

      Array.from(children).forEach(function() {
         const item = document.createElement(this);
         const innerChildren = item.children;
         const itemName = item.prop('tagName');
         let value;

         if (itemName === 'PHOTO') {
            const img = item.find('BINVAL').text();
            const type = item.find('TYPE').text();
            let src = 'data:' + type + ';base64,' + img; // @REVIEW XSS

            // @REVIEW privacy
            if (item.find('EXTVAL').length > 0) {
               src = item.find('EXTVAL').text();
            }

            // concat chunks
            src = src.replace(/[\t\r\n\f ]/gi, '');

            value = {
               type,
               src,
            };
         } else if (itemName === 'EMAIL') {
            value = item.find('USERID').text();
         } else if (innerChildren.length > 0) {
            value = self.parseVcardChildren(item);
         } else {
            value = item.text().trim();
         }

         if (Array.isArray(data[itemName])) {
            (data[itemName] as vCardData[]).push(value);
         } else if (data[itemName]) {
            data[itemName] = [data[itemName], value];
         } else {
            data[itemName] = value;
         }
      });

      return data;
   }
}
