import {ChatConnection, ChatConnectionFactory} from '../services/adapters/xmpp/interface/chat-connection';
import {BehaviorSubject, Observable, Subject} from 'rxjs';
import {LogInRequest} from '../core/log-in-request';
import {JID} from '@xmpp/jid';
import {LogService} from '../services/adapters/xmpp/service/log.service';
import {StropheChatConnectionService} from '../services/adapters/xmpp/service/strophe-chat-connection.service';
import {Injectable} from '@angular/core';

@Injectable()
export class MockChatConnectionFactory implements ChatConnectionFactory {
    create(logService: LogService, afterReceiveMessageSubject: Subject<Element>, afterSendMessageSubject: Subject<Element>, beforeSendMessageSubject: Subject<Element>, onBeforeOnlineSubject: Subject<void>, onOfflineSubject: Subject<void>): ChatConnection {
        return new MockConnectionService(
            logService,
            afterReceiveMessageSubject,
            afterSendMessageSubject,
            beforeSendMessageSubject,
            onBeforeOnlineSubject,
            onOfflineSubject
        )
    }
}

export class MockConnectionService extends StropheChatConnectionService {

    mockDataReceived(elem: Element): void {
        (this.connection as any)._dataRecv(elem, null);
    }

    /*** TODO: reuse client for same Domain **/
    async logIn(logInRequest: LogInRequest): Promise<void> {
        if (logInRequest.username.indexOf('@') > -1) {
            this.logService.warn('username should not contain domain, only local part, this can lead to errors!');
        }

        this.connection = new MockConnection(logInRequest.service, null);

        return new Promise((resolve, reject) => {
            const jid = logInRequest.username + '@' + logInRequest.domain;
            this.connection.connect(jid, logInRequest.password, (status: Strophe.Status, value: string) => {
                this.logService.info('status update =', status, value ? JSON.stringify(value) : '');
                switch (status) {
                    case Strophe.Status.AUTHENTICATING:
                    case Strophe.Status.REDIRECT:
                    case Strophe.Status.ATTACHED:
                    case Strophe.Status.CONNECTING:
                        break;
                    case Strophe.Status.CONNECTED:
                        this.onOnline(new JID(logInRequest.username, logInRequest.domain));
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
                    case Strophe.Status.DISCONNECTING:
                    case Strophe.Status.DISCONNECTED:
                        break;
                }
            });
        });
    }
}

export class MockConnection extends Strophe.Connection {

    afterSend$ = new BehaviorSubject<{stanza:Element, id?:string }>(null);

    sent_stanzas = [];
    IQ_stanzas = [];
    IQ_ids = [];
    Presence_stanzas = [];
    Presence_ids = [];
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

        const proto = Object.getPrototypeOf(this);
        proto._processRequest = () => {
        };
        proto._disconnect = () => this._onDisconnectTimeout();
        proto._onDisconnectTimeout = () => {
        };
        proto._connect = () => {
            this.connected = true;
            this.jid = 'romeo@montague.lit/orchard';
            this._changeConnectStatus(Strophe.Status.BINDREQUIRED);
        };
    }

    dataReceived(data: Element) {
        this._dataRecv(data, null);
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
        this.IQ_ids.push(id);
        this.afterSend$.next({stanza: iq, id})
        return id;
    }

    sendPresence(presence, callback, errback) {
        if (typeof presence.tree === 'function') {
            presence = presence.tree();
        }
        this.Presence_stanzas.push(presence);
        const id = super.sendPresence(presence, callback, errback);
        this.afterSend$.next({stanza: presence, id})
        this.Presence_ids.push(id);
        return id;
    }

    send(stanza) {
        if (typeof stanza.tree === 'function') {
            stanza = stanza.tree();
        }
        this.sent_stanzas.push(stanza);
        this.afterSend$.next({stanza})
        return super.send(stanza);
    }

    async bind() {
        this.authenticated = true;
    }
}
