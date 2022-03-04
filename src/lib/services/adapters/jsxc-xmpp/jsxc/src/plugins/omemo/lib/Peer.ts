import Store from './Store';
import Device, { Trust } from './Device';
import * as AES from '../util/AES';
import Address from '../vendor/Address';
import BundleManager from './BundleManager';
import Session from './Session';
import EncryptedDeviceMessage from '../model/EncryptedDeviceMessage';
import Translation from '../../../util/Translation';
import Omemo from './Omemo';
import Log from '../../../util/Log';

const MAX_PADDING = 10;
const PADDING_CHARACTER = '​\u200B';

export interface IEncryptedPeerMessage {
   keys: EncryptedDeviceMessage[];
   iv: BufferSource;
   payload: ArrayBuffer;
}

export default class Peer {
   private devices: any = {};
   private store: Store;
   private bundleManager: BundleManager;

   constructor(private deviceName: string, private omemo: Omemo) {
      this.store = omemo.getStore();
      this.bundleManager = omemo.getBundleManager();
   }

   public getDeviceName(): string {
      return this.deviceName;
   }

   public async encrypt(localPeer: Peer, plaintext: string): Promise<IEncryptedPeerMessage> {
       const remoteDeviceIds = this.store.getDeviceList(this.deviceName);

       if (remoteDeviceIds.length === 0) {
         throw new Error(Translation.t('Your_contact_does_not_support_OMEMO'));
      }

       if (this.getTrust() === Trust.unknown) {
         throw new Error(Translation.t('There_are_new_devices_for_your_contact'));
      }

       if (this.getTrust() === Trust.ignored) {
         throw new Error(Translation.t('You_ignore_all_devices_of_your_contact'));
      }

       if (localPeer.getTrust() === Trust.unknown) {
         throw new Error(Translation.t('I_found_new_devices_from_you'));
      }

       while (plaintext.length < MAX_PADDING) {
         plaintext += PADDING_CHARACTER;
      }

       const aes = await AES.encrypt(plaintext);
       const devices = [...this.getDevices(), ...localPeer.getDevices()];
       const promises = devices
           .filter(device => device.getTrust() !== Trust.ignored)
           .map(device => device.encrypt(aes.keydata));

       let keys = await Promise.all(promises);

       keys = keys.filter(key => key !== null);

       if (keys.length === 0) {
         throw new Error('Could not encrypt data with any Signal session');
      }

       this.store.setPeerUsed(this.getDeviceName());
       this.store.setPeerUsed(localPeer.getDeviceName());

       return {
         keys: keys as EncryptedDeviceMessage[],
         iv: aes.iv,
         payload: aes.payload,
      };
   }

   public decrypt(
      deviceId: number,
      ciphertext,
      preKey: boolean = false
   ): Promise<{ plaintextKey: ArrayBuffer; deviceTrust: Trust }> {
       const device = this.getDevice(deviceId);

       return device.decrypt(ciphertext, preKey).then(plaintextKey => {
         return {
            plaintextKey,
            deviceTrust: device.getTrust(),
         };
      });
   }

   public getTrust(): Trust {
       const trust = this.getDevices().map(device => device.getTrust());

       if (trust.indexOf(Trust.unknown) >= 0) {
         return Trust.unknown;
      }

       if (trust.indexOf(Trust.recognized) >= 0) {
         return Trust.recognized;
      }

       if (trust.indexOf(Trust.confirmed) >= 0) {
         return Trust.confirmed;
      }

       return Trust.ignored;
   }

   public async trustOnFirstUse(): Promise<boolean> {
      if (this.store.isPeerUsed(this.deviceName)) {
         return false;
      }

      const identityManager = this.omemo.getIdentityManager();

      const promises = this.getDevices().map(async device => {
           if ([Trust.confirmed, Trust.recognized].includes(device.getTrust())) {
               return true;
           }

           try {
               const address = device.getAddress();
               const fingerprint = await identityManager.loadFingerprint(address);

               if (!fingerprint) {
                   throw new Error(`Can not trust on first use, because no fingerprint for ${address} is available`);
               }

               device.setTrust(Trust.recognized);

               if (device.isDisabled()) {
                   device.enable();
               }
           } catch (err) {
               Log.warn('Error while retrieving fingerprint', err);

               device.disable();

               return false;
           }

           return true;
       });

      const results = await Promise.all(promises);

      return results.indexOf(false) < 0;
   }

   public getDevices(): Device[] {
       const deviceIds = this.store.getDeviceList(this.deviceName);

       return deviceIds.map(id => this.getDevice(id));
   }

   private getDevice(id: number): Device {
      if (!this.devices[id]) {
          const address = new Address(this.deviceName, id);
          const session = new Session(address, this.store, this.bundleManager);

          this.devices[id] = new Device(address, session, this.store);
      }

      return this.devices[id];
   }
}
