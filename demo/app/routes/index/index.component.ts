import { Component, Inject } from '@angular/core';
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

        this.chatService.state$.subscribe((state) => this.stateChanged(state));

        chatBackgroundNotificationService.enable();

        // @ts-ignore
        window.chatService = chatService;
    }

    onLogin() {
        const logInRequest: LogInRequest = {
            domain: this.domain,
            service: this.service,
            password: this.password,
            username: this.username,
        };
        localStorage.setItem('data', JSON.stringify(logInRequest));
        this.chatService.logIn(logInRequest);
    }

    onLogout() {
        this.chatService.logOut();
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
            this.registrationMessage = 'registration successful';
        } catch (e) {
            this.registrationMessage = 'registration failed: ' + e.toString();
            throw e;
        }
    }

    onAddContact() {
        this.chatService.addContact(this.otherJid);
    }

    onRemoveContact() {
        this.chatService.removeContact(this.otherJid);
    }

    async onOpenChat() {
        this.chatListStateService.openChat(await this.chatService.getOrCreateContactById(this.otherJid));
    }

    private async stateChanged(state: 'disconnected' | 'connecting' | 'online') {
        console.log('state changed!', state);
    }

    onReconnect() {
        this.chatService.reconnect();
    }

}
