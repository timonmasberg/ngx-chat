import {testBOSHServer} from './testBOSHServer';
import Client from '../Client';
import {AbstractPlugin, IPlugin} from '../plugin/AbstractPlugin';
import {EncryptionPlugin} from '../plugin/EncryptionPlugin';
import InvalidParameterError from '../errors/InvalidParameterError';
import {AccountWrapper} from './account-wrapper';
import BaseError from '../errors/BaseError';
import Log from '../util/Log';
import LinkHandlerXMPP from '../LinkHandlerXMPP';
import Translation from '../util/Translation';
import Form from '../connection/Form';
import {Presence} from '../connection/AbstractConnection';
import Account from '../Account';
import {register} from './register';
import JID from '../JID';
import {Strophe} from 'strophe.js';

const __VERSION__ = '0.0.1';

// noinspection JSUnusedGlobalSymbols
export default class JSXC {
    public static readonly version = __VERSION__;

    public static readonly AbstractPlugin = AbstractPlugin;

    public static readonly AbstractEncryptionPlugin = EncryptionPlugin;

    private static initialized = false;

    public numberOfCachedAccounts: number;

    public version: string = __VERSION__;

    constructor(options) {
        if (JSXC.initialized) {
            throw new Error('JSXC was already initialized');
        }

        JSXC.initialized = true;

        this.numberOfCachedAccounts = Client.init(options);
    }


    async startAndPause(boshUrl: string, jid: string, password: string): Promise<void> {
        const accountManager = Client.getAccountManager();
        const account = await accountManager.createAccount(boshUrl, jid, password);

        return account.connect(true).then(() => {
            accountManager.addPendingAccount(account);
        });
    }

    async startWithCredentials(connectionServiceUrl: string, jid: string, password: string, connectionHook?: (status: Strophe.Status, condition?: string) => void) {
        const account = await Client.getAccountManager().createAccount(connectionServiceUrl, jid, password.toString());
        if (connectionHook){
            account.registerConnectionHook(connectionHook);
        }

        return this.connect(account);
    }

    async startWithBoshParameters(url: string, jid: string, sid: string, rid: string) {
        if (!/\/.+$/.test(jid)) {
            return Promise.reject(new InvalidParameterError('We need a Jabber ID with resource.'));
        }

        const account = await Client.getAccountManager().createCurrentReconnectingAccount(url, jid, sid, rid);

        return this.connect(account);
    }

    async connect(account: Account): Promise<void> {
        const accountManager = Client.getAccountManager();

        await account.connect(true);

        try {
            accountManager.addAccount(account);
        } catch (err) {
            accountManager.removeAccount(account);

            if (err instanceof BaseError) {
                Log.warn('Instance of BaseErrors', err.toString());

                throw err;
            }

            Log.warn('Unknown error:', err);

            throw new Error('Unknown error');
        }
    }


    addPlugin(Plugin: IPlugin) {
        Client.addPlugin(Plugin);
    }

    addHandlerToXMPPUri(container: JQuery = $('body')) {
        LinkHandlerXMPP.get().detect(container);
    }

    executeXMPPUri(uri: string) {
        return LinkHandlerXMPP.get().execute(uri);
    }

    exportAllOptions() {
        const accounts = Client.getAccountManager().getAccounts();

        return {
            ...accounts.reduce((previous, account) => {
                const option = account.getOptions();

                previous[option.getId()] = option.export();

                return previous;
            }, {}),
            [Client.getOptions().getId()]: Client.getOptions().export(),
        };
    }

    translate(str: string, param) {
        return Translation.t(str, param);
    }

    getAccount(uid: string) {
        return new AccountWrapper(uid);
    }

    restoreAccounts(): number {
        return Client.getAccountManager().restoreAccounts();
    }

    disconnect() {
        return new Promise<void>(resolve => {
            Client.getPresenceController().registerCurrentPresenceHook(presence => {
                if (presence === Presence.offline) {
                    resolve();
                }
            });

            if (Client.getAccountManager().getAccount()) {
                Client.getPresenceController().setTargetPresence(Presence.offline);
            } else {
                resolve();
            }
        });
    }


    register(service: string, domain: string, callback?: (form: Form) => Promise<Form>) {
        return register(service, domain, callback);
    }

    testBOSHServer(url: string, domain: string): Promise<string> {
        return testBOSHServer(url, domain);
    }


    enableDebugMode() {
        const storage = Client.getStorage();

        storage.setItem('debug', true);
    }

    disableDebugMode() {
        const storage = Client.getStorage();

        storage.setItem('debug', false);
    }

    deleteAllData() {
        if (!Client.isDebugMode()) {
            Log.warn('This action is only available in debug mode.');

            return 0;
        }

        const storage = Client.getStorage();
        const prefix = storage.getPrefix();
        const prefixRegex = new RegExp('^' + prefix);
        const backend = storage.getBackend();
        const keys = Object.keys(backend);
        let count = 0;

        for (const key of keys) {
            if (prefixRegex.test(key) && key !== prefix + 'debug') {
                backend.removeItem(key);
                count++;
            }
        }

        return count;
    }

    deleteObsoleteData() {
        const storage = Client.getStorage();
        const backend = storage.getBackend();
        const keys = Object.keys(backend);
        let count = 0;

        for (const key of keys) {
            if (/^jsxc:/.test(key)) {
                backend.removeItem(key);
                count++;
            }
        }

        return count;
    }

    toJid(jidBare: string) {
        return new JID(jidBare);
    }

}
