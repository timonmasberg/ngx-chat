import {LogInRequest} from 'src/public-api';
import {Affiliation} from '../services/adapters/xmpp/plugins/multi-user-chat/affiliation';

export interface RoomOptions {
    title: string;
    description: string;
    allow_change_subj: string;
    allow_query_users: string;
    allow_private_messages: string;
    allow_private_messages_from_visitors: string;
    allow_visitor_status: string;
    allow_visitor_nickchange: string;
    public: string;
    public_list: string;
    persistent: string;
    moderated: string;
    captcha_protected: string;
    members_by_default: string;
    members_only: string;
    allow_user_invites: string;
    allow_subscription: string;
    password_protected: string;
    password: string;
    anonymous: string;
    presence_broadcast: string;
    allow_voice_requests: string;
    voice_request_min_interval: string;
    max_users: string;
    logging: string;
    vcard: string;
    vcard_xupdate: string;
    captcha_whitelist: string;
    mam: string;
    pubsub: string;
    lang: string;
}

export interface RoomAffiliation {
    username: string;
    domain: string;
    affiliation: string;
    reason: string;
}

export class EjabberdClient {

    private readonly userName = 'local-admin@local-jabber.entenhausen.pazz.de';
    private readonly password = 'AdminLocalPassword123!';

    private readonly apiUrl = 'http://local-jabber.entenhausen.pazz.de:52810/api/';


    async getConnectedUsersNumber(): Promise<number> {
        const {num_sessions} = await this.executeRequest<{ num_sessions: number }>('connected_users_number');
        return num_sessions;
    }

    async getLastSeen(user: string, host: string) {
        const {timestamp} = await this.executeRequest('get_last', {
            user,
            host,
        });
        return new Date(timestamp);
    }

    /**
     * @deprecated can be misleading as there are silent read notifications
     */
    async getUnreadMessageCount(user: string, server: string): Promise<number> {
        const {value} = await this.executeRequest('get_offline_count', {
            user,
            server,
        });
        return value;
    }

    async banAccount(user: string, host: string, reason: string = '') {
        await this.executeRequest('ban_account', {
            user,
            host,
            reason,
        });
    }

    /**
     * Check if an account exists or not
     *
     * @param user :: string : User name to check
     * @param host :: string : Server to check
     *
     * @returns res :: integer : Status code (0 on success, 1 otherwise) as Boolean
     */
    async checkAccountExists(user: string, host: string): Promise<boolean> {
        const value = await this.executeRequest('check_account', {
            user,
            host,
        });
        return !value;
    }

    async unregister({username: user, domain: host}: { username: string, domain: string }) {
        if (!await this.checkAccountExists(user, host)) {
            return;
        }
        await this.executeRequest('unregister', {
            user,
            host,
        });
    }

    async removeMamForUser(user: string, server: string) {
        return await this.executeRequest('remove_mam_for_user', {
            user,
            server,
        });
    }

    async register({username: user, password, domain: host}: LogInRequest) {
        if (await this.checkAccountExists(user, host)) {
            return;
        }
        return await this.executeRequest('register', {user, password, host});
    }

    async registeredUsers(host = 'local-jabber.entenhausen.pazz.de'): Promise<string[]> {
        return await this.executeRequest('registered_users', {host});
    }

    async getMucRooms(host = 'global'): Promise<string[]> {
        return await this.executeRequest('muc_online_rooms', {host});
    }

    async changeRoomOption(name: string, service: string, option: string, value: string) {
        return await this.executeRequest('change_room_option', {
            name,
            service,
            option,
            value,
        });
    }

    async changePassword(user: string, password: string, domain) {
        return await this.executeRequest('change_password', {
            user,
            host: domain,
            newpass: password,
        });
    }

    async getRoomOptions(name: string, service: string): Promise<RoomOptions> {
        return await this.executeRequest('get_room_options', {name, service});
    }

    /**
     * Changes the room option of eJabberD room
     *
     * @param name name of the room usually the project id
     * @param service usually our eJabberD server with a 'conference.' prefix
     * @param option option to change
     * @param value new value for option
     */
    async changeRoomOptions<K extends keyof RoomOptions>(
        name: string,
        service: string,
        option: K | string,
        value: RoomOptions[K]
    ): Promise<void> {
        return await this.executeRequest('change_room_option', {
            name,
            service,
            option,
            value,
        });
    }

    async getRoomAffiliations(name: string, service: string): Promise<RoomAffiliation[]> {
        return await this.executeRequest('get_room_affiliations', {
            name,
            service,
        });
    }

    async setRoomAffiliation(
        name: string,
        service: string,
        jid: string,
        affiliation: Affiliation
    ): Promise<Object> {
        return await this.executeRequest('set_room_affiliation', {
            name,
            service,
            jid,
            affiliation,
        });
    }

    async destroyRoom(room: string, service = 'conference.local-jabber.entenhausen.pazz.de') {
        return await this.executeRequest('destroy_room', {
            name: room,
            service
        });
    }

    private async executeRequest<T>(path: string, json: any = {}): Promise<T> {
        const headers = new Headers();
        headers.append('X-Admin', 'true');
        headers.append('Content-Type', 'application/json');
        headers.append('Authorization', 'Basic ' + btoa(this.userName + ':' + this.password));
        const response = await globalThis.fetch(this.apiUrl + path, {
            headers,
            method: 'POST',
            body: JSON.stringify(json),
            mode: 'cors',
        });

        return await response.json();
    }
}
