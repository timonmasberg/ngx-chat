import Storage from './Storage';
import SortedPersistentMap from './util/SortedPersistentMap';
// import Roster from './ui/Roster';
import {INoticeData, Notice} from './Notice';
import Client from './Client';

(globalThis as any).removeNotice = function(notice) {
    Client.getNoticeManager().removeNotice(notice);
};

(globalThis as any).addNotice = function(title, description, fnName) {
    return Client.getNoticeManager().addNotice({
        title,
        description,
        fnName,
    });
};

export class NoticeManager {
    private notices: SortedPersistentMap;

    public static removeAll() {
        Client.getNoticeManager().removeAll();

        Client.getAccountManager()
            .getAccounts()
            .forEach(account => {
                account.getNoticeManager().removeAll();
            });
    }

    constructor(private storage: Storage) {
        this.notices = new SortedPersistentMap(this.storage, 'notices');

        this.notices.setRemoveHook(id => {
            // Roster.get().removeNotice(this, id);
        });

        this.notices.setPushHook(id => {
            const notice = new Notice(this.storage, id);

            // Roster.get().addNotice(this, notice);

            return notice;
        });

        this.notices.init();
    }

    public getId(): string {
        return this.storage.getName();
    }

    public addNotice(noticeData: INoticeData) {
        const notice = new Notice(this.storage, noticeData);

        if (this.notices.get(notice.getId())) {
            return null;
        }

        this.notices.push(notice);

        return notice;
    }

    public removeNotice(notice: Notice) {
        this.notices.remove(notice);
    }

    public removeAll() {
        this.notices.empty(id => {
            //  Roster.get().removeNotice(this, id);
        });
    }
}
