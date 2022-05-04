import {IqResponseStanza} from '../../../../core/stanza';
import {removeDuplicates} from '../../../../core/utils-array';
import {nsPubSub, PublishSubscribePlugin} from './publish-subscribe.plugin';
import {ChatConnection} from '../interface/chat-connection';
import {ChatPlugin} from '../../../../core/plugin';
import {Builder} from '../interface/builder';
import {Subject} from 'rxjs';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';

export interface SavedConference {
    name: string;
    jid: string;
    autojoin: boolean;
}

const nsBookmarks = 'storage:bookmarks';

const nsPEPNativeBookmarks = 'urn:xmpp:bookmarks:1';

/**
 * XEP-0402 (https://xmpp.org/extensions/xep-0402.html)
 *  replaces XEP-0048 Bookmarks (https://xmpp.org/extensions/xep-0048.html)
 */
export class BookmarkPlugin implements ChatPlugin {
    private readonly bookmarkSubject = new Subject<Bookmark[]>();

    readonly bookmarks$ = this.bookmarkSubject.asObservable();

    readonly nameSpace = nsPEPNativeBookmarks;

    private pendingAddConference: Promise<IqResponseStanza<'result'>> | null = null;

    constructor(private readonly chatAdapter: XmppChatAdapter) {
        chatAdapter.onBeforeOnline$.subscribe(async () => this.bookmarkSubject.next(await this.getBooksMarks()))
    }

    registerHandler(connection: ChatConnection): Promise<void> {
        throw new Error('Method not implemented.');
    }

    onOffline(): void {
        this.pendingAddConference = null;
    }

    async getBooksMarks(): Promise<Bookmark[]> {
        const bookMarks = await this.chatAdapter.plugins.pubSub.retrieveNodeItems(nsPEPNativeBookmarks)
        return bookMarks.map((item) => {
                    const conference = item.querySelector('conference');
                    return {
                        id: item.getAttribute('id'),
                        conference: {
                            name: conference.getAttribute('name'),
                            autojoin: !!conference.getAttribute('autojoin'),
                            nick: conference.querySelector('nick')?.textContent,
                            password: conference.querySelector('password')?.textContent,
                            extensions: Array.from(conference.querySelector('extensions').children)
                        }
                    } as Bookmark;
                }
            );
    }

    async retrieveMultiUserChatRooms(): Promise<SavedConference[]> {
        const itemNode = await this.chatAdapter.plugins.pubSub.retrieveNodeItems(nsBookmarks);
        const storageNode = Array.from(itemNode?.[0].querySelectorAll('storage')).find((el) => el.getAttribute('xmlns') === nsBookmarks);
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
        return this.chatAdapter.plugins.pubSub.storePrivatePayloadPersistent(
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

export interface Bookmark {
    /**
     * jid from a muc as item id from items
     */
    id: string;
    conference: Conference;
}

export interface Conference {

    /**
     * A set of child elements (of potentially any namespace). Clients MUST preserve these (particularly preserving unknown elements) when editing items.
     */
    extensions?: Element[];

    /**
     * A password used to access the chatroom. Note this is not intended to be a secure storage.
     */
    password?: string;

    /**
     * A friendly name for the bookmark, specified by the user. Clients SHOULD NOT attempt to autogenerate this from the JID.
     */
    name?: string;

    /**
     * The user's preferred roomnick for the chatroom, if different to that specified by User Nickname (XEP-0172) [1].
     * In the absence of this element being present, the nickname from User Nickname (XEP-0172) [1] SHOULD be used if present.
     *
     * Links:
     *  [1] https://xmpp.org/extensions/xep-0172.html
     */
    nick?: string;

    /**
     * Whether the client should automatically join the conference room on login.
     *  defaults to false
     */
    autojoin: boolean;
}
