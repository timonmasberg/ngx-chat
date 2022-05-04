import {BehaviorSubject, combineLatest, merge, Observable, Subject, Subscription} from 'rxjs';
import {debounceTime, delay, distinctUntilChanged, map, share} from 'rxjs/operators';
import {JidToNumber} from '../interface/chat.service';
import {Direction, Message} from '../../../../core/message';
import {Recipient} from '../../../../core/recipient';
import {findSortedInsertionIndexLast} from '../../../../core/utils-array';
import {ChatMessageListRegistryService} from '../../../components/chat-message-list-registry.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {EntityTimePlugin} from '../plugins/entity-time.plugin';
import {MultiUserChatPlugin} from '../plugins/multi-user-chat/multi-user-chat.plugin';
import {PublishSubscribePlugin} from '../plugins/publish-subscribe.plugin';

const STORAGE_NGX_CHAT_LAST_READ_DATE = 'ngxchat:unreadmessagedate';

type JidToLastReadTimestamp = Map<string, number>;

/**
 * Unofficial plugin using XEP-0163 / PubSub to track count of unread messages per recipient
 *
 * It publishes entries to a private PubSub-Node 'ngxchat:unreadmessagedate'
 * The stored elements look like this:
 * <item id="current">
 *     <entries>
 *         <last-read jid="user1@host1.tld" date="1546419050584"/>
 *         <last-read jid="user2@host1.tld" date="1546419050000"/>
 *     </entries>
 * </item>
 */
export class UnreadMessageCountService {

    /**
     * already debounced to prevent the issues described in {@link UnreadMessageCountService.jidToUnreadCount$}.
     */
    public readonly unreadMessageCountSum$: Observable<number>;
    /**
     * emits as soon as the unread message count changes, you might want to debounce it with e.g. half a a second, as
     * new messages might be acknowledged in another session.
     */
    public readonly jidToUnreadCount$: BehaviorSubject<JidToNumber> = new BehaviorSubject(new Map<string, number>());
    private readonly jidToLastReadTimestamp: JidToLastReadTimestamp = new Map<string, number>();
    private readonly recipientIdToMessageSubscription = new Map<string, Subscription>();

    constructor(
        private chatService: XmppChatAdapter,
        private chatMessageListRegistry: ChatMessageListRegistryService,
        private publishSubscribePlugin: PublishSubscribePlugin,
        private entityTimePlugin: EntityTimePlugin,
        private multiUserChatPlugin: MultiUserChatPlugin,
    ) {

        this.chatMessageListRegistry.chatOpened$
            .pipe(
                delay(0), // prevent 'Expression has changed after it was checked'
            )
            .subscribe(recipient => this.checkForUnreadCountChange(recipient));

        merge(
            multiUserChatPlugin.rooms$,
            this.chatService.contactCreated$.pipe(map(contact => [contact])),
        ).subscribe(recipients => {
            for (const recipient of recipients) {
                const jid = recipient.jidBare.toString();
                if (!this.recipientIdToMessageSubscription.has(jid)) {
                    const messages$: Subject<Message> = recipient.messages$;
                    const updateUnreadCountSubscription = messages$
                        .pipe(debounceTime(20))
                        .subscribe(() => this.checkForUnreadCountChange(recipient));
                    this.recipientIdToMessageSubscription.set(jid, updateUnreadCountSubscription);
                }
            }
        });

        this.publishSubscribePlugin.publish$
            .subscribe((event) => this.handlePubSubEvent(event));

        this.unreadMessageCountSum$ = combineLatest([this.jidToUnreadCount$, this.chatService.blockedContactJids$])
            .pipe(
                debounceTime(20),
                map(([jidToUnreadCount, blockedContactIdSet]) => {
                    let sum = 0;
                    for (const [recipientJid, count] of jidToUnreadCount) {
                        if (!blockedContactIdSet.has(recipientJid)) {
                            sum += count;
                        }
                    }
                    return sum;
                }),
                distinctUntilChanged(),
                share(),
            );
    }

    private async checkForUnreadCountChange(recipient: Recipient) {
        if (this.chatMessageListRegistry.isChatOpen(recipient)) {
            this.jidToLastReadTimestamp.set(recipient.jidBare.toString(), await this.entityTimePlugin.getNow());
            await this.persistLastSeenDates();
        }
        this.updateContactUnreadMessageState(recipient);
    }

    async onBeforeOnline(): Promise<any> {
        const fetchedDates = await this.fetchLastSeenDates();
        this.mergeJidToDates(fetchedDates);
    }

    onOffline() {
        for (const subscription of this.recipientIdToMessageSubscription.values()) {
            subscription.unsubscribe();
        }
        this.recipientIdToMessageSubscription.clear();
        this.jidToLastReadTimestamp.clear();
        this.jidToUnreadCount$.next(new Map<string, number>());
    }

    private async fetchLastSeenDates(): Promise<JidToLastReadTimestamp> {
        const entries = await this.publishSubscribePlugin.retrieveNodeItems(STORAGE_NGX_CHAT_LAST_READ_DATE);
        return this.parseLastSeenDates(entries);
    }

    private parseLastSeenDates(topLevelElements: Element[]): JidToLastReadTimestamp {
        const result: JidToLastReadTimestamp = new Map<string, number>();

        if (topLevelElements.length === 1) {
            const [itemElement] = topLevelElements;
            itemElement
                .querySelector('entries')
                .querySelectorAll('last-read')
                .forEach((lastReadEntry) => {
                    const jid = lastReadEntry.getAttribute('jid');
                    const date = Number.parseInt(lastReadEntry.getAttribute('date'), 10);
                    if (!isNaN(date)) {
                        result.set(jid, date);
                    }
                });
        }

        return result;
    }

    updateContactUnreadMessageState(recipient: Recipient) {
        const contactJid = recipient.jidBare.toString();
        const lastReadDate = this.jidToLastReadTimestamp.get(contactJid) || 0;
        const contactUnreadMessageCount = this.calculateUnreadMessageCount(recipient, lastReadDate);
        const jidToCount = this.jidToUnreadCount$.getValue();
        if (jidToCount.get(contactJid) !== contactUnreadMessageCount) {
            this.jidToUnreadCount$.next(jidToCount.set(contactJid, contactUnreadMessageCount));
        }
    }

    private calculateUnreadMessageCount(recipient: Recipient, lastReadTimestamp: number) {
        const firstUnreadMessageIndex = findSortedInsertionIndexLast(lastReadTimestamp, recipient.messages,
            message => message.datetime.getTime());
        return recipient.messages.slice(firstUnreadMessageIndex)
            .filter(message => message.direction === Direction.in)
            .length;
    }

    private async persistLastSeenDates() {
        await this.publishSubscribePlugin.storePrivatePayloadPersistent(
            STORAGE_NGX_CHAT_LAST_READ_DATE,
            'current',
            (builder) => {
                const wrapperBuilder = builder.c('entries');
                for (const [jid, date] of this.jidToLastReadTimestamp) {
                    wrapperBuilder.c('last-read', {jid, date: date.toString()});
                }
                return wrapperBuilder;
            });
    }

    private handlePubSubEvent(event: Element) {
        const itemsWrapper = event.querySelector('items');
        const itemsNode = itemsWrapper?.getAttribute('node');
        const items = itemsWrapper?.querySelectorAll('item');
        if (itemsNode === STORAGE_NGX_CHAT_LAST_READ_DATE && items) {
            const publishedLastJidToDate = this.parseLastSeenDates(Array.from(items));
            this.mergeJidToDates(publishedLastJidToDate);
        }
    }

    private mergeJidToDates(newJidToDate: JidToLastReadTimestamp) {
        for (const [jid, date] of newJidToDate) {
            const oldLastReadDate = this.jidToLastReadTimestamp.get(jid);
            if (!oldLastReadDate || oldLastReadDate < date) {
                this.jidToLastReadTimestamp.set(jid, date);
            }
        }
    }
}
