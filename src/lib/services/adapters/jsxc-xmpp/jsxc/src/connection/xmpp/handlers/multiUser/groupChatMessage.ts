import Log from '../../../../util/Log';
import JID from '../../../../JID';
import Message from '../../../../Message';
import Translation from '../../../../util/Translation';
import MultiUserContact from '../../../../MultiUserContact';
import AbstractHandler from '../../AbstractHandler';
import MultiUserStatusCodeHandler from './StatusCodeHandler';
import {MessageMark} from '../../../../Message.interface';

// body.replace(/^\/me /, '<i title="/me">' + Utils.removeHTML(this.sender.getName()) + '</i> ');

export default class extends AbstractHandler {
    public processStanza(stanza: Element) {
        let message: Message;
        const messageElement = $(stanza);
        const from = new JID(stanza.getAttribute('from'));
        const subjectElement = messageElement.find('subject');
        const bodyElement = messageElement.find('>body:first');
        const originId = messageElement.find('origin-id[xmlns="urn:xmpp:sid:0"]').attr('id');
        const stanzaId = messageElement.find('stanza-id[xmlns="urn:xmpp:sid:0"]').attr('id');
        const attrId = messageElement.attr('id');
        const body = bodyElement.text();
        const nickname = from.resource;

        const contact = this.account.getContact(from) as MultiUserContact;
        if (typeof contact === 'undefined') {
            Log.info('Sender is not in our contact list');

            return this.PRESERVE_HANDLER;
        }

        if (contact.getType() !== 'groupchat') {
            Log.info('This groupchat message is not intended for a MultiUserContact');

            return this.PRESERVE_HANDLER;
        }

        if (subjectElement.length === 1 && bodyElement.length === 0) {
            const subject = subjectElement.text();
            const oldSubject = contact.getSubject();

            if (subject === oldSubject) {
                return this.PRESERVE_HANDLER;
            }

            contact.setSubject(subject);

            const translatedMessage = Translation.t('changed_subject_to', {
                nickname,
                subject,
            });

            contact.addSystemMessage(':page_with_curl: ' + translatedMessage);

            return this.PRESERVE_HANDLER;
        }

        if (!nickname) {
            const codes = $(stanza)
                .find('x[xmlns="http://jabber.org/protocol/muc#user"]')
                .find('status')
                .map((index, element) => element.getAttribute('code'))
                .get();

            MultiUserStatusCodeHandler.processCodes(codes, contact);
        }

        if (body === '') {
            return this.PRESERVE_HANDLER;
        }

        const delay = messageElement.find('delay[xmlns="urn:xmpp:delay"]');
        const sendDate = delay.length > 0 ? new Date(delay.attr('stamp')) : new Date();
        const afterJoin = sendDate > contact.getJoinDate();
        let direction = afterJoin ? Message.DIRECTION.IN : Message.DIRECTION.PROBABLY_IN;

        const transcript = contact.getTranscript();

        if (!afterJoin) {
            if (Message.exists(originId) || Message.exists(stanzaId)) {
                return this.PRESERVE_HANDLER;
            }

            for (const generatorMessage of transcript.getGenerator()) {
                if (generatorMessage.getAttrId() === attrId && generatorMessage.getPlaintextMessage() === body) {
                    return this.PRESERVE_HANDLER;
                }
            }
        }

        const member = contact.getMember(nickname);
        let uid = stanzaId || originId;
        let unread = afterJoin;
        let sender = {
            name: nickname,
            jid: member && member.jid,
        };

        if (contact.getNickname() === nickname) {
            if (afterJoin) {
                if (Message.exists(originId)) {
                    message = new Message(originId);

                    message.received();

                    return this.PRESERVE_HANDLER;
                }

                direction = Message.DIRECTION.OUT;
                uid = originId;
                unread = false;
                sender = undefined;
            } else {
                direction = Message.DIRECTION.PROBABLY_OUT;
            }
        }

        message = new Message({
            uid,
            attrId,
            peer: from,
            direction,
            plaintextMessage: body,
            // htmlMessage: htmlBody.html(),
            stamp: sendDate.getTime(),
            sender,
            unread,
            mark: MessageMark.transferred,
        });


        if (direction === Message.DIRECTION.OUT) {
            message.received();
        }

        const pipe = this.account.getPipe('afterReceiveGroupMessage');

        pipe.run(contact, message, messageElement.get(0)).then(([afterPipeContact, afterPipeMessage]) => {
            afterPipeContact.getTranscript().pushMessage(afterPipeMessage);
        });

        return this.PRESERVE_HANDLER;
    }
}
