import JingleHandler from '../JingleHandler';
import JingleAbstractSession from '../../JingleAbstractSession';

export default class XMPPJingleHandler extends JingleHandler {
   protected onIncoming(session) {
       const jingleSession: JingleAbstractSession = super.onIncoming(session);

       jingleSession.onOnceIncoming();

       return jingleSession;
   }
}
