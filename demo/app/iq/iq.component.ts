import {Component, Inject} from '@angular/core';
import {CHAT_SERVICE_TOKEN, XmppChatAdapter} from '@pazznetwork/ngx-chat';

@Component({
    selector: 'app-iq',
    templateUrl: './iq.component.html',
    styleUrls: ['./iq.component.css']
})
export class IqComponent {
    iqRequest: string;
    iqResponse: string;

    constructor(@Inject(CHAT_SERVICE_TOKEN) public chatService: XmppChatAdapter) {}

    async sendIq() {
        const parser = new globalThis.DOMParser();
        const element = parser.parseFromString(this.iqRequest, 'text/xml').documentElement;
        const attributes = Array.from(element.attributes).reduce((acc, val) => acc[val.name] = val.value, {});
        const response = await this.chatService.chatConnectionService.$iq(attributes).cNode(element.firstElementChild).sendAwaitingResponse()
        this.iqResponse = response.outerHTML;
    }
}
