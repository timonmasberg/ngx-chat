import {BehaviorSubject} from 'rxjs';
import {first} from 'rxjs/operators';
import {XmppChatAdapter} from '../xmpp-chat-adapter.service';
import {AbstractXmppPlugin} from './abstract-xmpp-plugin';
import {ChatPlugin} from '../../../../core/plugin';

export interface IdentityAttrs {
    category: string;
    type: string;
    name?: string;
}

export interface Service {
    jid: string;
    identitiesAttrs: IdentityAttrs[];
    features: string[];
}

/**
 * see XEP-0030 Service Discovery
 */
export class ServiceDiscoveryPlugin implements ChatPlugin {

    public static readonly DISCO_INFO = 'http://jabber.org/protocol/disco#info';
    public static readonly DISCO_ITEMS = 'http://jabber.org/protocol/disco#items';

    private readonly servicesInitialized$ = new BehaviorSubject(false);
    private hostedServices: Service[] = [];
    private readonly resourceCache = new Map<string, Service>();

    constructor(private readonly chatAdapter: XmppChatAdapter) {
        super();
    }

    async onBeforeOnline(): Promise<void> {
        await this.discoverServices(await this.chatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise());
        this.servicesInitialized$.next(true);
    }

    onOffline(): void {
        this.servicesInitialized$.next(false);
        this.hostedServices = [];
        this.resourceCache.clear();
    }

    async supportsFeature(jid: string, searchedFeature: string): Promise<boolean> {

        return new Promise((resolve, reject) => {

            this.servicesInitialized$.pipe(first(value => !!value)).subscribe(async () => {
                try {
                    const service = this.resourceCache.get(jid) || await this.discoverServiceInformation(jid);
                    if (!service) {
                        reject(new Error('no service found for jid ' + jid));
                    }
                    resolve(service.features.includes(searchedFeature));
                } catch (e) {
                    reject(e);
                }
            });

        });

    }

    async findService(category: string, type: string): Promise<Service> {

        return new Promise((resolve, reject) => {

            this.servicesInitialized$.pipe(first(value => !!value)).subscribe(() => {
                const results = this.hostedServices.filter(service =>
                    service.identitiesAttrs.filter(identityAttrs => identityAttrs.category === category
                        && identityAttrs.type === type).length > 0,
                );

                if (results.length === 0) {
                    reject(new Error(`no service matching category ${category} and type ${type} found!`));
                } else if (results.length > 1) {
                    reject(new Error(`multiple services matching category ${category} and type ${type} found! ${JSON.stringify(results)}`));
                } else {
                    return resolve(results[0]);
                }
            });

        });

    }

    private async discoverServices(mainDomain: string): Promise<void> {
        const to = await this.chatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const serviceListResponse = await this.sendDiscoQuery(ServiceDiscoveryPlugin.DISCO_ITEMS, to);

        const serviceDomains = new Set(
            Array.from(serviceListResponse
                .querySelector('query')
                .querySelectorAll('item')
            ).map((itemNode: Element) => itemNode.getAttribute('jid')),
        );
        serviceDomains.add(mainDomain);

        const discoveredServices: Service[] = await Promise.all(
            [...serviceDomains.keys()]
                .map((serviceDomain) => this.discoverServiceInformation(serviceDomain)),
        );
        this.hostedServices.push(...discoveredServices);
    }

    private async discoverServiceInformation(serviceDomain: string): Promise<Service> {
        const serviceInformationResponse = await this.sendDiscoQuery(ServiceDiscoveryPlugin.DISCO_INFO, serviceDomain);

        const queryNode = serviceInformationResponse.querySelector('query');
        const features = Array.from(queryNode.querySelectorAll('feature')).map((featureNode: Element) => featureNode.getAttribute('var'));
        const identitiesAttrs = Array.from(queryNode
            .querySelectorAll('identity'))
            .filter((identityNode: Element) => identityNode.getAttributeNames().length > 0)
            .map((identityNode: Element) => identityNode.getAttributeNames()
                .reduce((acc, name) => ({...acc, [name]: identityNode.getAttribute(name)}), {}));

        const from = serviceInformationResponse.getAttribute('from');
        const serviceInformation: Service = {
            identitiesAttrs: this.isIdentitiesAttrs(identitiesAttrs) ? identitiesAttrs : [],
            features,
            jid: from,
        };
        this.resourceCache.set(from, serviceInformation);
        return serviceInformation;
    }

    private async sendDiscoQuery(xmlns: string, to?: string): Promise<Element> {
        return await this.chatAdapter.chatConnectionService
            .$iq({type: 'get', ...(to ? {to} : {})})
            .c('query', {xmlns: xmlns})
            .sendAwaitingResponse();
    }

    private isIdentitiesAttrs(elements: { [attrName: string]: any }[]): elements is IdentityAttrs[] {
        return elements.every((element) => {
            const keys = Object.keys(element);
            const mustHave = keys.includes('category') && keys.includes('type');
            if (keys.length === 2) {
                return mustHave;
            } else if (keys.length === 3) {
                return mustHave && keys.includes('name');
            }
            return false;
        });
    }
}
