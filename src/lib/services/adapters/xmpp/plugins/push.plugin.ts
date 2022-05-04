import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {ServiceDiscoveryPlugin} from './service-discovery.plugin';
import {IqResponseStanza} from '../../../../core/stanza';
import {ChatPlugin} from '../../../../core/plugin';

const nsPush = 'urn:xmpp:push:0';

/**
 * xep-0357
 */
export class PushPlugin implements ChatPlugin {

    nameSpace = nsPush;

    constructor(
        private xmppChatAdapter: XmppChatAdapter,
        private serviceDiscoveryPlugin: ServiceDiscoveryPlugin,
    ) {
    }

    async register(node: string, jid?: string): Promise<IqResponseStanza<'result'>> {
        if (!jid) {
            const service = await this.getPushServiceComponent();
            jid = service.jid;
        }
        return await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set'})
            .c('enable', {xmlns: this.nameSpace, jid, node})
            .sendAwaitingResponse();
    }

    private async getPushServiceComponent() {
        return await this.serviceDiscoveryPlugin.findService('pubsub', 'push');
    }

    async unregister(node?: string, jid?: string): Promise<IqResponseStanza<'result'>> {
        if (!jid) {
            const service = await this.getPushServiceComponent();
            jid = service.jid;
        }
        return await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set'})
            .c('disable', {xmlns: this.nameSpace, jid, node})
            .sendAwaitingResponse();
    }

}
