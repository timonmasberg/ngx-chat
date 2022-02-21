/* tslint:disable:max-line-length */
// Type definitions for @converse/headless
// Project: @converse/headless
// Definitions by: CodeBastard <https://stackoverflow.com/users/6379296/codebastard>

declare module '@converse/headless/core' {

interface ConverseSettings {

    /**
     * Default: login
     * Allowed values: login, external, anonymous, prebind
     * This option states the way Converse will authenticate.
     * login
     * The default means is login, which means that the user either logs in manually with their username and password, or automatically if used together with auto_login set to true and jid and password values.
     * external
     * This setting will still show a login form and submit button, but the form will only contain an input for the user’s JID, not for the password.
     * That’s because this setting is intended to be used when you are using SASL-EXTERNAL as authentication mechanism, in which case a password is usually not required.
     * SASL-EXTERNAL is generally used together with x509 client certificates to enable passwordless login or 2-factor authentication.
     * For more details on this, read [this blog post](https://opkode.com/blog/strophe_converse_sasl_external/).
     * anonymous
     * This enables anonymous login if the XMPP server supports it. This option can be used together with auto_login to automatically and anonymously log a user in as soon as the page loads.
     * The server’s domain is passed in via the jid setting.
     * prebind
     * See also: Shared Sessions
     * Use this option when you want to attach to an existing XMPP BOSH session.
     * Usually a BOSH session is set up server-side in your web app.
     * Attaching to an existing BOSH session that was set up server-side is useful when you want to maintain a persistent single session for your users instead of requiring them to log in manually.
     * When a BOSH session is initially created, you’ll receive three tokens. A JID (jabber ID), SID (session ID) and RID (Request ID).
     * Converse needs these tokens in order to attach to that same session.
     * In addition to setting authentication to prebind, you’ll also need to set the prebind_url and bosh-service-url.
     * Here’s an example of Converse being initialized with these options:
     *
     * converse.initialize({
     *  bosh_service_url: 'https://bind.example.com',
     *  jid: 'me@example.com',
     *  authentication: 'prebind',
     *  prebind_url: 'http://example.com/api/prebind',
     *  auto_login: true,
     *  allow_logout: false
     *  });
     */
    authentication: 'login' | 'external' | 'anonymous' | 'prebind';

    /**
     * Default: false
     * If true, and the XMPP server on which the current user is logged in supports multi-user chat, then a list of rooms on that server will be fetched in the “Query for Groupchats” modal.
     * Not recommended for servers with lots of chatrooms.
     * For each room on the server a query is made to fetch further details (e.g. features, number of occupants etc.), so on servers with many rooms this option will create lots of extra connection traffic.
     * If the muc_domain is locked with the locked_muc_domain setting, then rooms will automatically be fetched in the “Query for Groupchats” modal, regardless of the value of this setting.
     */
    auto_list_rooms?: boolean;

    /**
     * Default: false
     * If true, the user will automatically subscribe back to any contact requests.
     */
    auto_subscribe?: boolean;

    /**
     * Default: undefined
     * Example: http://xmpp.example.com:5280/bosh/
     * Example with reverse-proxy and TLS: https://xmpp.example.com/bosh/
     * To connect to an XMPP server over HTTP you need a BOSH connection manager which acts as a middle man between the HTTP and XMPP protocols.
     * The bosh_service_url setting takes the URL of a BOSH connection manager.
     * Please refer to your XMPP server’s documentation on how to enable BOSH. For more information, read this blog post: Which BOSH server do you need?
     * A more modern alternative to BOSH is to use websockets. Please see the websocket_url configuration setting.
     */
    bosh_service_url?: string;

    /**
     * Default: undefined
     * Example: ws://xmpp.example.com:5280/ws/
     * Example with reverse-proxy and TLS: wss://xmpp.example.com/ws/
     * This option is used to specify a websocket URI to which Converse can connect to.
     * Websockets provide a more modern and effective two-way communication protocol between the browser and a server, effectively emulating TCP at the application layer and therefore overcoming many of the problems with existing long-polling techniques for bidirectional HTTP (such as BOSH).
     * Please refer to your XMPP server’s documentation on how to enable websocket support.
     */
    websocket_url?: string;

    /**
     * Default: Auto-detection of the User/Browser language or en;
     * Specify the locale/language.
     * The translations for that locale must be served in JSON format at /dist/locales/${i18n}-LC_MESSAGES-converse-po.js. The default webpack configuration for Converse.js ensures that these files are generated and placed in the right location.
     * If an explicit locale is specified via the i18n setting and the translations for that locale are not found, then Converse will fall back to trying to determine the browser’s language and fetching those translations, or if that fails the default English strings will be used.
     */
    i18n?: 'en' | 'de';

    /**
     * Default: false
     * Plays a notification sound when you receive a personal message or when your nickname is mentioned in a chatroom.
     * Inside the ./sounds directory of the Converse repo you’ll see MP3 and Ogg formatted sound files. We need both, because neither format is supported by all browsers.
     * You can set the URL where the sound files are hosted with the sounds_path option.
     * Requires the src/converse-notification.js plugin.
     */
    play_sounds?: boolean;

    /**
     * Default: false (true when the view_mode is set to fullscreen)
     * The “controlbox” refers to the special chatbox containing your contacts roster, status widget, chatrooms and other controls.
     * By default this box is hidden and can be toggled by clicking on any element in the page with class toggle-controlbox.
     * If this options is set to true, the controlbox will by default be shown upon page load.
     * However, be aware that even if this value is set to false, if the controlbox is open, and the page is reloaded, then it will stay open on the new page as well.
     */
    show_controlbox_by_default?: boolean;

    /**
     * Default: true
     * If set to true, Converse will show any roster groups you might have configured.
     * Note
     * It’s currently not possible to use Converse to assign contacts to groups. Converse can only show users and groups that were previously configured elsewhere.
     */
    roster_groups?: boolean;

    /**
     * TODO
     */
    debug?: boolean;

    /**
     * Default: []
     * A list of plugin names that are whitelisted and will therefore be initialized once converse.initialize is called.
     * From Converse 3.0 onwards most of the API is available only to plugins and all plugins need to be whitelisted first.
     * This is done to prevent malicious scripts from using the API to trick users or to read their conversations.
     * By default, all the core plugins are already whitelisted.
     * These are:
     * converse-bookmarks
     * converse-chatboxes
     * converse-chatview
     * converse-controlbox
     * converse-core
     * converse-disco
     * converse-dragresize
     * converse-fullscreen
     * converse-headline
     * converse-mam
     * converse-minimize
     * converse-muc
     * converse-muc-embedded
     * converse-notification
     * converse-ping
     * converse-profile
     * converse-register
     * converse-roomslist
     * converse-rosterview
     * converse-singleton
     * converse-spoilers
     * converse-vcard'
     * Note
     * If you are using a custom build which excludes some core plugins, then you should blacklist them so that malicious scripts can’t register their own plugins under those names. See blacklisted_plugins for more info.
     * Example:
     *
     * require(['converse-core', 'converse-muc-embedded'], function (converse) {
     *  converse.initialize({
     *      // other settings removed for brevity
     *      whitelisted_plugins: ['myplugin']
     *   });
     * });
     */
    whitelisted_plugins: string[];

    /**
     * Default: false
     * This option can be used to let Converse automatically log the user in as soon as the page loads.
     * If authentication is set to login, then you will also need to provide a valid jid and password values, either manually by passing them in, or by the credentials_url setting. Setting a credentials_url is preferable to manually passing in jid and password values, because it allows better reconnection with auto_reconnect. When the connection drops, Converse will automatically fetch new login credentials from the credentials_url and reconnect.
     * If authentication is set to anonymous, then you will also need to provide the server’s domain via the jid setting.
     * This is a useful setting if you’d like to create a custom login form in your website. You’ll need to write some JavaScript to accept that custom form’s login credentials, then you can pass those credentials (jid and password) to converse.initialize to start Converse and log the user in to their XMPP account.
     * Note
     * The interaction between keepalive and auto_login is unfortunately inconsistent depending on the authentication method used.
     * If auto_login is set to false and authentication is set to anonymous, external or prebind, then Converse won’t automatically log the user in.
     * If authentication set to login the situation is much more ambiguous, since we don’t have a way to distinguish between whether we’re restoring a previous session (keepalive) or whether we’re automatically setting up a new session (auto_login).
     * So currently if EITHER keepalive or auto_login is true and authentication is set to login, then Converse will try to log the user in.
     */
    auto_login?: boolean;

    /**
     * The Jabber ID or “JID” of the current user. The JID uniquely identifies a user on the XMPP network. It looks like an email address, but it’s used for instant messaging instead.
     * This value may be provided together with a password instead of supplying a credentials_url when setting auto_login to true.
     */
    jid?: string;

    /**
     * The password used for auto_login
     */
    password?: string;
}


/**
 * ### The Public API
 *
 * This namespace contains public API methods which are
 * accessible on the global `converse` object.
 * They are public, because any JavaScript in the
 * page can call them. Public methods therefore don’t expose any sensitive
 * or closure data. To do that, you’ll need to create a plugin, which has
 * access to the private API method.
 *
 * @global
 * @namespace converse
 */
namespace converse {

    const CHAT_STATES: ['active', 'composing', 'gone', 'inactive', 'paused'];

    const keycodes: {
        TAB: 9,
        ENTER: 13,
        SHIFT: 16,
        CTRL: 17,
        ALT: 18,
        ESCAPE: 27,
        LEFT_ARROW: 37,
        UP_ARROW: 38,
        RIGHT_ARROW: 39,
        DOWN_ARROW: 40,
        FORWARD_SLASH: 47,
        AT: 50,
        META: 91,
        META_RIGHT: 93
    };


    function initialize(settings: ConverseSettings): Promise<void>;

    /**
     * Exposes methods for adding and removing plugins. You'll need to write a plugin
     * if you want to have access to the private API methods defined further down below.
     *
     * For more information on plugins, read the documentation on [writing a plugin](/docs/html/plugin_development.html).
     * @namespace plugins
     * @memberOf converse
     */
    const plugins: {
        /**
         * Registers a new plugin.
         * @method converse.plugins.add
         * @param {string} name The name of the plugin
         * @param {object} plugin The plugin object
         * @example
         *  const plugin = {
         *      initialize: function () {
         *          // Gets called as soon as the plugin has been loaded.
         *
         *          // Inside this method, you have access to the private
         *          // API via `_converse.api`.
         *
         *          // The private _converse object contains the core logic
         *          // and data-structures of Converse.
         *      }
         *  }
         *  converse.plugins.add('myplugin', plugin);
         */
        add(name: string, plugin: ConversePlugin): void;
    };

    /**
     * Utility methods and globals from bundled 3rd party libraries.
     * @typedef ConverseEnv
     * @property {function} converse.env.$build    - Creates a Strophe.Builder, for creating stanza objects.
     * @property {function} converse.env.$iq       - Creates a Strophe.Builder with an <iq/> element as the root.
     * @property {function} converse.env.$msg      - Creates a Strophe.Builder with an <message/> element as the root.
     * @property {function} converse.env.$pres     - Creates a Strophe.Builder with an <presence/> element as the root.
     * @property {function} converse.env.Promise   - The Promise implementation used by Converse.
     * @property {function} converse.env.Strophe   - The [Strophe](http://strophe.im/strophejs) XMPP library used by Converse.
     * @property {function} converse.env.f         - And instance of Lodash with its methods wrapped to produce immutable auto-curried iteratee-first data-last methods.
     * @property {function} converse.env.sizzle    - [Sizzle](https://sizzlejs.com) CSS selector engine.
     * @property {function} converse.env.sprintf
     * @property {object} converse.env._           - The instance of [lodash-es](http://lodash.com) used by Converse.
     * @property {object} converse.env.dayjs       - [DayJS](https://github.com/iamkun/dayjs) date manipulation library.
     * @property {object} converse.env.utils       - Module containing common utility methods used by Converse.
     * @memberOf converse
     */
    const env: {
        $build,
        $iq,
        $msg,
        $pres,
        utils,
        Collection,
        Model,
        Promise,
        Strophe,
        URI,
        dayjs,
        html,
        log,
        sizzle,
        sprintf,
        u,
    };
}

interface ConversePlugin {
    /**
     * Gets called as soon as the plugin has been loaded.
     *
     * Inside this method, you have access to the private
     * API via `_converse.api`.
     *
     * The private _converse object contains the core logic
     * and data-structures of Converse.
     */
    initialize(): void;
}


/**
 * ### The private API
 *
 * The private API methods are only accessible via the closure {@link _converse}
 * object, which is only available to plugins.
 *
 * These methods are kept private (i.e. not global) because they may return
 * sensitive data which should be kept off-limits to other 3rd-party scripts
 * that might be running in the page.
 *
 * @namespace _converse.api
 * @memberOf _converse
 */
namespace _converse.api {


    /**
     * This grouping collects API functions related to the current logged-in user.
     *
     * @namespace _converse.api.user
     * @memberOf _converse.api
     */
    const user: UserApi;

    /**
     * This grouping collects API functions related to the XMPP connection.
     *
     * @namespace _converse.api.connection
     * @memberOf _converse.api
     */
    const connection: ConnectionApi;

    /**
     * Represents an open/ongoing chat conversation.
     *
     * @class
     * @namespace _converse.ChatBox
     * @memberOf _converse
     */
    const ChatBox: ChatBoxApi;

}

interface ChatBoxApi {
    /**
     * returns an extended Backbone.Model
     */
    getMessagesCollection(): unknown;

    getMessagesCacheKey(): string;

    getNotificationsText(): string;

    /**
     * fills up the _converse.Messages() backBone model collection
     */
    fetchMessages(): Promise<void>;
}

interface UserSettingsApi {
    placeholder: boolean;
}

interface UserApi {
    settings: UserSettingsApi;

    /**
     * @method _converse.api.user.jid
     * @returns {string} The current user's full JID (Jabber ID)
     * @example _converse.api.user.jid())
     */
    jid();

    /**
     * Logs the user in.
     *
     * If called without any parameters, Converse will try
     * to log the user in by calling the `prebind_url` or `credentials_url` depending
     * on whether prebinding is used or not.
     *
     * @method _converse.api.user.login
     * @param {string} [jid]
     * @param {string} [password]
     * @param {boolean} [automatic=false] - An internally used flag that indicates whether
     *  this method was called automatically once the connection has been
     *  initialized. It's used together with the `auto_login` configuration flag
     *  to determine whether Converse should try to log the user in if it
     *  fails to restore a previous auth'd session.
     *  @returns  {void}
     */
    login(jid: string, password: string, automatic: boolean);

    /**
     * Logs the user out of the current XMPP session.
     * @method _converse.api.user.logout
     * @example _converse.api.user.logout();
     */
    logout(): Promise<void>;
}

interface ConnectionApi {
    /**
     * @method _converse.api.connection.connected
     * @memberOf _converse.api.connection
     * @returns {boolean} Whether there is an established connection or not.
     */
    connected(): boolean;

    /**
     * Terminates the connection.
     *
     * @method _converse.api.connection.disconnect
     * @memberOf _converse.api.connection
     */
    disconnect(): void;

    /**
     * Can be called once the XMPP connection has dropped, and we want
     * to attempt reconnection.
     * Only needs to be called once, if reconnect fails Converse will
     * attempt to reconnect every two seconds, alternating between BOSH and
     * Websocket if URLs for both were provided.
     * @method reconnect
     * @memberOf _converse.api.connection
     */
    reconnect(): void;

    /**
     * Utility method to determine the type of connection we have
     * @method isType
     * @memberOf _converse.api.connection
     * @returns {boolean}
     */
    isType(type: string): boolean;
}
}
