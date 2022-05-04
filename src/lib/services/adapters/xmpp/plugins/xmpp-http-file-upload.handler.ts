import {HttpClient} from '@angular/common/http';
import {XmppChatAdapter} from '../../xmpp-chat-adapter.service';
import {Service, ServiceDiscoveryPlugin} from './service-discovery.plugin';
import {FileUploadHandler} from '../../../../hooks/file-upload-handler';
import {ChatPlugin} from '../../../../core/plugin';
import {Finder} from '../shared/finder';

export const upload = 'urn:xmpp:http:upload:0';

/**
 * XEP-0363 http file upload
 */
export class XmppHttpFileUploadHandler implements ChatPlugin, FileUploadHandler {

    readonly nameSpace = upload;

    constructor(
        private readonly httpClient: HttpClient,
        private readonly xmppChatAdapter: XmppChatAdapter,
        private readonly uploadService: Promise<Service>,
    ) {
    }

    static getUploadServiceThroughServiceDiscovery(serviceDiscoveryPlugin: ServiceDiscoveryPlugin): Promise<Service> {
        return serviceDiscoveryPlugin.findService('store', 'file');
    }

    async upload(file: File): Promise<string> {
        const {name, size, type} = file;
        const slotUrl = await this.requestSlot(name, size.toString(), type);
        return await this.uploadToSlot(slotUrl, file);
    }

    isUploadSupported(): boolean {
        return true;
    }

    private async requestSlot(filename: string, size: string, contentType: string): Promise<string | undefined> {
        const to = (await this.uploadService).jid;
        const slotResponse = await this.xmppChatAdapter.chatConnectionService
            .$iq({to, type: 'get'})
            .c('request', {xmlns: this.nameSpace, filename, size, 'content-type': contentType})
            .sendAwaitingResponse();
        return Finder
            .create(slotResponse)
            .searchByTag('slot')
            .searchByTag('put')
            .result
            .getAttribute('url');
    }

    private async uploadToSlot(slot: string, file: File): Promise<string> {
        await this.httpClient.put(slot, file, {responseType: 'blob'}).toPromise();
        return slot;
    }

}
