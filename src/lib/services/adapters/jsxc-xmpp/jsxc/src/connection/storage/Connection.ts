import JID from '../../JID';
import {IConnection} from '../Connection.interface';
import Log from '../../util/Log';
import Account from '../../Account';
import {AbstractConnection, STANZA_IQ_KEY, STANZA_KEY, STANZA_JINGLE_KEY} from '../AbstractConnection';
import JingleHandler from '../JingleHandler';
import {parseXML} from '../../util/Utils';

// tslint:disable:unified-signatures
export default class StorageConnection extends AbstractConnection implements IConnection {
    protected connection: any = {};

    private handlers = [];

    constructor(protected account: Account) {
        super(account);

        this.connection = {
            jid: account.getJID().full,
            send: this.send,
            sendIQ: (elem, success, error) => {
                this.sendIQ(elem).then(success).catch(error);
            },
            addHandler: () => {
            },
        };

        for (const k in (Strophe as unknown as any)._connectionPlugins) {
            if ((Strophe as unknown as any)._connectionPlugins.hasOwnProperty(k)) {
                const ptype = (Strophe as unknown as any)._connectionPlugins[k];
                const F = () => {
                };
                F.prototype = ptype;
                this.connection[k] = new F();
                this.connection[k].init(this.connection);
            }
        }

        this.getStorage().registerHook(STANZA_JINGLE_KEY, this.storageJingleHook);
    }

    public registerHandler(
        handler: (stanza: string) => boolean,
        ns?: string,
        name?: string,
        type?: string,
        id?: string,
        from?: string
    ) {
        this.handlers.push(arguments);
    }

    public getHandlers() {
        return this.handlers;
    }

    public get getJingleHandler() {
        if (!this.jingleHandler) {
            this.jingleHandler = new JingleHandler(this.account, this);
        }

        return this.jingleHandler;
    }

    public getCapabilitiesByJid(jid: JID): any {
        Log.info('[SC] getCapabilitiesByJid');
    }

    public hasFeatureByJid(jid: JID, feature: string);
    public hasFeatureByJid(jid: JID, feature: string[]);
    public hasFeatureByJid() {
        Log.info('[SC] has feature by jid');
    }

    public logout() {
        Log.info('[SC] logout');
    }

    public send(stanzaElement: Element);
    public send(stanzaElement: Strophe.Builder);
    public send() {
        const storage = this.getStorage();
        const stanzaString = this.stanzaElementToString(arguments[0]);
        const key = storage.generateKey(STANZA_KEY, stanzaString.length + '', new Date().getTime() + '');

        storage.setItem(key, stanzaString);
    }

    protected sendIQ(stanzaElement: Element): Promise<Element>;
    protected sendIQ(stanzaElement: Strophe.Builder): Promise<Element>;
    protected sendIQ() {
        const storage = this.getStorage();
        const stanzaString = this.stanzaElementToString(arguments[0]);
        const key = storage.generateKey(STANZA_IQ_KEY, stanzaString.length + '', new Date().getTime() + '');

        storage.setItem(key, stanzaString);

        return new Promise<Element>((resolve, reject) => {
            storage.registerHook(key, (newValue: { type: 'success' | 'error'; stanza: string }) => {
                if (!newValue) {
                    return;
                }

                const stanzaElement = parseXML(newValue.stanza).documentElement;

                if (newValue.type === 'success') {
                    resolve(stanzaElement);
                } else if (newValue.type === 'error') {
                    reject(stanzaElement);
                }
            });
        });
    }

    public close() {
        this.getStorage().removeHook(STANZA_JINGLE_KEY, this.storageJingleHook);
    }

    private stanzaElementToString(stanzaElement: Element): string;
    private stanzaElementToString(stanzaElement: Strophe.Builder): string;
    private stanzaElementToString() {
        let stanzaString: string;
        const stanzaElement = arguments[0] || {};

        if (typeof stanzaElement.outerHTML === 'string') {
            stanzaString = stanzaElement.outerHTML;
        } else {
            stanzaString = stanzaElement.toString();
        }

        return stanzaString;
    }

    private storageJingleHook = (newValue, oldValue, key) => {
        if (newValue && !oldValue) {
            this.processJingleStanza(newValue);
        }
    }

    private processJingleStanza(stanzaString) {
        const iqElement = parseXML(stanzaString).getElementsByTagName('iq')[0];

        this.getJingleHandler().onJingle(iqElement);
    }
}
// tslint:enable:unified-signatures
