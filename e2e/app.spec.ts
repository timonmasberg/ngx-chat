import {test, expect} from '@playwright/test';
import {LogInRequest} from '@pazznetwork/ngx-chat';
import {AppPage} from './app.po';

const adminLogin: LogInRequest = {
    domain: process.env.XMPP_DOMAIN,
    username: process.env.XMPP_JID,
    password: process.env.XMPP_PASSWORD,
    service: 'wss://' + process.env.XMPP_DOMAIN + ':5280/websocket'
};

test.describe('ngx-chat', () => {
    test('should be able to log in and log out', async ({page}) => {
        const appPage = new AppPage(page);
        await appPage.navigateToIndex();
        await appPage.logIn(adminLogin);
        await expect(appPage.userIsOnline()).toBeTruthy();
        await appPage.logOut();
        await expect(appPage.userIsOnline()).toBeFalsy();
    });
});
