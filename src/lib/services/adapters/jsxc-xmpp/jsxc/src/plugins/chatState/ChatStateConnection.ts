import {NS} from '../../connection/xmpp/Namespace';
import JID from '../../JID';
import {STATE} from './State';

export default class ChatStateConnection {
    constructor(private send) {
    }

    public sendPaused(to: JID, type: 'chat' | 'groupchat' = 'chat') {
        this.sendState(STATE.PAUSED, to, type);
    }

    public sendComposing(to: JID, type: 'chat' | 'groupchat' = 'chat') {
        this.sendState(STATE.COMPOSING, to, type);
    }

    private sendState(state: STATE, to: JID, type: 'chat' | 'groupchat' = 'chat') {
        const msg = $msg({
            to: to.full,
            type,
        }).c(state, {
            xmlns: NS.get('CHATSTATES'),
        });

        this.send(msg);
    }
}
