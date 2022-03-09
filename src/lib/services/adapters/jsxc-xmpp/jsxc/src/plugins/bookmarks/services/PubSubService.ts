import AbstractService from './AbstractService';
import {NS} from '../../../connection/xmpp/Namespace';
import RoomBookmark from '../RoomBookmark';
import {IConnection} from '../../../connection/Connection.interface';
import Log from '../../../util/Log';
import UUID from '../../../util/UUID';
import {IJID} from '../../../JID.interface';
import JID from '../../../JID';
import Form from '../../../connection/Form';

NS.register('BOOKMARKS', 'storage:bookmarks');

/**
 * XEP-0048: Bookmarks
 *
 * @version 1.1
 * @see https://xmpp.org/extensions/xep-0048.html
 */

export class PubSubService extends AbstractService {
    constructor(private connection: IConnection) {
        super();
    }

    public getName(): string {
        return 'pubsub';
    }

    public async getRooms(): Promise<RoomBookmark[]> {
        let storageElement: Element;
        try {
            storageElement = await this.getBookmarks();
        } catch (err) {
            Log.info(err);

            return [];
        }
        const bookmarkElements = Array.from(storageElement.children);

        return bookmarkElements
            .filter(element => element.tagName.toLowerCase() === 'conference')
            .map(element => this.parseConferenceElement(element));
    }

    public async addRoom(room: RoomBookmark) {
        this.addBookmark(room);
    }

    public async removeRoom(id: IJID) {
        this.removeBookmark(id);
    }

    private parseConferenceElement(element: Element): RoomBookmark {
        const jid = new JID(element.getAttribute('jid'));
        const alias = element.getAttribute('name');
        const nickElement = element.getElementsByTagName('nick');
        const nickname = nickElement.length === 1 ? nickElement[0].textContent : UUID.v4().split('-')[0];
        const passwordElement = element.getElementsByTagName('password');
        const password = passwordElement.length === 1 ? passwordElement[0].textContent : undefined;
        const autoJoin = element.getAttribute('autojoin') === 'true';

        return new RoomBookmark(jid, alias, nickname, autoJoin, password);
    }

    // private createBookmarksNode() {
    //    let pubSubService = this.connection.getPubSubService();
    //    let options = this.getOptionForm();

    //    return pubSubService.createNode(NS.get('BOOKMARKS'), options);
    // }

    private async getBookmarks(): Promise<Element> {
        const pubSubService = this.connection.getPubSubService;
        const bookmarkNode = await pubSubService.getAllItems(NS.get('BOOKMARKS'));

        const storageElement = bookmarkNode.querySelector(NS.getFilter('BOOKMARKS', 'storage'));

        if (!storageElement) {
            throw new Error('Could not retrieve bookmarks.');
        }

        return storageElement;
    }

    private async addBookmark(room: RoomBookmark) {
        let storageElement: JQuery<Element>;
        try {
            storageElement = $(await this.getBookmarks());
        } catch (err) {
            storageElement = $('<storage>').attr('xmlns', NS.get('BOOKMARKS'));
        }

        const roomBareJid = room.getJid().bare;
        storageElement.find(`[jid="${roomBareJid}"]`).remove();

        const conferenceElement = $('<conference>');
        conferenceElement.attr({
            name: room.getAlias(),
            autojoin: room.isAutoJoin(),
            jid: roomBareJid,
        });

        if (room.hasNickname()) {
            const nickElement = $('<nick>');
            nickElement.text(room.getNickname());
            nickElement.appendTo(conferenceElement);
        }

        if (room.hasPassword()) {
            const passwordElement = $('<password>');
            passwordElement.text(room.getPassword());
            passwordElement.appendTo(conferenceElement);
        }

        storageElement.append(conferenceElement);

        return this.publishBookmarks(storageElement.get(0));
    }

    private async removeBookmark(id: IJID): Promise<Element> {
        let storageElement: Element;
        try {
            storageElement = await this.getBookmarks();
        } catch (err) {
            return null;
        }

        const conferenceElement = storageElement.querySelector(`[jid="${id.bare}"]`);

        if (conferenceElement) {
            return null;
        }

        conferenceElement.remove();

        return this.publishBookmarks(storageElement);
    }

    private publishBookmarks(storageElement: Element) {
        const pubSubService = this.connection.getPubSubService;
        const item = $build('item', {
            id: 'current',
        }).cnode(storageElement.firstElementChild);

        return pubSubService.publish(NS.get('BOOKMARKS'), item, this.getOptionForm());
    }

    private getOptionForm(): Form {
        return Form.fromJSON({
            type: 'submit',
            fields: [
                {
                    type: 'hidden',
                    name: 'FORM_TYPE',
                    values: [NS.get('PUBSUB_PUBLISH_OPTIONS')],
                },
                {
                    name: 'pubsub#persist_items',
                    values: ['1'],
                },
                {
                    name: 'pubsub#access_model',
                    values: ['whitelist'],
                },
            ],
        });
    }
}
