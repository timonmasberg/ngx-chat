import Address from '../vendor/Address';
import { NS_BUNDLES, NS_BASE, NS_DEVICELIST, NUM_PRE_KEYS, MAX_PRE_KEY_ID } from '../util/Const';
import Bundle from './Bundle';
import IdentityKey from '../model/IdentityKey';
import PreKey from '../model/PreKey';
import SignedPreKey from '../model/SignedPreKey';
import { KeyHelper } from '../vendor/KeyHelper';
import Store from './Store';
import Random from '../../../util/Random';
import Log from '../../../util/Log';
import PEP from '../../../connection/services/PEP';

export default class BundleManager {
   constructor(private pepService: PEP, private store: Store) {}

   public async refreshBundle(): Promise<Bundle> {
      Log.debug('Refresh local device bundle.');

      const identityKey = this.store.getLocalIdentityKey();

      const preKeyIds = this.store.getPreKeyIds();
      const signedPreKeyIds = this.store.getSignedPreKeyIds();

      const newKeyIds = this.generateUniqueKeyIds(NUM_PRE_KEYS - preKeyIds.length, preKeyIds);

      await Promise.all(newKeyIds.map(id => this.generatePreKey(id)));

      if (signedPreKeyIds.length !== 1) {
         throw new Error(
            `Could not refresh local device bundle, because we have ${signedPreKeyIds.length} signed prekeys.`
         );
      }

      return new Bundle({
         identityKey,
         signedPreKey: this.store.getSignedPreKey(signedPreKeyIds[0]),
         preKeys: this.store.getAllPreKeys(),
      });
   }

   public async generateBundle(identityKey: IdentityKey): Promise<Bundle> {
      Log.debug('Generate local device bundle.');

      let preKeyPromises: Promise<PreKey>[];
      const ids = this.generateUniqueKeyIds(NUM_PRE_KEYS);
      const signedPreKeyId = ids.pop();

      preKeyPromises = ids.map(id => this.generatePreKey(id));

      preKeyPromises.push(this.generateSignedPreKey(identityKey, signedPreKeyId));

      const preKeys = await Promise.all(preKeyPromises);

      return new Bundle({
         identityKey,
         signedPreKey: preKeys.pop() as SignedPreKey,
         preKeys,
      });
   }

   private generateUniqueKeyIds(quantity: number, list: number[] = []) {
      const ids = [];

      while (ids.length < quantity) {
         const id = Random.number(MAX_PRE_KEY_ID, 1);

         if (ids.indexOf(id) < 0) {
            ids.push(id);
         }
      }

      return ids;
   }

   private async generatePreKey(id: number): Promise<PreKey> {
      const preKey = await KeyHelper.generatePreKey(id);

      this.store.storePreKey(preKey);

      return preKey;
   }

   private async generateSignedPreKey(identityKey: IdentityKey, id: number): Promise<SignedPreKey> {
      const signedPreKey = await KeyHelper.generateSignedPreKey(identityKey, id);

      this.store.storeSignedPreKey(signedPreKey);

      return signedPreKey;
   }

   public async requestBundle(address: Address): Promise<Bundle> {
      const node = NS_BUNDLES + address.getDeviceId();
      let stanza;

      try {
         stanza = await this.pepService.retrieveItems(node, address.getName());
      } catch (errorStanza) {
         Log.warn('Error while retrieving bundle', errorStanza);

         throw new Error('Could not retrieve bundle');
      }

      const itemsElement = $(stanza).find(`items[node='${node}']`);
      const bundleElement = itemsElement.find(`bundle[xmlns='${NS_BASE}']`);

      if (bundleElement.length !== 1) {
         throw new Error(`Expected to find one bundle, but there are actually ${bundleElement.length} bundles.`);
      }

      const bundle = Bundle.fromXML(bundleElement.get());

      return bundle;
   }

   public async publishBundle(bundle: Bundle): Promise<void> {
      const node = NS_BUNDLES + this.store.getLocalDeviceId();

      await this.pepService.publish(node, bundle.toXML().tree(), 'current');
      this.store.setPublished(true);
   }

   public publishDeviceId(deviceId: number): Promise<Element> {
      const localDeviceName = this.store.getLocalDeviceName();
      const deviceIds = this.store.getDeviceList(localDeviceName);

      if (deviceIds.indexOf(deviceId) < 0) {
         deviceIds.push(deviceId);
      }

      const xmlList = $build('list', { xmlns: NS_BASE });

      for (const id of deviceIds) {
         xmlList.c('device', { id }).up();
      }

      return this.pepService.publish(NS_DEVICELIST, xmlList.tree(), 'current');
   }

   public deleteDeviceList(): Promise<Element> {
      return this.pepService.delete(NS_DEVICELIST);
   }
}
