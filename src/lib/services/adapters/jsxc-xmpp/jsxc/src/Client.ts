import { IPlugin } from './plugin/AbstractPlugin';
import Storage from './Storage';
import { NoticeManager } from './NoticeManager';
import PluginRepository from './plugin/PluginRepository';
import Log from './util/Log';
import Options from './Options';
import PresenceController from './PresenceController';
import PageVisibility from './PageVisibility';
import AccountManager from './AccountManager';
import Migration from './Migration';
import Translation from './util/Translation';

const __VERSION__ = '0.0.1';

export default class Client {
   private static storage: Storage;

   private static noticeManager: NoticeManager;

   private static presenceController: PresenceController;

   private static accountManager: AccountManager;

   private static initialized = false;

   private static options: Options;

   public static init(options?): number {
      if (Client.initialized) {
         Log.warn('JSXC was already initialized');

         return NaN;
      }

      Client.initialized = true;

      if (typeof options === 'object' && options !== null) {
         Options.overwriteDefaults(options);
      }

      Translation.initialize();
      PageVisibility.init();

      const storage = Client.getStorage();

      Client.accountManager = new AccountManager(storage);
      Client.presenceController = new PresenceController(storage, () => Client.accountManager.getAccounts());


      Migration.run(Client.getVersion(), storage);

      return Options.getDefault('automaticallyRestoreAccounts') ? Client.accountManager.restoreAccounts() : 0;
   }

   public static getVersion(): string {
      return __VERSION__;
   }

   public static addPlugin(Plugin: IPlugin) {
      try {
         PluginRepository.add(Plugin);
      } catch (err) {
         Log.warn('Error while adding Plugin: ' + err);
      }
   }

   public static hasTabFocus() {
      let hasFocus = true;

      if (typeof document.hasFocus === 'function') {
         hasFocus = document.hasFocus();
      }

      return hasFocus;
   }

   public static isVisible() {
      return PageVisibility.isVisible();
   }

   public static isDebugMode(): boolean {
      return Client.getStorage().getItem('debug') === true;
   }

   public static getStorage(): Storage {
      if (!Client.storage) {
         Client.storage = new Storage();
      }

      return Client.storage;
   }

   public static getAccountManager(): AccountManager {
      return Client.accountManager;
   }

   public static getNoticeManager(): NoticeManager {
      if (!Client.noticeManager) {
         Client.noticeManager = new NoticeManager(Client.getStorage());
      }

      return Client.noticeManager;
   }

   public static getPresenceController(): PresenceController {
      return Client.presenceController;
   }

   public static getOptions(): Options {
      if (!Client.options) {
         Client.options = new Options(Client.getStorage());
      }

      return Client.options;
   }

   public static getOption<IOption = any>(key: string, defaultValue?: IOption): IOption {
      const value = Client.getOptions().get(key);

      return (typeof value !== 'undefined' ? value : defaultValue) as IOption;
   }

   public static setOption(key: string, value) {
      Client.getOptions().set(key, value);
   }

   public static isTrustedDomain(url: URL): boolean {
      const trustedDomains = Client.getOption<string[]>('trustedDomains', []);

      return (
         trustedDomains.filter(domain => {
            let result = url.hostname === domain;

            if (!result && domain.indexOf('*.') > -1) {
               const wildCardTestDomain = domain.substring(domain.lastIndexOf('*.') + 2);
               result = url.hostname.endsWith(wildCardTestDomain);
            }

            return result;
         }).length > 0
      );
   }
}
