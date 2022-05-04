import {HttpClient} from '@angular/common/http';
import {Component, Inject, Input, OnInit, Optional} from '@angular/core';
import {Contact} from '../../core/contact';
import {Direction, Message, MessageState} from '../../core/message';
import {extractUrls} from '../../core/utils-links';
import {XmppChatAdapter} from '../../services/adapters/xmpp-chat-adapter.service';
import {ChatContactClickHandler, CONTACT_CLICK_HANDLER_TOKEN} from '../../hooks/chat-contact-click-handler';
import {CHAT_SERVICE_TOKEN, ChatService} from '../../services/adapters/xmpp/interface/chat.service';

export const MAX_IMAGE_SIZE = 250 * 1024;

@Component({
    selector: 'ngx-chat-message',
    templateUrl: './chat-message.component.html',
    styleUrls: ['./chat-message.component.less'],
})
export class ChatMessageComponent implements OnInit {

    @Input()
    showAvatars: boolean;

    @Input()
    avatar?: string;

    @Input()
    message: Message;

    @Input()
    nick: string;

    @Input()
    contact: Contact;

    @Input()
    showMessageReadState = true;

    showImagePlaceholder = true;
    imageLink: string;

    Direction = Direction;

    constructor(
        @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
        private httpClient: HttpClient,
        @Inject(CONTACT_CLICK_HANDLER_TOKEN) @Optional() public contactClickHandler: ChatContactClickHandler,
    ) {
    }

    ngOnInit() {
        this.tryFindImageLink();
    }

    private tryFindImageLink() {
        if (this.chatService instanceof XmppChatAdapter) {
            const candidateUrls = extractUrls(this.message.body);

            if (candidateUrls.length === 0) {
                this.showImagePlaceholder = false;
                return;
            }

            void this.tryFindEmbedImageUrls(candidateUrls);
        }
    }

    private async tryFindEmbedImageUrls(candidateUrls: RegExpMatchArray) {
        for (const url of candidateUrls) {
            try {
                const headRequest = await this.httpClient.head(url, {observe: 'response'}).toPromise();
                const contentType = headRequest.headers.get('Content-Type');
                const isImage = contentType && contentType.startsWith('image');
                const contentLength = headRequest.headers.get('Content-Length');
                if (isImage && parseInt(contentLength, 10) < MAX_IMAGE_SIZE) {
                    this.imageLink = url;
                    break;
                }
            } catch (e) {
            }
        }

        if (!this.imageLink) {
            this.showImagePlaceholder = false;
        }
    }

    getMessageState(): MessageState {
        if (this.showMessageReadState) {
            if (this.message.state) {
                return this.message.state;
            } else if (this.chatService.supportsPlugin.messageState && this.contact) {
               return this.chatService.getContactMessageState(this.message, this.contact.jidBare.toString());
            }
        }
        return MessageState.HIDDEN;
    }

    onContactClick() {
        if (this.contactClickHandler) {
            this.contactClickHandler.onClick(this.contact);
        }
    }

    getAvatar(): string | undefined {
        if (this.showAvatars) {
            if (this.message.direction === Direction.in) {
                return this.avatar;
            } else {
                return this.chatService.userAvatar$.getValue();
            }
        }
        return undefined;
    }
}
