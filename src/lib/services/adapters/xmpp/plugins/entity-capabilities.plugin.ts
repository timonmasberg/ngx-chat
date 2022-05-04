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

    /**
     * TODO:
     * A client interested in bookmarks SHOULD include the 'urn:xmpp:bookmarks:1+notify' feature in its Entity Capabilities (XEP-0115) [8], as per Personal Eventing Protocol (XEP-0163) [9], so that it receives notifications for updates done by other clients of the user, and reacts accordingly. The actual notifications are explained in the Bookmark Notifications section of this specification.
     */

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
