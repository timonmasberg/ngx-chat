import {NgZone} from '@angular/core';
import {Subject} from 'rxjs';
import {first, takeUntil} from 'rxjs/operators';
import {getDomain} from '../../../../core/get-domain';
import {timeout} from '../../../../core/utils-timeout';
import {LogService} from '../service/log.service';
import {ChatConnection} from '../interface/chat-connection';

const xmlns = 'jabber:iq:register';

/**
 * XEP-0077: In-Band Registration
 * see: https://xmpp.org/extensions/xep-0077.html
 * Handles registration over the XMPP chat instead of relaying on an admin user account management
 */
export class RegistrationPlugin {

    private readonly registered$ = new Subject<void>();
    private readonly cleanUp = new Subject<void>();
    private readonly loggedIn$ = new Subject<void>();
    private readonly registrationTimeout = 5000;

    constructor(private logService: LogService, private ngZone: NgZone, private connection: ChatConnection) {
    }

    /**
     * Promise resolves if user account is registered successfully,
     * rejects if an error happens while registering, e.g. the username is already taken.
     */
    public async register(username: string,
                          password: string,
                          service: string,
                          domain: string): Promise<void> {
        await this.ngZone.runOutsideAngular(async () => {
            try {
                if (username.indexOf('@') > -1) {
                    this.logService.warn('username should not contain domain, only local part, this can lead to errors!');
                }

                await timeout((async () => {
                    domain = domain || getDomain(service);

                    this.logService.debug('registration plugin', 'connecting...');
                    await this.connection.logIn({username, password, service, domain});

                    this.logService.debug('registration plugin', 'connection established, starting registration');
                    await this.connection
                        .$iq({type: 'get', to: domain})
                        .c('query', {xmlns})
                        .send();

                    this.logService.debug('registration plugin', 'server acknowledged registration request, sending credentials');
                    await this.connection
                        .$iq({type: 'set'})
                        .c('query', {xmlns: 'jabber:iq:register'})
                        .c('username', {}, username)
                        .up().c('password', {}, password)
                        .send();

                    this.registered$.next();
                    await this.loggedIn$.pipe(takeUntil(this.cleanUp), first()).toPromise();
                    this.logService.debug('registration plugin', 'registration successful');
                })(), this.registrationTimeout);
            } catch (e) {
                this.logService.warn('error registering', e);
                throw e;
            } finally {
                this.cleanUp.next();
                this.logService.debug('registration plugin', 'cleaning up');
            }
        });
    }
}
