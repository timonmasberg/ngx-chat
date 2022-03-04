import IStorage from '../../../Storage.interface';
import { IContact as Contact } from '../../../Contact.interface';
import { IMessage as Message } from '../../../Message.interface';
import { IConnection } from '../../../connection/Connection.interface';
import Store from './Store';
import Peer from './Peer';
import Bootstrap from './Bootstrap';
import JID from '../../../JID';
import { IJID } from '../../../JID.interface';
import Stanza from '../util/Stanza';
import { NS_BASE } from '../util/Const';
import ArrayBufferUtils from '../util/ArrayBuffer';
import * as AES from '../util/AES';
import Device, { Trust } from './Device';
import BundleManager from './BundleManager';
import IdentityManager from './IdentityManager';
import Translation from '../../../util/Translation';
import Log from '../../../util/Log';

export default class Omemo {
   private store: Store;

   private peers: any = {};

   private bootstrap: Bootstrap;

   private bundleManager: BundleManager;

   private identityManager: IdentityManager;

   private deviceName: string;

   private localPeer: Peer;

   constructor(storage: IStorage, private connection: IConnection) {
      this.deviceName = connection.getJID.bare;
      this.store = new Store(storage);
      this.bundleManager = new BundleManager(connection.getPEPService, this.store);

      this.localPeer = new Peer(this.deviceName, this);
   }

   public getIdentityManager(): IdentityManager {
      if (!this.identityManager) {
         this.identityManager = new IdentityManager(this.store, this.bundleManager);
      }

      return this.identityManager;
   }

   public getStore(): Store {
      return this.store;
   }

   public getBundleManager(): BundleManager {
      return this.bundleManager;
   }

   public async cleanUpDeviceList() {
      const localIdentifier = this.store.getLocalDeviceName();
      const localDeviceId = this.store.getLocalDeviceId();

      this.store.setDeviceList(localIdentifier, [localDeviceId]);

      await this.bundleManager.deleteDeviceList();
      await this.bundleManager.publishDeviceId(localDeviceId);

      return localDeviceId;
   }

   public storeDeviceList(identifier: string, deviceList: number[]) {
      const ownJid = this.connection.getJID;

      this.store.setDeviceList(identifier, deviceList);

      if (ownJid.bare === identifier) {
         this.makeSureOwnDeviceIdIsInList(deviceList);
      }
   }

   private makeSureOwnDeviceIdIsInList(deviceList: number[]) {
      const ownDeviceId = this.store.getLocalDeviceId();

      if (
         this.store.isPublished() &&
         typeof ownDeviceId === 'number' &&
         !isNaN(ownDeviceId) &&
         deviceList.indexOf(ownDeviceId) < 0
      ) {
         this.bundleManager.publishDeviceId(ownDeviceId);
      }
   }

   public prepare(): Promise<void> {
      return this.getBootstrap().prepare();
   }

   public isSupported(contact: Contact): boolean {
      const devices = this.getDevices(contact);

      return devices.length > 0;
   }

   public getTrust(contact: Contact): Trust {
      const peer = this.getPeer(contact.getJid());
      const peerTrust = peer.getTrust();
      const localPeerTrust = this.localPeer.getTrust();

      return Math.min(peerTrust, localPeerTrust);
   }

   public isTrusted(contact: Contact): boolean {
      const peer = this.getPeer(contact.getJid());

      return peer.getTrust() !== Trust.unknown && this.localPeer.getTrust() !== Trust.unknown;
   }

   public async trustOnFirstUse(contact: Contact): Promise<boolean> {
      const peer = this.getPeer(contact.getJid());
      const [peerTrustedOnFirstUse, localPeerTrustedOnFirstUse] = await Promise.all([
         peer.trustOnFirstUse(),
         this.localPeer.trustOnFirstUse(),
      ]);

      if (peerTrustedOnFirstUse) {
         contact.addSystemMessage(Translation.t('Blindly_trusted_peer_on_first_use'));
      }

      if (localPeerTrustedOnFirstUse) {
         contact.addSystemMessage(Translation.t('Blindly_trusted_all_your_own_devices_on_first_use'));
      }

      return peerTrustedOnFirstUse && localPeerTrustedOnFirstUse;
   }

   public getDevices(contact?: Contact): Device[] {
      let peer: Peer;

      if (contact) {
         peer = this.getPeer(contact.getJid());
      } else {
         peer = this.localPeer;
      }

      return peer.getDevices();
   }

   public isTrustUnknown(contact: Contact): boolean {
      const peer = this.getPeer(contact.getJid());
      const peerNewDevices = peer.getTrust() === Trust.unknown;
      const localPeerNewDevices = this.localPeer.getTrust() === Trust.unknown;

      return peerNewDevices || localPeerNewDevices;
   }

   public encrypt(contact: Contact, message: Message, xmlElement: Strophe.Builder) {
      const peer = this.getPeer(contact.getJid());
      const plaintextMessage = message.getPlaintextMessage();

      return peer
         .encrypt(this.localPeer, plaintextMessage)
         .then(encryptedMessages => {
            const stanza = Stanza.buildEncryptedStanza(encryptedMessages, this.store.getLocalDeviceId());

            $(xmlElement.tree()).find(`html[xmlns="${Strophe.NS.XHTML_IM}"]`).remove();
            $(xmlElement.tree()).find('>body').remove();
            $(xmlElement.tree()).find('>data[xmlns="urn:xmpp:bob"]').remove();

            xmlElement.cnode(stanza.tree());
            xmlElement
               .up()
               .c('store', {
                  xmlns: 'urn:xmpp:hints',
               })
               .up();

            xmlElement
               .c('body')
               .t('***' + Translation.t('You_received_an_OMEMO_encrypted_message') + '***')
               .up();

            message.setEncrypted(true);

            return [message, xmlElement];
         })
         .catch(msg => {
            message.setErrorMessage(Translation.t('Message_was_not_sent'));
            message.setEncrypted(false);

            contact.addSystemMessage(typeof msg === 'string' ? msg : msg.toString());

            throw msg;
         });
   }

   public async decrypt(stanza): Promise<{ plaintext: string; trust: Trust } | void> {
      const messageElement = $(stanza);

      if (messageElement.prop('tagName') !== 'message') {
         throw new Error('Root element is no message element');
      }

      const encryptedElement = $(stanza).find(`> encrypted[xmlns="${NS_BASE}"]`);

      if (encryptedElement.length === 0) {
         throw new Error('No encrypted stanza found');
      }

      const from = new JID(messageElement.attr('from'));
      const encryptedData = Stanza.parseEncryptedStanza(encryptedElement);

      if (!encryptedData) {
         throw new Error('Could not parse encrypted stanza');
      }

      const ownDeviceId = this.store.getLocalDeviceId();
      const ownPreKeyFiltered = encryptedData.keys.filter(function(preKey) {
         return ownDeviceId === preKey.deviceId;
      });

      if (ownPreKeyFiltered.length !== 1) {
         return Promise.reject(`Found ${ownPreKeyFiltered.length} PreKeys which match my device id (${ownDeviceId}).`);
      }

      const ownPreKey = ownPreKeyFiltered[0];
      const peer = this.getPeer(from);
      let deviceDecryptionResult;

      try {
         deviceDecryptionResult = await peer.decrypt(
            encryptedData.sourceDeviceId,
            ownPreKey.ciphertext,
            ownPreKey.preKey
         );
      } catch (err) {
         throw new Error('Error during decryption: ' + err);
      }

      const exportedKey = deviceDecryptionResult.plaintextKey;
      const exportedAESKey = exportedKey.slice(0, 16);
      const authenticationTag = exportedKey.slice(16);

      if (authenticationTag.byteLength < 16) {
         if (authenticationTag.byteLength > 0) {
            throw new Error('Authentication tag too short');
         }

         Log.info(`Authentication tag is only ${authenticationTag.byteLength} byte long`);
      }

      if (!encryptedData.payload) {
         throw new Error('We received a KeyTransportElement');
      }

      if (ownPreKey.preKey) {
         this.bundleManager.refreshBundle().then(bundle => {
            this.bundleManager.publishBundle(bundle);
         });
      }

      const iv = (encryptedData as any).iv;
      const ciphertextAndAuthenticationTag = ArrayBufferUtils.concat(encryptedData.payload, authenticationTag);

      return {
         plaintext: await AES.decrypt(exportedAESKey, iv, ciphertextAndAuthenticationTag),
         trust: deviceDecryptionResult.deviceTrust,
      };
   }

   private getPeer(jid: IJID): Peer {
      if (!this.peers[jid.bare]) {
         this.peers[jid.bare] = new Peer(jid.bare, this);
      }

      return this.peers[jid.bare];
   }

   private getBootstrap(): Bootstrap {
      if (!this.bootstrap) {
         this.bootstrap = new Bootstrap(this.deviceName, this.store, this.bundleManager);
      }

      return this.bootstrap;
   }
}
