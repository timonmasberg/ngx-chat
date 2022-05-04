import {jid as parseJid} from '@xmpp/client';
import {JID} from '@xmpp/jid';
import {filter, first} from 'rxjs/operators';
import {Direction, Message, MessageState} from '../../../../core/message';
import {MessageWithBodyStanza, Stanza} from '../../../../core/stanza';
import {ChatMessageListRegistryService} from '../../../components/chat-message-list-registry.service';
import {LogService} from '../service/log.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {EntityTimePlugin} from './entity-time.plugin';
import {MessageUuidPlugin} from './message-uuid.plugin';
import {MessageReceivedEvent} from './message.plugin';
import {PublishSubscribePlugin} from './publish-subscribe.plugin';
import {ChatPlugin} from '../../../../core/plugin';
import {Builder} from '../interface/builder';

export interface StateDate {
    lastRecipientReceived: Date;
    lastRecipientSeen: Date;
    lastSent: Date;
}

export type JidToMessageStateDate = Map<string, StateDate>;

const STORAGE_NGX_CHAT_CONTACT_MESSAGE_STATES = 'ngxchat:contactmessagestates';
const wrapperNodeName = 'entries';
const nodeName = 'contact-message-state';

/**
 * Plugin using PubSub to persist message read states.
 * Custom not part of the XMPP Specification
 * Standardized implementation specification would be https://xmpp.org/extensions/xep-0184.html
 */
export class MessageStatePlugin implements ChatPlugin {

    readonly nameSpace = STORAGE_NGX_CHAT_CONTACT_MESSAGE_STATES;

    private jidToMessageStateDate: JidToMessageStateDate = new Map<string, StateDate>();

    constructor(
        private readonly publishSubscribePlugin: PublishSubscribePlugin,
        private readonly xmppChatAdapter: XmppChatAdapter,
        private readonly chatMessageListRegistry: ChatMessageListRegistryService,
        private readonly logService: LogService,
        private readonly entityTimePlugin: EntityTimePlugin,
    ) {
        this.chatMessageListRegistry.openChats$
            .pipe(filter(() => xmppChatAdapter.state$.getValue() === 'online'))
            .subscribe(contacts => {
                contacts.forEach(async contact => {
                    if (contact.mostRecentMessageReceived) {
                        await this.sendMessageStateNotification(
                            contact.jidBare,
                            contact.mostRecentMessageReceived.id,
                            MessageState.RECIPIENT_SEEN);
                    }
                });
            });

        this.publishSubscribePlugin.publish$.pipe(filter((stanza) => stanza.querySelector('items')?.getAttribute('node') === this.nameSpace)).subscribe((stanza) => this.processPubSub(Array.from(stanza?.querySelectorAll('item'))));
    }

    async onBeforeOnline(): Promise<void> {
        this.parseContactMessageStates().catch(err => this.logService.error('error parsing contact message states', err));
    }

    private async parseContactMessageStates(): Promise<void> {
        const itemElements = await this.publishSubscribePlugin.retrieveNodeItems(this.nameSpace);
        this.processPubSub(itemElements);
    }

    private processPubSub(itemElements: Stanza[]): void {
        if (itemElements.length === 1) {
            itemElements[0]
                .querySelector(wrapperNodeName)
                .querySelectorAll(nodeName)
                .forEach((contactMessageStateElement: Stanza) => {
                    const lastRecipientReceived = contactMessageStateElement.getAttribute('lastRecipientReceived');
                    const lastRecipientSeen = contactMessageStateElement.getAttribute('lastRecipientSeen');
                    const lastSent = contactMessageStateElement.getAttribute('lastSent');
                    const jid = contactMessageStateElement.getAttribute('jid');
                    this.jidToMessageStateDate.set(jid, {
                        lastRecipientSeen: new Date(+lastRecipientSeen || 0),
                        lastRecipientReceived: new Date(+lastRecipientReceived || 0),
                        lastSent: new Date(+lastSent || 0),
                    });
                });
        } else {
            this.jidToMessageStateDate.clear();
        }
    }

    private async persistContactMessageStates(): Promise<void> {
        await this.publishSubscribePlugin.storePrivatePayloadPersistent(
            STORAGE_NGX_CHAT_CONTACT_MESSAGE_STATES,
            'current',
            (builder: Builder) =>
                builder
                    .c(wrapperNodeName)
                    .cCreateMethod((childBuilder) => {
                        [...this.jidToMessageStateDate.entries()]
                            .map(([jid, stateDates]) =>
                                childBuilder.c(nodeName, {
                                    jid,
                                    lastRecipientReceived: String(stateDates.lastRecipientReceived.getTime()),
                                    lastRecipientSeen: String(stateDates.lastRecipientSeen.getTime()),
                                    lastSent: String(stateDates.lastSent.getTime()),
                                })
                            );
                        return childBuilder;
                    }));
    }

    onOffline(): void {
        this.jidToMessageStateDate.clear();
    }

    beforeSendMessage(messageStanza: Element, message: Message): void {
        const type = messageStanza.getAttribute('type');
        if (type === 'chat' && message) {
            message.state = MessageState.SENDING;
        }
    }

    async afterSendMessage(message: Message, messageStanza: Element): Promise<void> {
        const type = messageStanza.getAttribute('type');
        const to = messageStanza.getAttribute('to');
        if (type === 'chat') {
            this.updateContactMessageState(
                parseJid(to).bare().toString(),
                MessageState.SENT,
                new Date(await this.entityTimePlugin.getNow()));
            delete message.state;
        }
    }

    afterReceiveMessage(messageReceived: Message, stanza: MessageWithBodyStanza, messageReceivedEvent: MessageReceivedEvent): void {
        const messageStateElement = Array.from(stanza.querySelectorAll('message-state')).find(el => el.getAttribute('xmlns') === this.nameSpace);
        if (messageStateElement) {
            // we received a message state or a message via carbon from another resource, discard it
            messageReceivedEvent.discard = true;
        } else if (messageReceived.direction === Direction.in && !messageReceived.fromArchive && stanza.getAttribute('type') !== 'groupchat') {
            this.acknowledgeReceivedMessage(stanza);
        }
    }

    private acknowledgeReceivedMessage(stanza: MessageWithBodyStanza): void {
        const from = stanza.getAttribute('from');
        const isChatWithContactOpen = this.chatMessageListRegistry.isChatOpen(this.xmppChatAdapter.getOrCreateContactByIdSync(from));
        const state = isChatWithContactOpen ? MessageState.RECIPIENT_SEEN : MessageState.RECIPIENT_RECEIVED;
        const messageId = MessageUuidPlugin.extractIdFromStanza(stanza);
        this.sendMessageStateNotification(parseJid(from), messageId, state).catch(e => this.logService.error('error sending state notification', e));
    }

    private async sendMessageStateNotification(recipient: JID, messageId: string, state: MessageState): Promise<void> {
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        await this.xmppChatAdapter.chatConnectionService
            .$msg({
                to: recipient.bare().toString(),
                from,
                type: 'chat'
            })
            .c('message-state', {
                xmlns: STORAGE_NGX_CHAT_CONTACT_MESSAGE_STATES,
                messageId,
                date: new Date(await this.entityTimePlugin.getNow()).toISOString(),
                state
            })
            .send();
    }

    async registerHandler(stanza: Stanza): Promise<boolean> {
        const type = stanza.getAttribute('type');
        const from = stanza.getAttribute('from');
        const stateElement = Array.from(stanza.querySelectorAll('message-state')).find(el => el.getAttribute('xmlns') === this.nameSpace);
        if (type === 'chat' && stateElement) {
            this.handleStateNotificationStanza(stateElement, from);
            return true;
        }
        return false;
    }

    private handleStateNotificationStanza(stateElement: Element, from: string): void {
        const state = stateElement.getAttribute('state');
        const date = stateElement.getAttribute('date');
        const contact = this.xmppChatAdapter.getOrCreateContactByIdSync(from);
        const stateDate = new Date(date);
        this.updateContactMessageState(contact.jidBare.toString(), state as MessageState, stateDate);
    }

    private updateContactMessageState(contactJid: string, state: MessageState, stateDate: Date): void {
        const current = this.getContactMessageState(contactJid);
        let changed = false;
        if (state === MessageState.RECIPIENT_RECEIVED && current.lastRecipientReceived < stateDate) {
            current.lastRecipientReceived = stateDate;
            changed = true;
        } else if (state === MessageState.RECIPIENT_SEEN && current.lastRecipientSeen < stateDate) {
            current.lastRecipientReceived = stateDate;
            current.lastRecipientSeen = stateDate;
            changed = true;
        } else if (state === MessageState.SENT && current.lastSent < stateDate) {
            current.lastSent = stateDate;
            changed = true;
        }
        if (changed) {
            this.persistContactMessageStates().catch(err => this.logService.error('error persisting contact message states', err));
        }
    }

    public getContactMessageState(contactJid: string): StateDate | undefined {
        if (!this.jidToMessageStateDate.has(contactJid)) {
            this.jidToMessageStateDate.set(
                contactJid,
                {
                    lastRecipientReceived: new Date(0),
                    lastRecipientSeen: new Date(0),
                    lastSent: new Date(0),
                }
            );
        }
        return this.jidToMessageStateDate.get(contactJid);
    }
}
