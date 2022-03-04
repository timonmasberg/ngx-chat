import Log from './util/Log';
import IStorage from './Storage.interface';
import Options from './Options';

const PREFIX = 'jsxc2';

const SEP = ':';

const IGNORE_KEY = ['rid'];

// tslint:disable
export default class Storage implements IStorage {

   constructor(private name: string = null) {
      if (!Storage.backend) {
         Storage.backend = Options.getDefault('storage');
      }

      if (!Storage.tested) {
         Storage.tested = true;

         this.testStorage();
      }

      window.addEventListener('storage', this.onStorageEvent, false);
   }
   public static storageNotConform = false;
   public static tested = false;

   private static backend;

   public static toSNC: number;

   private hooks: any = {};

   public static clear(name?: string) {
      Storage.getKeysWithPrefix(name).forEach(key => Storage.backend.removeItem(key));
   }

   public static getKeysWithPrefix(name?: string): string[] {
      let prefix = '';

      if (!name.startsWith(PREFIX)) {
         prefix = PREFIX + SEP;
      }

      if (name) {
         prefix = prefix + name + SEP;
      }

      const keys = [];

      for (const key in Storage.backend) {
         if (!Storage.backend.hasOwnProperty(key)) {
            continue;
         }

         if (key.startsWith(prefix)) {
            keys.push(key);
         }
      }

      return keys;
   }

   public getName(): string {
      return this.name;
   }

   public generateKey(...args: string[]): string {
      let key = '';

      args.forEach(arg => {
         if (key !== '') {
            key += SEP;
         }

         key += arg;
      });

      return key;
   }

   private testStorage() {
      const randomNumber = Math.round(Math.random() * 1000000000) + '';
      const key = this.getPrefix() + randomNumber;
      let timeout;

      const listenerFunction = ev => {
         if (ev.newValue === randomNumber) {
            clearTimeout(timeout);
            cleanup();
            Storage.storageNotConform = true;
         }
      };

      const cleanup = () => {
         window.removeEventListener('storage', listenerFunction, false);
         Storage.backend.removeItem(key);
      };

      window.addEventListener('storage', listenerFunction, false);

      timeout = setTimeout(() => {
         cleanup();
      }, 20);

      Storage.backend.setItem(key, randomNumber);
   }

   public getPrefix(): string {
      let prefix = PREFIX + SEP;

      if (this.name) {
         prefix += this.name + SEP;
      }

      return prefix;
   }

   public getBackend() {
      return Storage.backend;
   }

   public setItem<Data = any>(type: string, key: string, value: Data): void;
   public setItem<Data = any>(key: string, value: Data): void;
   public setItem(): void {
      let key: string;
      let value: any;

      if (arguments.length === 2) {
         key = arguments[0];
         value = arguments[1];
      } else if (arguments.length === 3) {
         key = arguments[0] + SEP + arguments[1];
         value = arguments[2];
      }

      // @REVIEW why do we just stringify objects?
      if (typeof value === 'object') {
         // exclude jquery objects, because otherwise safari will fail
         try {
            value = JSON.stringify(value, (key, val) => {
               if (!(val instanceof jQuery)) {
                  return val;
               }
            });
         } catch (err) {
            Log.warn('Could not stringify value', err);
         }
      }

      const oldValue = Storage.backend.getItem(this.getPrefix() + key);

      Storage.backend.setItem(this.getPrefix() + key, value);

      if (!Storage.storageNotConform && oldValue !== value) {
         this.onStorageEvent({
            key: this.getPrefix() + key,
            oldValue,
            newValue: value,
         });
      }
   }

   public getItem<Data = any>(type: string, key: string): Data;
   public getItem<Data = any>(key: string): Data;
   public getItem(): any {
      let key: string;

      if (arguments.length === 1) {
         key = arguments[0];
      } else if (arguments.length === 2) {
         key = arguments[0] + SEP + arguments[1];
      }

      key = this.getPrefix() + key;

      if (!Storage.backend.hasOwnProperty(key)) {
         return undefined;
      }

      const value = Storage.backend.getItem(key);

      return this.parseValue(value);
   }

   public removeItem(type, key): void;
   public removeItem(key): void;
   public removeItem(): void {
      let key;

      if (arguments.length === 1) {
         key = arguments[0];
      } else if (arguments.length === 2) {
         key = arguments[0] + SEP + arguments[1];
      }

      Storage.backend.removeItem(this.getPrefix() + key);
   }

   public updateItem(type: string, key: string, variable: string, value: any): void;
   public updateItem(key: string, variable: string, value: any): void;
   public updateItem(): void {
      let key: string;
      let variable: string;
      let value: any;

      if (arguments.length === 4 || (arguments.length === 3 && typeof variable === 'object')) {
         key = arguments[0] + SEP + arguments[1];
         variable = arguments[2];
         value = arguments[3];
      } else {
         key = arguments[0];
         variable = arguments[1];
         value = arguments[2];
      }

      const data = this.getItem(key) || {};

      if (typeof variable === 'object') {
         $.each(variable, (key, val) => {
            if (typeof data[key] === 'undefined') {
               Log.debug(`Variable ${key} doesn't exist in ${variable}. It was created.`);
            }

            data[key] = val;
         });
      } else {
         if (typeof data[variable] === 'undefined') {
            Log.debug('Variable ' + variable + ' doesn\'t exist. It was created.');
         }

         data[variable] = value;
      }

      this.setItem(key, data);
   }

   public increment(key: string): void {
      const value = Number(this.getItem(key));

      this.setItem(key, value + 1);
   }

   public removeElement(type, key, name): void;
   public removeElement(key, name): void;
   public removeElement(): void {
      let key;
      let name;

      if (arguments.length === 2) {
         key = arguments[0];
         name = arguments[1];
      } else if (arguments.length === 3) {
         key = arguments[0] + SEP + arguments[1];
         name = arguments[2];
      }

      let item = this.getItem(key);

      if ($.isArray(item)) {
         item = $.grep(item, e => e !== name);
      } else if (typeof item === 'object' && item !== null) {
         delete item[name];
      }

      this.setItem(key, item);
   }

   public getItemsWithKeyPrefix(keyPrefix: string) {
      const prefix = this.getPrefix() + keyPrefix;

      const fullKeys = Storage.getKeysWithPrefix(prefix);
      const items = {};

      for (const fullKey of fullKeys) {
         const key = fullKey.replace(new RegExp('^' + this.getPrefix()), '');

         items[key] = this.getItem(key);
      }

      return items;
   }

   public registerHook(eventName: string, func: (newValue: any, oldValue: any, key: string) => void) {
      if (!this.hooks[eventName]) {
         this.hooks[eventName] = [];
      }

      this.hooks[eventName].push(func);
   }

   public removeHook(eventName: string, func?: (newValue: any, oldValue: any, key: string) => void) {
      let eventNameList = this.hooks[eventName] || [];

      if (typeof func === 'undefined') {
         eventNameList = [];
      } else if (eventNameList.indexOf(func) > -1) {
         eventNameList = $.grep(eventNameList, i => func !== i);
      }

      this.hooks[eventName] = eventNameList;
   }

   public removeAllHooks() {
      this.hooks = {};
   }

   public destroy() {
      this.removeAllHooks();

      window.removeEventListener('storage', this.onStorageEvent, false);
   }

   private onStorageEvent = (ev: any) => {
      const prefix = this.getPrefix();

      if (!ev.key || ev.key.indexOf(prefix) !== 0) {
         return;
      }

      const key = ev.key.slice(prefix.length);

      if (IGNORE_KEY.indexOf(key) > -1) {
         return;
      }

      const hooks = this.hooks;
      const oldValue = this.parseValue(ev.oldValue);
      const newValue = this.parseValue(ev.newValue);

      const eventNames = Object.keys(hooks);
      eventNames.forEach(eventName => {
         if (eventName === '*' || key === eventName || key.indexOf(eventName + ':') === 0) {
            const eventNameHooks = hooks[eventName] || [];
            eventNameHooks.forEach(hook => {
               hook(newValue, oldValue, key);
            });
         }
      });
   }

   private parseValue(value: string) {
      if (value === 'undefined') {
         return;
      }

      try {
         return JSON.parse(value);
      } catch (e) {
         return value;
      }
   }
}
