import {jid as parseJid} from '@xmpp/client';
import {Contact, Invitation} from '../../../../core/contact';
import {Direction, Message} from '../../../../core/message';
import {MessageWithBodyStanza, Stanza} from '../../../../core/stanza';
import {LogService} from '../service/log.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {nsMucUser} from './multi-user-chat/multi-user-chat-constants';
import {first} from 'rxjs/operators';
import {ChatPlugin} from '../../../../core/plugin';

export class MessageReceivedEvent {
    discard = false;
}

const nsConference = 'jabber:x:conference';

/**
 * Part of the XMPP Core Specification
 * see: https://datatracker.ietf.org/doc/rfc6120/
 */
export class MessagePlugin implements ChatPlugin {
    nameSpace = nsConference;

    constructor(
        private readonly xmppChatAdapter: XmppChatAdapter,
        private readonly logService: LogService,
    ) {
    }

    async registerHandler(stanza: Stanza, archiveDelayElement?: Stanza): Promise<boolean> {
        if (this.isMessageStanza(stanza)) {
            await this.handleMessageStanza(stanza, archiveDelayElement);
            return true;
        }
        return false;
    }

    async sendMessage(contact: Contact, body: string) {
        const from = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const messageBuilder = this.xmppChatAdapter.chatConnectionService
            .$msg({to: contact.jidBare.toString(), from, type: 'chat'})
            .c('body')
            .t(body);

        const message: Message = {
            direction: Direction.out,
            body,
            datetime: new Date(), // TODO: replace with entity time plugin
            delayed: false,
            fromArchive: false,
        };
        contact.addMessage(message);
        // TODO: on rejection mark message that it was not sent successfully
        try {
            await messageBuilder.send();
        } catch (rej) {
            this.logService.error('rejected message ' + message.id, rej);
        }
    }

    private isMessageStanza(stanza: Stanza): stanza is MessageWithBodyStanza {
        return stanza.nodeName === 'message'
            && stanza.getAttribute('type') !== 'groupchat'
            && stanza.getAttribute('type') !== 'error'
            && !!stanza.querySelector('body').textContent?.trim();
    }

    private async handleMessageStanza(messageStanza: MessageWithBodyStanza, archiveDelayElement?: Stanza) {
        const me = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const isAddressedToMe = me === messageStanza.getAttribute('to');
        const messageDirection = isAddressedToMe ? Direction.in : Direction.out;

        const messageFromArchive = archiveDelayElement != null;

        const delayElement = archiveDelayElement ?? messageStanza.querySelector('delay');
        const stamp = delayElement?.getAttribute('stamp');
        const datetime = stamp ? new Date(stamp) : new Date() /* TODO: replace with entity time plugin */;

        if (messageDirection === Direction.in && !messageFromArchive) {
            this.logService.debug('message received <=', messageStanza.querySelector('body').textContent);
        }

        const message = {
            body: messageStanza.querySelector('body').textContent.trim(),
            direction: messageDirection,
            datetime,
            delayed: !!delayElement,
            fromArchive: messageFromArchive,
        };

        const messageReceivedEvent = new MessageReceivedEvent();

        if (messageReceivedEvent.discard) {
            return;
        }

        const contactJid = isAddressedToMe ? messageStanza.getAttribute('from') : messageStanza.getAttribute('to');
        const contact = this.xmppChatAdapter.getOrCreateContactByIdSync(contactJid);
        contact.addMessage(message);

        const invites = Array.from(messageStanza.querySelectorAll('x'));
        const isRoomInviteMessage =
            invites.find(el => el.getAttribute('xmlns') === nsMucUser)
            || invites.find(el => el.getAttribute('xmlns') === nsConference);

        if (isRoomInviteMessage) {
            contact.pendingRoomInvite$.next(this.extractInvitationFromMessage(messageStanza));
        }

        if (messageDirection === Direction.in && !messageFromArchive) {
            this.xmppChatAdapter.message$.next(contact);
        }
    }

    private extractInvitationFromMessage(messageStanza: MessageWithBodyStanza): Invitation {
        const invitations = Array.from(messageStanza.querySelectorAll('x'));
        const mediatedInvitation = invitations.find(el => el.getAttribute('xmlns') === nsMucUser);
        if (mediatedInvitation) {
            const inviteEl = mediatedInvitation.querySelector('invite');
            return {
                from: parseJid(inviteEl.getAttribute('from')),
                roomJid: parseJid(messageStanza.getAttribute('from')),
                reason: inviteEl.querySelector('reason').textContent,
                password: mediatedInvitation.querySelector('password').textContent,
            };
        }

        const directInvitation = invitations.find(el => el.getAttribute('xmlns') === nsConference);
        if (directInvitation) {
            return {
                from: parseJid(messageStanza.getAttribute('from')),
                roomJid: parseJid(directInvitation.getAttribute('jid')),
                reason: directInvitation.getAttribute('reason'),
                password: directInvitation.getAttribute('password'),
            };
        }

        throw new Error(`unknown invitation format: ${messageStanza.toString()}`);
    }

}
