import {NgZone} from '@angular/core';
import {filter} from 'rxjs/operators';
import {timeout} from '../../../../core/utils-timeout';
import {LogService} from '../service/log.service';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {IqResponseStanza} from '../../../../core/stanza';
import {ChatPlugin} from '../../../../core/plugin';

const nsPing = 'urn:xmpp:ping';

/**
 * XEP-0199 XMPP Ping (https://xmpp.org/extensions/xep-0199.html)
 */
export class PingPlugin implements ChatPlugin {
    nameSpace = nsPing;
    private timeoutHandle: any;
    private readonly pingInterval = 60_000;

    constructor(
        private readonly xmppChatAdapter: XmppChatAdapter,
        private readonly logService: LogService,
        private readonly ngZone: NgZone,
    ) {
        this.xmppChatAdapter.state$.pipe(
            filter(newState => newState === 'online'),
        ).subscribe(() => this.schedulePings());

        this.xmppChatAdapter.state$.pipe(
            filter(newState => newState === 'disconnected'),
        ).subscribe(() => this.unschedulePings());
    }

    private schedulePings(): void {
        this.unschedulePings();
        this.ngZone.runOutsideAngular(() => {
            this.timeoutHandle = window.setInterval(() => this.ping(), this.pingInterval);
        });
    }

    private async ping(): Promise<void> {
        this.logService.debug('ping...');
        try {
            await timeout(this.sendPing(), 10_000);
            this.logService.debug('... pong');
        } catch {
            if (this.xmppChatAdapter.state$.getValue() === 'online'
                && this.xmppChatAdapter.chatConnectionService.state$.getValue() === 'online') {
                this.logService.error('... pong errored,  connection should be online, waiting for browser websocket timeout');
            }
        }
    }

    private async sendPing(): Promise<IqResponseStanza<'result'>> {
        return await this.xmppChatAdapter.chatConnectionService
            .$iq({type: 'get'})
            .c('ping', {xmlns: this.nameSpace})
            .sendAwaitingResponse();
    }

    private unschedulePings(): void {
        window.clearInterval(this.timeoutHandle);
    }

}
