import debounce from 'lodash-es/debounce';
import compact from 'lodash-es/compact';
import {Strophe} from 'strophe.js';
import {LogService} from './service/log.service';
import {Observable, Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

export enum AuthenticationMode {
    LOGIN,
    ANONYMOUS,
    PREBIND,
    EXTERNAL,
}

/**
 * The Connection class manages the connection to the XMPP server. It's
 * agnostic concerning the underlying protocol (i.e. websocket, long-polling
 * via BOSH or websocket inside a shared worker).
 */
export class StropheConnection extends Strophe.Connection {

    jid: string;

    userJid$: Observable<string>;

    private readonly userJidSubject = new Subject<string>();

    willReconnect$: Observable<void>;
    willReconnectSubject = new Subject<void>();

    afterResourceBindingSubject = new Subject<void>();
    reconnectedSubject = new Subject<void>();
    connectedSubject = new Subject<void>();
    disconnectedSubject = new Subject<void>();

    // these declarations are for better work on the strophe native functions
    connected: boolean;

    private readonly debouncedReconnect = debounce(this.reconnect, 3000);

    private bosh: Bosh;

    private reconnecting = false;

    private connectionStatus: { status: Strophe.Status, message: string };

    private session: Record<string, unknown>;
    private bareJid: string;
    private domainJid: string;

    private websocketUrl: string;
    private boshServiceUrl: string;

    private disconnectionCause: Strophe.Status;
    private disconnectionReason: string;
    private send_initial_presence: boolean;


    private constructor(
        private readonly logService: LogService,
        private readonly settings = {
            discoverConnectionMethods: true,
            authenticationMode: AuthenticationMode.LOGIN,
            clearCacheOnLogout: true,
            connectionOptions: {worker: undefined},
            automaticLogin: false,
            password: null,
            credentialsUrl: null,
            prebindUrl: null,
        },
        connections: {
            boshServiceUrl: string,
            websocketUrl: string,
            connection_url: string,
        },
        options = {keepalive: true, explicitResourceBinding: true}
    ) {
        super(connections.connection_url, options);
        this.websocketUrl = connections.websocketUrl;
        this.boshServiceUrl = connections.boshServiceUrl;
        this.userJid$ = this.userJidSubject.asObservable();
        this.willReconnect$ = this.willReconnectSubject.asObservable();
        this.bosh = new Bosh(this, settings.prebindUrl);
    }

    /**
     * Logs the user in.
     *
     * If called without any parameters, Converse will try
     * to log the user in by calling the `prebind_url` or `credentials_url` depending
     * on whether prebinding is used or not.
     *
     * @param {string} [jid]
     * @param {string} [password]
     * @param {boolean} [automatic=false] - An internally used flag that indicates whether
     *  this method was called automatically once the connection has been
     *  initialized. It's used together with the `auto_login` configuration flag
     *  to determine whether Converse should try to log the user in if it
     *  fails to restore a previous auth'd session.
     *  @returns  {void}
     */
    async login(jid = this.jid, password?: string, automatic = false) {
        if (this.settings.connectionOptions?.worker && (await this.restoreWorkerSession())) {
            return;
        }
        if (jid) {
            jid = await this.setUserJID(jid);
        }

        // See whether there is a BOSH session to re-attach to
        if (await this.bosh.restoreBOSHSession()) {
            return;
        }
        if (this.settings.authenticationMode === AuthenticationMode.PREBIND && (!automatic || this.settings.automaticLogin)) {
            return this.bosh.startNewPreboundBOSHSession();
        }


        password = password ?? this.settings.password;
        const credentials = (jid && password) ? {jid, password} : null;
        await this.attemptNonPreboundSession(credentials, automatic);
    }

    async attemptNonPreboundSession(credentials?, automatic = false) {
        if (this.settings.authenticationMode === AuthenticationMode.LOGIN) {
            // XXX: If EITHER ``keepalive`` or ``auto_login`` is ``true`` and
            // ``authentication`` is set to ``login``, then Converse will try to log the user in,
            // since we don't have a way to distinguish between wether we're
            // restoring a previous session (``keepalive``) or whether we're
            // automatically setting up a new session (``auto_login``).
            // So we can't do the check (!automatic || _converse.api.settings.get("auto_login")) here.
            if (credentials) {
                await this.connectNonPreboundSession(credentials);
            } else if (this.settings.credentialsUrl) {
                // We give credentials_url preference, because
                // _converse.connection.pass might be an expired token.
                await this.connectNonPreboundSession(await this.getLoginCredentials(this.settings.credentialsUrl));
            } else if (this.jid && (this.settings.password || (this as unknown as any).pass)) {
                await this.connectNonPreboundSession();
            } else if ('credentials' in navigator) {
                await this.connectNonPreboundSession(await this.getLoginCredentialsFromBrowser());
            } else {
                this.logService.warn('attemptNonPreboundSession: Couldn\'t find credentials to log in with');
            }
        } else if ([AuthenticationMode.ANONYMOUS, AuthenticationMode.EXTERNAL].includes(this.settings.authenticationMode) && (!automatic || this.settings.automaticLogin)) {
            await this.connectNonPreboundSession();
        }
    }

    async getLoginCredentialsFromBrowser() {
        try {
            // https://github.com/microsoft/TypeScript/issues/34550
            const creds = await navigator.credentials.get({'password': true} as unknown);
            if (creds && creds.type == 'password' && StropheConnection.isValidJID(creds.id)) {
                await this.setUserJID(creds.id);
                return {'jid': creds.id, 'password': (creds as unknown as any).password};
            }
        } catch (e) {
            this.logService.error(e);
        }
        return null;
    }

    private static isValidJID(jid) {
        if (typeof jid === 'string') {
            return compact(jid.split('@')).length === 2 && !jid.startsWith('@') && !jid.endsWith('@');
        }
        return false;
    };

    fetchLoginCredentialsInterceptor = async (xhr) => xhr;

    async getLoginCredentials(credentialsURL: string) {
        let credentials;
        let wait = 0;
        while (!credentials) {
            try {
                credentials = await this.fetchLoginCredentials(wait, credentialsURL); // eslint-disable-line no-await-in-loop
            } catch (e) {
                this.logService.error('Could not fetch login credentials');
                this.logService.error(e);
            }
            // If unsuccessful, we wait 2 seconds between subsequent attempts to
            // fetch the credentials.
            wait = 2000;
        }
        return credentials;
    }

    async fetchLoginCredentials(wait = 0, credentialsURL: string) {
        return new Promise(
            debounce(async (resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.open('GET', credentialsURL, true);
                xhr.setRequestHeader('Accept', 'application/json, text/javascript');
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 400) {
                        const data = JSON.parse(xhr.responseText);
                        this.setUserJID(data.jid).then(() => {
                            resolve({
                                jid: data.jid,
                                password: data.password
                            });
                        });
                    } else {
                        reject(new Error(`${xhr.status}: ${xhr.responseText}`));
                    }
                };
                xhr.onerror = reject;
                /**
                 * *Hook* which allows modifying the server request
                 * @event _converse#beforeFetchLoginCredentials
                 */
                xhr = await this.fetchLoginCredentialsInterceptor(xhr);
                xhr.send();
            }, wait));
    }


    async connectNonPreboundSession(credentials?) {
        if ([AuthenticationMode.ANONYMOUS, AuthenticationMode.EXTERNAL].includes(this.settings.authenticationMode)) {
            if (!this.jid) {
                throw new Error('Config Error: when using anonymous login ' +
                    'you need to provide the server\'s domain via the \'jid\' option. ' +
                    'Either when calling converse.initialize, or when calling ' +
                    '_converse.api.user.login.');
            }
            if (!this.reconnecting) {
                super.reset();
            }
            await this.connect(this.jid.toLowerCase(), null, null);
        } else if (this.settings.authenticationMode === AuthenticationMode.LOGIN) {
            const password = credentials ? credentials.password : ((this as unknown as any).pass ?? this.settings.password);
            if (!password) {
                if (this.settings.automaticLogin) {
                    throw new Error('autoLogin: If you use auto_login and ' +
                        'authentication=\'login\' then you also need to provide a password.');
                }
                this.setDisconnectionCause(Strophe.Status.AUTHFAIL, undefined, true);
                super.disconnect('');
                return;
            }
            if (!this.reconnecting) {
                super.reset();
            }
            await this.connect(this.jid, password);
        }
    }


    static async createConnection(
        logService: LogService,
        connectionUrls: {
            boshServiceUrl?: string,
            websocketUrl?: string,
            domain?: string
        },
        authenticationMode = AuthenticationMode.LOGIN
    ): Promise<Strophe.Connection> {
        const {boshServiceUrl, websocketUrl, domain} = connectionUrls;

        if (!boshServiceUrl && authenticationMode === AuthenticationMode.PREBIND) {
            throw new Error('authentication is set to \'prebind\' but we don\'t have a BOSH connection');
        }

        let connection_url = '';
        if (('WebSocket' in window || 'MozWebSocket' in window) && websocketUrl) {
            connection_url = websocketUrl;
        } else if (boshServiceUrl) {
            connection_url = boshServiceUrl;
        }
        const connection = new StropheConnection(
            logService,
            {
                discoverConnectionMethods: true,
                authenticationMode,
                clearCacheOnLogout: true,
                connectionOptions: {worker: undefined},
                automaticLogin: false,
                password: null,
                credentialsUrl: null,
                prebindUrl: null
            },
            {
                boshServiceUrl,
                websocketUrl,
                connection_url
            },
        );

        if (!connection_url && domain) {
            await connection.discoverConnectionMethods(domain);
        }

        return connection;
    }

    static generateResource() {
        return `/ngx-chat-${Math.floor(Math.random() * 139749528).toString()}`;
    }


    async onDomainDiscovered(response) {
        const text = await response.text();
        const xrd = (new window.DOMParser()).parseFromString(text, 'text/xml').firstElementChild;
        if (xrd.nodeName != 'XRD' || xrd.getAttribute('xmlns') != 'http://docs.oasis-open.org/ns/xri/xrd-1.0') {
            return this.logService.warn('Could not discover XEP-0156 connection methods');
        }
        const bosh_links = xrd.querySelectorAll(`Link[rel="urn:xmpp:alt-connections:xbosh"]`);
        const ws_links = xrd.querySelectorAll(`Link[rel="urn:xmpp:alt-connections:websocket"]`);
        const bosh_methods = Array.from(bosh_links).map(el => el.getAttribute('href'));
        const ws_methods = Array.from(ws_links).map(el => el.getAttribute('href'));
        if (bosh_methods.length === 0 && ws_methods.length === 0) {
            this.logService.warn('Neither BOSH nor WebSocket connection methods have been specified with XEP-0156.');
        } else {
            this.websocketUrl = ws_methods.pop();
            this.boshServiceUrl = bosh_methods.pop();
            this.service = this.websocketUrl ?? this.boshServiceUrl;
            super.setProtocol();
        }
    }

    /**
     * Adds support for XEP-0156 by quering the XMPP server for alternate
     * connection methods. This allows users to use the websocket or BOSH
     * connection of their own XMPP server instead of a proxy provided by the
     * host of Converse.js.
     * @method Connnection.discoverConnectionMethods
     * @param domain the xmpp server domain to requests the connection urls from
     */
    async discoverConnectionMethods(domain: string) {
        // Use XEP-0156 to check whether this host advertises websocket or BOSH connection methods.
        const options = {
            'mode': 'cors' as RequestMode,
            'headers': {
                'Accept': 'application/xrd+xml, text/xml'
            }
        };
        const url = `https://${domain}/.well-known/host-meta`;
        let response;
        try {
            response = await fetch(url, options);
        } catch (e) {
            this.logService.error(`Failed to discover alternative connection methods at ${url}`);
            this.logService.error(e);
            return;
        }
        if (response.status >= 200 && response.status < 400) {
            await this.onDomainDiscovered(response);
        } else {
            this.logService.warn('Could not discover XEP-0156 connection methods');
        }
    }

    /**
     * Establish a new XMPP session by logging in with the supplied JID and
     * password.
     * @method Connnection.connect
     * @param { String } jid userId@domain.tld/resources
     * @param { String } password
     * @param { Function } callback
     */
    async connect(jid: string, password: string, callback?: (status: Strophe.Status, condition: string, elem: Element) => unknown) {
        if (this.settings.discoverConnectionMethods) {
            const domain = Strophe.getDomainFromJid(jid);
            await this.discoverConnectionMethods(domain);
        }
        if (!this.boshServiceUrl && !this.websocketUrl) {
            throw new Error('You must supply a value for either the bosh_service_url or websocket_url or both.');
        }
        const boshWait = 59;
        super.connect(jid, password, callback || this.onConnectStatusChanged, boshWait);
    }

    /**
     * Switch to a different transport if a service URL is available for it.
     *
     * When reconnecting with a new transport, we call setUserJID
     * so that a new resource is generated, to avoid multiple
     * server-side sessions with the same resource.
     *
     * We also call `_proto._doDisconnect` so that connection event handlers
     * for the old transport are removed.
     */
    async switchTransport() {
        if (this.isType('websocket') && this.boshServiceUrl) {
            await this.setUserJID(this.bareJid);
            Object.getPrototypeOf(this)._doDisconnect();
            Object.setPrototypeOf(this, new Strophe.Bosh(this));
            this.service = this.boshServiceUrl;
        } else if (this.isType('bosh') && this.websocketUrl) {
            if (this.settings.authenticationMode === AuthenticationMode.ANONYMOUS) {
                // When reconnecting anonymously, we need to connect with only
                // the domain, not the full JID that we had in our previous
                // (now failed) session.
                await this.setUserJID(this.domainJid);
            } else {
                await this.setUserJID(this.bareJid);
            }
            Object.getPrototypeOf(this)._doDisconnect();
            Object.setPrototypeOf(this, new Strophe.Websocket(this));
            this.service = this.websocketUrl;
        }
    }

    async reconnect() {
        this.logService.debug('RECONNECTING: the connection has dropped, attempting to reconnect.');
        this.reconnecting = true;

        const isAuthenticationAnonymous = this.settings.authenticationMode === AuthenticationMode.ANONYMOUS;

        if (this.connectionStatus.status === Strophe.Status.CONNFAIL) {
            await this.switchTransport();
        } else if (this.connectionStatus.status === Strophe.Status.AUTHFAIL && isAuthenticationAnonymous) {
            // When reconnecting anonymously, we need to connect with only
            // the domain, not the full JID that we had in our previous
            // (now failed) session.
            await this.setUserJID(this.domainJid);
        }

        this.setConnectionStatus(
            Strophe.Status.RECONNECTING,
            'The connection has dropped, attempting to reconnect.'
        );
        /**
         * Triggered when the connection has dropped, but we will attempt
         * to reconnect again.
         */
        this.willReconnectSubject.next();

        if (isAuthenticationAnonymous && this.settings.clearCacheOnLogout) {
            this.clearSession();
        }

        return await this.login();
    }

    /**
     * Called as soon as a new connection has been established, either
     * by logging in or by attaching to an existing BOSH session.
     * @method Connection.onConnected
     * @param {boolean} reconnecting - Whether we reconnected from an earlier dropped session.
     */
    async onConnected(reconnecting: boolean) {
        delete this.reconnecting;
        super.flush(); // Solves problem of returned PubSub BOSH response not received by browser
        await this.setUserJID(this.jid);

        /**
         * Synchronous event triggered after we've sent an IQ to bind the
         * user's JID resource for this session.
         */
        this.afterResourceBindingSubject.next();

        if (reconnecting) {
            /**
             * After the connection has dropped and we have reconnected.
             * Any Strophe stanza handlers will have to be registered anew.
             */
            this.reconnectedSubject.next();
        } else {
            /**
             * Triggered after the connection has been established
             */
            this.connectedSubject.next();
        }
    }

    /**
     * Used to keep track of why we got disconnected, so that we can
     * decide on what the next appropriate action is (in onDisconnected)
     * @method Connection.setDisconnectionCause
     * @param {number} cause - The status number as received from Strophe.
     * @param {string} [reason] - An optional user-facing message as to why
     *  there was a disconnection.
     * @param {boolean} [override] - An optional flag to replace any previous
     *  disconnection cause and reason.
     */
    setDisconnectionCause(cause: number, reason?: string, override = false) {
        if (cause === undefined) {
            delete this.disconnectionCause;
            delete this.disconnectionReason;
        } else if (this.disconnectionCause === undefined || override) {
            this.disconnectionCause = cause;
            this.disconnectionReason = reason;
        }
    }

    setConnectionStatus(status: Strophe.Status, message: string) {
        super.status = status;
        this.connectionStatus = {status, message};
    }

    async finishDisconnection() {
        // Properly tear down the session so that it's possible to manually connect again.
        this.logService.debug('DISCONNECTED');
        delete this.reconnecting;
        super.reset();
        await this.clearSession();
        /**
         * Triggered after we disconnected from the XMPP server.
         */
        this.disconnectedSubject.next();
    }

    /**
     * Gets called once strophe's status reaches Strophe.Status.DISCONNECTED.
     * Will either start a teardown process for converse.js or attempt
     * to reconnect.
     * @method onDisconnected
     */
    async onDisconnected() {
        if (this.settings.automaticLogin) {
            const reason = this.disconnectionReason;
            if (this.disconnectionCause === Strophe.Status.AUTHFAIL) {
                if (this.settings.credentialsUrl || this.settings.authenticationMode === AuthenticationMode.ANONYMOUS) {
                    // If `credentials_url` is set, we reconnect, because we might
                    // be receiving expirable tokens from the credentials_url.
                    //
                    // If `authentication` is anonymous, we reconnect because we
                    // might have tried to attach with stale BOSH session tokens
                    // or with a cached JID and password
                    return this.reconnect();
                } else {
                    return this.finishDisconnection();
                }
            } else if (this.connectionStatus.status === Strophe.Status.CONNECTING) {
                // Don't try to reconnect if we were never connected to begin
                // with, otherwise an infinite loop can occur (e.g. when the
                // BOSH service URL returns a 404).
                this.setConnectionStatus(
                    Strophe.Status.CONNFAIL,
                    'An error occurred while connecting to the chat server.'
                );
                return this.finishDisconnection();
            } else if (
                this.disconnectionCause === Strophe.Status.DISCONNECTING ||
                reason === Strophe.ErrorCondition.NO_AUTH_MECH ||
                reason === 'host-unknown' ||
                reason === 'remote-connection-failed'
            ) {
                return this.finishDisconnection();
            }
            await this.reconnect();
        } else {
            return this.finishDisconnection();
        }
    }

    private readonly CONNECTION_STATUS = {
        [Strophe.Status.ATTACHED]: 'ATTACHED',
        [Strophe.Status.AUTHENTICATING]: 'AUTHENTICATING',
        [Strophe.Status.AUTHFAIL]: 'AUTHFAIL',
        [Strophe.Status.CONNECTED]: 'CONNECTED',
        [Strophe.Status.CONNECTING]: 'CONNECTING',
        [Strophe.Status.CONNFAIL]: 'CONNFAIL',
        [Strophe.Status.DISCONNECTED]: 'DISCONNECTED',
        [Strophe.Status.DISCONNECTING]: 'DISCONNECTING',
        [Strophe.Status.ERROR]: 'ERROR',
        [Strophe.Status.RECONNECTING]: 'RECONNECTING',
        [Strophe.Status.REDIRECT]: 'REDIRECT',
    };

    /**
     * Callback method called by Strophe as the Connection goes
     * through various states while establishing or tearing down a
     * connection.
     * @param {number} status
     * @param {string} message
     */
    async onConnectStatusChanged(status: Strophe.Status, message: string) {
        this.logService.debug(`Status changed to: ${this.CONNECTION_STATUS[status]}`);
        if (status === Strophe.Status.ATTACHFAIL) {
            this.setConnectionStatus(status, message);
            super.worker_attach_promise?.resolve(false);

        } else if (status === Strophe.Status.CONNECTED || status === Strophe.Status.ATTACHED) {
            if (super.worker_attach_promise?.isResolved && this.connectionStatus.status === Strophe.Status.ATTACHED) {
                // A different tab must have attached, so nothing to do for us here.
                return;
            }
            this.setConnectionStatus(status, message);
            super.worker_attach_promise?.resolve(true);

            // By default we always want to send out an initial presence stanza.
            this.send_initial_presence = true;
            this.setDisconnectionCause(undefined);
            if (this.reconnecting) {
                this.logService.debug(status === Strophe.Status.CONNECTED ? 'Reconnected' : 'Reattached');
                await this.onConnected(true);
            } else {
                this.logService.debug(status === Strophe.Status.CONNECTED ? 'Connected' : 'Attached');
                if (this.restored) {
                    // No need to send an initial presence stanza when
                    // we're restoring an existing session.
                    this.send_initial_presence = false;
                }
                await this.onConnected(false);
            }
        } else if (status === Strophe.Status.DISCONNECTED) {
            this.setDisconnectionCause(status, message);
            await this.onDisconnected();
        } else if (status === Strophe.Status.BINDREQUIRED) {
            super.bind();
        } else if (status === Strophe.Status.ERROR) {
            this.setConnectionStatus(
                status,
                'An error occurred while connecting to the chat server.'
            );
        } else if (status === Strophe.Status.CONNECTING) {
            this.setConnectionStatus(status, message);
        } else if (status === Strophe.Status.AUTHENTICATING) {
            this.setConnectionStatus(status, message);
        } else if (status === Strophe.Status.AUTHFAIL) {
            if (!message) {
                message = 'Your XMPP address and/or password is incorrect. Please try again.';
            }
            this.setConnectionStatus(status, message);
            this.setDisconnectionCause(status, message, true);
            await this.onDisconnected();
        } else if (status === Strophe.Status.CONNFAIL) {
            let feedback = message;
            if (message === 'host-unknown' || message == 'remote-connection-failed') {
                feedback = 'Sorry, we could not connect to the XMPP host with domain: ' + this.domainJid;
            } else if (message !== undefined && message === Strophe?.ErrorCondition?.NO_AUTH_MECH) {
                feedback = 'The XMPP server did not offer a supported authentication mechanism';
            }
            this.setConnectionStatus(status, feedback);
            this.setDisconnectionCause(status, message);
        } else if (status === Strophe.Status.DISCONNECTING) {
            this.setDisconnectionCause(status, message);
        }
    }

    isType(type) {
        if (type.toLowerCase() === 'websocket') {
            return Object.getPrototypeOf(this) instanceof Strophe.Websocket;
        } else if (type.toLowerCase() === 'bosh') {
            return Strophe.Bosh && Object.getPrototypeOf(this) instanceof Strophe.Bosh;
        } else {
            return false;
        }
    }

    hasResumed() {
        if (this.settings.connectionOptions.worker || this.isType('bosh')) {
            return this.connectionStatus.status === Strophe.Status.ATTACHED;
        } else {
            // Not binding means that the session was resumed.
            return !super.do_bind;
        }
    }

    restoreWorkerSession() {
        super.attach(this.onConnectStatusChanged);
        super.worker_attach_promise = getOpenPromise();
        return super.worker_attach_promise;
    }

    /**
     * Stores the passed in JID for the current user, potentially creating a
     * resource if the JID is bare.
     *
     * @emits userJidSubject
     * @param {string} jid
     */
    async setUserJID(jid: string) {
        /**
         * Triggered whenever the user's JID has been updated
         */
        this.jid = jid;
        this.userJidSubject.next(this.jid);
        return this.jid;
    }


    private clearSession() {
        delete this.domainJid;
        delete this.bareJid;
        delete this.session;
        this.bosh = new Bosh(this, null);
    }

    killSessionBosh() {
        this.clearSession();
    }

    _changeConnectStatus(status: number, condition?: string, elem?: Element) {
        super._changeConnectStatus(status, condition, elem);
    }

    /** PrivateFunction: _addSysHandler
     *  _Private_ function to add a system level stanza handler.
     *
     *  This function is used to add a Strophe.Handler for the
     *  library code.  System stanza handlers are allowed to run before
     *  authentication is complete.
     *
     *  Parameters:
     *    @param {(element: Element) => boolean} handler - The callback function.
     *    @param {string} ns - The namespace to match.
     *    @param {string} name - The stanza name to match.
     *    @param {string} type - The stanza type attribute to match.
     *    @param {string} id - The stanza id attribute to match.
     */
    _addSysHandler(handler: (element: Element) => boolean, ns: string, name: string, type: string, id: string) {
        return super._addSysHandler(handler, ns, name, type, id);
    }
}


export function getOpenPromise<T>() {
    let wrapper: Strophe.PromiseWrapper<T>;
    const promise = Object.assign(new Promise<T>((resolve, reject) => {
        wrapper = {
            isResolved: false,
            isPending: true,
            isRejected: false,
            resolve,
            reject,
        };
    }), wrapper);
    promise.then(
        function(v) {
            promise.isResolved = true;
            promise.isPending = false;
            promise.isRejected = false;
            return v;
        },
        function(e) {
            promise.isResolved = false;
            promise.isPending = false;
            promise.isRejected = true;
            throw (e);
        }
    );
    return promise;
}

class Bosh {
    private jid: string;

    private destroySubject = new Subject<void>();
    noResumeableBOSHSession$: Observable<void>;
    private noResumeableBOSHSessionSubject = new Subject<void>();

    get rid() {
        // the property lies in the inner connection Bosh class of Strophe
        // https://github.com/strophe/strophejs/blob/master/src/bosh.js
        return (this.connection as unknown as any).rid ?? Object.getPrototypeOf(this.connection).rid;
    }

    get sid() {
        // the property lies in the inner connection Bosh class of Strophe
        // https://github.com/strophe/strophejs/blob/master/src/bosh.js
        return (this.connection as unknown as any).sid ?? Object.getPrototypeOf(this.connection).sid;
    }

    constructor(private readonly connection: StropheConnection, private readonly prebindUrl: string) {
        this.connection.userJid$.pipe(takeUntil(this.destroySubject)).subscribe((newJid) => this.jid = newJid);
        this.noResumeableBOSHSession$ = this.noResumeableBOSHSessionSubject.asObservable();
    }

    async restoreBOSHSession() {
        const jid = (await this.initBOSHSession());
        if (jid && (Object.getPrototypeOf(this.connection) instanceof Strophe.Bosh)) {
            try {
                (this.connection as Strophe.Connection).restore(jid, this.connection.onConnectStatusChanged);
                return true;
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    async initBOSHSession() {
        // new session
        if (this.connection.jid && this.jid !== this.connection.jid) {
            this.jid = await this.connection.setUserJID(this.connection.jid);
            return this.jid;
        }
        // Keepalive
        this.jid && await this.connection.setUserJID(this.jid);
        return this.jid;
    }

    startNewPreboundBOSHSession() {
        if (!this.prebindUrl) {
            throw new Error('startNewPreboundBOSHSession: If you use prebind then you MUST supply a prebind_url');
        }
        const xhr = new XMLHttpRequest();
        xhr.open('GET', this.prebindUrl, true);
        xhr.setRequestHeader('Accept', 'application/json, text/javascript');
        xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 400) {
                const data = JSON.parse(xhr.responseText);
                const jid = await this.connection.setUserJID(data.jid);
                (this.connection as Strophe.Connection).attach(
                    jid,
                    data.sid,
                    data.rid,
                    this.connection.onConnectStatusChanged,
                    BOSH_WAIT
                );
            } else {
                xhr.onerror(null);
            }
        };
        xhr.onerror = () => {
            this.connection.killSessionBosh();
            /**
             * Triggered when fetching prebind tokens failed
             */
            this.noResumeableBOSHSessionSubject.next();
        };
        xhr.send();
    }

    destroy() {
        this.destroySubject.next();
    }
}
