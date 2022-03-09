import Account from './Account';
import JID from './JID';
import IStorage from './Storage.interface';
import Client from './Client';
import ClientAvatar from './ClientAvatar';
import RoleAllocator from './RoleAllocator';
import Log from './util/Log';
import Utils from './util/Utils';

export default class AccountManager {
    private accounts: { [id: string]: Account } = {};

    constructor(private storage: IStorage) {
    }

    public restoreAccounts(): number {
        const accountIds = this.getAccountIds();
        const pendingAccountIds = this.getPendingAccountIds();
        const numberOfAccounts = accountIds.length + pendingAccountIds.length;

        accountIds.forEach(this.initAccount);
        pendingAccountIds.forEach(this.initAccount);

        this.storage.setItem('pendingAccounts', []);
        this.storage.setItem('accounts', Object.keys(this.accounts));

        this.storage.registerHook('accounts', this.accountsHook);

        return numberOfAccounts;
    }

    private initAccount = (id: string) => {
        if (this.accounts[id]) {
            Log.debug('destroy old account with uid ' + id);

            this.accounts[id].destroy();
        }

        const account = (this.accounts[id] = new Account(id));

        Client.getPresenceController().registerAccount(account);
        ClientAvatar.get().registerAccount(account);

        RoleAllocator.get()
            .waitUntilMaster()
            .then(() => account.connect())
            .then(() => {
            })
            .catch(msg => {
                account.connectionDisconnected();

                Log.warn(msg);
            });
    };

    private accountsHook = (newValue, oldValue) => {
        const diff = Utils.diffArray(newValue, oldValue);
        const newAccountIds = diff.newValues;
        const deletedAccountIds = diff.deletedValues;

        newAccountIds.forEach(this.initAccount);

        deletedAccountIds.forEach(id => {
            const account: Account = this.accounts[id];

            if (account) {
                delete this.accounts[account.getUid()];

                account.remove();
            }
        });
    };

    public async createAccount(url: string, jid: string, ...remainingArgs: string[]): Promise<Account> {
        if (!url) {
            throw new Error('We need an url to create an account');
        }

        if (this.getAccount(jid)) {
            throw new Error('Account with this jid already exists.');
        }

        if (remainingArgs.length === 2) {
            const [sid, rid] = remainingArgs;
            return new Account(url, jid, sid, rid);
        } else if (remainingArgs.length === 1) {
            const [password] = remainingArgs;
            return new Account(url, jid, password);
        } else {
            throw new Error('Wrong number of arguments');
        }
    }

    public async createCurrentReconnectingAccount(url: string, jid: string, sid: string, rid: string): Promise<Account> {
        if (this.getAccount(jid)) {
            throw new Error('Account with this jid already exists.');
        }
        return new Account(url, jid, sid, rid);
    }

    public getAccount(jid: JID): Account;
    public getAccount(uid?: string): Account;
    public getAccount() {
        let uid;

        if (arguments[0] instanceof JID) {
            uid = arguments[0].bare;
        } else if (arguments[0]) {
            uid = arguments[0];
        } else {
            uid = Object.keys(this.accounts)[0];
        }

        return this.accounts[uid];
    }

    public getAccounts(): Account[] {
        // @REVIEW use of Object.values()
        const accounts = [];

        for (const id in this.accounts) {
            accounts.push(this.accounts[id]);
        }

        return accounts;
    }

    public addAccount(account: Account) {
        if (this.getAccount(account.getUid())) {
            throw new Error('Account with this jid already exists.');
        }

        this.accounts[account.getUid()] = account;

        this.storage.setItem('accounts', Object.keys(this.accounts));
    }

    private getAccountIds(): string[] {
        return this.storage.getItem('accounts') || [];
    }

    public addPendingAccount(account: Account) {
        const uid = account.getUid();
        const pendingAccounts = this.getPendingAccountIds();

        if (pendingAccounts.indexOf(uid) < 0) {
            pendingAccounts.push(uid);

            this.storage.setItem('pendingAccounts', pendingAccounts);
        }
    }

    private getPendingAccountIds(): string[] {
        return this.storage.getItem('pendingAccounts') || [];
    }

    public removeAccount(account: Account) {
        const ids = Object.keys(this.accounts).filter(id => id !== account.getUid());

        this.storage.setItem('accounts', ids);

        if (ids.length === 0) {
            Client.getNoticeManager().removeAll();
        }
    }
}
