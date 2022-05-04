import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {ServiceDiscoveryPlugin} from './service-discovery.plugin';
import {ChatPlugin} from '../../../../core/plugin';
import {first} from 'rxjs/operators';
import {Finder} from '../shared/finder';

export const nsMucSub = 'urn:xmpp:mucsub:0';

/**
 * support for https://docs.ejabberd.im/developer/xmpp-clients-bots/extensions/muc-sub/
 */
export class MucSubPlugin implements ChatPlugin {

    readonly nameSpace = nsMucSub;

    constructor(
        private readonly xmppChatAdapter: XmppChatAdapter,
        private readonly serviceDiscoveryPlugin: ServiceDiscoveryPlugin,
    ) {
    }

    async subscribeRoom(roomJid: string, nodes: string[] = []): Promise<void> {
        const nick = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set', to: roomJid})
            .c('subscribe', {xmlns: this.nameSpace, nick})
            .cCreateMethod((builder) => {
                nodes.map(node => builder.c('event', {node}));
                return builder;
            })
            .send();
    }

    async unsubscribeRoom(roomJid: string): Promise<void> {
        await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set', to: roomJid})
            .c('unsubscribe', {xmlns: this.nameSpace})
            .send();
    }

    /**
     * A room moderator can unsubscribe others providing the their jid as attribute to the information query (iq)
     * see: https://docs.ejabberd.im/developer/xmpp-clients-bots/extensions/muc-sub/#unsubscribing-from-a-muc-room
     * @param roomJid for the room to be unsubscribed from
     * @param jid user id to be unsubscribed
     */
    async unsubscribeJidFromRoom(roomJid: string, jid: string) {
        await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set', to: roomJid})
            .c('unsubscribe', {xmlns: this.nameSpace, jid})
            .send();
    }

    /**
     * A user can query the MUC service to get their list of subscriptions.
     * see: https://docs.ejabberd.im/developer/xmpp-clients-bots/extensions/muc-sub/#g dd ddetting-list-of-subscribed-rooms
     */
    async getSubscribedRooms() {
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const domain = from.split('@')[0];
        const subscriptions = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', from, to: 'muc.' + domain})
            .c('subscriptions', {xmlns: this.nameSpace})
            .sendAwaitingResponse();

        return Finder.create(subscriptions).searchByTag('subscription').results.map(sub => sub.getAttribute('jid'));
    }

    /**
     * A subscriber or room moderator can get the list of subscribers by sending <subscriptions/> request directly to the room JID.
     * see: https://docs.ejabberd.im/developer/xmpp-clients-bots/extensions/muc-sub/#getting-list-of-subscribers-of-a-room
     * @param roomJid of the room the get a subscriber list from
     */
    getSubscribers(roomJid: string) {
        return this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to: roomJid})
            .c('subscriptions', {xmlns: this.nameSpace})
            .sendAwaitingResponse();
    }

    async retrieveSubscriptions(): Promise<Map<string, string[]>> {
        const service = await this.serviceDiscoveryPlugin.findService('conference', 'text');

        const result = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to: service.jid})
            .c('subscriptions', {xmlns: this.nameSpace})
            .sendAwaitingResponse();

        const subscriptions = Finder.create(result)
            .searchByTag('subscriptions').searchByNamespace(this.nameSpace).searchByTag('subscription').results
            ?.map(subscriptionElement => {
                const subscribedEvents: string[] = Finder.create(subscriptionElement).searchByTag('event').results
                    ?.map(eventElement => eventElement.getAttribute('node')) ?? [];
                return [subscriptionElement.getAttribute('jid'), subscribedEvents] as const;
            });

        return new Map(subscriptions);
    }
}
