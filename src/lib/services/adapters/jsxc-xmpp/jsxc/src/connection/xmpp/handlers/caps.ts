import * as NS from '../namespace';
import DiscoInfo from '../../../DiscoInfo';
import JID from '../../../JID';
import Account from '../../../Account';
import Log from '../../../util/Log';
import AbstractHandler from '../AbstractHandler';

export default class CapsHandler extends AbstractHandler {
    public static NAMESPACE = 'http://jabber.org/protocol/caps';

    constructor(account: Account) {
        super(account);

        NS.register('CAPS', CapsHandler.NAMESPACE);

        account.getDiscoInfo().addFeature(NS.get('CAPS'));
    }

    public processStanza(stanza: Element) {
        const c = stanza.querySelector('c');
        const hash = c.getAttribute('hash');
        const version = c.getAttribute('ver');
        const node = c.getAttribute('node');
        const discoInfo = new DiscoInfo(version);
        const from = new JID(stanza.getAttribute('from'));


        if (!hash) {
            Log.info('Drop caps element, because hash attribute is missing.');
            return this.PRESERVE_HANDLER;
        } else if (hash !== 'sha-1') {
            Log.info('Drop caps element, because we only support sha-1.');
            return this.PRESERVE_HANDLER;

            // tslint:disable:max-line-length
            /* @TODO
             * Send a service discovery information request to the generating entity.
             * Receive a service discovery information response from the generating entity.
             * Do not validate or globally cache the verification string as described below; instead, the processing application SHOULD associate the discovered identity+features only with the JabberID of the generating entity.
             */
        }

        const discoInfoRepository = this.account.getDiscoInfoRepository();

        if (!DiscoInfo.exists(version)) {
            discoInfoRepository
                .requestDiscoInfo(from, node)
                .then(requestedDiscoInfo => {
                    if (version !== requestedDiscoInfo.getCapsVersion()) {
                        Log.warn(
                            `Caps version from ${
                                from.full
                            } doesn't match. Expected: ${requestedDiscoInfo.getCapsVersion()}. Actual: ${version}.`
                        );
                    }

                    discoInfoRepository.addRelation(from, requestedDiscoInfo);
                })
                .catch(err => {
                    Log.warn('Something went wrong during disco retrieval: ', err);
                });
        } else {

            discoInfoRepository.addRelation(from, discoInfo);
        }

        return this.PRESERVE_HANDLER;
    }
}
