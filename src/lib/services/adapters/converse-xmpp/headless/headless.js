/* START: Removable components
 * --------------------
 * Any of the following components may be removed if they're not needed.
 */
import "./plugins/adhoc.js";            // XEP-0050 Ad Hoc Commands
import "./plugins/bookmarks";  // XEP-0199 XMPP Ping
import "./plugins/bosh.js";             // XEP-0206 BOSH
import "./plugins/caps";       // XEP-0115 Entity Capabilities
import "./plugins/carbons.js";          // XEP-0280 Message Carbons
import "./plugins/chat";       // RFC-6121 Instant messaging
import "./plugins/chatboxes";
import "./plugins/disco";      // XEP-0030 Service discovery
import "./plugins/headlines.js";        // Support for headline messages
import "./plugins/mam";        // XEP-0313 Message Archive Management
import "./plugins/muc";        // XEP-0045 Multi-user chat
import "./plugins/ping";       // XEP-0199 XMPP Ping
import "./plugins/pubsub.js";           // XEP-0060 Pubsub
import "./plugins/roster";     // RFC-6121 Contacts Roster
import "./plugins/smacks";     // XEP-0198 Stream Management
import "./plugins/status";
import "./plugins/vcard";      // XEP-0054 VCard-temp
/* END: Removable components */

import { converse } from "./core.js";

export default converse;
