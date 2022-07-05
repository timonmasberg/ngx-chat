import {TextFieldModule} from '@angular/cdk/text-field';
import {CommonModule} from '@angular/common';
import {HttpClient, HttpClientModule} from '@angular/common/http';
import {ModuleWithProviders, NgModule, NgZone} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ChatAvatarComponent} from './components/chat-avatar/chat-avatar.component';
import {FileDropComponent} from './components/chat-filedrop/file-drop.component';
import {ChatMessageInputComponent} from './components/chat-message-input/chat-message-input.component';
import {ChatMessageLinkComponent} from './components/chat-message-link/chat-message-link.component';
import {ChatMessageListComponent} from './components/chat-message-list/chat-message-list.component';
import {ChatMessageSimpleComponent} from './components/chat-message-simple/chat-message-simple.component';
import {ChatMessageTextComponent} from './components/chat-message-text/chat-message-text.component';
import {ChatMessageComponent} from './components/chat-message/chat-message.component';
import {ChatVideoWindowComponent} from './components/chat-video-window/chat-video-window.component';
import {ChatWindowFrameComponent} from './components/chat-window-frame/chat-window-frame.component';
import {ChatWindowListComponent} from './components/chat-window-list/chat-window-list.component';
import {ChatWindowComponent} from './components/chat-window/chat-window.component';
import {ChatComponent} from './components/chat.component';
import {RosterListComponent} from './components/roster-list/roster-list.component';
import {RosterRecipientComponent} from './components/roster-recipient/roster-recipient.component';
import {IntersectionObserverDirective} from './directives/intersection-observer.directive';
import {LinksDirective} from './directives/links.directive';
import {XmppChatAdapter} from './services/adapters/xmpp-chat-adapter.service';
import {CHAT_CONNECTION_FACTORY_TOKEN, ChatConnectionFactory} from './services/adapters/xmpp/interface/chat-connection';
import {ChatBackgroundNotificationService} from './services/components/chat-background-notification.service';
import {ChatListStateService} from './services/components/chat-list-state.service';
import {ChatMessageListRegistryService} from './services/components/chat-message-list-registry.service';
import {CHAT_SERVICE_TOKEN, ChatService} from './services/adapters/xmpp/interface/chat.service';
import {ContactFactoryService} from './services/adapters/xmpp/service/contact-factory.service';
import {LogService} from './services/adapters/xmpp/service/log.service';
import {FILE_UPLOAD_HANDLER_TOKEN} from './hooks/file-upload-handler';
import {ChatMessageContactComponent} from './components/chat-message-contact/chat-message-contact.component';
import {StropheChatConnectionFactory} from './services/adapters/xmpp/service/strophe-chat-connection.service';

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        HttpClientModule,
        TextFieldModule,
    ],
    declarations: [
        ChatComponent,
        ChatMessageComponent,
        ChatMessageInputComponent,
        ChatMessageLinkComponent,
        ChatMessageContactComponent,
        ChatMessageListComponent,
        ChatMessageSimpleComponent,
        ChatMessageTextComponent,
        ChatWindowComponent,
        ChatWindowListComponent,
        LinksDirective,
        IntersectionObserverDirective,
        RosterListComponent,
        FileDropComponent,
        ChatWindowFrameComponent,
        ChatVideoWindowComponent,
        ChatAvatarComponent,
        RosterRecipientComponent,
    ],
    exports: [
        ChatComponent,
        ChatMessageInputComponent,
        ChatMessageListComponent,
        ChatMessageSimpleComponent,
        FileDropComponent,
        LinksDirective,
    ],
})
export class NgxChatModule {

    static forRoot(): ModuleWithProviders<NgxChatModule> {

        return {
            ngModule: NgxChatModule,
            providers: [
                ChatBackgroundNotificationService,
                ChatListStateService,
                ChatMessageListRegistryService,
                ContactFactoryService,
                LogService,
                {
                    provide: CHAT_CONNECTION_FACTORY_TOKEN,
                    useClass: StropheChatConnectionFactory,
                },
                {
                    provide: CHAT_SERVICE_TOKEN,
                    deps: [
                        CHAT_CONNECTION_FACTORY_TOKEN,
                        ChatMessageListRegistryService,
                        ContactFactoryService,
                        HttpClient,
                        LogService,
                        NgZone,
                    ],
                    useFactory: NgxChatModule.xmppChatAdapter,
                },
                {
                    provide: FILE_UPLOAD_HANDLER_TOKEN,
                    deps: [CHAT_SERVICE_TOKEN],
                    useFactory: NgxChatModule.fileUploadHandlerFactory,
                },
            ],
        };

    }

    private static fileUploadHandlerFactory(chatService: ChatService) {
        return chatService.fileUploadHandler;
    }

    private static xmppChatAdapter(
        chatConnectionFactory: ChatConnectionFactory,
        chatMessageListRegistryService: ChatMessageListRegistryService,
        contactFactory: ContactFactoryService,
        httpClient: HttpClient,
        logService: LogService,
        ngZone: NgZone,
    ): XmppChatAdapter {
        return new XmppChatAdapter(
            logService,
            contactFactory,
            chatConnectionFactory,
            chatMessageListRegistryService,
            ngZone,
            httpClient
        );
    }

}
