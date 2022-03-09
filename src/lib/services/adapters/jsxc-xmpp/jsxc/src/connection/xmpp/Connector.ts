import Account from '../../Account';
import PersistentMap from '../../util/PersistentMap';
import Log from '../../util/Log';
import JID from '../../JID';
import StorageConnection from '../storage/Connection';
import XMPPConnection from './Connection';
import BaseError from '../../errors/BaseError';
import UUID from '../../util/UUID';
import {Strophe} from 'strophe.js';
import ConnectionError from '../../errors/ConnectionError';
import AuthenticationError from '../../errors/AuthenticationError';
import InvalidParameterError from '../../errors/InvalidParameterError';
import Client from '../../Client';
import SM from '../../StateMachine';
import {IConnection} from '../Connection.interface';

export enum TYPE {
    BOSH,
    WEBSOCKET,
}

interface ConnectionPayload {
    connection: StropheInnerConnection;
    status: Strophe.Status;
    condition: string;
}

interface StropheInnerConnection extends Strophe.Connection {
    features: HTMLElement;
    // added by us
    nextValidRid: (rid) => void;
    connect_callback: (status, condition) => void;
    _proto: {
        inactivity: number;
        rid: string;
        sid: string;
    };
    service: string;

    // @TODO remove current websocket reconnect workaround, but even conversjs caches the password
    password:string;
}

export default class Connector {
    private connectionParameters: PersistentMap;

    private readonly connectionArgs: string[];

    // tslint:disable-next-line:unified-signatures
    constructor(private account: Account, url: string, jid: string, ...remainingArgs: string[]) {
        let type = /^wss?:/.test(url) ? TYPE.WEBSOCKET : TYPE.BOSH;
        const storage = account.getStorage();
        this.connectionParameters = new PersistentMap(storage, 'connection');

        if (!(url && jid && remainingArgs[0])) {
            type = this.connectionParameters.get('type');

            // if (type === TYPE.WEBSOCKET) {
            //    throw new Error('Can\'t attach to websocket connection.');
            // }

            this.connectionArgs = [
                this.connectionParameters.get('url'),
                this.connectionParameters.get('jid'),
                this.connectionParameters.get('sid'),
                this.connectionParameters.get('rid'),
            ];
            // [password] || [sid, rid]
        } else if (remainingArgs.length === 1 || remainingArgs.length === 2) {
            this.connectionArgs = [url, jid, ...remainingArgs];


            this.connectionParameters.set('type', type);
            this.connectionParameters.remove('inactivity');
            this.connectionParameters.remove('timestamp');
        } else {
            throw new BaseError('Unsupported number of arguments');
        }
    }

    public async connect(): Promise<[Strophe.Status, IConnection]> {
        const inactivity = this.connectionParameters.get('inactivity');
        const timestamp = this.connectionParameters.get('timestamp');
        const isConnectionExpired = inactivity && timestamp && new Date().getTime() - timestamp > inactivity;

        if (isConnectionExpired) {
            Log.debug(
                `Inactivity: ${inactivity}, Last timestamp: ${timestamp}, Time diff: ${new Date().getTime() - timestamp}`
            );
            Log.warn('Credentials expired');

            this.account.triggerConnectionHook(Strophe.Status.CONNTIMEOUT);
            this.account.triggerConnectionHook(Strophe.Status.DISCONNECTED, 'timeout');

            throw new BaseError('Credentials expired');
        }

        const [url, jid, ...remainingArgs] = this.connectionArgs;
        try {
        const loginData = await this.login(url, jid, remainingArgs);
        return this.successfulConnected(loginData);
        } catch (e) {
            throw new ConnectionError(`Connector.connect: Creating a connection failed; url=${url}, jid=${jid}, remainingArgs=${remainingArgs}` );
        }
    }

    private login(url: string, jid: string, args: string[]) {
        const isWebsocket = url.startsWith('wss');
        const isLogin = args[0] && !args[1];
        const isReconnecting = args[0] && args[1];
        if (!jid) {
            throw new InvalidParameterError('I can not log in without a jid.');
        }

        if (!url) {
            throw new InvalidParameterError('I can not log in without an URL.');
        }
        if (isLogin) {
            const [password] = args;
            return this.loginWithPassword(url, jid, password);
        } else if (isReconnecting && !isWebsocket) {
            const [sid, rid] = args;
            return this.attachConnection(url, jid, sid, rid);
        } else if (isReconnecting && isWebsocket) {
            return this.reconnectToWebsocket(url, jid, this.connectionParameters.get('password'));
        } else {
            throw new Error('Login was called without arguments');
        }
    }


    private loginWithPassword(url: string, jid: string, password: string): Promise<ConnectionPayload> {
        const connection = this.prepareConnection(url);

        Log.debug('Try to establish a new connection.');

        if (jid.indexOf('/') < 0) {
            jid += '/jsxc-' + UUID.v4().slice(0, 8);
        }

        return new Promise<ConnectionPayload>((resolve, reject) => {
            connection.connect(jid, password, (status, condition) => {
                connection.password = password;
                this.resolveConnectionPromise(status, condition, connection, resolve, reject);
            });
        });
    }

    private reconnectToWebsocket(url: string, jid: string, password: string): Promise<ConnectionPayload> {
        const connection = this.prepareConnection(url);

        Log.debug('Try to attach old connection.');

        connection.disconnect('lost websocket connection');
        return new Promise((resolve, reject) => {
            connection.connect(jid, password, (status, condition) => {
                this.resolveConnectionPromise(status, condition, connection, resolve, reject);
            });
        });
    }

    private attachConnection(url: string, jid: string, sid: string, rid: string): Promise<ConnectionPayload> {
        const connection = this.prepareConnection(url);

        Log.debug('Try to attach old connection.');

        return new Promise((resolve, reject) => {
            connection.attach(jid, sid, rid, (status, condition) => {
                this.resolveConnectionPromise(status, condition, connection, resolve, reject);
            });
        });
    }

    private resolveConnectionPromise(
        status: Strophe.Status,
        condition: string,
        connection: StropheInnerConnection,
        resolve: (value: (PromiseLike<ConnectionPayload> | ConnectionPayload)) => void,
        reject: (reason?: any) => void
    ) {
        switch (status) {
            case Strophe.Status.DISCONNECTED:
            case Strophe.Status.CONNFAIL:
                reject(new ConnectionError(condition));
                break;
            case Strophe.Status.AUTHFAIL:
                reject(new AuthenticationError(condition));
                break;
            case Strophe.Status.ATTACHED:
                // flush connection in order we reuse a rid
                connection.flush();
                setTimeout(() => {
                    // attached doesn't mean the connection is working, but if something
                    // is wrong the server will immediately response with a connection failure.
                    resolve({
                        connection,
                        status,
                        condition,
                    });
                }, 1000);
                break;
            case Strophe.Status.CONNECTED:
                resolve({
                    connection,
                    status,
                    condition,
                });
                break;
            default:
                Log.debug('Strophe Connection Status: ', Object.keys(Strophe.Status)[status]);
        }
    }

    private prepareConnection(url: string): StropheInnerConnection {
        const connection = new Strophe.Connection(url);

        if (Client.isDebugMode()) {
            connection.xmlInput = data => {
                Log.debug('<', data);
            };
            connection.xmlOutput = data => {
                Log.debug('>', data);
            };
        }

        SM.changeState(SM.STATE.ESTABLISHING);

        return connection as StropheInnerConnection;
    }

    public getJID(): JID {
        return new JID(this.connectionParameters.get('jid'));
    }

    public getUrl(): string {
        return this.connectionParameters.get('url');
    }

    public getPassword(): string {
        if (this.connectionArgs.length === 3) {
            return this.connectionArgs[2];
        }
        return null;
    }

    public clearPassword() {
        if (this.connectionArgs.length === 3) {
            delete this.connectionArgs[2];
        }
    }

    private successfulConnected = (data: ConnectionPayload): [Strophe.Status, IConnection] => {
        const stropheConnection = data.connection;
        const status = data.status;
        const condition = data.condition;

        this.storeConnectionParameters(stropheConnection);
        this.replaceConnectionHandler(stropheConnection);
        this.addRidHandler(stropheConnection);
        this.addRidUnloadHandler(stropheConnection);

        const accountConnection = this.replaceStorageConnectionWithXMPPConnection(stropheConnection);

        if (stropheConnection.features) {
            this.storeConnectionFeatures(stropheConnection);
        }

        Log.debug('XMPP connection ready');

        this.account.triggerConnectionHook(status, condition);

        return [status, accountConnection];
    };

    private storeConnectionParameters(connection: StropheInnerConnection) {
        this.connectionParameters.set({
            url: connection.service,
            jid: connection.jid,
            sid: connection._proto.sid,
            rid: connection._proto.rid,
            password: connection.password,
            timestamp: new Date().getTime(),
        });

        if (connection._proto.inactivity) {
            const inactivity = connection._proto.inactivity * 1000;

            this.connectionParameters.set('inactivity', inactivity);
        }
    }

    private replaceConnectionHandler(connection: StropheInnerConnection) {
        connection.connect_callback = (status, condition) => {
            this.account.triggerConnectionHook(status, condition);

            if (status === Strophe.Status.DISCONNECTED) {
                this.account.connectionDisconnected();
            }
        };
    }

    private addRidHandler(connection: StropheInnerConnection) {
        connection.nextValidRid = rid => {
            const timestamp = new Date().getTime();

            this.connectionParameters.set('timestamp', timestamp);
            this.connectionParameters.set('rid', rid);
        };
    }

    private addRidUnloadHandler(connection: StropheInnerConnection) {
        $(window).on('unload', () => {
            connection.nextValidRid(connection._proto.rid);
        });
    }

    private replaceStorageConnectionWithXMPPConnection(stropheConnection) {
        let accountConnection = this.account.getConnection();
        const handlers = (accountConnection as StorageConnection).getHandlers();

        accountConnection.close();
        accountConnection = new XMPPConnection(this.account, stropheConnection);

        for (const handler of handlers) {
            accountConnection.registerHandler.apply(accountConnection, handler);
        }

        return accountConnection;
    }

    private storeConnectionFeatures(connection: StropheInnerConnection) {
        const from = new JID('', connection.domain, '');
        const stanza = connection.features;

        if (!stanza) {
            return;
        }

        const capsElement = stanza.querySelector('c');

        if (!capsElement) {
            return;
        }

        const ver = capsElement.getAttribute('ver');

        const discoInfoRepository = this.account.getDiscoInfoRepository();
        discoInfoRepository.addRelation(from, ver);
    }
}
