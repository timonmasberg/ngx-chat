import Storage from './Storage';
import Log from './util/Log';

const VERSION_KEY = 'version';

export default class Migration {

   private constructor(currentVersion: string, private storage: Storage) {
      const lastVersion = storage.getItem(VERSION_KEY);

      if (lastVersion !== currentVersion) {
         Log.debug('Apply migrations');

         this.keys = Object.keys(storage.getBackend());

         this.runV3Migration();

         storage.setItem(VERSION_KEY, currentVersion);
      }
   }

   private keys: string[];
   public static run(currentVersion: string, storage: Storage) {
     return new Migration(currentVersion, storage);
   }

   private runV3Migration() {
      const backend = this.storage.getBackend();

      if (!backend.getItem('jsxc:version')) {
         return;
      }

      Log.debug('Run migration for 3.x');

      this.keys.forEach(key => {
         const matches = key.match(/^jsxc:([^:]+):key$/);

         if (matches) {
            const newKey = this.storage.generateKey(matches[1], 'plugin', 'otr', 'key');

            this.storage.setItem(newKey, backend.getItem(key));
         }
      });
   }
}
