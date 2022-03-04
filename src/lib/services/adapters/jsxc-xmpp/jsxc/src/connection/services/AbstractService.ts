import {IConnection} from '../Connection.interface';
import Account from '../../Account';

export type AbstractServiceConstructor<TService extends AbstractService> = new(send: (stanzaElement: Element | Strophe.Builder) => void,
                                                                               sendIQ: (stanzaElement: Element | Strophe.Builder) => Promise<Element>,
                                                                               connection: IConnection,
                                                                               account: Account) => TService;

export default abstract class AbstractService {
    constructor(
        protected send: (stanzaElement: Element | Strophe.Builder) => void,
        protected sendIQ: (stanzaElement: Element | Strophe.Builder) => Promise<Element>,
        protected connection: IConnection,
        protected account: Account
    ) {
    }
}
