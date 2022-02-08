import {Injectable} from '@angular/core';
import {ChatService, ConnectionStates} from '../../chat-service';
import {BehaviorSubject, Observable} from 'rxjs';
import {ChatAction} from 'src/lib/components/chat-window/chat-window.component';
import {LogInRequest} from 'src/lib/core/log-in-request';
import {Contact} from '../../../core/contact';
import {ChatPlugin} from '../../../core/plugin';
import {Recipient} from '../../../core/recipient';
import {Translations} from 'src/lib/core/translations';
import '@converse/headless';

@Injectable()
export class ConverseXmppChatService implements ChatService {
    message$: Observable<Contact>;
    state$: BehaviorSubject<ConnectionStates>;
    contacts$: BehaviorSubject<Contact[]>;
    blockedContacts$: Observable<Contact[]>;
    notBlockedContacts$: Observable<Contact[]>;
    contactsSubscribed$: Observable<Contact[]>;
    contactRequestsSent$: Observable<Contact[]>;
    contactRequestsReceived$: Observable<Contact[]>;
    contactsUnaffiliated$: Observable<Contact[]>;
    enableDebugging: boolean;
    userAvatar$: BehaviorSubject<string>;
    translations: Translations;
    chatActions: ChatAction[];

    reloadContacts(): void {
        throw new Error('Method not implemented.');
    }

    getContactById(id: string): Contact {
        throw new Error('Method not implemented.');
    }

    getOrCreateContactById(id: string): Contact {
        throw new Error('Method not implemented.');
    }

    addContact(identifier: string): void {
        throw new Error('Method not implemented.');
    }

    removeContact(identifier: string): void {
        throw new Error('Method not implemented.');
    }

    logIn(logInRequest: LogInRequest): void {
        globalThis.converse
    }

    logOut(): void {
        throw new Error('Method not implemented.');
    }

    sendMessage(recipient: Recipient, body: string): void {
        throw new Error('Method not implemented.');
    }

    loadCompleteHistory(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    getPlugin<T extends ChatPlugin>(constructor: new (...args: any[]) => T): T {
        throw new Error('Method not implemented.');
    }

    reconnectSilently(): void {
        throw new Error('Method not implemented.');
    }

    reconnect(): void {
        throw new Error('Method not implemented.');
    }

}
