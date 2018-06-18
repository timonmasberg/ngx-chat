import { CommonModule } from '@angular/common';
import { ModuleWithProviders, NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { Client } from '@xmpp/client-core';
import bind from '@xmpp/plugins/bind';
import plain from '@xmpp/plugins/sasl-plain';
import sessionEstablishment from '@xmpp/plugins/session-establishment';
import websocket from '@xmpp/plugins/websocket';
import { ChatListComponent } from './components/chat-list/chat-list.component';
import { ChatWindowComponent } from './components/chat-list/chat-window/chat-window.component';
import { ChatComponent } from './components/chat.component';
import { RosterContactComponent } from './components/roster-list/roster-contact/roster-contact.component';
import { RosterListComponent } from './components/roster-list/roster-list.component';
import { LinksDirective } from './directives/links.directive';
import { ChatConnectionService, XmppClientToken } from './services/chat-connection.service';
import { ChatListStateService } from './services/chat-list-state.service';
import { ChatService } from './services/chat.service';
import { LogService } from './services/log.service';


@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        BrowserAnimationsModule,
    ],
    declarations: [
        ChatListComponent,
        ChatWindowComponent,
        ChatComponent,
        RosterListComponent,
        RosterContactComponent,
        LinksDirective,
    ],
    exports: [ChatComponent],
})
export class NgxChatModule {

    static forRoot(): ModuleWithProviders {

        return {
            ngModule: NgxChatModule,
            providers: [
                ChatListStateService,
                LogService,
                {
                    provide: ChatService,
                    deps: [ChatConnectionService, LogService],
                    useFactory: NgxChatModule.chatService
                },
                {
                    provide: ChatConnectionService,
                    deps: [XmppClientToken, LogService],
                    useFactory: NgxChatModule.chatConnectionService
                },
                {
                    provide: XmppClientToken,
                    useFactory: NgxChatModule.client
                },
            ],
        };

    }

    private static chatService(chatConnectionService: ChatConnectionService, logService: LogService) {
        const chatService = new ChatService(chatConnectionService, logService);
        chatService.initialize();
        return chatService;
    }

    private static chatConnectionService(client: Client, logService: LogService) {
        const connectionService = new ChatConnectionService(client, logService);
        connectionService.initialize();
        return connectionService;
    }

    private static client() {
        const client = new Client();
        client.plugin(bind);
        client.plugin(plain);
        client.plugin(sessionEstablishment);
        client.plugin(websocket);
        return client;
    }

}
