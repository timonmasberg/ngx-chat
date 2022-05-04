import {Component, Inject, Input, OnDestroy, OnInit, Optional, Output,} from '@angular/core';
import {combineLatest, Observable, Subject} from 'rxjs';
import {filter, takeUntil} from 'rxjs/operators';
import {Direction} from '../../core/message';
import {ChatListStateService} from '../../services/components/chat-list-state.service';
import {CHAT_SERVICE_TOKEN, ChatService} from '../../services/adapters/xmpp/interface/chat.service';
import {REPORT_USER_INJECTION_TOKEN, ReportUserService} from '../../hooks/report-user-service';
import {Contact} from '../../core/contact';
import {ContactSubscription} from '../../core/subscription';

enum SubscriptionAction {
    PENDING_REQUEST,
    SHOW_BLOCK_ACTIONS,
    // There is no contact request on both sites but only a message
    BLOCK_FOR_UNAFFILIATED,
    NO_PENDING_REQUEST,
}

@Component({
    selector: 'ngx-chat-message-contact',
    templateUrl: './chat-message-contact.component.html',
    styleUrls: ['./chat-message-contact.component.less'],
})
export class ChatMessageContactComponent implements OnInit, OnDestroy {

    // types
    Direction = Direction;
    SubscriptionAction = SubscriptionAction;

    @Input()
    contact: Contact;

    @Input()
    showAvatars: boolean;

    @Output()
    get scheduleScrollToLastMessage$(): Observable<void> {
        return this.scheduleScrollToLastMessageSubject.asObservable();
    }

    private readonly scheduleScrollToLastMessageSubject = new Subject<void>();

    subscriptionAction = SubscriptionAction.NO_PENDING_REQUEST;

    private ngDestroy = new Subject<void>();

    constructor(
        public chatListService: ChatListStateService,
        @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
        @Optional() @Inject(REPORT_USER_INJECTION_TOKEN) public reportUserService: ReportUserService,
    ) {
    }

    async ngOnInit() {
        combineLatest([
            this.contact.pendingIn$,
            this.contact.subscription$
        ]).pipe(takeUntil(this.ngDestroy))
            .subscribe(([pendingIn, subscription]) => {
                if (pendingIn) {
                    this.subscriptionAction = SubscriptionAction.PENDING_REQUEST;
                } else if (subscription === ContactSubscription.none) {
                    this.subscriptionAction = SubscriptionAction.BLOCK_FOR_UNAFFILIATED;
                }
                this.scheduleScrollToLastMessageSubject.next();
            });
    }


    ngOnDestroy(): void {
        this.ngDestroy.next();
    }

    async acceptSubscriptionRequest(event: Event) {
        event.preventDefault();
        if (this.subscriptionAction === SubscriptionAction.PENDING_REQUEST) {
            await this.chatService.addContact(this.contact.jidBare.toString());
            this.subscriptionAction = SubscriptionAction.NO_PENDING_REQUEST;
            this.scheduleScrollToLastMessageSubject.next();
        }
    }

    async denySubscriptionRequest(event: Event) {
        event.preventDefault();
        if (this.subscriptionAction === SubscriptionAction.PENDING_REQUEST) {
            await this.chatService.removeContact(this.contact.jidBare.toString());
            this.subscriptionAction = SubscriptionAction.SHOW_BLOCK_ACTIONS;
            this.scheduleScrollToLastMessageSubject.next();
        }
    }

    blockContact($event: MouseEvent) {
        $event.preventDefault();
        this.chatService.blockJid(this.contact.jidBare.toString());
        this.chatListService.closeChat(this.contact);
        this.subscriptionAction = SubscriptionAction.NO_PENDING_REQUEST;
    }

    blockContactAndReport($event: MouseEvent) {
        $event.preventDefault();
        this.reportUserService.reportUser(this.contact);
        this.blockContact($event);
    }

    dismissBlockOptions($event: MouseEvent) {
        $event.preventDefault();
        this.subscriptionAction = SubscriptionAction.NO_PENDING_REQUEST;
    }

    subscriptionActionShown() {
        const isPendingContactRequest = this.subscriptionAction === SubscriptionAction.PENDING_REQUEST;
        const userWantsToBlock = this.chatService.supportsPlugin.block && this.subscriptionAction === SubscriptionAction.SHOW_BLOCK_ACTIONS;
        const blockAbleUnaffiliated = this.chatService.supportsPlugin.block && this.subscriptionAction === SubscriptionAction.BLOCK_FOR_UNAFFILIATED;
        return isPendingContactRequest || userWantsToBlock || blockAbleUnaffiliated;
    }

    getMessage() {
        const isUnaffiliated = this.subscriptionAction === SubscriptionAction.BLOCK_FOR_UNAFFILIATED;
        const {unaffiliatedMessage, subscriptionRequestMessage} = this.chatService.translations;
        return isUnaffiliated ? unaffiliatedMessage : subscriptionRequestMessage;
    }
}
