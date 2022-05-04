import {BehaviorSubject, combineLatest, Observable, ReplaySubject} from 'rxjs';
import {filter, first, map} from 'rxjs/operators';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {ChatPlugin} from '../../../../core/plugin';

export interface Service {
    jid: string;
    // string in format category.type
    identities: string[];
    features: string[];
}

export const nsDisco = 'http://jabber.org/protocol/disco';
export const nsDiscoInfo = `${nsDisco}#info`;
export const nsDiscoItems = `${nsDisco}#items`;

/**
 * see XEP-0030 Service Discovery
 * https://xmpp.org/extensions/xep-0030.html
 */
export class ServiceDiscoveryPlugin implements ChatPlugin {

    readonly nameSpace = nsDisco;

    readonly servicesInitialized$: Observable<void>;
    private readonly servicesInitializationSubject = new ReplaySubject<void>(1);
    private readonly onlineSubject = new BehaviorSubject<boolean>(false);

    private readonly identityToService = new Map<string, Service>();
    private readonly jidToService = new Map<string, Service>();

    constructor(private readonly chatAdapter: XmppChatAdapter) {

        // TODO: Change to service/host changed Hook
        chatAdapter.onBeforeOnline$.subscribe(async (jid) => {
            const domain = jid.split('@')[1].split('/')[0];
            await this.discoverServiceInformation(domain);
            await this.discoverServiceItems(jid, domain);
            this.servicesInitializationSubject.next();
            this.onlineSubject.next(true);
        });

        chatAdapter.onOffline$.subscribe(() => {
            this.onlineSubject.next(false);
            this.identityToService.clear();
            this.jidToService.clear();
        });

        this.servicesInitialized$ = combineLatest([this.onlineSubject, this.servicesInitializationSubject])
            .pipe(filter(([online]) => online), map(() => {
            }));
    }

    async supportsFeature(jid: string, searchedFeature: string): Promise<boolean> {
        await this.servicesInitialized$.pipe(first()).toPromise();

        const service = this.jidToService.get(jid) || await this.discoverServiceInformation(jid);
        return service.features.includes(searchedFeature);
    }

    // TODO: into key collection(Enum) of used and tested keys
    async findService(category: string, type: string): Promise<Service> {
        return this.servicesInitialized$.pipe(map(() => {
            const key = category + '.' + type;

            if (!this.identityToService.has(key)) {
                throw new Error(`no service matching category ${category} and type ${type} found!`);
            }

            return this.identityToService.get(key);
        })).pipe(first()).toPromise();
    }

    private async discoverServiceItems(jid: string, domain: string): Promise<void> {
        const serviceListResponse = await this.chatAdapter.chatConnectionService
            .$iq({type: 'get', from: jid, to: domain})
            .c('query', {xmlns: nsDiscoItems})
            .sendAwaitingResponse();

        const serviceDomains = new Set(
            Array.from(serviceListResponse
                .querySelector('query')
                .querySelectorAll('item')
            ).map((itemNode: Element) => itemNode.getAttribute('jid')),
        );

        await Promise.all(
            [...serviceDomains.keys()]
                .map((serviceDomain) => this.discoverServiceInformation(serviceDomain)),
        );
    }

    private async discoverServiceInformation(serviceDomain: string): Promise<Service> {
        const serviceInformationResponse = await this.chatAdapter.chatConnectionService
            .$iq({type: 'get', to: serviceDomain})
            .c('query', {xmlns: nsDiscoInfo})
            .sendAwaitingResponse();

        const queryNode = serviceInformationResponse.querySelector('query');
        const features = Array.from(queryNode.querySelectorAll('feature')).map((featureNode: Element) => featureNode.getAttribute('var'));
        const identities = Array.from(queryNode.querySelectorAll('identity'));

        const from = serviceInformationResponse.getAttribute('from');
        const serviceInformation: Service = {
            identities: identities.map(identity => identity.getAttribute('category') + '.' + identity.getAttribute('type')),
            features,
            jid: from,
        };
        this.jidToService.set(from, serviceInformation);
        for (const identity of serviceInformation.identities) {
            this.identityToService.set(identity, serviceInformation)
        }
        return serviceInformation;
    }
}
