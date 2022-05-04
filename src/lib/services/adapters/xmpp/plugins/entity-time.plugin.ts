import {BehaviorSubject, of} from 'rxjs';
import {catchError, first, map, mergeMap, timeout} from 'rxjs/operators';
import {LogService} from '../service/log.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {ServiceDiscoveryPlugin} from './service-discovery.plugin';
import {ChatPlugin} from '../../../../core/plugin';
import {ChatConnection} from '../interface/chat-connection';
import {Finder} from '../shared/finder';

export interface TimeReference {
    utcTimestamp: number;
    /**
     * When was utcTimestamp seen locally according to performance.now().
     */
    localReference: number;
}

const nsTime = 'urn:xmpp:time';

/**
 * Request time of entities via XEP-0202.
 */
export class EntityTimePlugin implements ChatPlugin {
    nameSpace = nsTime;
    private serverSupportsTime$ = new BehaviorSubject<boolean | 'unknown'>('unknown');
    private serverTime$ = new BehaviorSubject<TimeReference | null>(null);

    constructor(
        private xmppChatAdapter: XmppChatAdapter,
        private serviceDiscoveryPlugin: ServiceDiscoveryPlugin,
        private logService: LogService,
    ) {
    }

    async onBeforeOnline(): Promise<void> {
        const jid = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const domain = jid.split('@')[0];
        const serverSupportsTimeRequest = await this.serviceDiscoveryPlugin.supportsFeature(domain, this.nameSpace);
        if (!serverSupportsTimeRequest) {
            this.serverSupportsTime$.next(false);
            return;
        }

        const sharedUtcTimeStamp = await this.requestTime(domain);
        this.serverTime$.next(sharedUtcTimeStamp);
        this.serverSupportsTime$.next(true);
    }

    onOffline() {
        this.serverSupportsTime$.next('unknown');
        this.serverTime$.next(null);
    }

    /**
     * Returns a non-client-specific timestamp if server supports XEP-0202. Fallback to local timestamp in case of missing support.
     */
    async getNow(): Promise<number> {
        const calculateNowViaServerTime$ = this.serverTime$.pipe(map(reference => this.calculateNow(reference)), first());
        return await this.serverSupportsTime$.pipe(
            timeout(5000),
            first(supportsServerTime => supportsServerTime !== 'unknown'),
            mergeMap(supportsServerTime => supportsServerTime ? calculateNowViaServerTime$ : of(Date.now())),
            catchError(() => of(Date.now())),
        ).toPromise();
    }

    private calculateNow(reference: TimeReference): number {
        return reference.utcTimestamp + (performance.now() - reference.localReference);
    }

    async requestTime(jid: string): Promise<TimeReference> {
        const response = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get', to: jid})
            .c('time', {xmlns: this.nameSpace})
            .sendAwaitingResponse();
        const utcString = Finder
            .create(response)
            .searchByTag('time')
            .searchByNamespace(this.nameSpace)
            .searchByTag('utc')
            .result
            .textContent;

        if (!utcString) {
            const message = 'invalid time response';
            this.logService.error(message, response.toString());
            throw new Error(message);
        }

        return {utcTimestamp: Date.parse(utcString), localReference: performance.now()};
    }

    registerHandler(connection: ChatConnection): Promise<void> {
        return Promise.resolve(undefined);
    }
}
