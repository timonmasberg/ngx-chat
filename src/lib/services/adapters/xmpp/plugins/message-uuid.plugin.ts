import {id} from '../../../../core/id-generator';
import {Message} from '../../../../core/message';
import {MessageWithBodyStanza} from '../../../../core/stanza';
import {ChatPlugin} from '../../../../core/plugin';

const nsSID = 'urn:xmpp:sid:0';

/**
 * https://xmpp.org/extensions/xep-0359.html
 */
export class MessageUuidPlugin implements ChatPlugin {

    readonly nameSpace = nsSID;

    public static extractIdFromStanza(messageStanza: Element) {
        const originIdElement = messageStanza.querySelector('origin-id');
        const stanzaIdElement = messageStanza.querySelector('stanza-id');
        return messageStanza.getAttribute('id')
            || (originIdElement && originIdElement.getAttribute('id'))
            || (stanzaIdElement && stanzaIdElement.getAttribute('id'));
    }

    beforeSendMessage(messageStanza: Element, message: Message): void {
        const generatedId = id();
        const element = document.createElement('origin-id');
        element.setAttribute('xmlns', this.nameSpace);
        element.setAttribute('id', generatedId);
        messageStanza.append(element);
        if (message) {
            message.id = generatedId;
        }
    }

    afterSendMessage(message: Message, messageStanza: Element): void {
        message.id = MessageUuidPlugin.extractIdFromStanza(messageStanza);
    }

    afterReceiveMessage(message: Message, messageStanza: MessageWithBodyStanza) {
        message.id = MessageUuidPlugin.extractIdFromStanza(messageStanza);
    }

}
