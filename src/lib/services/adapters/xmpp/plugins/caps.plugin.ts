import {ChatPlugin} from '../../../../core/plugin';

export const nsCaps = 'http://jabber.org/protocol/caps';

export class CapsPlugin implements ChatPlugin {
    nameSpace = nsCaps;
}
