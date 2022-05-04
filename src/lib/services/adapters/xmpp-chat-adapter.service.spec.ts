import {TestBed} from '@angular/core/testing';
import {first, take} from 'rxjs/operators';
import {Contact} from '../../core/contact';
import {Direction} from '../../core/message';

import {testLogService} from '../../test/log-service';
import {CHAT_SERVICE_TOKEN} from './xmpp/interface/chat.service';
import {ContactFactoryService} from './xmpp/service/contact-factory.service';
import {LogService} from './xmpp/service/log.service';
import {XmppChatAdapter} from './xmpp-chat-adapter.service';
import {MockChatConnectionFactory, MockConnectionService} from '../../test/mock-connection.service';
import {CHAT_CONNECTION_FACTORY_TOKEN} from './xmpp/interface/chat-connection';

describe('XmppChatAdapter', () => {
    let chatService: XmppChatAdapter;
    let chatConnectionService: MockConnectionService;
    let contactFactory;

    let contact1: Contact;
    let contact2: Contact;
    let contacts: Contact[];

    beforeEach(() => {
        const logService = testLogService();
        TestBed.configureTestingModule({
            providers: [
                {provide: CHAT_CONNECTION_FACTORY_TOKEN, use: MockChatConnectionFactory},
                {provide: CHAT_SERVICE_TOKEN, useClass: XmppChatAdapter},
                {provide: LogService, useValue: logService},
                ContactFactoryService
            ]
        });

        contactFactory = TestBed.inject(ContactFactoryService);
        chatService = TestBed.inject(CHAT_SERVICE_TOKEN) as XmppChatAdapter;

        contact1 = contactFactory.createContact('test@example.com', 'jon doe');
        contact2 = contactFactory.createContact('test2@example.com', 'jane dane');
        contacts = [contact1, contact2];
    });

    describe('contact management', () => {

        it('#getContactById() should ignore resources', async () => {
            chatService.contacts$.next(contacts);
            expect(await chatService.getContactById('test2@example.com/test123')).toEqual(contact2);
        });

        it('#getContactById() should return the correct contact', async () => {
            chatService.contacts$.next(contacts);

            expect(await chatService.getContactById('test@example.com')).toEqual(contact1);

            expect(await chatService.getContactById('test2@example.com')).toEqual(contact2);
        });

        it('#getContactById() should return undefined when no such contact exists', async () => {
            chatService.contacts$.next(contacts);
            expect(await chatService.getContactById('non@existing.com')).toBeUndefined();
        });
    });

    describe('messages', () => {

        it('#messages$ should emit contact on received messages', (done) => {
            chatService.message$.pipe(first()).subscribe(contact => {
                expect(contact.jidBare.toString()).toEqual(contact1.jidBare.toString());
                expect(contact.messages.length).toEqual(1);
                expect(contact.messages[0].body).toEqual('message text');
                expect(contact.messages[0].direction).toEqual(Direction.in);
                done();
            });
            chatConnectionService.mockDataReceived(
                chatConnectionService
                    .$msg({from: contact1.jidBare.toString(), to: chatConnectionService.userJid.toString()})
                    .c('body', {}, 'message text')
                    .tree()
            );
        });

        it('#messages$ should not emit contact on sending messages', async () => {
            return new Promise<void>((resolve) => {
                let emitted = false;
                chatService.message$.pipe(first()).subscribe(() => emitted = true);
                chatService.sendMessage(contact1, 'send message text');
                setTimeout(() => {
                    expect(emitted).toBeFalsy();
                    resolve();
                }, 500);
            });
        });

        it('#messages$ in contact should emit message on received messages', async (done) => {
            const serviceContact = await chatService.getOrCreateContactById(contact1.jidBare.toString());
            serviceContact.messages$.pipe(first()).subscribe(message => {
                expect(message.body).toEqual('message text');
                expect(message.direction).toEqual(Direction.in);
                done();
            });
            chatConnectionService.mockDataReceived(
                chatConnectionService
                    .$msg({from: contact1.jidBare.toString(), to: chatConnectionService.userJid.toString()})
                    .c('body', {}, 'message text')
                    .tree());
        });

        it('#messages$ in contact should emit on sending messages', (done) => {
            contact1.messages$.pipe(first()).subscribe(message => {
                expect(message.direction).toEqual(Direction.out);
                expect(message.body).toEqual('send message text');
                done();
            });
            chatService.sendMessage(contact1, 'send message text');
        });

        it('#messages$ should emit a message with the same id a second time, the message in the contact should only exist once', (done) => {
            let messagesSeen = 0;
            chatService.message$.pipe(take(2)).subscribe(async contact => {
                expect(contact.messages[0].body).toEqual('message text');
                expect(contact.messages[0].direction).toEqual(Direction.in);
                expect(contact.messages[0].id).toEqual('id');
                messagesSeen++;
                if (messagesSeen === 2) {
                    const serviceContact = await chatService.getContactById(contact1.jidBare.toString());
                    expect(serviceContact.messages.length).toEqual(1);
                    done();
                }
            });
            const sampleMessageStanzaWithId = chatConnectionService
                .$msg({from: contact1.jidBare.toString(), to: chatConnectionService.userJid.toString()})
                .c('origin-id', {id: 'id'})
                .c('body', {}, 'message text').tree();
            chatConnectionService.mockDataReceived(sampleMessageStanzaWithId);
            chatConnectionService.mockDataReceived(sampleMessageStanzaWithId);
        });

    });

    describe('states', () => {

        it('should clear contacts when logging out', async () => {
            chatService.chatConnectionService.state$.next('online');
            await chatService.state$.pipe(first(state => state === 'online')).toPromise();
            chatService.contacts$.next([contact1]);
            chatService.chatConnectionService.state$.next('disconnected');
            await chatService.state$.pipe(first(state => state === 'disconnected')).toPromise();
            expect(chatService.contacts$.getValue()).toEqual([]);
        });

    });

});
