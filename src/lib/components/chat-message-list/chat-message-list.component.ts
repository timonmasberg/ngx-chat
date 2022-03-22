import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    ElementRef,
    Inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    QueryList,
    SimpleChanges,
    ViewChild,
    ViewChildren,
} from '@angular/core';
import {Observable, Subject} from 'rxjs';
import {debounceTime, filter, takeUntil} from 'rxjs/operators';
import {Direction, Message} from '../../core/message';
import {Recipient} from '../../core/recipient';
import {ChatMessageListRegistryService} from '../../services/components/chat-message-list-registry.service';
import {CHAT_SERVICE_TOKEN, ChatService} from '../../services/chat-service';
import {ContactFactoryService} from '../../services/adapters/contact-factory.service';
import {ChatMessageComponent} from '../chat-message/chat-message.component';
import {RoomMessage} from '../../services/adapters/xmpp/plugins/multi-user-chat/room-message';
import {Contact, Invitation} from '../../core/contact';

@Component({
    selector: 'ngx-chat-message-list',
    templateUrl: './chat-message-list.component.html',
    styleUrls: ['./chat-message-list.component.less'],
})
export class ChatMessageListComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit {

    @Input()
    recipient: Recipient;

    @Input()
    showAvatars: boolean;

    @ViewChild('messageArea')
    chatMessageAreaElement: ElementRef<HTMLElement>;

    @ViewChildren(ChatMessageComponent)
    chatMessageViewChildrenList: QueryList<ChatMessageComponent>;

    Direction = Direction;
    onTop$ = new Subject<IntersectionObserverEntry>();

    private ngDestroy = new Subject<void>();
    private isAtBottom = true;
    private bottomLeftAt = 0;
    private oldestVisibleMessageBeforeLoading: Message = null;
    private pendingRoomInvite: Invitation | null = null;

    get recipientAsContact(): Contact {
        return this.recipient as Contact;
    }

    constructor(
        @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
        private chatMessageListRegistry: ChatMessageListRegistryService,
        private changeDetectorRef: ChangeDetectorRef,
        private contactFactory: ContactFactoryService,
    ) {
    }

    async ngOnInit() {
        this.onTop$
            .pipe(filter(event => event.isIntersecting), debounceTime(1000))
            .subscribe(() => this.loadOlderMessagesBeforeViewport());

        if (this.recipient.recipientType === 'contact') {
            this.recipient.pendingRoomInvite$
                .pipe(
                    filter(invite => invite != null),
                    takeUntil(this.ngDestroy),
                )
                .subscribe((invite) => this.pendingRoomInvite = invite);
        }

        this.chatMessageListRegistry.incrementOpenWindowCount(this.recipient);
    }

    async ngAfterViewInit() {
        this.chatMessageViewChildrenList.changes
            .subscribe(() => {
                if (this.oldestVisibleMessageBeforeLoading) {
                    this.scrollToMessage(this.oldestVisibleMessageBeforeLoading);
                }
                this.oldestVisibleMessageBeforeLoading = null;
            });

        const messages$: Observable<Message> = this.recipient.messages$;
        messages$
            .pipe(
                debounceTime(10),
                filter(() => this.isNearBottom()),
                takeUntil(this.ngDestroy),
            )
            .subscribe((_) => this.scheduleScrollToLastMessage());

        if (this.recipient.messages.length < 10) {
            await this.loadMessages(); // in case insufficient old messages are displayed
        }
        this.scheduleScrollToLastMessage();
    }

    ngOnChanges(changes: SimpleChanges): void {
        const contact = changes.contact;

        if (contact && contact.previousValue && contact.currentValue) {
            this.chatMessageListRegistry.decrementOpenWindowCount(contact.previousValue);
            this.chatMessageListRegistry.incrementOpenWindowCount(contact.currentValue);
        }

        if (contact && contact.currentValue) {
            this.scheduleScrollToLastMessage();
        }
    }

    ngOnDestroy(): void {
        this.ngDestroy.next();
        this.chatMessageListRegistry.decrementOpenWindowCount(this.recipient);
    }

    scheduleScrollToLastMessage() {
        setTimeout(() => this.scrollToLastMessage(), 0);
    }

    async loadOlderMessagesBeforeViewport() {
        if (this.isLoadingHistory() || this.isNearBottom()) {
            return;
        }

        try {
            this.oldestVisibleMessageBeforeLoading = this.recipient.oldestMessage;
            await this.loadMessages();
        } catch (e) {
            this.oldestVisibleMessageBeforeLoading = null;
        }
    }

    onBottom(event: IntersectionObserverEntry) {
        this.isAtBottom = event.isIntersecting;

        if (event.isIntersecting) {
            this.isAtBottom = true;
        } else {
            this.isAtBottom = false;
            this.bottomLeftAt = Date.now();
        }
    }

    getOrCreateContactWithFullJid(message: Message | RoomMessage): Contact {
        if (this.recipient.recipientType === 'contact') {
            // this is not a multi user chat, just use recipient as contact
            return this.recipient;
        }

        const roomMessage = message as RoomMessage;

        let matchingContact = this.chatService.contacts$.getValue().find(
            contact => contact.jidFull.equals(roomMessage.from),
        );

        if (!matchingContact) {
            matchingContact = this.contactFactory.createContact(roomMessage.from.toString(), roomMessage.from.resource);
            this.chatService.contacts$.next([matchingContact].concat(this.chatService.contacts$.getValue()));
        }

        return matchingContact;
    }

    showPendingRoomInvite() {
        if (this.recipient.recipientType !== 'contact') {
            return false;
        }
        return this.pendingRoomInvite;
    }

    async acceptRoomInvite(event: MouseEvent) {
        event.preventDefault();
        await this.chatService.joinRoom(this.pendingRoomInvite.roomJid);
        (this.recipient as Contact).pendingRoomInvite$.next(null);
        this.pendingRoomInvite = null;
    }

    async declineRoomInvite(event: MouseEvent) {
        event.preventDefault();
        await this.chatService.declineRoomInvite(this.pendingRoomInvite.roomJid);
        (this.recipient as Contact).pendingRoomInvite$.next(null);
        this.pendingRoomInvite = null;
        this.chatService.removeContact(this.recipient.jidBare.toString());
    }

    private scrollToLastMessage() {
        if (this.chatMessageAreaElement) {
            this.chatMessageAreaElement.nativeElement.scrollTop = this.chatMessageAreaElement.nativeElement.scrollHeight;
            this.isAtBottom = true; // in some browsers the intersection observer does not emit when scrolling programmatically
        }
    }

    private scrollToMessage(message: Message) {
        if (this.chatMessageAreaElement) {
            const htmlIdAttribute = 'message-' + message.id;
            const messageElement = document.getElementById(htmlIdAttribute);
            messageElement.scrollIntoView(false);
        }
    }

    private async loadMessages() {
        try {
            // improve performance when loading lots of old messages
            this.changeDetectorRef.detach();
            await this.chatService.loadMostRecentUnloadedMessages(this.recipient);
        } finally {
            this.changeDetectorRef.reattach();
        }
    }

    private isNearBottom() {
        return this.isAtBottom || Date.now() - this.bottomLeftAt < 1000;
    }

    private isLoadingHistory(): boolean {
        return !!this.oldestVisibleMessageBeforeLoading;
    }
}
