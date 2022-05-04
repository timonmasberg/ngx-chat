import {Stanza} from '../../../../core/stanza';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {ChatPlugin} from '../../../../core/plugin';
import {ChatConnection} from '../interface/chat-connection';

/**
 * see XEP-0115 Entity Capabilities
 * a specification for ensuring compatibility to different jabber node provider versions
 */
export class EntityCapabilitiesPlugin implements ChatPlugin {

    nameSpace = '????'

    constructor(private readonly chatAdapter: XmppChatAdapter) {
    }

    registerHandler(connection: ChatConnection): Promise<void> {
        return Promise.resolve();
        // connection.addHandler();
    }

    private isEntityCapabilityStanze(stanza: Stanza) {
        stanza.tagName;
    }
}
