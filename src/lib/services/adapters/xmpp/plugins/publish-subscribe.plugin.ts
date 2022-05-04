import {Subject} from 'rxjs';
import {Stanza} from '../../../../core/stanza';
import {XmppResponseError} from '../shared/xmpp-response.error';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {serializeToSubmitForm} from '../../../../core/form';
import {Builder} from '../interface/builder';
import {ChatPlugin} from '../../../../core/plugin';

export const nsPubSub = 'http://jabber.org/protocol/pubsub';
export const nsPubSubEvent = `${nsPubSub}#event`;
export const nsPubSubOptions = `${nsPubSub}#publish-options`;

/**
 * XEP-0060 Publish Subscribe (https://xmpp.org/extensions/xep-0060.html)
 * XEP-0223 Persistent Storage of Private Data via PubSub (https://xmpp.org/extensions/xep-0223.html)
 */
export class PublishSubscribePlugin implements ChatPlugin {
    nameSpace = nsPubSubEvent;
    readonly publish$ = new Subject<Stanza>();

    constructor(
        private readonly xmppChatAdapter: XmppChatAdapter,
    ) {
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
            .cCreateMethod((builder =>
                serializeToSubmitForm(builder, {
                    type: 'submit',
                    instructions: [],
                    fields: [
                        {type: 'hidden', variable: 'FORM_TYPE', value: nsPubSubOptions},
                        {type: 'boolean', variable: 'pubsub#persist_items', value: true},
                        {type: 'list-single', variable: 'pubsub#access_model', value: 'whitelist'},
                    ]
                })))
            .sendAwaitingResponse();
    }

    async privateNotify(node: string, data?: Element, id?: string): Promise<void> {
        const builder = this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set'})
            .c('pubsub', {xmlns: nsPubSub})
            .c('publish', {node})
            .c('item', {id})
            .cNode(data)
            .up().up().up()
            .c('publish-options');

        await serializeToSubmitForm(builder, {
            type: 'submit',
            instructions: [],
            fields: [
                {type: 'hidden', variable: 'FORM_TYPE', value: nsPubSubOptions},
                {type: 'boolean', variable: 'pubsub#persist_items', value: false},
                {type: 'list-single', variable: 'pubsub#access_model', value: 'whitelist'},
            ]
        }).send();
    }

    async registerHandler(stanza: Element): Promise<boolean> {
        const eventElement = Array.from(stanza.querySelectorAll('event')).find(el => el.namespaceURI === nsPubSubEvent);
        if (stanza.nodeName === 'message' && eventElement) {
            this.publish$.next(eventElement);
            return true;
        }
        return false;
    }

    async retrieveNodeItems(node: string): Promise<Element[]> {
        try {
            const iqResponseStanza = await this.xmppChatAdapter.chatConnectionService
                .$iq({type: 'get'})
                .c('pubsub', {xmlns: nsPubSub})
                .c('items', {node})
                .sendAwaitingResponse();
            return Array.from(iqResponseStanza
                .querySelector('pubsub')
                .querySelector('items')
                .querySelectorAll('item'));
        } catch (e) {
            if (e instanceof XmppResponseError &&
                (e.errorCondition === 'item-not-found' || e.errorCode === 404)) {
                return [];
            }

            throw e;
        }
    }
}
