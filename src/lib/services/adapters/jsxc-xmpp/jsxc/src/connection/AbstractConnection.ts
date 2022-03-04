import Message from '../Message';
import JID from '../JID';
import * as NS from './xmpp/namespace';
import Log from '../util/Log';
import Account from '../Account';
import PEPService from './services/PEP';
import SearchService from './services/Search';
import PubSubService from './services/PubSub';
import MUCService from './services/MUC';
import RosterService from './services/Roster';
import VcardService from './services/Vcard';
import DiscoService from './services/Disco';
import AbstractService, {AbstractServiceConstructor} from './services/AbstractService';
import {IConnection} from './Connection.interface';

export const STANZA_KEY = 'stanza';
export const STANZA_IQ_KEY = 'stanzaIQ';
export const STANZA_JINGLE_KEY = 'stanzaJingle';

enum Presence {
    online,
    chat,
    away,
    xa,
    dnd,
    offline,
}

enum ServiceType {
    PubSub,
    PEP,
    Search,
    MUC,
    Roster,
    Vcard,
    Disco,
}

// tslint:disable:unified-signatures
type ExtensivePresence = { presence: Presence; status: string };

abstract class AbstractConnection implements IConnection {

    protected constructor(protected account: Account) {
        const discoInfo = this.account.getDiscoInfo();

        discoInfo.addIdentity('client', 'web', 'JSXC');

        NS.register('VCARD', 'vcard-temp');
        NS.register('FORWARD', 'urn:xmpp:forward:0');
    }

    protected abstract connection;

    protected jingleHandler;

    protected node = 'https://jsxc.org';

    protected services: Map<ServiceType, AbstractService> = new Map<ServiceType, AbstractService>();

    protected abstract send(stanzaElement: Element);
    protected abstract send(stanzaElement: Strophe.Builder);

    protected abstract sendIQ(stanzaElement: Element): Promise<Element>;
    protected abstract sendIQ(stanzaElement: Strophe.Builder): Promise<Element>;

    public abstract registerHandler(
        handler: (stanza: string) => boolean,
        ns?: string,
        name?: string,
        type?: string,
        id?: string,
        from?: string
    );

    public abstract get getJingleHandler();

    public get getPubSubService(): PubSubService {
        // @TODO connect? supported?
        return this.getService(ServiceType.PubSub, PubSubService);
    };

    public get getPEPService(): PEPService {
        return this.getService(ServiceType.PEP, PEPService);
    };

    public get getSearchService(): SearchService {
        return this.getService(ServiceType.Search, SearchService);
    };

    public get getMUCService(): MUCService {
        return this.getService(ServiceType.MUC, MUCService);
    };

    public get getRosterService(): RosterService {
        return this.getService(ServiceType.Roster, RosterService);
    };

    public get getVcardService(): VcardService {
        return this.getService(ServiceType.Vcard, VcardService);
    };

    public get getDiscoService(): DiscoService {
        return this.getService(ServiceType.Roster, DiscoService);
    };

    private getService<TService extends AbstractService>(key: ServiceType, Service: AbstractServiceConstructor<TService>): TService {
        if (this.services.has(key)) {
            return this.services.get(key) as TService;
        }

        const self = this;
        const newService = new Service(
            () => {
                return self.send.apply(self, arguments);
            },
            () => {
                return self.sendIQ.apply(self, arguments);
            },
            this,
            this.account
        );

        this.services.set(key, newService);

        return newService;
    }

    public get getJID(): JID {
        return this.account.getJID();
    }

    public get getServerJID(): JID {
        return new JID('', this.getJID.domain, '');
    }


    public pluginOnlySend(stanzaElement: Element);
    public pluginOnlySend(stanzaElement: Strophe.Builder);
    public pluginOnlySend(stanzaElement) {
        this.send(stanzaElement);
    }

    public pluginOnlySendIQ(stanzaElement: Element): Promise<Element>;
    public pluginOnlySendIQ(stanzaElement: Strophe.Builder): Promise<Element>;
    public pluginOnlySendIQ(stanzaElement) {
        return this.sendIQ(stanzaElement);
    }

    public sendMessage(message: Message) {
        if (message.getDirection() !== Message.DIRECTION.OUT) {
            return;
        }

        const xmlMsg = $msg({
            to: message.getPeer().full,
            type: message.getType(),
            id: message.getAttrId(),
        });

        const htmlMessage = this.getMessage(message, message.getEncryptedHtmlMessage, message.getHtmlMessage);

        if (htmlMessage) {
            xmlMsg
                .c('html', {
                    xmlns: Strophe.NS.XHTML_IM,
                })
                .c('body', {
                    xmlns: Strophe.NS.XHTML,
                });

            for (const node of Array.from(document.createElement(htmlMessage).children)) {
                xmlMsg.cnode(node).up();
            }

            xmlMsg.up().up();
        }

        const plaintextMessage = this.getMessage(
            message,
            message.getEncryptedPlaintextMessage,
            message.getPlaintextMessage
        );

        if (plaintextMessage) {
            xmlMsg.c('body').t(plaintextMessage).up();
        }

        xmlMsg
            .c('origin-id', {
                xmlns: 'urn:xmpp:sid:0',
                id: message.getUid(),
            })
            .up();

        const pipe = this.account.getPipe('preSendMessageStanza');
        pipe
            .run(message, xmlMsg)
            .then(([innerMessage, innerXmlMsg]: [Message, Element]) => {
                if (innerMessage.hasAttachment() && !innerMessage.getAttachment().isProcessed()) {
                    Log.warn('Attachment was not processed');

                    if (!innerMessage.getErrorMessage()) {
                        innerMessage.setErrorMessage('Attachment was not processed');
                    }

                    if (!innerMessage.getPlaintextMessage()) {
                        innerMessage.aborted();

                        return;
                    }
                }

                this.send(innerXmlMsg);

                innerMessage.transferred();
            })
            .catch(err => {
                message.aborted();

                Log.warn('Error during preSendMessageStanza pipe:', err);
            });
    }

    private getMessage(message: Message, getEncryptedMessage: () => string, getMessage: () => string): string {
        if (message.isEncrypted() && getEncryptedMessage.call(message)) {
            return getEncryptedMessage.call(message);
        } else if (getMessage.call(message)) {
            if (!message.isEncrypted()) {
                return getMessage.call(message);
            }

            Log.warn('This message should be encrypted');
        }
        return null;
    }

    public async sendPresence(presence?: Presence, statusText?: string) {
        const presenceStanza = $pres();

        presenceStanza.c('c', this.generateCapsAttributes()).up();

        if (typeof presence !== 'undefined' && presence !== Presence.online) {
            presenceStanza.c('show').t(Presence[presence]).up();
        }

        if (statusText) {
            presenceStanza.c('status').t(statusText).up();
        }

        let avatarHash = '';

        try {
            const avatar = await this.account.getContact().getAvatar();

            avatarHash = avatar.getHash();
        } catch (err) {
            // we don't have an avatar
        }

        presenceStanza.c('x', {xmlns: 'vcard-temp:x:update'}).c('photo').t(avatarHash).up().up();

        Log.debug('Send presence', presenceStanza.toString());

        this.send(presenceStanza);
    }

    public queryArchive(
        archive: JID,
        version: string,
        queryId: string,
        contact?: JID,
        beforeResultId?: string,
        end?: Date,
        max = '20'
    ): Promise<Element> {
        const iq = $iq({
            type: 'set',
            to: archive.bare,
        });

        iq.c('query', {
            xmlns: version,
            queryid: queryId,
        });

        iq.c('x', {
            xmlns: 'jabber:x:data',
            type: 'submit',
        });

        iq.c('field', {
            var: 'FORM_TYPE',
            type: 'hidden',
        })
            .c('value')
            .t(version)
            .up()
            .up();

        if (contact) {
            iq.c('field', {
                var: 'with',
            })
                .c('value')
                .t(contact.bare)
                .up()
                .up();
        }

        if (end) {
            iq.c('field', {
                var: 'end',
            })
                .c('value')
                .t(end.toISOString())
                .up()
                .up();
        }

        iq.up()
            .c('set', {
                xmlns: 'http://jabber.org/protocol/rsm',
            })
            .c('max')
            .t(max)
            .up();

        if (typeof beforeResultId === 'string' || typeof beforeResultId === 'number') {
            iq.c('before').t(beforeResultId);
        }

        iq.up();

        return this.sendIQ(iq);
    }

    public changePassword(newPassword: string): Promise<Element> {
        const iq = $iq({
            type: 'set',
        });

        iq.c('query', {
            xmlns: 'jabber:iq:register',
        });

        iq.c('username').t(this.getJID.node).up();

        iq.c('password').t(newPassword);

        return this.sendIQ(iq);
    }

    protected getStorage() {
        return this.account.getSessionStorage();
    }

    private generateCapsAttributes() {
        return {
            xmlns: NS.get('CAPS'),
            hash: 'sha-1',
            node: this.node,
            ver: this.account.getDiscoInfo().getCapsVersion(),
        };
    }

    close() {
        // @TODO Missing
        throw new Error('There is no closure to seek');
    }
}

export {AbstractConnection, Presence, ExtensivePresence};
// tslint:enable:unified-signatures
