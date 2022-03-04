import Account from '../../Account';
import PersistentMap from '../../util/PersistentMap';
import Log from '../../util/Log';
import JID from '../../JID';
import * as ConnectHelper from './ConnectHelper';
import StorageConnection from '../storage/Connection';
import XMPPConnection from './Connection';
import BaseError from '../../errors/BaseError';

export enum TYPE {
   BOSH,
   WEBSOCKET,
}

export default class Connector {
   private connectionParameters;

   private readonly connectionArgs: string[];

   // tslint:disable-next-line:unified-signatures
   constructor(account: Account, url: string, jid: string, sid: string, rid: string);
   constructor(account: Account, url: string, jid: string, password: string);
   constructor(account: Account);
   constructor(private account: Account, ...connectionArgs: string[]) {
      let type = /^wss?:/.test(connectionArgs[1]) ? TYPE.WEBSOCKET : TYPE.BOSH;
      const storage = account.getStorage();
      this.connectionParameters = new PersistentMap(storage, 'connection');

      connectionArgs = connectionArgs.filter(arg => typeof arg === 'string');

      if (connectionArgs.length < 3) {
         type = this.connectionParameters.get('type');

         if (type === TYPE.WEBSOCKET) {
            throw new Error('Can\'t attach to websocket connection.');
         }

         this.connectionArgs = [
            this.connectionParameters.get('url'),
            this.connectionParameters.get('jid'),
            this.connectionParameters.get('sid'),
            this.connectionParameters.get('rid'),
         ];
      } else if (connectionArgs.length === 3 || connectionArgs.length === 4) {
         this.connectionArgs = connectionArgs;


         this.connectionParameters.set('type', type);
         this.connectionParameters.remove('inactivity');
         this.connectionParameters.remove('timestamp');
      } else {
         throw new BaseError('Unsupported number of arguments');
      }
   }

   public async connect() {
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

      const loginData = await ConnectHelper.login.apply(this, this.connectionArgs)
      return this.successfulConnected(loginData);
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

   private successfulConnected = data => {
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
   }

   private storeConnectionParameters(connection) {
      this.connectionParameters.set({
         url: connection.service,
         jid: connection.jid,
         sid: connection._proto.sid,
         rid: connection._proto.rid,
         timestamp: new Date().getTime(),
      });

      if (connection._proto.inactivity) {
         const inactivity = connection._proto.inactivity * 1000;

         this.connectionParameters.set('inactivity', inactivity);
      }
   }

   private replaceConnectionHandler(connection) {
      connection.connect_callback = (status, condition) => {
         this.account.triggerConnectionHook(status, condition);

         if (status === Strophe.Status.DISCONNECTED) {
            this.account.connectionDisconnected();
         }
      };
   }

   private addRidHandler(connection) {
      connection.nextValidRid = rid => {
         const timestamp = new Date().getTime();

         this.connectionParameters.set('timestamp', timestamp);
         this.connectionParameters.set('rid', rid);
      };
   }

   private addRidUnloadHandler(connection) {
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

   private storeConnectionFeatures(connection) {
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
