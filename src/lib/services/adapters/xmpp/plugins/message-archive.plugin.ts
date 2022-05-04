import {Subject} from 'rxjs';
import {debounceTime, filter} from 'rxjs/operators';
import {Recipient} from '../../../../core/recipient';
import {Stanza} from '../../../../core/stanza';
import {LogService} from '../service/log.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {MultiUserChatPlugin, nsRSM} from './multi-user-chat/multi-user-chat.plugin';
import {ServiceDiscoveryPlugin} from './service-discovery.plugin';
import {nsPubSubEvent} from './publish-subscribe.plugin';
import {MessagePlugin} from './message.plugin';
import {Form, serializeToSubmitForm} from '../../../../core/form';
import {ChatPlugin} from '../../../../core/plugin';
import {Finder} from '../shared/finder';
import {MUC_SUB_EVENT_TYPE} from './multi-user-chat/muc-sub-event-type';

const nsMAM = 'urn:xmpp:mam:2';

/**
 * https://xmpp.org/extensions/xep-0313.html
 * Message Archive Management
 */
export class MessageArchivePlugin implements ChatPlugin {
    readonly nameSpace = nsMAM;

    private readonly mamMessageReceived$ = new Subject<void>();

    constructor(
        private readonly chatService: XmppChatAdapter,
        private readonly serviceDiscoveryPlugin: ServiceDiscoveryPlugin,
        private readonly multiUserChatPlugin: MultiUserChatPlugin,
        private readonly logService: LogService,
        private readonly messagePlugin: MessagePlugin,
    ) {
        this.chatService.state$
            .pipe(filter(state => state === 'online'))
            .subscribe(async () => await this.requestNewestMessages());

        // emit contacts to refresh contact list after receiving mam messages
        this.mamMessageReceived$
            .pipe(debounceTime(10))
            .subscribe(() => this.chatService.contacts$.next(this.chatService.contacts$.getValue()));
    }

    private async requestNewestMessages(): Promise<void> {
        await this.chatService.chatConnectionService.$iq({type: 'set'})
            .c('query', {xmlns: this.nameSpace})
            .c('set', {xmlns: nsRSM})
            .c('max', {}, '250')
            .up().c('before')
            .send();
    }

    async loadMostRecentUnloadedMessages(recipient: Recipient): Promise<void> {
        // for user-to-user chats no to-attribute is necessary, in case of multi-user-chats it has to be set to the bare room jid
        const to = recipient.recipientType === 'room' ? recipient.jid.toString() : undefined;

        const form: Form = {
            type: 'submit',
            instructions: [],
            fields: [
                {type: 'hidden', variable: 'FORM_TYPE', value: this.nameSpace},
                ...(recipient.recipientType === 'contact'
                    ? [{type: 'jid-single', variable: 'with', value: recipient.jidBare.toString()}] as const
                    : []),
                ...(recipient.oldestMessage
                    ? [{type: 'text-single', variable: 'end', value: recipient.oldestMessage.datetime.toISOString()}] as const
                    : []),
            ],
        };

        await this.chatService.chatConnectionService
            .$iq({type: 'set', to})
            .c('query', {xmlns: this.nameSpace})
            .cCreateMethod(builder => serializeToSubmitForm(builder, form))
            .c('set', {xmlns: nsRSM})
            .c('max', {}, '100')
            .up().c('before').send();
    }

    async loadAllMessages(): Promise<void> {
        let lastMamResponse = await this.chatService.chatConnectionService
            .$iq({type: 'set'})
            .c('query', {xmlns: this.nameSpace})
            .sendAwaitingResponse();

        while (lastMamResponse.querySelector('fin').getAttribute('complete') !== 'true') {
            const lastReceivedMessageId = lastMamResponse.querySelector('fin').querySelector('set').querySelector('last').textContent;
            lastMamResponse = await this.chatService.chatConnectionService
                .$iq({type: 'set'})
                .c('query', {xmlns: this.nameSpace})
                .c('set', {xmlns: nsRSM})
                .c('max', {}, '250')
                .up().c('after', {}, lastReceivedMessageId)
                .sendAwaitingResponse();
        }
    }

    async registerHandler(stanza: Stanza): Promise<boolean> {
        if (this.isMamMessageStanza(stanza)) {
            this.handleMamMessageStanza(stanza);
            return true;
        }
        return false;
    }

    private isMamMessageStanza(stanza: Stanza): boolean {
        const result = stanza.querySelector('result');
        return stanza.tagName === 'message' && result?.getAttribute('xmlns') === this.nameSpace;
    }

    private handleMamMessageStanza(stanza: Stanza): void {
        const forwardedElement = Finder.create(stanza).searchByTag('result').searchByTag('forwarded');
        const messageElement = forwardedElement.searchByTag('message');
        const delayElement = forwardedElement.searchByTag('delay');

        const eventElement = messageElement.searchByTag('event').searchByNamespace(nsPubSubEvent);
        if (messageElement.result.getAttribute('type') == null && eventElement != null) {
            this.handlePubSubEvent(eventElement.result, delayElement.result);
        } else {
            this.handleArchivedMessage(messageElement.result, delayElement.result);
        }
    }

    private handleArchivedMessage(messageElement: Stanza, delayEl: Element): void {
        const type = messageElement.getAttribute('type');
        if (type === 'chat') {
            const messageHandled = this.messagePlugin.registerHandler(messageElement, delayEl);
            if (messageHandled) {
                this.mamMessageReceived$.next();
            }
        } else if (type === 'groupchat' || this.multiUserChatPlugin.isRoomInvitationStanza(messageElement)) {
            throw new Error('NOT IMPLEMENTED');
            // this.multiUserChatPlugin.registerHandler(messageElement);
        } else {
            throw new Error(`unknown archived message type: ${type}`);
        }
    }

    private handlePubSubEvent(eventElement: Element, delayElement: Element): void {
        const itemsElement = eventElement.querySelector('items');
        const itemsNode = itemsElement?.getAttribute('node');

        if (itemsNode !== MUC_SUB_EVENT_TYPE.messages) {
            this.logService.warn(`Handling of MUC/Sub message types other than ${MUC_SUB_EVENT_TYPE.messages} isn't implemented yet!`);
            return;
        }

        const itemElements = Array.from(itemsElement.querySelectorAll('item'));
        itemElements.forEach((itemEl) => this.handleArchivedMessage(itemEl.querySelector('message'), delayElement));
    }
}
