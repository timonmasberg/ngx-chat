import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {first} from 'rxjs/operators';
import {ChatConnection, ChatPlugin} from 'src/public-api';

export const nsBlocking = 'urn:xmpp:blocking';

/**
 * XEP-0191: Blocking Command
 * https://xmpp.org/extensions/xep-0191.html
 */
export class BlockPlugin implements ChatPlugin {

    nameSpace = nsBlocking;

    constructor(
        private xmppChatAdapter: XmppChatAdapter,
    ) {
    }

    onOffline() {
        this.xmppChatAdapter.blockedContactJids$.next(new Set<string>());
    }

    async blockJid(from: string, jid: string) {
        await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set'})
            .c('block', {xmlns: this.nameSpace})
            .c('item', {from, jid})
            .send();

        const current = this.xmppChatAdapter.blockedContactJids$.getValue();
        current.add(jid);
        this.xmppChatAdapter.blockedContactJids$.next(current);
    }

    async unblockJid(jid: string) {
        await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'set'})
            .c('unblock', {xmlns: this.nameSpace})
            .c('item', {jid})
            .send();

        const current = this.xmppChatAdapter.blockedContactJids$.getValue();
        current.delete(jid);
        this.xmppChatAdapter.blockedContactJids$.next(current);
    }

    private async requestBlockedJids() {
        const blockListResponse = await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get'})
            .c('blocklist', {xmlns: this.nameSpace})
            .sendAwaitingResponse();

        const blockedJids = Array.from(
            blockListResponse
                .querySelector('blocklist')
                .querySelectorAll('item')
        ).map(e => e.getAttribute('jid'));

        this.xmppChatAdapter.blockedContactJids$.next(new Set<string>(blockedJids));
    }

    async registerHandler(connection: ChatConnection): Promise<void> {
        const currentLoggedInUserJid = await this.xmppChatAdapter.chatConnectionService.userJid$.pipe(first()).toPromise();
        const identifier = {ns: this.nameSpace, from: currentLoggedInUserJid};
        // TODO: cleanup async workaround
        //  check if current BlockList handling is possible outside the handler without deleting and creating the handler anew
        //  this workaround exists because strophe does not handle promises returned by handlers
        const blockList = await this.xmppChatAdapter.blockedContactJids$.pipe(first()).toPromise();
        const handler = (stanza: Element) => {
            const blockPush = Array.from(stanza.querySelectorAll('block')).find(el => el.getAttribute('xmlns') === this.nameSpace);
            const unblockPush = Array.from(stanza.querySelectorAll('unblock')).find(el => el.getAttribute('xmlns') === this.nameSpace);


            if (!blockPush && !unblockPush) {
                return false;
            }

            if (blockPush) {
                Array.from(blockPush.querySelectorAll('item'))
                    .map(e => e.getAttribute('jid'))
                    .forEach(jid => blockList.add(jid));
                this.xmppChatAdapter.blockedContactJids$.next(blockList);
                return true;
            }

            const jidsToUnblock = Array.from(blockPush.querySelectorAll('item')).map(e => e.getAttribute('jid'));
            if (jidsToUnblock.length === 0) {
                // unblock everyone
                blockList.clear();
            } else {
                // unblock individually
                jidsToUnblock.forEach(jid => blockList.delete(jid));
            }
            this.xmppChatAdapter.blockedContactJids$.next(blockList);
            return true;
        };
        connection.addHandler(handler, identifier);
    }
}
