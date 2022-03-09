import Account from '../Account';
import {IContact} from '../Contact.interface';
import Form, {IFormJSONData} from '../connection/Form';
import MultiUserContact, {ROOMCONFIG} from '../MultiUserContact';
import Client from '../Client';
import JID from '../JID';


export class ContactWrapper {
    constructor(protected contact: IContact, protected account: Account) {
    }

    public getUid() {
        return this.contact.getUid();
    }

    public getJid() {
        return this.contact.getJid();
    }

    public openChatWindow() {
        this.contact.getChatWindowController().open();
    }

    public openChatWindowProminently() {
        this.contact.getChatWindowController().openProminently();
    }

    public addToContactList() {
        this.account.getContactManager().add(this.contact);
    }
}

export class MultiUserContactWrapper extends ContactWrapper {
    protected contact: MultiUserContact;

    public get multiUserContact() {
        return this.contact;
    }

    public join() {
        this.contact.join();
    }

    public leave() {
        return this.contact.leave();
    }

    public destroy() {
        return this.contact.destroy();
    }

    public rejectInvitation() {
        return this.contact.rejectInvitation();
    }

    public async getRoomConfigurationForm() {
        return Form.fromXML(await this.getRoomConfigurationFormElement()).toJSON();
    }

    public async getRoomConfigurationFormElement() {
        const service = this.account.getConnection().getMUCService;
        return await service.getRoomConfigurationForm(this.getJid());
    }

    public submitRoomConfigurationForm(data: IFormJSONData) {
        const form = Form.fromJSON(data);
        this.contact.setRoomConfiguration(form.toJSON());

        const service = this.account.getConnection().getMUCService;

        return service.submitRoomConfiguration(this.getJid(), form);
    }

    getRoomUsers() {
        return this.contact.getMemberIds().map(nickname => {
            const {affiliation, role, jid} = this.contact.getMember(nickname);
            return {
                userIdentifiers: [{
                    userJid: jid,
                    nick: nickname
                }],
                affiliation,
                role
            };
        });
    }
}

export class AccountWrapper {
    private readonly account: Account;

    get jid() {
        return this.account.getJID();
    }

    get innerAccount(): Account {
        return this.account;
    }

    constructor(uid: string) {
        const account = Client.getAccountManager().getAccount(uid);

        if (!account) {
            throw new Error(`Account with uid "${uid}" doesn't exist.`);
        }

        this.account = account;
    }

    public createMultiUserContact(jidString: string, nickname: string, displayName?: string, password?: string) {
        const jid = new JID(jidString);

        if (!jid.node || !jid.domain) {
            throw new Error('You have to provide a full jid');
        }

        const contactManager = this.account.getContactManager();

        if (contactManager.getContact(jid)) {
            throw new Error('Contact with this jid already exists');
        }

        const contact = new MultiUserContact(this.account, jid, displayName);

        contact.setNickname(nickname);
        contact.setBookmark(true);
        contact.setAutoJoin(true);
        contact.setRoomConfiguration(ROOMCONFIG.INSTANT);

        if (password) {
            contact.setPassword(password);
        }

        contactManager.addToCache(contact);

        return new MultiUserContactWrapper(contact, this.account);
    }

    public getContact(jidString: string) {
        const jid = new JID(jidString);
        const contact = this.account.getContact(jid);

        if (!contact) {
            throw new Error('Contact not found');
        }

        if (contact.isGroupChat()) {
            return new MultiUserContactWrapper(contact, this.account);
        }

        return new ContactWrapper(contact, this.account);
    }

    public getMultiUserContact(jidString: string) {
        const jid = new JID(jidString);
        const contact = this.account.getContact(jid);

        if (!contact.isGroupChat()) {
            throw new Error('Not a MultiUserContact');
        }

        return new MultiUserContactWrapper(contact, this.account);
    }
}
