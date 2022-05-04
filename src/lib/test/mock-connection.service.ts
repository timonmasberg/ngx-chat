import {ChatConnection, ChatConnectionFactory} from '../services/adapters/xmpp/interface/chat-connection';
import {BehaviorSubject, Subject} from 'rxjs';
import {LogInRequest} from '../core/log-in-request';
import {JID} from '@xmpp/jid';
import {LogService} from '../services/adapters/xmpp/service/log.service';
import {StropheChatConnectionService} from '../services/adapters/xmpp/service/strophe-chat-connection.service';
import {Injectable} from '@angular/core';
import {filter} from 'rxjs/operators';
import {nsDisco, nsDiscoInfo, nsDiscoItems} from '../services/adapters/xmpp/plugins/service-discovery.plugin';

export const mockLoginRequest: LogInRequest = {
    domain: 'montague.lit', password: 'JULIA4EVAR', service: 'https://montague.lit', username: 'romeo'
};

const mockJidResource = 'orchard';
export const mockJid = mockLoginRequest.username + '@' + mockLoginRequest.domain + '/' + mockJidResource;

@Injectable()
export class MockChatConnectionFactory implements ChatConnectionFactory {
    create(logService: LogService, afterReceiveMessageSubject: Subject<Element>, afterSendMessageSubject: Subject<Element>, beforeSendMessageSubject: Subject<Element>, onBeforeOnlineSubject: Subject<string>, onOnlineSubject: Subject<void>, onOfflineSubject: Subject<void>): ChatConnection {
        return new MockConnectionService(
            logService,
            afterReceiveMessageSubject,
            afterSendMessageSubject,
            beforeSendMessageSubject,
            onBeforeOnlineSubject,
            onOnlineSubject,
            onOfflineSubject
        );
    }
}

export class MockConnectionService extends StropheChatConnectionService {

    connection: MockConnection;

    mockDataReceived(elem: Element): void {
        this.connection.dataReceived(elem);
    }

    async logIn({username, service, domain, password} = mockLoginRequest): Promise<void> {
        if (username.indexOf('@') > -1) {
            this.logService.warn('username should not contain domain, only local part, this can lead to errors!');
        }

        console.log('login with mockConnection');
        this.connection = new MockConnection(service, null);
        const jid = username + '@' + domain;
        this.onBeforeOnlineSubject.next(jid);
        return new Promise((resolve, reject) => {
            this.connection.connect(jid, password, (status: Strophe.Status, value: string) => {
                this.logService.info('status update =', status, value ? JSON.stringify(value) : '');
                switch (status) {
                    case Strophe.Status.AUTHENTICATING:
                    case Strophe.Status.REDIRECT:
                    case Strophe.Status.ATTACHED:
                    case Strophe.Status.CONNECTING:
                        break;
                    case Strophe.Status.CONNECTED:
                        this.onOnline(new JID(username, domain));
                        resolve();
                        break;
                    case Strophe.Status.ERROR:
                    case Strophe.Status.CONNFAIL:
                    case Strophe.Status.AUTHFAIL:
                    case Strophe.Status.CONNTIMEOUT:
                        this.state$.next('disconnected');
                        this.onOffline();
                        reject('connection failed with status code: ' + status);
                        break;
                    case Strophe.Status.BINDREQUIRED:
                        this.connection.bind();
                        break;
                    case Strophe.Status.DISCONNECTING:
                    case Strophe.Status.DISCONNECTED:
                        break;
                }
            });
        });
    }
}

export class MockConnection extends Strophe.Connection {

    private afterSendSubject = new BehaviorSubject<{ stanza: Element, id?: string }>(null);
    afterSend$ = this.afterSendSubject.pipe(filter(item => item?.stanza != null));

    sent_stanzas = [];
    IQ_stanzas = [];
    IQ_ids = new Set<string>();
    Presence_stanzas = [];
    Presence_ids = new Set<string>();
    mock = true;

    constructor(service, options) {
        super(service, options);

        this.features = Strophe.xmlHtmlNode(
            '<stream:features xmlns:stream="http://etherx.jabber.org/streams" xmlns="jabber:client">' +
            '<ver xmlns="urn:xmpp:features:rosterver"/>' +
            '<csi xmlns="urn:xmpp:csi:0"/>' +
            '<this xmlns="http://jabber.org/protocol/caps" ver="UwBpfJpEt3IoLYfWma/o/p3FFRo=" hash="sha-1" node="http://prosody.im"/>' +
            '<bind xmlns="urn:ietf:params:xml:ns:xmpp-bind">' +
            '<required/>' +
            '</bind>' +
            `<sm xmlns='urn:xmpp:sm:3'/>` +
            '<session xmlns="urn:ietf:params:xml:ns:xmpp-session">' +
            '<optional/>' +
            '</session>' +
            '</stream:features>').children.item(0);

        (this._proto as any)._processRequest = () => {
        };
        (this._proto as any)._disconnect = () => this._onDisconnectTimeout();
        (this._proto as any)._onDisconnectTimeout = () => {
        };
        (this._proto as any)._connect = (..._args) => {
            this.connected = true;
            this.mock = true;
            this.jid = mockJid;
            this._changeConnectStatus(Strophe.Status.BINDREQUIRED);
        };
        // should be called in bind if following the converse.js example
        this.authenticated = true;
    }

    dataReceived(data: Element) {
        console.log('RECEIVED WAS', data);
        this._dataRecv(this.createRequest(data), null);
    }

    _processRequest() {
        // Don't attempt to send out stanzas
    }

    sendIQ(iq, callback, errback) {
        if (typeof iq.tree === 'function') {
            iq = iq.tree();
        }
        this.IQ_stanzas.push(iq);
        const id = super.sendIQ(iq, callback, errback);
        this.IQ_ids.add(id);

        // Discovery handshake should be handled before beeing connected
        mockDiscoveryProtocolResults(id, iq, this.dataReceived.bind(this));
        return id;
    }

    sendPresence(presence, callback, errback) {
        if (typeof presence.tree === 'function') {
            presence = presence.tree();
        }
        this.Presence_stanzas.push(presence);
        const id = super.sendPresence(presence, callback, errback);
        this.Presence_ids.add(id);
        return id;
    }

    send(stanza) {
        // Send will be also called by sendIQ and sendPresence through the stropheConnection
        if (typeof stanza.tree === 'function') {
            stanza = stanza.tree();
        }
        this.sent_stanzas.push(stanza);
        console.log('SEND STANZA', stanza);
        this.afterSendSubject.next({stanza, id: stanza.getAttribute('id')});
        return super.send(stanza);
    }

    async bind() {
        // necessary to avoid authenticated false set while receiving stanzas
        this.authenticated = true;
        // resolving connect promise
        this._changeConnectStatus(Strophe.Status.CONNECTED);
    }

    private createRequest(stanza: any) {
        if (typeof stanza.tree == 'function') {
            stanza = stanza.tree();
        }
        const req = new Strophe.Request(stanza, () => {
        }, null, null);
        req.getResponse = () => {
            const env = new Strophe.Builder('env', {type: 'mock'}).tree();
            env.appendChild(stanza);
            return env;
        };
        return req;
    }
}

function mockDiscoveryProtocolResults(id: string, iq: Element, dataReceived: (data: Element) => void) {
    const xmlns = iq.querySelector('query').getAttribute('xmlns');

    if (!xmlns.includes(nsDisco)) {
        return;
    }

    const fromJid = (jid: string) => jid?.split('@')?.[1]?.split('/')?.[0];
    const fromDomain = (domain: string) => {
        const split = domain.split('.');

        return split.length > 2 ? split[split.length - 2] + '.' + split[split.length - 1] : domain;
    };

    const from = iq.getAttribute('from');
    const to = iq.getAttribute('to');

    const receiveAsXML = (xml: string) => dataReceived(Strophe.xmlHtmlNode(xml).documentElement);
    const mainNode = fromJid(from) ?? fromJid(to) ?? fromDomain(to) ?? to;
    const conferenceNode = `conference.${mainNode}`;
    const pubsubNode = `pubsub.${mainNode}`;
    const uploadNode = `upload.${mainNode}`;

    if (xmlns.includes(nsDiscoItems)) {
        return receiveAsXML(
            `<iq xmlns='jabber:client' xml:lang='en' to='${from}' from='${to}' type='result' id='${id}'>
                    <query xmlns='${nsDiscoItems}'>
                        <item jid='${conferenceNode}'/>
                        <item jid='${pubsubNode}'/>
                        <item jid='${uploadNode}'/>
                    </query>
                </iq>`
        );
    }

    if (xmlns.includes(nsDiscoInfo) && to === conferenceNode) {
        return receiveAsXML(
            '<iq xmlns=\'jabber:client\' xml:lang=\'en\' to=\'' + mockJid + '\' from=\'' + to + '\' type=\'result\' id=\'' + id + '\'>' +
            '<query xmlns=\'' + nsDiscoInfo + '\'>' +
            '<identity name=\'Chatrooms\' type=\'text\' category=\'conference\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#info\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#items\'/>' +
            '<feature var=\'http://jabber.org/protocol/muc\'/><feature var=\'vcard-temp\'/>' +
            '<feature var=\'urn:xmpp:mucsub:0\'/>' +
            '<feature var=\'http://jabber.org/protocol/muc#unique\'/>' +
            '<feature var=\'jabber:iq:register\'/>' +
            '<feature var=\'http://jabber.org/protocol/rsm\'/>' +
            '<feature var=\'urn:xmpp:mam:tmp\'/>' +
            '<feature var=\'urn:xmpp:mam:0\'/>' +
            '<feature var=\'urn:xmpp:mam:1\'/>' +
            '<feature var=\'urn:xmpp:mam:2\'/>' +
            '<x type=\'result\' xmlns=\'jabber:x:data\'>' +
            '<field var=\'FORM_TYPE\' type=\'hidden\'>' +
            '<value>http://jabber.org/network/serverinfo</value>' +
            '</field>' +
            '</x>' +
            '</query>' +
            '</iq>'
        );
    }

    if (xmlns.includes(nsDiscoInfo) && to === pubsubNode) {
        return receiveAsXML(
            '<iq xmlns=\'jabber:client\' xml:lang=\'en\' to=\'' + mockJid + '\' from=\'' + to + '\' type=\'result\' id=\'' + id + '\'>' +
            '<query xmlns=\'' + nsDiscoInfo + '\'>' +
            '<identity name=\'Publish-Subscribe\' type=\'service\' category=\'pubsub\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#info\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub\'/>' +
            '<feature var=\'http://jabber.org/protocol/commands\'/>' +
            '<feature var=\'vcard-temp\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-authorize\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-open\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-presence\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-whitelist\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#auto-create\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#auto-subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#collections\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#config-node\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#create-and-configure\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#create-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#delete-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#delete-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#filtered-notifications\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#get-pending\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#instant-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#item-ids\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#last-published\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#manage-subscriptions\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#member-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#modify-affiliations\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#multi-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#outcast-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#persistent-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#presence-notifications\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#presence-subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish-only-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish-options\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publisher-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#purge-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retract-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-affiliations\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-default\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-subscriptions\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#shim\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#subscription-notifications\'/>' +
            '<x type=\'result\' xmlns=\'jabber:x:data\'>' +
            '<field var=\'FORM_TYPE\' type=\'hidden\'>' +
            '<value>http://jabber.org/network/serverinfo</value>' +
            '</field>' +
            '</x>' +
            '</query>' +
            '</iq>');
    }

    if (xmlns.includes(nsDiscoInfo) && to === uploadNode) {
        return receiveAsXML(
            '<iq xmlns=\'jabber:client\' xml:lang=\'en\' to=\'' + mockJid + '\' from=\'' + to + '\' type=\'result\' id=\'' + id + '\'>' +
            '<query xmlns=\'' + nsDiscoInfo + '\'>' +
            '<identity name=\'HTTP File Upload\' type=\'file\' category=\'store\'/>' +
            '<feature var=\'urn:xmpp:http:upload\'/>' +
            '<feature var=\'urn:xmpp:http:upload:0\'/>' +
            '<feature var=\'eu:siacs:conversations:http:upload\'/>' +
            '<feature var=\'vcard-temp\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#info\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#items\'/>' +
            '<x type=\'result\' xmlns=\'jabber:x:data\'>' +
            '<field var=\'FORM_TYPE\' type=\'hidden\'>' +
            '<value>urn:xmpp:http:upload</value>' +
            '</field>' +
            '<field var=\'max-file-size\' type=\'text-single\' label=\'Maximum file size\'>' +
            '<value>104857600</value>' +
            '</field>' +
            '</x>' +
            '<x type=\'result\' xmlns=\'jabber:x:data\'>' +
            '<field var=\'FORM_TYPE\' type=\'hidden\'>' +
            '<value>urn:xmpp:http:upload:0</value>' +
            '</field>' +
            '<field var=\'max-file-size\' type=\'text-single\' label=\'Maximum file size\'>' +
            '<value>104857600</value>' +
            '</field>' +
            '</x>' +
            '<x type=\'result\' xmlns=\'jabber:x:data\'>' +
            '<field var=\'FORM_TYPE\' type=\'hidden\'>' +
            '<value>http://jabber.org/network/serverinfo</value>' +
            '</field>' +
            '</x>' +
            '</query>' +
            '</iq>');
    }

    if (xmlns.includes(nsDiscoInfo) && to === mainNode) {
        return receiveAsXML(
            '<iq xmlns=\'jabber:client\' xml:lang=\'en\' to=\'' + mockJid + '\' from=\'' + to + '\' type=\'result\' id=\'' + id + '\'>' +
            '<query xmlns=\'' + nsDiscoInfo + '\'>' +
            '<identity type=\'pep\' category=\'pubsub\'/>' +
            '<identity name=\'ejabberd\' type=\'im\' category=\'server\'/>' +
            '<feature var=\'http://jabber.org/protocol/commands\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#info\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#items\'/>' +
            '<feature var=\'http://jabber.org/protocol/offline\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-authorize\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-open\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-presence\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#access-whitelist\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#auto-create\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#auto-subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#collections\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#config-node\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#create-and-configure\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#create-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#delete-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#delete-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#filtered-notifications\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#get-pending\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#instant-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#item-ids\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#last-published\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#manage-subscriptions\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#member-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#modify-affiliations\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#multi-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#outcast-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#persistent-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#presence-notifications\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#presence-subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish-only-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish-options\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publisher-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#purge-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retract-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-affiliations\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-default\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-subscriptions\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#shim\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#subscription-notifications\'/>' +
            '<feature var=\'http://jabber.org/protocol/stats\'/>' +
            '<feature var=\'iq\'/>' +
            '<feature var=\'jabber:iq:last\'/>' +
            '<feature var=\'jabber:iq:privacy\'/>' +
            '<feature var=\'jabber:iq:register\'/>' +
            '<feature var=\'jabber:iq:version\'/>' +
            '<feature var=\'msgoffline\'/>' +
            '<feature var=\'presence\'/>' +
            '<feature var=\'urn:xmpp:blocking\'/>' +
            '<feature var=\'urn:xmpp:carbons:2\'/>' +
            '<feature var=\'urn:xmpp:carbons:rules:0\'/>' +
            '<feature var=\'urn:xmpp:mam:0\'/>' +
            '<feature var=\'urn:xmpp:mam:1\'/>' +
            '<feature var=\'urn:xmpp:mam:2\'/>' +
            '<feature var=\'urn:xmpp:mam:tmp\'/>' +
            '<feature var=\'urn:xmpp:ping\'/>' +
            '<feature var=\'urn:xmpp:time\'/>' +
            '<feature var=\'vcard-temp\'/>' +
            '<x type=\'result\' xmlns=\'jabber:x:data\'>' +
            '<field var=\'FORM_TYPE\' type=\'hidden\'>' +
            '<value>http://jabber.org/network/serverinfo</value>' +
            '</field>' +
            '</x>' +
            '</query>' +
            '</iq>');
    }

    if (xmlns.includes(nsDiscoInfo) && to && false) {
        return receiveAsXML(
            '<iq xmlns=\'jabber:client\' xml:lang=\'en\' to=\'' + mockJid + '\' from=\'' + to + '\' type=\'result\' id=\'' + id + '\'>' +
            '<query xmlns=\'' + nsDiscoInfo + '\'>' +
            '<identity type=\'pep\' category=\'pubsub\'/>' +
            '<identity type=\'registered\' category=\'account\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#info\'/>' +
            '<feature var=\'http://jabber.org/protocol/disco#items\'/>' +
            '<feature var=\'vcard-temp\'/>' +
            '<feature var=\'urn:xmpp:bookmarks-conversion:0\'/>' +
            '<feature var=\'urn:xmpp:mam:tmp\'/>' +
            '<feature var=\'urn:xmpp:mam:0\'/>' +
            '<feature var=\'urn:xmpp:mam:1\'/>' +
            '<feature var=\'urn:xmpp:mam:2\'/>' +
            '<feature var=\'urn:xmpp:sid:0\'/>' +
            '<feature var=\'msgoffline\'/>' +
            '<feature var=\'http://jabber.org/protocol/offline\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#create-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#auto-create\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#auto-subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#delete-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#delete-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#filtered-notifications\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#modify-affiliations\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#outcast-affiliation\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#persistent-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#publish-options\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#purge-nodes\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retract-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-affiliations\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-items\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#retrieve-subscriptions\'/>' +
            '<feature var=\'http://jabber.org/protocol/pubsub#subscribe\'/>' +
            '<feature var=\'http://jabber.org/protocol/commands\'/>' +
            '</query>' +
            '</iq>');
    }
}
