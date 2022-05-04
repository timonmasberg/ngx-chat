import {TestBed} from '@angular/core/testing';
import {Client} from '@xmpp/client';
import {testLogService} from '../../../../test/log-service';
import {MockChatConnectionFactory, MockConnectionService} from '../../../../test/mock-connection.service';
import {ContactFactoryService} from '../service/contact-factory.service';
import {LogService} from '../service/log.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {CHAT_CONNECTION_FACTORY_TOKEN, ChatConnection} from '../interface/chat-connection';
import {ServiceDiscoveryPlugin} from './service-discovery.plugin';
import {CHAT_SERVICE_TOKEN} from '../interface/chat.service';

describe('service discovery plugin', () => {

    let chatAdapter: XmppChatAdapter;
    let serviceDiscoveryPlugin: ServiceDiscoveryPlugin;
    let xmppClientMock: jasmine.SpyObj<Client>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                {provide: CHAT_CONNECTION_FACTORY_TOKEN, use: MockChatConnectionFactory},
                {provide: CHAT_SERVICE_TOKEN, use: XmppChatAdapter},
                {provide: LogService, useValue: testLogService()},
                ContactFactoryService
            ]
        });

        // chatConnectionService.client = xmppClientMock;
        // chatConnectionService.userJid = parseJid('me', 'jabber.example.com', 'something');

        chatAdapter = TestBed.inject(XmppChatAdapter);
    });

    it('should discover the multi user chat service', async () => {
        let infoCallCounter = 0;
        // given
        xmppClientMock.send.and.callFake((content) => {
            if (content.attrs.to === 'jabber.example.com'
                && content.getChild('query').attrs.xmlns === 'http://jabber.org/protocol/disco#items') {

                /* chatConnectionService.onStanzaReceived(
                    xml('iq', {type: 'result', id: content.attrs.id},
                        xml('query', {xmlns: 'http://jabber.org/protocol/disco#items'},
                            xml('item', {jid: 'conference.jabber.example.com'}),
                            xml('item', {jid: 'conference.jabber.example.com'}),
                            xml('item', {jid: 'conference.jabber.example.com'}),
                            xml('item', {jid: 'conference.jabber.example.com'}),
                        )
                    ) as Stanza
                ); */
            } else if (content.getChild('query') && content.getChild('query').attrs.xmlns === 'http://jabber.org/protocol/disco#info') {
                infoCallCounter++;
                if (content.attrs.to === 'conference.jabber.example.com') {
                    /* chatConnectionService.onStanzaReceived(
                        xml('iq', {type: 'result', id: content.attrs.id, from: content.attrs.to},
                            xml('query', {xmlns: 'http://jabber.org/protocol/disco#info'},
                                xml('identity', {type: 'text', category: 'conference'})
                            )
                        ) as Stanza
                    ); */
                } else {
                    /* chatConnectionService.onStanzaReceived(
                        xml('iq', {type: 'result', id: content.attrs.id, from: content.attrs.to},
                            xml('query', {xmlns: 'http://jabber.org/protocol/disco#info'},
                                xml('identity', {type: 'type', category: 'category'})
                            )
                        ) as Stanza
                    ); */
                }
            } else {
                fail('unexpected stanza: ' + content.toString());
            }
            return Promise.resolve();
        });

        // when
        await serviceDiscoveryPlugin.onBeforeOnline();
        const service = await serviceDiscoveryPlugin.findService('conference', 'text');

        // then
        expect(service.jid).toEqual('conference.jabber.example.com');
        expect(infoCallCounter).toEqual(2);
    });

});
