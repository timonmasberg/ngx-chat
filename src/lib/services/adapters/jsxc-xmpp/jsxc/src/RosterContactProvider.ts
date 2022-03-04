import ContactProvider from './ContactProvider';
import {ContactSubscription as SUBSCRIPTION, IContact, ContactType} from './Contact.interface';
import JID from './JID';
import Account from './Account';
import Contact from './Contact';
import {IJID} from './JID.interface';
import ContactManager from './ContactManager';
import RoleAllocator from './RoleAllocator';
import Log from './util/Log';

export default class RosterContactProvider extends ContactProvider {
    constructor(contactManager: ContactManager, private account: Account) {
        super(contactManager);

        account.getConnection().registerHandler(
            stanza => {
                this.processUpdateStanza(stanza);

                return true;
            },
            'jabber:iq:roster',
            'iq',
            'set'
        );
    }

    public getUid() {
        return 'roster';
    }

    public async add(contact: IContact): Promise<boolean> {
        if (contact.getType() !== ContactType.CHAT) {
            return false;
        }

        await this.getService().addContact(contact.getJid(), contact.hasName() ? contact.getName() : undefined);

        this.registerContact(contact);

        return true;
    }

    public async load(): Promise<IContact[]> {
        const rosterVersion = this.getStorage().getItem('roster', 'version') || '';

        try {
            const rosterService = this.getConnection().getRosterService;
            const rosterStanza = await rosterService.getRoster(rosterVersion);

            return this.processStanza(rosterStanza);
        } catch (err) {
            Log.warn(err);
        }

        return [];
    }

    public createContact(jid: IJID, name?: string): IContact;
    public createContact(id: string): IContact;
    public createContact() {
        const contact = new Contact(this.account, arguments[0], arguments[1]);

        this.registerContact(contact);

        return contact;
    }

    private registerContact(contact: IContact) {
        contact.setProvider(this);

        contact.registerHook('name', displayName => {
            if (RoleAllocator.get().isMaster()) {
                this.renameContact(contact.getJid(), displayName, contact.getGroups());
            }
        });
    }

    public deleteContact(jid: IJID): Promise<void> {
        return this.getService()
            .removeContact(jid)
            .then(() => undefined);
    }

    private renameContact(jid: IJID, displayName: string, groups: string[]) {
        this.getService().setDisplayName(jid, displayName, groups);
    }

    private getStorage() {
        return this.account.getStorage();
    }

    private getConnection() {
        return this.account.getConnection();
    }

    private getService() {
        return this.getConnection().getRosterService;
    }

    private processStanza(stanzaElement: Element): IContact[] {
        Log.debug('Load roster', stanzaElement);

        const storage = this.getStorage();
        const stanza = $(stanzaElement);

        if (stanza.find('query').length === 0) {
            Log.debug('Use cached roster');

            return this.restoreRosterFromCache();
        }

        let cache = [];
        const contacts: IContact[] = [];
        const self = this;

        stanza.find('item').each(function() {
            const item = $(this);
            const jid = new JID(item.attr('jid'));
            const name = item.attr('name') || jid.bare;
            const subscription = item.attr('subscription');
            const groups = item
                .find('>group')
                .map((index, groupElement) => $(groupElement).text())
                .get();

            const contact = self.createContact(jid, name);
            contact.setSubscription(subscription as SUBSCRIPTION);
            contact.setGroups(groups);

            cache.push(contact.getId());
            contacts.push(contact);
        });

        const rosterVersion = $(stanza).find('query').attr('ver');

        if (!rosterVersion) {
            cache = [];
        }

        storage.setItem('roster', 'version', rosterVersion);
        storage.setItem('roster', 'cache', cache);

        return contacts;
    }

    private restoreRosterFromCache(): IContact[] {
        const storage = this.getStorage();
        const cachedRoster = storage.getItem('roster', 'cache') || [];
        const failedContacts: string[] = [];
        const contacts: IContact[] = [];

        for (const id of cachedRoster) {
            try {
                const contact = this.createContact(id);
                contact.clearResources();

                contacts.push(contact);
            } catch (err) {
                Log.warn('Could not restore contact from cached roster.', err);

                failedContacts.push(id);
            }
        }

        if (failedContacts.length > 0) {
            storage.setItem(
                'roster',
                'cache',
                cachedRoster.filter(id => failedContacts.indexOf(id) < 0)
            );
        }

        return contacts;
    }

    private processUpdateStanza(stanza: string): boolean {
        const fromString = $(stanza).attr('from');
        let fromJid: IJID;

        if (fromString) {
            fromJid = new JID(fromString);
        }

        const account = this.account;

        if (fromJid && fromJid.bare !== account.getJID().bare) {
            Log.info('Ignore roster change with wrong sender jid.');

            return false;
        }

        Log.debug('Process roster change.');

        const itemElement = $(stanza).find('item');

        if (itemElement.length !== 1) {
            Log.info('Ignore roster change with more than one item element.');

            return false;
        }

        const jid = new JID($(itemElement).attr('jid'));
        const name = $(itemElement).attr('name');
        const subscription = $(itemElement).attr('subscription') || 'none';
        const groups = $(itemElement)
            .find('>group')
            .map((index, groupElement) => $(groupElement).text())
            .get();

        let contact = account.getContact(jid);

        if (!contact && subscription === SUBSCRIPTION.REMOVE) {
            return false;
        }

        if (!contact) {
            contact = this.createContact(jid, name);
        }

        if (subscription === SUBSCRIPTION.REMOVE) {
            this.contactManager.deleteFromCache(contact.getId());

            contact.delete();
        } else {
            contact.setName(name);
            contact.setSubscription(subscription as SUBSCRIPTION);
            contact.setGroups(groups);

            this.contactManager.addToCache(contact);
        }

        if (subscription === SUBSCRIPTION.FROM || subscription === SUBSCRIPTION.BOTH) {
            // @TODO Remove pending friendship request from notice list. This can be done via property hook.
        }

        const rosterVersion = $(stanza).find('query').attr('ver');

        if (rosterVersion) {
            const storage = account.getStorage();

            storage.setItem('roster', 'version', rosterVersion);

            let cache = storage.getItem('roster', 'cache') || [];

            if (subscription === SUBSCRIPTION.REMOVE && cache.indexOf(contact.getId()) > -1) {
                cache = cache.filter(id => id !== contact.getId());
            } else if (subscription !== SUBSCRIPTION.REMOVE && cache.indexOf(contact.getId()) < 0) {
                cache.push(contact.getId());
            }

            storage.setItem('roster', 'cache', cache);
        }

        return true;
    }
}
