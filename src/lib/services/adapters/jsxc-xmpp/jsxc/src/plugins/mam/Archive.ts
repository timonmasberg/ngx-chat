import MessageArchiveManagementPlugin from './Plugin';
import Message from '../../Message';
import {IContact as Contact} from '../../Contact.interface';
import JID from '../../JID';
import UUID from '../../util/UUID';
import Utils from '../../util/Utils';
import Log from '../../util/Log';
import Translation from '../../util/Translation';
import {NS} from '../../connection/xmpp/Namespace';
import {IJID} from '../../JID.interface';
import {IMessage, MessageMark} from '../../Message.interface';
import MultiUserContact from '../../MultiUserContact';

export default class Archive {
    private archiveJid: IJID;
    private messageCache: JQuery<HTMLElement>[] = [];

    constructor(private plugin: MessageArchiveManagementPlugin, private contact: Contact) {
        const jid = contact.isGroupChat() ? contact.getJid() : plugin.getConnection().getJID;

        this.archiveJid = new JID(jid.bare);
    }

    public clear() {
        this.setExhausted(false);
        this.setFirstResultId(undefined);
    }

    private getId() {
        return this.contact.getJid().bare;
    }

    private getFirstResultId(): string {
        return this.plugin.getStorage().getItem('firstResultId', this.getId()) || '';
    }

    private setFirstResultId(resultId: string) {
        return this.plugin.getStorage().setItem('firstResultId', this.getId(), resultId);
    }

    public isExhausted(): boolean {
        return !!this.plugin.getStorage().getItem('exhausted', this.getId());
    }

    private setExhausted(exhausted: boolean) {
        return this.plugin.getStorage().setItem('exhausted', this.getId(), exhausted);
    }

    public registerExhaustedHook(hook: (isExhausted) => void) {
        const storage = this.plugin.getStorage();
        const key = storage.generateKey('exhausted', this.getId());

        storage.registerHook(key, hook);
    }

    public nextMessages(max = '20') {
        if (this.isExhausted()) {
            Log.debug('No more archived messages.');
            return false;
        }

        if (this.messageCache.length > 0) {
            Log.debug('Ongoing message retrieval');
            return false;
        }

        const queryId = UUID.v4();

        this.plugin.addQueryContactRelation(queryId, this.contact);

        const firstResultId = this.getFirstResultId();
        let endDate: Date;

        if (!firstResultId) {
            const lastMessage = this.contact.getTranscript().getLastMessage();
            if (lastMessage) {
                endDate = lastMessage.getStamp();
                endDate.setSeconds(endDate.getSeconds() - 1);
            } else {
                endDate = undefined;
            }
        }

        const connection = this.plugin.getConnection();
        this.plugin
            .determineServerSupport(this.archiveJid)
            .then(version => {
                if (!version) {
                    throw new Error(`Archive JID ${this.archiveJid.full} has no support for MAM.`);
                }

                const jid = !this.contact.isGroupChat() ? this.contact.getJid() : undefined;

                return connection.queryArchive(this.archiveJid, version.toString(), queryId, jid, firstResultId, endDate);
            })
            .then(this.onComplete)
            .catch(stanza => {
                Log.warn('Error while requesting archive', stanza);
            });

        return false;
    }

    public onForwardedMessage(forwardedElement: JQuery<HTMLElement>) {
        this.messageCache.push(forwardedElement);
    }

    public async parseForwardedMessage(forwardedElement: JQuery<HTMLElement>): Promise<IMessage> {
        const messageElement = forwardedElement.find('message');
        const messageId = messageElement.attr('id');

        if (messageElement.length !== 1) {
            return null;
        }

        const from = new JID(messageElement.attr('from'));
        const to = new JID(messageElement.attr('to'));

        if (this.archiveJid.bare !== from.bare && this.archiveJid.bare !== to.bare) {
            return null;
        }

        const delayElement = forwardedElement.find('delay[xmlns="urn:xmpp:delay"]');
        const stamp = delayElement.length > 0 ? new Date(delayElement.attr('stamp')) : new Date();

        const plaintextBody = Utils.removeHTML(messageElement.find('> body').text());
        const htmlBody = messageElement.find('html body' + NS.getFilter('XHTML'));

        if (!plaintextBody) {
            return null;
        }

        const direction = this.contact.getJid().bare === to.bare ? Message.DIRECTION.OUT : Message.DIRECTION.IN;

        const stanzaIdElement = messageElement.find('stanza-id[xmlns="urn:xmpp:sid:0"]');
        const originIdElement = messageElement.find('origin-id[xmlns="urn:xmpp:sid:0"]');
        const uid =
            direction === Message.DIRECTION.OUT && originIdElement.length
                ? originIdElement.attr('id')
                : stanzaIdElement.attr('id');

        if (Message.exists(uid)) {
            return new Message(uid);
        }

        const messageProperties = {
            uid,
            attrId: messageId,
            peer: this.contact.getJid(),
            direction,
            plaintextMessage: plaintextBody,
            htmlMessage: htmlBody.html(),
            stamp: stamp.getTime(),
            mark: MessageMark.transferred,
            unread: false,
            sender: undefined,
        };

        if (this.contact.isGroupChat()) {
            messageProperties.sender = {
                name: from.resource,
            };

            const contact = this.contact as MultiUserContact;

            messageProperties.direction =
                contact.getNickname() === from.resource ? Message.DIRECTION.OUT : Message.DIRECTION.IN;
        }

        return new Message(messageProperties);
    }

    public onComplete = async (stanza: Element) => {
        const stanzaElement = $(stanza);
        const finElement = stanzaElement.find(`fin[xmlns^="urn:xmpp:mam:"]`);

        if (finElement.length !== 1) {
            Log.warn('No fin element found');
            return;
        }

        const transcript = this.contact.getTranscript();

        while (this.messageCache.length > 0) {
            const messageElement = this.messageCache.pop();

            try {
                const message = await this.parseForwardedMessage(messageElement);

                transcript.unshiftMessage(message);
            } catch (err) {}
        }

        const isArchiveExhausted = finElement.attr('complete') === 'true';
        const firstResultId = finElement.find('first').text();
        const queryId = finElement.attr('queryid');

        if (isArchiveExhausted) {
            const archiveExhaustedMessage = new Message({
                peer: this.contact.getJid(),
                direction: Message.DIRECTION.SYS,
                plaintextMessage: Translation.t('Archive_exhausted'),
                mark: MessageMark.transferred,
                unread: false,
            });

            transcript.unshiftMessage(archiveExhaustedMessage);
        }

        this.setExhausted(isArchiveExhausted);
        this.setFirstResultId(firstResultId);
        this.plugin.removeQueryContactRelation(queryId);
    }
}
