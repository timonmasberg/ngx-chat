import {IqResponseStanza} from '../../../../core/stanza';
import {removeDuplicates} from '../../../../core/utils-array';
import {PublishSubscribePlugin} from './publish-subscribe.plugin';
import {ChatConnection} from '../interface/chat-connection';
import {ChatPlugin} from '../../../../core/plugin';
import {Builder} from '../interface/builder';

export interface SavedConference {
    name: string;
    jid: string;
    autojoin: boolean;
}

const nsBookmarks = 'storage:bookmarks';

/**
 * XEP-0048 Bookmarks (https://xmpp.org/extensions/xep-0048.html)
 */
export class BookmarkPlugin implements ChatPlugin {
    readonly nameSpace = nsBookmarks;

    private pendingAddConference: Promise<IqResponseStanza<'result'>> | null = null;

    constructor(private readonly publishSubscribePlugin: PublishSubscribePlugin) {
    }

    registerHandler(connection: ChatConnection): Promise<void> {
        throw new Error('Method not implemented.');
    }

    onOffline(): void {
        this.pendingAddConference = null;
    }

    async retrieveMultiUserChatRooms(): Promise<SavedConference[]> {
        const itemNode = await this.publishSubscribePlugin.retrieveNodeItems(nsBookmarks);
        const storageNode =  Array.from(itemNode?.[0].querySelectorAll('storage')).find((el) => el.namespaceURI === nsBookmarks);
        const conferenceNodes = itemNode && Array.from(storageNode.querySelectorAll('conference'));
        if (!conferenceNodes) {
            return [];
        }
        return conferenceNodes.map(c => this.convertElementToSavedConference(c));
    }

    private convertElementToSavedConference(conferenceNode: Element): SavedConference {
        return {
            name: conferenceNode.getAttribute('name'),
            jid: conferenceNode.getAttribute('jid'),
            autojoin: conferenceNode.getAttribute('autojoin') === 'true',
        };
    }

    saveConferences(conferences: SavedConference[]): Promise<IqResponseStanza<'result'>> {
        const deduplicatedConferences = removeDuplicates(conferences, (x, y) => x.jid === y.jid);
        return this.publishSubscribePlugin.storePrivatePayloadPersistent(
            nsBookmarks,
            null,
            (builder: Builder) => {
                builder.c('storage', {xmlns: nsBookmarks});
                deduplicatedConferences.map(conference => {
                    const {name, autojoin, jid} = conference;
                    builder.c('conference', {name, jid, autojoin: autojoin.toString()});
                });
                return builder;
            });
    }

    async addConference(conferenceToSave: SavedConference): Promise<IqResponseStanza<'result'>> {
        while (this.pendingAddConference) {
            try {
                await this.pendingAddConference; // serialize the writes, so that in case of multiple conference adds all get added
            } catch {
            }
        }

        this.pendingAddConference = this.addConferenceInternal(conferenceToSave);

        try {
            return await this.pendingAddConference;
        } finally {
            this.pendingAddConference = null;
        }
    }

    private async addConferenceInternal(conferenceToSave: SavedConference): Promise<IqResponseStanza<'result'>> {
        const savedConferences = await this.retrieveMultiUserChatRooms();
        const conferences = [...savedConferences, conferenceToSave];

        return await this.saveConferences(conferences);
    }
}
