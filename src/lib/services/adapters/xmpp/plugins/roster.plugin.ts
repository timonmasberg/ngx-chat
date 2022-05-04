import {Contact} from '../../../../core/contact';
import {Presence} from '../../../../core/presence';
import {PresenceStanza, Stanza} from '../../../../core/stanza';
import {ContactSubscription} from '../../../../core/subscription';
import {LogService} from '../service/log.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {first} from 'rxjs/operators';
import {ChatPlugin} from '../../../../core/plugin';
import {ChatConnection} from '../interface/chat-connection';
import {ConnectionStates} from '../interface/chat.service';
import {Finder} from '../shared/finder';
import {nsMuc} from './multi-user-chat/multi-user-chat-constants';
import {Subject} from 'rxjs';

/**
 * Current @TODOS:
 * 1. rename ns constants to nsNameCase
 * 2. move contacts observable to roster plugin as source of truth, inner Behaviour Subject outer Observable
 * 3. actions on contact as private subjects to avoid async
 *
 */

export const nsRoster = 'jabber:iq:roster';
// https://xmpp.org/extensions/xep-0144.html
export const nsRosterX = 'jabber:x:roster';

/**
 * https://xmpp.org/rfcs/rfc6121.html#roster-add-success
 */
export class RosterPlugin implements ChatPlugin {

    readonly nameSpace = nsRoster;

    private readonly authorizePresenceSubscriptionSubject = new Subject<string>();

    private readonly acknowledgeRosterStanzaPushSubject = new Subject<string>();
    private readonly acknowledgeSubscribeSubject = new Subject<string>();
    private readonly acknowledgeUnsubscribeSubject = new Subject<string>();

    private readonly addContactFromRosterXPushSubject = new Subject<string>();

    private rosterPushHandler;
    private contactSuggestionHandler;
    private presenceHandler;

    constructor(
        private chatService: XmppChatAdapter,
        private logService: LogService,
    ) {
    }

    async registerHandler(connection: ChatConnection): Promise<void> {
        const from = await this.chatService.chatConnectionService.userJid$.pipe(first()).toPromise();

        this.authorizePresenceSubscriptionSubject.subscribe(async (jid) => await this.authorizePresenceSubscription(jid));

        this.acknowledgeRosterStanzaPushSubject.subscribe(async (id) =>
            await this.chatService.chatConnectionService
                .$iq({from, id, type: 'result'})
                .send());
        this.acknowledgeSubscribeSubject.subscribe(async (jid) => await this.sendAcknowledgeSubscribe(jid));
        this.acknowledgeUnsubscribeSubject.subscribe(async (jid) => await this.sendAcknowledgeUnsubscribe(jid));
        this.addContactFromRosterXPushSubject.subscribe(async (jid) => await this.addRosterContact(jid));

        this.rosterPushHandler = connection.addHandler(elem => this.handleRosterPushStanza(elem, from), {
            ns: nsRoster,
            name: 'iq',
            type: 'set'
        });
        this.contactSuggestionHandler = connection.addHandler(elem => this.handleRosterXPush(elem), {ns: nsRosterX, name: 'message'});
        this.presenceHandler = connection.addHandler((elem) => this.handlePresenceStanza(elem, from), {name: 'presence'});
    }

    unregisterHandler(connection: ChatConnection): Promise<void> {
        connection.deleteHandler(this.rosterPushHandler);
        connection.deleteHandler(this.contactSuggestionHandler);
        connection.deleteHandler(this.presenceHandler);
        return Promise.resolve();
    }

    private handleRosterPushStanza(stanza: Stanza, currentUser: string) {
        const itemChild = Finder.create(stanza).searchByTag('query').searchByTag('item').result;
        const to = itemChild.getAttribute('jid');
        const id = itemChild.getAttribute('id');
        const name = itemChild.getAttribute('name');
        const ask = itemChild.getAttribute('ask');
        const from = itemChild.getAttribute('from');

        if (currentUser !== from) {
            // Security Warning: Traditionally, a roster push included no 'from' address, with the result that all roster pushes were sent
            // implicitly from the bare JID of the account itself. However, this specification allows entities other than the user's server
            // to maintain roster information, which means that a roster push might include a 'from' address other than the bare JID of the
            // user's account. Therefore, the client MUST check the 'from' address to verify that the sender of the roster push is authorized
            // to update the roster. If the client receives a roster push from an unauthorized entity, it MUST NOT process the pushed data; in
            // addition, the client can either return a stanza error of <service-unavailable/> error or refuse to return a stanza error at all
            // (the latter behavior overrides a MUST-level requirement from [XMPP‑CORE] for the purpose of preventing a presence leak).
            return true;
        }

        const subscription = itemChild.getAttribute('subscription');
        const contact = this.chatService.getOrCreateContactByIdSync(to, name || to);
        contact.pendingOut$.next(ask === 'subscribe');
        const subscriptionStatus = subscription || 'none';

        // acknowledge the reception of the pushed roster stanza
        this.acknowledgeRosterStanzaPushSubject.next(id);

        if (subscriptionStatus === 'remove') {
            contact.pendingOut$.next(false);
            contact.subscription$.next(ContactSubscription.none);
            return this.refreshContacts();
        } else if (subscriptionStatus === 'none') {
            contact.subscription$.next(ContactSubscription.none);
            return this.refreshContacts();
        } else if (subscriptionStatus === 'to') {
            contact.subscription$.next(ContactSubscription.to);
            return this.refreshContacts();
        } else if (subscriptionStatus === 'from') {
            contact.subscription$.next(ContactSubscription.from);
            return this.refreshContacts();
        } else if (subscriptionStatus === 'both') {
            contact.subscription$.next(ContactSubscription.both);
            return this.refreshContacts();
        }

        return false;
    }

    private refreshContacts(): true {
        const existingContacts = this.chatService.contacts$.getValue();
        this.chatService.contacts$.next(existingContacts);
        return true;
    }

    private handlePresenceStanza(stanza: PresenceStanza, userJid: string): boolean {
        const type = stanza.getAttribute('type');

        if (type === 'error') {
            return true;
        }

        const fromJid = stanza.getAttribute('from');
        if (userJid.split('/')[0] === fromJid.split('/')[0]) {
            return this.handleOwnPresence(stanza, userJid, fromJid);
        }

        const stanzaFinder = Finder.create(stanza);

        if (stanzaFinder.searchByTag('query').searchByNamespace(nsMuc).result) {
            return false;
        }

        const fromContact = this.chatService.getOrCreateContactByIdSync(fromJid);
        const statusMessage = stanzaFinder.searchByTag('status')?.result?.textContent;

        if (statusMessage) {
            fromContact.setStatus(statusMessage);
        }

        if (!type) {
            // https://xmpp.org/rfcs/rfc3921.html#stanzas-presence-children-show
            const show = stanzaFinder.searchByTag('show').result.textContent;
            const presenceMapping: { [key: string]: Presence } = {
                chat: Presence.present,
                null: Presence.present,
                away: Presence.away,
                dnd: Presence.away,
                xa: Presence.away,
            };
            fromContact.updateResourcePresence(fromJid, presenceMapping[show]);
            return true;
        }

        if (type === 'unavailable') {
            fromContact.updateResourcePresence(fromJid, Presence.unavailable);
            return true;
        }

        if (type === 'subscribe') {
            if (fromContact.isSubscribed() || fromContact.pendingOut$.getValue()) {
                // subscriber is already a contact of us, approve subscription
                fromContact.pendingIn$.next(false);
                this.authorizePresenceSubscriptionSubject.next(fromJid);
                fromContact.subscription$.next(
                    this.transitionSubscriptionRequestReceivedAccepted(fromContact.subscription$.getValue()));
                this.chatService.contacts$.next(this.chatService.contacts$.getValue());
                return true;
            } else if (fromContact) {
                // subscriber is known but not subscribed or pending
                fromContact.pendingIn$.next(true);
                this.chatService.contacts$.next(this.chatService.contacts$.getValue());
                return true;
            }
        }

        if (type === 'subscribed') {
            fromContact.pendingOut$.next(false);
            fromContact.subscription$.next(this.transitionSubscriptionRequestSentAccepted(fromContact.subscription$.getValue()));
            this.chatService.contacts$.next(this.chatService.contacts$.getValue());
            this.acknowledgeSubscribeSubject.next(fromJid);
            return true;
        }

        if (type === 'unsubscribed') {
            this.acknowledgeUnsubscribeSubject.next(fromJid);
            return true;
        }
        // do nothing on true and for false we didn't handle the stanza properly
        return type === 'unsubscribe';
    }

    private transitionSubscriptionRequestReceivedAccepted(subscription: ContactSubscription) {
        switch (subscription) {
            case ContactSubscription.none:
                return ContactSubscription.from;
            case ContactSubscription.to:
                return ContactSubscription.both;
            default:
                return subscription;
        }
    }

    private transitionSubscriptionRequestSentAccepted(subscription: ContactSubscription) {
        switch (subscription) {
            case ContactSubscription.none:
                return ContactSubscription.to;
            case ContactSubscription.from:
                return ContactSubscription.both;
            default:
                return subscription;
        }
    }

    private async unauthorizePresenceSubscription(jid: string) {
        const contact = this.chatService.getOrCreateContactByIdSync(jid);
        contact.pendingIn$.next(false);
        await this.chatService.chatConnectionService
            .$pres({to: jid, type: 'unsubscribed'})
            .send();
    }

    private async authorizePresenceSubscription(jid: string) {
        const contact = this.chatService.getOrCreateContactByIdSync(jid);
        contact.pendingIn$.next(false);
        await this.chatService.chatConnectionService
            .$pres({to: jid, type: 'subscribed'})
            .send();
    }

    public onBeforeOnline(): PromiseLike<any> {
        return this.refreshRosterContacts();
    }

    async getRosterContacts(): Promise<Contact[]> {
        const responseStanza = await this.chatService.chatConnectionService
            .$iq({type: 'get'})
            .c('query', {xmlns: 'jabber:iq:roster'})
            .sendAwaitingResponse();
        return this.convertToContacts(responseStanza);
    }

    private convertToContacts(responseStanza: Element): Contact[] {
        return Array.from(responseStanza.querySelector('query').children)
            .map(rosterElement => {
                const contact = this.chatService.getOrCreateContactByIdSync(rosterElement.getAttribute('jid'),
                    rosterElement.getAttribute('name') || rosterElement.getAttribute('jid'));
                contact.subscription$.next(this.parseSubscription(rosterElement.getAttribute('subscription')));
                contact.pendingOut$.next(rosterElement.getAttribute('ask') === 'subscribe');
                return contact;
            });
    }

    private parseSubscription(subscription: string): ContactSubscription {
        switch (subscription) {
            case 'to':
                return ContactSubscription.to;
            case 'from':
                return ContactSubscription.from;
            case 'both':
                return ContactSubscription.both;
            case 'none':
            default:
                return ContactSubscription.none;
        }
    }

    async addRosterContact(jid: string): Promise<void> {
        await this.authorizePresenceSubscription(jid);
        await this.sendAddToRoster(jid);
        await this.sendSubscribeToPresence(jid);
    }

    private async sendAddToRoster(jid: string) {
        return await this.chatService.chatConnectionService
            .$iq({type: 'set'})
            .c('query', {xmlns: this.nameSpace})
            .c('item', {jid})
            .send();
    }

    private async sendSubscribeToPresence(jid: string) {
        await this.chatService.chatConnectionService
            .$pres({to: jid, type: 'subscribe'})
            .send();
    }

    async removeRosterContact(jid: string): Promise<void> {
        const contact = this.chatService.getContactByIdSync(jid);
        if (contact) {
            contact.subscription$.next(ContactSubscription.none);
            contact.pendingOut$.next(false);
            contact.pendingIn$.next(false);
            await this.sendRemoveFromRoster(jid);
            await this.sendWithdrawPresenceSubscription(jid);
        }
    }

    private async sendRemoveFromRoster(jid: string) {
        await this.chatService.chatConnectionService
            .$iq({type: 'set'})
            .c('query', {xmlns: this.nameSpace})
            .c('item', {jid, subscription: 'remove'})
            .send();
    }

    private async sendWithdrawPresenceSubscription(jid: string) {
        await this.chatService.chatConnectionService
            .$pres({to: jid, type: 'unsubscribed'})
            .send();
    }

    /**
     * Upon receiving the presence stanza of type "subscribed",
     * the user SHOULD acknowledge receipt of that subscription
     * state notification by sending a presence stanza of type
     * "subscribe" to the contact
     * @param jid - The Jabber ID of the user to whom one is subscribing
     */
    private async sendAcknowledgeSubscribe(jid: string) {
        await this.chatService.chatConnectionService
            .$pres({to: jid, type: 'subscribe'})
            .send();
    }

    /**
     * Upon receiving the presence stanza of type "unsubscribed",
     * the user SHOULD acknowledge receipt of that subscription state
     * notification by sending a presence stanza of type "unsubscribe"
     * this step lets the user's server know that it MUST no longer
     * send notification of the subscription state change to the user.
     * @param jid - The Jabber ID of the user who is unsubscribing
     */
    private async sendAcknowledgeUnsubscribe(jid: string) {
        await this.chatService.chatConnectionService
            .$pres({to: jid, type: 'unsubscribe'})
            .send();
    }

    refreshRosterContacts() {
        return this.getRosterContacts();
    }

    private handleOwnPresence(stanza: PresenceStanza, userJid: string, fromJid: string) {
        const resource = this.getResourceFromJid(fromJid);
        const presenceType = stanza.getAttribute('type');
        if (resource && userJid !== fromJid && presenceType !== 'unavailable') {
            // another resource of the current user changed it status.
            const show = stanza.querySelector('show')?.textContent || 'online';
            this.chatService.state$.next(show as ConnectionStates);
        }
        return true;
    }

    private getResourceFromJid(jid: string) {
        const index = jid.indexOf('/');
        if (index === -1) {
            return null;
        }

        return jid.substring(index);
    }

    private handleRosterXPush(elem: Element): boolean {
        const items = Array.from(elem.querySelectorAll('item')).filter(item => item.getAttribute('action') === 'add');
        for (const item of items) {
            this.addContactFromRosterXPushSubject.next(item.getAttribute('jid'));
        }
        return true;
    }
}
