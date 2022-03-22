import {Component, Inject} from '@angular/core';
import {
    CHAT_SERVICE_TOKEN,
    ChatBackgroundNotificationService,
    ChatListStateService,
    ChatService,
    ContactFactoryService,
    LogInRequest,
    LogLevel,
    LogService
} from '@pazznetwork/ngx-chat';

@Component({
    selector: 'app-index',
    templateUrl: './index.component.html',
    styleUrls: ['./index.component.css'],
})
export class IndexComponent {

    domain?: string;
    service?: string;
    password?: string;
    username?: string;
    otherJid?: string;
    registrationMessage?: string;

    constructor(
        @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
        private contactFactory: ContactFactoryService,
        private logService: LogService,
        private chatListStateService: ChatListStateService,
        chatBackgroundNotificationService: ChatBackgroundNotificationService,
    ) {
        const contactData: {
            domain?: string;
            service?: string;
            password?: string;
            username?: string;
        } = JSON.parse(localStorage.getItem('data')) || {};
        this.logService.logLevel = LogLevel.Debug;
        this.domain = contactData.domain;
        this.service = contactData.service;
        this.password = contactData.password;
        this.username = contactData.username;

        this.chatService.state$.subscribe((state) => IndexComponent.stateChanged(state));

        chatBackgroundNotificationService.enable();

        // @ts-ignore
        window.chatService = chatService;
    }

    async onLogin() {
        const logInRequest: LogInRequest = {
            domain: this.domain,
            service: this.service,
            password: this.password,
            username: this.username,
        };
        localStorage.setItem('data', JSON.stringify(logInRequest));
        await this.chatService.logIn(logInRequest);
    }

    async onLogout() {
        await this.chatService.logOut();
    }

    async onRegister() {
        this.registrationMessage = 'registering ...';
        try {
            await this.chatService.register({
                    username: this.username,
                    password: this.password,
                    service: this.service,
                    domain: this.domain,
                }
            );
            this.registrationMessage = this.username + ' registration was successful';
        } catch (e) {
            this.registrationMessage = 'registration failed: ' + e.toString();
            throw e;
        }
    }

    async onAddContact() {
        await this.chatService.addContact(this.otherJid);
    }

    async onRemoveContact() {
        await this.chatService.removeContact(this.otherJid);
    }

    async onOpenChat() {
        this.chatListStateService.openChat(await this.chatService.getOrCreateContactById(this.otherJid));
    }

    private static async stateChanged(state: 'disconnected' | 'connecting' | 'online') {
        console.log('state changed!', state);
    }

    async onReconnect() {
        await this.chatService.reconnect();
    }

    async blockContact(): Promise<void> {
        await this.chatService.blockJid(this.otherJid);
    }

    async unblockContact(): Promise<void> {
        await this.chatService.unblockJid(this.otherJid);
    }
}
