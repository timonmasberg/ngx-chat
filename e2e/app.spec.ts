import {test, expect} from '@playwright/test';
import {LogInRequest} from '@pazznetwork/ngx-chat';
import {AppPage} from './app.po';

const domain = process.env.XMPP_DOMAIN;
const jid = process.env.XMPP_JID;
const username = jid.split('@')[0];
const password = process.env.XMPP_PASSWORD;

const adminLogin: LogInRequest = {
    domain,
    username,
    password,
    service: `wss://${domain}:5280/websocket`
};

const dwarfs = {
    doc: 'Doc',
    grumpy: 'Grumpy',
    happy: 'Happy',
    sleepy: 'Sleepy',
    bashful: 'Bashful',
    sneezy: 'Sneezy',
    dopey: 'Dopey'
};

const snowWhite = 'SnowWhite';
const huntsman = 'Huntsman';

/**
 * Current features:
 *   * blocking of contacts
 *   * writing to users not in your contact list
 *   * messages are time stamped
 *   * file uploads
 *   * message history (messages from past sessions are available)
 *   * message history on multiple devices stays the same
 *   * message state, (send, received, read)
 *   * chat rooms
 *   * chat room message notification
 *   * you are currently offline notification
 *   * push message notification
 *   * registration without admin
 *   * contact list - add / remove
 *   * unread messages count
 *   * image link preview
 */
test.describe('ngx-chat', () => {
    let appPage: AppPage;
    test.beforeAll(async ({browser}) => {
        appPage = new AppPage(await browser.newPage());
        await appPage.navigateToIndex();
    });

    test('should be able to log in', async () => {
        const {domain, service, username, password} = adminLogin;
        await appPage.setDomain(domain);
        await appPage.setService(service);
        await appPage.logIn(username, password);
        await expect(appPage.isUserOnline()).toBeTruthy();
    });

    test('should be able to log out', async () => {
        await appPage.logOut();
        expect(await appPage.isUserOnline()).toBeFalsy();
    });

    test('should be able to register SnowWhite', async () => {
        await appPage.register(snowWhite, snowWhite);
        await expect(appPage.isRegistrationSuccessful()).toBeTruthy();
    });

    test('should be able to register the 7 dwarves', async () => {
        await appPage.register(dwarfs.doc, dwarfs.doc);
        await expect(appPage.isRegistrationSuccessful()).toBeTruthy();
        await appPage.register(dwarfs.grumpy, dwarfs.grumpy);
        await expect(appPage.isRegistrationSuccessful()).toBeTruthy();
        await appPage.register(dwarfs.happy, dwarfs.happy);
        await expect(appPage.isRegistrationSuccessful()).toBeTruthy();
        await appPage.register(dwarfs.sleepy, dwarfs.sleepy);
        await expect(appPage.isRegistrationSuccessful()).toBeTruthy();
        await appPage.register(dwarfs.bashful, dwarfs.bashful);
        await expect(appPage.isRegistrationSuccessful()).toBeTruthy();
        await appPage.register(dwarfs.sneezy, dwarfs.dopey);
        await expect(appPage.isRegistrationSuccessful()).toBeTruthy();
    });

    test('should be able to login as SnowWhite', async () => {
        await appPage.logIn(snowWhite, snowWhite);
    });

    test('should be able to add the 7 dwarves as SnowWhite contacts', async ({page}) => {
        await appPage.addContact(dwarfs.doc);
        await appPage.addContact(dwarfs.grumpy);
        await appPage.addContact(dwarfs.happy);
        await appPage.addContact(dwarfs.sleepy);
        await appPage.addContact(dwarfs.bashful);
        await appPage.addContact(dwarfs.sneezy);
        await page.pause();
    });

    test('should be able to write to Sleepy and Grumpy', async () => {
    });

    test('should be able to write as the Huntsman to SnowWhite', async () => {
    });

    test('should be able to block the Huntsman as SnowWhite', async () => {
    });

    test('should no longer be able to write as the Huntsman to SnowWhite', async () => {
    });

    test('should be able to unblock the Huntsman as SnowWhite', async () => {
    });
});
