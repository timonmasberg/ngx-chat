import {TestBed} from '@angular/core/testing';
import {jid as parseJid} from '@xmpp/client';
import {filter, first} from 'rxjs/operators';
import {Direction} from '../../../../../core/message';
import {Stanza} from '../../../../../core/stanza';
import {testLogService} from '../../../../../test/log-service';
import {ContactFactoryService} from '../../service/contact-factory.service';
import {LogService} from '../../service/log.service';
import {XmppResponseError} from '../../shared/xmpp-response.error';
import {XmppChatAdapter} from '../../../xmpp-chat-adapter.service';
import {MultiUserChatPlugin} from './multi-user-chat.plugin';
import {jid} from '@xmpp/jid';
import {Affiliation} from './affiliation';
import {Role} from './role';
import {OccupantNickChange} from './occupant-change';
import {Invitation} from './invitation';
import {nsMuc, nsMucAdmin, nsMucRoomConfigForm, nsMucUser} from './multi-user-chat-constants';
import {nsDiscoInfo} from '../service-discovery.plugin';
import {MockChatConnectionFactory, MockConnection, MockConnectionService} from '../../../../../test/mock-connection.service';
import {Matcher} from '../../shared/matcher';
import {MockBuilder} from '../../strophe-stanza-builder';
import {Finder} from '../../shared/finder';
import {CHAT_CONNECTION_FACTORY_TOKEN} from '../../interface/chat-connection';
import {CHAT_SERVICE_TOKEN, ChatService} from '../../interface/chat.service';

const defaultRoomConfiguration = {
    roomId: 'roomId',
    public: false,
    membersOnly: true,
    nonAnonymous: true,
    persistentRoom: false,
};

fdescribe('multi user chat plugin', () => {

    let mockConnection: MockConnection;
    let chatService: ChatService;
    let multiUserChatPlugin: MultiUserChatPlugin;

    beforeEach(() => {

        TestBed.configureTestingModule({
            providers: [
                {provide: CHAT_CONNECTION_FACTORY_TOKEN, use: MockChatConnectionFactory},
                {provide: CHAT_SERVICE_TOKEN, use: XmppChatAdapter},
                {provide: LogService, useValue: testLogService()},
                ContactFactoryService,
            ],
        });

        chatService = TestBed.inject(CHAT_SERVICE_TOKEN);
        mockConnection = (chatService.chatConnectionService as MockConnectionService).connection;
    });

    describe('room creation', () => {

        it('should throw if user is not allowed to create rooms', async () => {
            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isIQ() && matcher.hasGetAttribute() && matcher.hasChildWithNameSpace('query', nsDiscoInfo)) {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$iq({from: stanza.getAttribute('to'), to: stanza.getAttribute('from'), type: 'error'})
                            .c('error', {by: 'me@example.com', type: 'cancel'})
                            .c('item-not-found', {xmlns: XmppResponseError.ERROR_ELEMENT_NS})
                            .tree()
                    );
                } else if (matcher.isPresence()) {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$pres({
                                id: stanza.getAttribute('id'),
                                from: stanza.getAttribute('to'),
                                to: stanza.getAttribute('from'),
                                type: 'error'
                            })
                            .c('x', {xmlns: nsMucUser, type: 'error'})
                            .c('error', {by: 'me@example.com', type: 'cancel'})
                            .c('not-allowed', {xmlns: XmppResponseError.ERROR_ELEMENT_NS})
                            .up().c('text', {xmlns: XmppResponseError.ERROR_ELEMENT_NS}, `Not allowed for user ${stanza.getAttribute('from')}!`)
                            .tree()
                    );
                } else {
                    throw new Error(`Unexpected stanza: ${stanza.toString()}`);
                }
            });

            try {
                await multiUserChatPlugin.createRoom(defaultRoomConfiguration);
                fail('should have thrown');
            } catch (e) {
                expect(e.message).toContain('Not allowed for user');
            }

        });

        it('should throw if user is not owner', async () => {

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isIQ() && matcher.hasChild('query')) {
                    mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                } else {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$pres({
                                from: stanza.getAttribute('to'),
                                to: stanza.getAttribute('from'),
                                id: stanza.getAttribute('id')
                            })
                            .c('x', {xmlns: nsMucUser})
                            .c('item', {affiliation: Affiliation.none, role: Role.visitor})
                            .tree()
                    );
                }
            });

            try {
                await multiUserChatPlugin.createRoom(defaultRoomConfiguration);
                fail('should have thrown');
            } catch (e) {
                expect(e.message).toContain('error creating room, user is not owner');
            }

        });

        it('should throw if room is not configurable', async () => {

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isPresence()) {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$pres({from: stanza.getAttribute('to'), to: stanza.getAttribute('from'), id: stanza.getAttribute('id')})
                            .c('x', {xmlns: nsMucUser})
                            .c('item', {affiliation: 'owner', role: 'moderator'})
                            .up().c('status', {code: '110'})
                            .up().c('status', {code: '201'})
                            .tree()
                    );
                } else if (matcher.isIQ()) {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$iq({
                                from: stanza.getAttribute('to'),
                                to: stanza.getAttribute('from'),
                                type: 'result',
                                id: stanza.getAttribute('id'),
                            })
                            .c('query', {xmlns: 'http://jabber.org/protocol/muc#owner'})
                            .tree()
                    );
                } else {
                    fail('unexpected stanza: ' + stanza.toString());
                }

            });

            try {
                await multiUserChatPlugin.createRoom(defaultRoomConfiguration);
                fail('should have thrown');
            } catch (e) {
                expect(e.message).toContain('room not configurable');
            }

        });

        it('should handle room configurations correctly', async () => {
            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isPresence()) {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                } else if (matcher.isIQ() && matcher.hasGetAttribute()) {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$iq({
                                from: stanza.getAttribute('to'),
                                to: stanza.getAttribute('from'),
                                type: 'result',
                                id: stanza.getAttribute('id')
                            })
                            .c('query', {xmlns: 'http://jabber.org/protocol/muc#owner'})
                            .c('x', {type: 'form', xmlns: 'jabber:x:data'})
                            .c('field', {var: 'FORM_TYPE', type: 'hidden'})
                            .c('value', {}, 'http://jabber.org/protocol/muc#roomconfig')
                            .tree()
                    );
                } else if (matcher.isIQ() && stanza.getAttribute('type') === 'set') {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$iq({
                                from: stanza.getAttribute('to'),
                                to: stanza.getAttribute('from'),
                                type: 'error',
                                id: stanza.getAttribute('id')
                            })
                            .c('error', {type: 'modify'})
                            .c('not-acceptable', {xmlns: XmppResponseError.ERROR_ELEMENT_NS})
                            .tree()
                    );
                } else {
                    fail('unexpected stanza: ' + stanza.toString());
                }
            });

            try {
                await multiUserChatPlugin.createRoom(defaultRoomConfiguration);
                fail('should be rejected');
            } catch (e) {
                expect(e.message).toContain('field for variable not found!');
            }
        });


        it('should allow users to create and configure rooms', async () => {

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isPresence()) {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                } else if (matcher.isIQ() && matcher.hasGetAttribute()) {
                    mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                } else if (matcher.isIQ() && stanza.getAttribute('type') === 'set') {
                    const finder = Finder.create(stanza);
                    const configurationListElement = finder.searchByTag('query').searchByTag('x').result;
                    expectConfigurationOption(configurationListElement, 'muc#roomconfig_publicroom', 'false');
                    expectConfigurationOption(configurationListElement, 'muc#roomconfig_whois', 'anyone');
                    expectConfigurationOption(configurationListElement, 'muc#roomconfig_membersonly', 'true');
                    expectConfigurationOption(configurationListElement, 'multipleValues', ['value1', 'value2']);
                    mockConnection.dataReceived(
                        MockBuilder.$iq({
                            from: stanza.getAttribute('to'),
                            to: stanza.getAttribute('from'),
                            type: 'result',
                            id: stanza.getAttribute('id'),
                        }).tree(),
                    );
                } else {
                    fail('unexpected stanza: ' + stanza.toString());
                }
            });

            await multiUserChatPlugin.createRoom(defaultRoomConfiguration);

        });
    });

    describe('room message handling', () => {

        it('should be able to receive messages in rooms', async (resolve) => {

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isIQ()) {
                    mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                } else {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                }
            });

            await multiUserChatPlugin.joinRoom(parseJid('chatroom', 'conference.example.com'));

            const rooms = multiUserChatPlugin.rooms$.getValue();
            expect(rooms.length).toEqual(1);

            rooms[0].messages$
                .pipe(first())
                .subscribe((message) => {
                    expect(message.body).toEqual('message content here');
                    resolve();
                });

            const otherOccupant = 'chatroom@conference.example.com/other-occupant';
            mockConnection.dataReceived(
                MockBuilder
                    .$msg({
                        from: otherOccupant,
                        id: '1',
                        to: mockConnection.jid,
                        type: 'groupchat',
                    })
                    .c('body', {}, 'message content here')
                    .tree(),
            );
        });

        it('should be able to send messages', async () => {

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);

                if (matcher.isMessage()) {
                    expect(stanza.getAttribute('from')).toEqual('me@example.com/something');
                    expect(stanza.getAttribute('to')).toEqual('chatroom@conference.example.com');
                    expect(stanza.getAttribute('type')).toEqual('groupchat');
                    expect(stanza.querySelector('body').textContent).toEqual('message body');
                    const finder = Finder.create(stanza);
                    mockConnection.dataReceived(
                        MockBuilder
                            .$msg({
                                from: 'chatroom@conference.example.com/me',
                                to: 'me@example.com/something',
                                type: 'groupchat',
                            })
                            .c('body', {}, 'message body')
                            .c('origin-id', {id: finder.searchByNamespace('origin-id').result.getAttribute('id')})
                            .tree()
                    );
                } else if (matcher.isPresence()) {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                } else if (matcher.isIQ()) {
                    mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                }

            });

            // when
            const myOccupantJid = parseJid('chatroom@conference.example.com/me');
            const room = await multiUserChatPlugin.joinRoom(myOccupantJid);
            await multiUserChatPlugin.sendMessage(room, 'message body');

            // then
            expect(room.messages.length).toEqual(1);
            expect(room.messages[0].body).toEqual('message body');
            expect(room.messages[0].direction).toEqual(Direction.out);
            expect(room.messages[0].id).not.toBeUndefined();
            expect(room.messages[0].from).toEqual(myOccupantJid);

        });

    });

    describe('room operations handling', () => {

        it('should handle kicked occupant and leave room', async (resolve) => {
            const otherOccupantJid = parseJid('chatroom@conference.example.com/other');

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isIQ()) {
                    if (matcher.hasGetAttribute()) {
                        mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                    } else if (matcher.hasSetAttribute()) {
                        mockConnection.dataReceived(
                            MockBuilder
                                .$pres({
                                    from: stanza.getAttribute('to') + '/' + otherOccupantJid.resource,
                                    to: stanza.getAttribute('from'),
                                    type: 'unavailable',
                                })
                                .c('x', {xmlns: nsMucUser})
                                .c('item', {affiliation: 'none', role: 'none'})
                                .c('status', {code: '307'})
                                .up().c('status', {code: '110'})
                                .tree()
                        );
                    }
                } else {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                }
            });

            const room = await multiUserChatPlugin.joinRoom(otherOccupantJid);

            expect(multiUserChatPlugin.rooms$.getValue().length).toEqual(1);

            room.onOccupantChange$.pipe(
                filter(({change}) => change === 'kicked'),
            ).subscribe(({occupant}) => {
                expect(occupant.nick).toEqual(otherOccupantJid.resource);
                expect(occupant.role).toEqual(Role.none);
                expect(occupant.affiliation).toEqual(Affiliation.none);
                expect(multiUserChatPlugin.rooms$.getValue().length).toEqual(0);
                resolve();
            });
            await multiUserChatPlugin.kickOccupant(otherOccupantJid.resource, room.roomJid);
        });

        it('should handle banned occupant', async (resolve) => {
            const otherOccupantJid = parseJid('chatroom@conference.example.com/other');

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isIQ()) {
                    if (matcher.hasGetAttribute() && matcher.hasChildWithNameSpace('query', 'http://jabber.org/protocol/disco#info')) {
                        mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                    } else if (matcher.hasGetAttribute()) {
                        const finder = Finder.create(stanza);
                        const affiliation = finder.searchByTag('query')?.searchByTag('item')?.result.getAttribute('affiliation');
                        if (affiliation && affiliation === Affiliation.member) {
                            mockConnection.dataReceived(
                                MockBuilder
                                    .$iq({
                                        to: stanza.getAttribute('from'),
                                        from: stanza.getAttribute('to'),
                                        id: stanza.getAttribute('id'),
                                        type: 'result',
                                    })
                                    .c('query', {xmlns: nsMucAdmin})
                                    .c('item', {
                                        affiliation: Affiliation.member,
                                        role: Role.participant,
                                        jid: otherOccupantJid.bare().toString(),
                                        nick: otherOccupantJid.resource,
                                    })
                                    .tree()
                            );
                        } else {
                            mockConnection.dataReceived(
                                MockBuilder
                                    .$iq({
                                        to: stanza.getAttribute('from'),
                                        from: stanza.getAttribute('to'),
                                        id: stanza.getAttribute('id'),
                                        type: 'result',
                                    })
                                    .c('query', {xmlns: nsMucAdmin})
                                    .tree()
                            );
                        }
                    } else if (stanza.getAttribute('type') === 'set') {
                        mockConnection.dataReceived(
                            MockBuilder
                                .$pres({
                                    from: stanza.getAttribute('to') + '/' + otherOccupantJid.resource,
                                    to: stanza.getAttribute('from'),
                                    type: 'unavailable',
                                })
                                .c('x', {xmlns: nsMucUser})
                                .c('item', {
                                    affiliation: 'outcast',
                                    role: Role.none,
                                    jid: otherOccupantJid.toString(),
                                })
                                .c('status', {code: '301'})
                                .tree(),
                        );
                    }
                } else if (matcher.isPresence()) {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                }
            });

            const room = await multiUserChatPlugin.joinRoom(otherOccupantJid);

            room.onOccupantChange$.pipe(
                filter(({change}) => change === 'banned'),
            ).subscribe(({occupant}) => {
                expect(occupant.nick).toEqual(otherOccupantJid.resource);
                expect(occupant.role).toEqual(Role.none);
                expect(occupant.affiliation).toEqual(Affiliation.outcast);
                resolve();
            });
            await multiUserChatPlugin.banUser(otherOccupantJid, jid('chatroom@conference.example.com'));
        });

        it('should handle unban occupant', async () => {
            const otherOccupantJid = 'chatroom@conference.example.com/other';
            const roomJid = 'chatroom@conference.example.com';
            let bannedOccupantItem = MockBuilder.build('item', {affiliation: 'outcast', jid: otherOccupantJid}).tree();

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isPresence()) {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$pres({
                                from: stanza.getAttribute('to') + '/other',
                                to: stanza.getAttribute('from'),
                                type: 'unavailable'
                            })
                            .c('x', {xmlns: nsMucUser})
                            .c('item', {
                                affiliation: 'outcast',
                                role: Role.none,
                                jid: otherOccupantJid.toString(),
                            })
                            .c('status', {code: '301'})
                            .tree()
                    );
                } else if (matcher.isIQ()) {
                    if (matcher.hasGetAttribute()) { // get ban list
                        mockConnection.dataReceived(
                            MockBuilder.$iq({
                                from: stanza.getAttribute('to'),
                                to: stanza.getAttribute('from'),
                                type: 'result',
                                id: stanza.getAttribute('id'),
                            }).c('query', {xmlns: nsMucAdmin})
                                .cNode(bannedOccupantItem)
                                .tree()
                        );
                    } else if (stanza.getAttribute('type') === 'set') { // unban
                        mockConnection.dataReceived(
                            MockBuilder
                                .$iq({
                                    from: stanza.getAttribute('to'),
                                    to: stanza.getAttribute('from'),
                                    type: 'result',
                                    id: stanza.getAttribute('id'),
                                })
                                .c('query', {xmlns: nsMucAdmin})
                                .c('item', {affiliation: 'none', jid: otherOccupantJid})
                                .tree()
                        );
                    }
                }
            });

            await multiUserChatPlugin.banUser(jid(otherOccupantJid), jid(roomJid));
            let banList = await multiUserChatPlugin.getBanList(jid(roomJid));
            expect(banList.length).toEqual(1);
            await multiUserChatPlugin.unbanUser(jid(otherOccupantJid), jid(roomJid));
            bannedOccupantItem = null;
            banList = await multiUserChatPlugin.getBanList(jid(roomJid));
            expect(banList.length).toEqual(0);
        });

        it('should be able to invite user', async (resolve) => {
            const myOccupantJid = parseJid('me@example.com/something');
            const otherOccupantJid = parseJid('other@example.com/something');
            const roomJid = parseJid('chatroom@conference.example.com');

            mockConnection.afterSend$.subscribe(({stanza}) => {
                const finder = Finder.create(stanza);
                const inviteEl = finder.searchByTag('x').searchByNamespace(nsMucUser).searchByTag('invite').result;
                expect(stanza.getAttribute('to')).toEqual(roomJid.toString());
                expect(stanza.getAttribute('omfr')).toEqual(myOccupantJid.toString());
                expect(inviteEl.getAttribute('to')).toEqual(otherOccupantJid.toString());

                mockConnection.dataReceived(
                    MockBuilder.$msg({from: stanza.getAttribute('to'), to: inviteEl.getAttribute('to'), id: stanza.getAttribute('id')})
                        .c('x', {xmlns: nsMucUser})
                        .c('invite', {from: stanza.getAttribute('from')})
                        .c('reason', {}, 'reason')
                        .tree()
                );
            });

            multiUserChatPlugin.onInvitation$.subscribe((invitation: Invitation) => {
                expect(invitation.type).toEqual('invite');
                expect(invitation.roomJid).toEqual(roomJid);
                expect(invitation.from).toEqual(myOccupantJid);
                expect(invitation.message).toEqual('reason');
                resolve();
            });
            await multiUserChatPlugin.inviteUser(otherOccupantJid, roomJid);
        });

        it('should be able to change nick', async (resolve) => {
            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.hasChildWithNameSpace('x', nsMuc)) {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                } else if (matcher.isIQ()) {
                    mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                } else {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$pres({from: myOccupantJid.toString(), to: stanza.getAttribute('from'), type: 'unavailable'})
                            .c('x', {xmlns: nsMucUser})
                            .c('item', {
                                nick: 'newNick',
                                jid: myOccupantJid.toString(),
                            })
                            .c('status', {code: '303'}).c('status', {code: '110'}).tree()
                    );
                }
            });

            const myOccupantJid = parseJid('chatroom@conference.example.com/something');
            const room = await multiUserChatPlugin.joinRoom(myOccupantJid);

            room.onOccupantChange$.pipe(
                filter(({change}) => change === 'changedNick'),
            ).subscribe(({occupant, newNick}: OccupantNickChange) => {
                expect(newNick).toEqual('newNick');
                expect(occupant.occupantJid.toString()).toEqual(myOccupantJid.toString());
                resolve();
            });

            await multiUserChatPlugin.changeUserNickname('newNick', room.roomJid);
        });

        it('should be able to change room topic', async () => {
            mockConnection.afterSend$.subscribe(({stanza}) => {
                const matcher = Matcher.create(stanza);
                if (matcher.isIQ()) {
                    mockConnection.dataReceived(mockRoomInfoStanza(stanza));
                } else if (matcher.isPresence()) {
                    mockConnection.dataReceived(mockJoinPresenceStanza(stanza));
                } else if (stanza.nodeName === 'message') {
                    mockConnection.dataReceived(
                        MockBuilder
                            .$msg({
                                from: stanza.getAttribute('to'),
                                to: stanza.getAttribute('from'),
                                id: stanza.getAttribute('id'),
                                type: 'groupchat',
                            })
                            .c('subject', {}, stanza.querySelector('subject').textContent)
                            .tree(),
                    );
                }
            });

            const roomJid = parseJid('chatroom', 'conference.example.com');
            const room = await multiUserChatPlugin.joinRoom(roomJid);

            const newSubject = 'new subject';

            await multiUserChatPlugin.changeRoomSubject(room.roomJid, newSubject);
            expect(multiUserChatPlugin.rooms$.getValue()[0].subject).toEqual(newSubject);
        });
    });

})
;

function mockJoinPresenceStanza(stanza: Stanza) {
    return MockBuilder
        .$pres({from: stanza.getAttribute('to'), to: stanza.getAttribute('from'), id: stanza.getAttribute('id')})
        .c('x', {xmlns: nsMucUser})
        .c('item', {affiliation: 'owner', role: 'moderator'})
        .up().c('status', {code: '110'})
        .tree();
}

function mockRoomInfoStanza(stanza: Stanza) {
    return MockBuilder
        .$iq({
            xmlns: 'jabber:client',
            to: stanza.getAttribute('from'),
            from: stanza.getAttribute('to'),
            type: 'result',
            id: stanza.getAttribute('id'),
        })
        .c('query', {xmlns: 'http://jabber.org/protocol/disco#info'})
        .c('identity', {type: 'text', category: 'conference'})
        .c('x', {type: 'result', xmlns: 'jabber:x:data'})
        .c('field', {
            var: 'FORM_TYPE',
            type: 'hidden',
        })
        .c('value', {}, nsMucRoomConfigForm)
        .up().up().c('field', {var: 'muc#roomconfig_roomname', type: 'text-single'})
        .c('value', {}, 'Room Name')
        .up().up().c('field', {var: 'muc#roominfo_description', type: 'text-single'}).c('value', {}, 'Room Desc')
        .up().up().c('field', {var: 'muc#roomconfig_whois', type: 'list-single'}).c('value', {}, 'moderators')
        .up().up().c('field', {var: 'muc#roomconfig_publicroom', type: 'boolean'}).c('value', {}, 'false')
        .up().up().c('field', {var: 'muc#roomconfig_membersonly', type: 'boolean'}).c('value', {}, 'true')
        .up().up().c('field', {var: 'muc#roomconfig_persistentroom', type: 'boolean'}).c('value', {}, 'true')
        .up().up().c('field', {var: 'multipleValues', type: 'list-multi'})
        .c('value', {}, 'value1')
        .up().c('value', {}, 'value2')
        .tree();
}

function expectConfigurationOption(configurationList: Stanza, configurationKey: string, expected: any) {
    const value = extractConfigurationValue(configurationList, configurationKey);
    expect(value).toEqual(expected);
}

function extractConfigurationValue(configurationList: Stanza, configurationKey: string) {
    const fieldNodes = Finder.create(configurationList).searchByAttribute('var', configurationKey).results;
    expect(fieldNodes.length).toEqual(1);
    const fieldNode = fieldNodes[0];
    const values = Array.from(fieldNode.querySelectorAll('value')).map(node => node.textContent);
    return values.length === 1 ? values[0] : values;
}
