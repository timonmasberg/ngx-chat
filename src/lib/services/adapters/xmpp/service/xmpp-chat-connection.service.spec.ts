import {TestBed} from '@angular/core/testing';
import {testLogService} from '../../../../test/log-service';
import {LogService} from './log.service';
import {CHAT_CONNECTION_FACTORY_TOKEN, ChatConnection} from '../interface/chat-connection';
import {MockChatConnectionFactory} from '../../../../test/mock-connection.service';
import {CHAT_SERVICE_TOKEN} from '../interface/chat.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';

describe('chat connection service', () => {

    let chatConnection: ChatConnection;
    let chatAdapter: XmppChatAdapter;

    beforeEach(() => {

        TestBed.configureTestingModule({
            providers: [
                {provide: CHAT_CONNECTION_FACTORY_TOKEN, use: MockChatConnectionFactory},
                {provide: CHAT_SERVICE_TOKEN, useClass: XmppChatAdapter},
                {provide: LogService, useValue: testLogService()},
            ],
        });

        chatAdapter = TestBed.inject(XmppChatAdapter);
        chatConnection = chatAdapter.chatConnectionService;
    });

    it('#getNextIqId() should generate new iq ids', () => {
        // expect(chatConnection.getNextRequestId())
            //.not.toEqual(chatConnection.getNextRequestId(), 'two consecutive iq ids should not match');
        expect(false).toBe(true);
    });

});
