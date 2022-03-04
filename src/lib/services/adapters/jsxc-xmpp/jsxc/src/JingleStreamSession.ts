import JingleMediaSession from './JingleMediaSession';
import {CallState} from './CallManager';
import Log from './util/Log';
import JingleHandler from './connection/JingleHandler';

export default class JingleStreamSession extends JingleMediaSession {
    public onOnceIncoming() {
        // send signal to partner
        this.session.ring();
    }

    protected onIncoming() {
        Log.debug('incoming stream from ' + this.session.peerID);

        // const videoDialog = JingleHandler.getVideoDialog();

        const callManager = this.account.getCallManager();
        const callType = this.getCallType();
        const peer = this.getPeer();

        const call = callManager.onIncomingCall(callType, this.session.sid, peer);

        this.on('terminated', () => {
            call.abort();
        });

        this.on('aborted', () => {
            call.abort();
        });

        call
            .getState()
            .then(state => {
                if (state === CallState.Accepted) {
                    // videoDialog.addSession(this);
                    //  videoDialog.showVideoWindow();

                    this.session.accept();

                    return;
                }

                throw state;
            })
            .catch(reason => {
                // @TODO hide user media request overlay

                // @TODO post reason to chat window
                if (reason !== CallState.Aborted && reason !== CallState.Ignored) {
                    if (reason !== CallState.Declined) {
                        Log.warn('Error on incoming call', reason);
                    }

                    this.session.decline();
                }
            });
    }

    public getMediaRequest() {
        return [];
    }
}
