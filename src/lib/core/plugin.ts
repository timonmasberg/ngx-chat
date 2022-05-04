import {ChatConnection} from '../services/adapters/xmpp/interface/chat-connection';

export interface ChatPlugin {
    /**
     * XML Namespace short XMLNS or NS as specified by the implemented XEP
     */
    readonly nameSpace: string;
}

export interface StanzaHandlerChatPlugin extends ChatPlugin {
    /**
     * Register the plugin handlers on the current chat connection.
     */
    registerHandler(connection: ChatConnection): Promise<void>;

    /**
     * Unregister the plugin handlers on the current chat connection.
     * To avoid bad stanza handling on connection change
     */
    unregisterHandler(connection: ChatConnection): Promise<void>;
}
