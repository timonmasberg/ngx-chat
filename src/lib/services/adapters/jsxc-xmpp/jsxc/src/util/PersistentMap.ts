import IIdentifiable from '../Identifiable.interface';
import InvalidParameterError from '../errors/InvalidParameterError';
import IStorage from '../Storage.interface';

export default class PersistentMap<Value = any> {

   constructor(private storage: IStorage, ...identifier: string[]) {
      this.key = storage.generateKey.apply(storage, identifier);

      this.map = this.storage.getItem(this.key) || {};

      this.storage.registerHook(this.key, newValue => {
         this.map = newValue;
      });
   }

   private map = {};

   private key: string;
   public static getData(storage: IStorage, ...identifier: string[]) {
       const key = storage.generateKey.apply(storage, identifier);

       return storage.getItem(key) || {};
   }

   public getAllKeys(): string[] {
      return Object.keys(this.map);
   }

   public get(id: string, defaultValue?: Value): Value {
       const value = this.map[id];

       return typeof value !== 'undefined' ? value : defaultValue;
   }

   public set(id: string, value: Value): void;
   public set(value: Value): void;
   public set() {
      if (typeof arguments[0] === 'string') {
          const id = arguments[0];
          const value = arguments[1];

          this.map[id] = value;
      } else if (typeof arguments[0] === 'object' && arguments[0] !== null) {
         $.extend(this.map, arguments[0]);
      }

      this.save();
   }

   public empty() {
      this.map = {};

      this.save();
   }

   public remove(id: IIdentifiable): void;
   public remove(id: string): void;
   public remove() {
      let id: string;

      if (typeof arguments[0] === 'string') {
         id = arguments[0];
      } else if (typeof arguments[0].getId === 'function') {
         id = (arguments[0] as IIdentifiable).getId();
      } else {
         throw new InvalidParameterError('I need to know which id do you want to remove');
      }

      delete this.map[id];

      this.save();
   }

   public delete() {
      this.map = {};

      this.storage.removeItem(this.key);
      this.storage.removeHook(this.key);
   }

   public registerHook(id: string, func: (newValue: Value, oldValue: Value, key: string) => void): void;
   public registerHook(func: (newValue: Value, oldValue: Value, key: string) => void): void;
   public registerHook() {
      const func = arguments[0];
      if (typeof arguments[0] === 'string' && typeof arguments[1] === 'function') {
           const id = arguments[0];
           const func = arguments[1];

           this.storage.registerHook(this.key, function(newData, oldData) {
            if (newData && !oldData) {
               func(newData[id]);
            } else if (newData[id] !== oldData[id]) {
               func(newData[id], oldData[id]);
            }
         });
      } else {

           this.storage.registerHook(this.key, func);
      }
   }

   public registerNewHook(func: (value: Value, id: string) => void) {
      this.registerHook((newValue, oldValue) => {
          const newValueKeys = Object.keys(newValue || {});
          const oldValueKeys = Object.keys(oldValue || {});

          if (newValueKeys.length > oldValueKeys.length) {
             const newIds = newValueKeys.filter(id => oldValueKeys.indexOf(id) < 0);

             for (const newId of newIds) {
               func(newValue[newId], newId);
            }
         }
      });
   }

   public registerRemoveHook(func: (id: string) => void) {
      this.registerHook((newValue, oldValue) => {
          const newValueKeys = Object.keys(newValue || {});
          const oldValueKeys = Object.keys(oldValue || {});

          if (newValueKeys.length < oldValueKeys.length) {
             const removedIds = oldValueKeys.filter(id => newValueKeys.indexOf(id) < 0);

             for (const removedId of removedIds) {
               func(removedId);
            }
         }
      });
   }

   private save() {
      this.storage.setItem(this.key, this.map);
   }
}
