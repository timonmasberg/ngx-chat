import {Subject} from 'rxjs';
import {Stanza} from '../../../../core/stanza';
import {XmppResponseError} from '../shared/xmpp-response.error';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {Form, serializeToSubmitForm} from '../../../../core/form';
import {Builder} from '../interface/builder';
import {StanzaHandlerChatPlugin} from '../../../../core/plugin';
import {ChatConnection} from '../interface/chat-connection';

export const nsPubSub = 'http://jabber.org/protocol/pubsub';
export const nsPubSubEvent = `${nsPubSub}#event`;
export const nsPubSubOptions = `${nsPubSub}#publish-options`;

/**
 * XEP-0060 Publish Subscribe (https://xmpp.org/extensions/xep-0060.html)
 * XEP-0223 Persistent Storage of Private Data via PubSub (https://xmpp.org/extensions/xep-0223.html)
 */
export class PublishSubscribePlugin implements StanzaHandlerChatPlugin {
    nameSpace = nsPubSubEvent;

    private readonly publishSubject = new Subject<Stanza>();
    readonly publish$ = this.publishSubject.asObservable();

    private publishHandler: object;

    constructor(
        private readonly xmppChatAdapter: XmppChatAdapter,
    ) {
        xmppChatAdapter.onBeforeOnline$.subscribe(async () => this.registerHandler(this.xmppChatAdapter.chatConnectionService));
        xmppChatAdapter.onOffline$.subscribe(async () => this.unregisterHandler(this.xmppChatAdapter.chatConnectionService));
    }

    async registerHandler(connection: ChatConnection): Promise<void> {
        this.publishHandler = connection.addHandler((stanza) => {
            this.publishSubject.next(stanza);
            return true;
        }, {
            ns: nsPubSub,
            name: 'message'
        });
    }

    async unregisterHandler(connection: ChatConnection): Promise<void> {
        connection.deleteHandler(this.publishHandler);
    }

    async storePrivatePayloadPersistent(node: string, id: string, createData: (builder: Builder) => Builder): Promise<Element> {
        return await this.xmppChatAdapter.chatConnectionService
            .$iq()
            .c('pubsub', {xmlns: nsPubSub})
            .c('publish', {node})
            .c('item', {id})
            .cCreateMethod(createData)
            .up().up().up()
            .c('publish-options')
            .cCreateMethod((builder => serializeToSubmitForm(builder, this.getPrivateConfigurationForm(true))))
            .sendAwaitingResponse();
    }

    async privateNotify(node: string, data?: Element, id?: string): Promise<void> {
        return await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set'})
            .c('pubsub', {xmlns: nsPubSub})
            .c('publish', {node})
            .c('item', {id})
            .cNode(data)
            .up().up().up()
            .c('publish-options')
            .cCreateMethod((builder => serializeToSubmitForm(builder, this.getPrivateConfigurationForm())))
            .send();
    }

    async retrieveNodeItems(node: string): Promise<Element[]> {
        try {
            const iqResponseStanza = await this.xmppChatAdapter.chatConnectionService
                .$iq({type: 'get'})
                .c('pubsub', {xmlns: nsPubSub})
                .c('items', {node})
                .sendAwaitingResponse();
            return Array.from(iqResponseStanza.querySelectorAll('items > item'));
        } catch (e) {
            if (e instanceof XmppResponseError &&
                (e.errorCondition === 'item-not-found' || e.errorCode === 404)) {
                return [];
            }

            throw e;
        }
    }

    async getSubscriptions(): Promise<Subscription[]> {
        const service = await this.xmppChatAdapter.plugins.disco.findService('pubsub', 'service');
        const subscriptions = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to: service.jid})
            .c('pubsub', {xmlns: nsPubSub})
            .c('subscriptions')
            .sendAwaitingResponse();
        return Array
            .from(subscriptions.querySelectorAll('subscriptions > subscription'))
            .map((element) => {
                return {
                    node: element.getAttribute('node'),
                    jid: element.getAttribute('jid'),
                    subscription: element.getAttribute('subscription'),
                    subid: element.getAttribute('subid') ?? undefined,
                } as Subscription;
            });
    }

    private getPrivateConfigurationForm(persistent = false): Form {
        return {
            type: 'submit',
            instructions: [],
            fields: [
                {type: 'hidden', variable: 'FORM_TYPE', value: nsPubSubOptions},
                {type: 'boolean', variable: 'pubsub#persist_items', value: persistent},
                {type: 'list-single', variable: 'pubsub#access_model', value: 'whitelist'},
            ]
        };
    }
}

export interface Subscription {
    node: string;
    jid: string;
    subscription: 'subscribed' | 'unconfigured';
    subid?: string;
}
