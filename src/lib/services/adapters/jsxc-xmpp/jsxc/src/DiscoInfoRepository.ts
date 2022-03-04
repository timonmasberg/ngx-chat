import Account from './Account';
import DiscoInfo from './DiscoInfo';
import PersistentMap from './util/PersistentMap';
import JID from './JID';
import Contact from './Contact';
import Client from './Client';
import Form from './connection/Form';
import {IDiscoInfoRepository} from './DiscoInfoRepository.interface';
import {IJID} from './JID.interface';
import Log from './util/Log';

// tslint:disable:unified-signatures
export default class implements IDiscoInfoRepository {
    private jidVersionMap: PersistentMap;

    constructor(private account: Account) {
        this.jidVersionMap = new PersistentMap(Client.getStorage(), 'capabilities');
    }

    public addRelation(jid: IJID, version: string): void;
    public addRelation(jid: IJID, discoInfo: DiscoInfo): void;
    public addRelation(jid: IJID, value: string | DiscoInfo) {
        if (value instanceof DiscoInfo) {
            this.jidVersionMap.set(jid.full, value.getCapsVersion());
        } else if (typeof value === 'string') {
            this.jidVersionMap.set(jid.full, value);
        }
    }

    public getDiscoInfo(jid: IJID) {
        const version = this.jidVersionMap.get(jid.full);

        if (!version) {
            throw new Error('Found no disco version');
        }

        return new DiscoInfo(version);
    }

    public getCapableResources(contact: Contact, features: string[]): Promise<string[]>;
    public getCapableResources(contact: Contact, features: string): Promise<string[]>;
    public getCapableResources(contact: Contact, features): Promise<string[]> {
        const resources = contact.getResources();

        if (!features) {
            return Promise.resolve(resources);
        }

        const promises = [];

        for (const resource of resources) {
            // @REVIEW
            promises.push(
                new Promise(resolve => {
                    const jid = new JID(contact.getJid().bare + '/' + resource);

                    this.hasFeature(jid, features).then(hasSupport => {
                        resolve(hasSupport ? resource : undefined);
                    });
                    // @REVIEW do we need a timer?
                })
            );
        }

        return Promise.all(promises).then(capableResources => {
            return capableResources.filter(resource => typeof resource === 'string');
        });
    }

    public hasFeature(jid: IJID, features: string[]): Promise<boolean>;
    public hasFeature(jid: IJID, feature: string): Promise<boolean>;
    public hasFeature(discoInfo: DiscoInfo, features: string[]): Promise<boolean>;
    public hasFeature(discoInfo: DiscoInfo, feature: string): Promise<boolean>;
    public hasFeature() {
        const features = arguments[1] instanceof Array ? arguments[1] : [arguments[1]];
        let capabilitiesPromise;

        if (arguments[0] instanceof JID) {
            const jid: JID = arguments[0];

            capabilitiesPromise = this.getCapabilities(jid);
        } else if (arguments[0] instanceof DiscoInfo) {
            capabilitiesPromise = Promise.resolve(arguments[0]);
        } else if (typeof arguments[0] === 'undefined') {
            const serverJid = this.account.getConnection().getServerJID;

            capabilitiesPromise = this.getCapabilities(serverJid);
        } else {
            return Promise.reject('Wrong parameters');
        }

        return capabilitiesPromise.then((capabilities: DiscoInfo) => {
            return capabilities.hasFeature(features);
        });
    }

    public getCapabilities(jid: IJID): Promise<DiscoInfo | void> {
        const jidVersionMap = this.jidVersionMap;
        const version = jidVersionMap.get(jid.full);

        if (!version || !DiscoInfo.exists(version)) {
            return this.requestDiscoInfo(jid).then(discoInfo => {
                if (version && version !== discoInfo.getCapsVersion()) {
                    Log.warn(
                        `Caps version doesn't match for ${
                            jid.full
                        }. Expected: ${version}. Actual: ${discoInfo.getCapsVersion()}.`
                    );
                } else if (!version) {
                    this.addRelation(jid, discoInfo);
                }

                return discoInfo;
            });
        }

        return new Promise<DiscoInfo>(resolve => {
            checkCaps(resolve);
        });

        function checkCaps(cb) {
            const checkedVersion = jidVersionMap.get(jid.full);

            if (checkedVersion && DiscoInfo.exists(checkedVersion)) {
                cb(new DiscoInfo(checkedVersion));
            } else {
                setTimeout(() => {
                    checkCaps(cb);
                }, 200);
            }
        }
    }

    public requestDiscoInfo(jid: IJID, node?: string) {
        const connection = this.account.getConnection();

        // @REVIEW why does the request fail if we send a node attribute?
        return connection.getDiscoService.getDiscoInfo(jid).then(this.processDiscoInfo);
    }

    private processDiscoInfo(stanza: Element) {
        const queryElement = stanza.querySelector('query');
        // let node = queryElement.attr('node') || '';
        // let from = new JID($(stanza).attr('from'));

        // @TODO verify response is valid: https://xmpp.org/extensions/xep-0115.html#ver-proc

        const capabilities: { [name: string]: any } = {};

        for (const childNode of Array.from(queryElement.firstElementChild.children)) {
            const nodeName = childNode.nodeName.toLowerCase();

            if (typeof capabilities[nodeName] === 'undefined') {
                capabilities[nodeName] = [];
            }

            if (nodeName === 'feature') {
                capabilities[nodeName].push(childNode.getAttribute('var'));
            } else if (nodeName === 'identity') {
                capabilities[nodeName].push({
                    category: childNode.getAttribute('category') ?? '',
                    type: childNode.getAttribute('type') ?? '',
                    name: childNode.getAttribute('name') ?? '',
                    lang: childNode.getAttribute('xml:lang') ?? '',
                });
                // @TODO test required arguments
            }
            // @TODO handle extended information
        }

        if (typeof capabilities.identity === 'undefined' || capabilities.identity.length === 0) {
            return Promise.reject('Disco info response is invalid. Missing identity.');
        }

        const forms = Array.from(queryElement
            .querySelector('x[xmlns="jabber:x:data"]')
            .children)
            .map(element => {
                return Form.fromXML(element);
            });

        // tslint:disable-next-line:max-line-length
        //   if (typeof capabilities['feature'] === 'undefined' || capabilities['feature'].indexOf('http://jabber.org/protocol/disco#info') < 0) {
        //      return Promise.reject('Disco info response is unvalid. Doesnt support disco.');
        //   }

        const discoInfo = new DiscoInfo(capabilities.identity, capabilities.feature, forms);

        return Promise.resolve(discoInfo);
    }
}
// tslint:enable:unified-signatures
