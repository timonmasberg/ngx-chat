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
const evilQueen = 'EvilQueen';
const huntsman = 'Huntsman';

/**
 * Current features:
 *   * blocking of contacts
 *   * writing to users not in your contact list
 *   * messages are time stamped
 *   * file uploads, trough file select and drag and drop
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
    });

    test('should be able to delete all existing users besides the admin', async () => {
        const users = await appPage.getAllJabberUsersBesidesAdmin(adminLogin.username, adminLogin.password);
        console.log('deleting users on ejabberd server: ' + users.join(', '));
        await appPage.deleteUsers(adminLogin.username, adminLogin.password, users);
    });

    test('should be able to log in', async () => {
        await appPage.navigateToIndex();
        const {domain, service, username, password} = adminLogin;
        await appPage.setDomain(domain);
        await appPage.setService(service);
        await appPage.logIn(username, password);
        await expect(appPage.isUserOnline()).toBeTruthy();
    });

    test('should be able to log out', async () => {
        await appPage.logOut();
        await appPage.waitForOffline();
        expect(await appPage.isUserOnline()).toBeFalsy();
    });

    test('should be able to register SnowWhite', async () => {
        await appPage.register(snowWhite, snowWhite);
        await expect(appPage.isRegistrationForUserSuccessful(snowWhite)).toBeTruthy();
    });

    test('should be able to register the 7 dwarves', async () => {
        await appPage.register(dwarfs.doc, dwarfs.doc);
        await expect(appPage.isRegistrationForUserSuccessful(dwarfs.doc)).toBeTruthy();
        await appPage.register(dwarfs.grumpy, dwarfs.grumpy);
        await expect(appPage.isRegistrationForUserSuccessful(dwarfs.grumpy)).toBeTruthy();
        await appPage.register(dwarfs.happy, dwarfs.happy);
        await expect(appPage.isRegistrationForUserSuccessful(dwarfs.happy)).toBeTruthy();
        await appPage.register(dwarfs.sleepy, dwarfs.sleepy);
        await expect(appPage.isRegistrationForUserSuccessful(dwarfs.sleepy)).toBeTruthy();
        await appPage.register(dwarfs.bashful, dwarfs.bashful);
        await expect(appPage.isRegistrationForUserSuccessful(dwarfs.bashful)).toBeTruthy();
        await appPage.register(dwarfs.sneezy, dwarfs.sneezy);
        await expect(appPage.isRegistrationForUserSuccessful(dwarfs.sneezy)).toBeTruthy();
        await appPage.register(dwarfs.dopey, dwarfs.dopey);
        await expect(appPage.isRegistrationForUserSuccessful(dwarfs.dopey)).toBeTruthy();
    });

    test('should be able to register the Huntsman', async () => {
        await appPage.register(huntsman, huntsman);
        await expect(appPage.isRegistrationForUserSuccessful(huntsman)).toBeTruthy();
    });

    test('should be able to login as SnowWhite', async () => {
        await appPage.logIn(snowWhite, snowWhite);
    });

    const toJid = (username: string) => `${username}@${adminLogin.domain}`;
    test('should be able to add the 7 dwarves as SnowWhite contacts', async () => {
        await appPage.addContact(toJid(dwarfs.doc));
        await appPage.addContact(toJid(dwarfs.grumpy));
        await appPage.addContact(toJid(dwarfs.happy));
        await appPage.addContact(toJid(dwarfs.sleepy));
        await appPage.addContact(toJid(dwarfs.bashful));
        await appPage.addContact(toJid(dwarfs.sneezy));
        await appPage.addContact(toJid(dwarfs.dopey));
    });

    test('should be able to write to Sleepy and Grumpy', async () => {
        const sleepyMessage = 'Please wake up we have it is time for the mines';
        const snowWhiteChatWithSleepy = await appPage.openChatWithContact(toJid(dwarfs.sleepy));
        await snowWhiteChatWithSleepy.writeTo(dwarfs.sleepy, sleepyMessage);
        await snowWhiteChatWithSleepy.close();

        const grumpyMessage = 'Grump Grump Grump';
        const snowWhiteChatWithGrumpy = await appPage.openChatWithContact(toJid(dwarfs.grumpy));
        await snowWhiteChatWithGrumpy.writeTo(dwarfs.grumpy, grumpyMessage);
        await snowWhiteChatWithGrumpy.close();

        await appPage.logOut(); // log out Snow White

        await appPage.logIn(dwarfs.sleepy, dwarfs.sleepy);
        const sleepyChatWithSnowWhite = await appPage.openChatWithContact(toJid(snowWhite));
        expect(await sleepyChatWithSnowWhite.getNthChatInMessageText(0)).toEqual(sleepyMessage);
        await appPage.logOut();


        await appPage.logIn(dwarfs.grumpy, dwarfs.grumpy);
        const grumpyChatWithSnowWhite = await appPage.openChatWithContact(toJid(snowWhite));
        expect(await grumpyChatWithSnowWhite.getNthChatInMessageText(0)).toEqual(grumpyMessage);
        await appPage.logOut();
    });


    test('should be able to write as the EvilQueen to SnowWhite', async () => {
        await appPage.register(evilQueen, evilQueen);
        await expect(appPage.isRegistrationForUserSuccessful(evilQueen)).toBeTruthy();

        const queenMessage = 'Do you like apples?';
        await appPage.logIn(evilQueen, evilQueen);
        const evilQueenChatWithSnowWhite = await appPage.openChatWith(toJid(snowWhite));
        await evilQueenChatWithSnowWhite.writeTo(snowWhite, queenMessage);
        await evilQueenChatWithSnowWhite.close();
    });

    test('should be able to send click able link and a image with preview as well', async () => {
        const evilQueenChatWithSnowWhite = await appPage.openChatWith(toJid(snowWhite));

        const imageLink = 'https://pixabay.com/images/id-1475977/';
        await evilQueenChatWithSnowWhite.writeTo(snowWhite, imageLink);
        await expect(evilQueenChatWithSnowWhite.hasLinkWithUrl(imageLink)).toBeTruthy();

        const imageLinkWithFileExtension = 'https://upload.wikimedia.org/wikipedia/en/3/3d/Poisoned_Apple_cd_cover.jpg';
        await evilQueenChatWithSnowWhite.writeTo(snowWhite, imageLinkWithFileExtension);
        await expect(evilQueenChatWithSnowWhite.hasLinkWithUrl(imageLinkWithFileExtension)).toBeTruthy();
        await expect(evilQueenChatWithSnowWhite.hasImageWithUrl(imageLinkWithFileExtension)).toBeTruthy();
        await appPage.logOut();
    });

    test('should be able to block the EvilQueen as SnowWhite', async () => {
        await appPage.logIn(snowWhite, snowWhite);
        await expect(appPage.isContactInRoster(toJid(evilQueen))).toBeTruthy();
        const snowWhiteChatWithEvilQueen = await appPage.openChatWithContact(toJid(evilQueen));
        await snowWhiteChatWithEvilQueen.block();
        expect(await appPage.isContactNotInRoster(toJid(evilQueen))).toBeTruthy();
        await appPage.logOut();
    });

    test('should no longer be able to write as the EvilQueen to SnowWhite', async () => {
        const message = 'ANSWER ME!';
        await appPage.logIn(evilQueen, evilQueen);
        const chat = await appPage.openChatWith(toJid(snowWhite));
        await chat.writeTo(snowWhite, message);
        await appPage.logOut();
        await appPage.logIn(snowWhite, snowWhite);
        expect(await appPage.isContactNotInRoster(toJid(evilQueen))).toBeTruthy();
        await appPage.logOut();
    });

    test('should be able to unblock the EvilQueen as SnowWhite', async () => {
        await appPage.logIn(snowWhite, snowWhite);
        await appPage.unblockContact(toJid(evilQueen));
        expect(await appPage.isContactInRoster(toJid(evilQueen))).toBeTruthy();
        await appPage.logOut();
    });

    test('should be able to write as the Huntsman to SnowWhite', async () => {
        const queenMessage = 'Do NOT eat any apples!!11elf!';
        await appPage.register(huntsman, huntsman);
        await appPage.logIn(huntsman, huntsman);
        const huntsmanChatWithSnowWhite = await appPage.openChatWith(toJid(snowWhite));
        await huntsmanChatWithSnowWhite.writeTo(snowWhite, queenMessage);
        await appPage.logOut();
    });

    test('should be able to block the Huntsman as SnowWhite', async () => {
        await appPage.logIn(snowWhite, snowWhite);
        expect(await appPage.isContactInRoster(toJid(huntsman))).toBeTruthy();
        const snowWhiteChatWithHuntsman = await appPage.openChatWithContact(toJid(huntsman));
        await snowWhiteChatWithHuntsman.block();
        expect(await appPage.isContactInRoster(toJid(huntsman))).toBeFalsy();
    });

    test('should no longer be able to write as the Huntsman to SnowWhite', async () => {
        const message = 'Hello? :(';
        await appPage.logIn(huntsman, huntsman);
        const chat = await appPage.openChatWith(toJid(snowWhite));
        await chat.writeTo(snowWhite, message);
        await appPage.logOut();
        await appPage.logIn(snowWhite, snowWhite);
        expect(await appPage.isContactInRoster(toJid(huntsman))).toBeFalsy();
        await appPage.logOut();
    });

    test('should be able to unblock the Huntsman as SnowWhite', async () => {
        await appPage.logIn(snowWhite, snowWhite);
        await appPage.unblockContact(toJid(huntsman));
        expect(await appPage.isContactInRoster(toJid(huntsman))).toBeTruthy();
        await appPage.logOut();
    });

    test('should be able to accept the Huntsman request as SnowWhite', async () => {
        await appPage.logIn(snowWhite, snowWhite);
        await appPage.addContact(toJid(huntsman));
        expect(await appPage.isContactInRoster(toJid(huntsman))).toBeTruthy();
        const chat = await appPage.openChatWith(toJid(huntsman));
        await chat.denyContactRequest();
        await chat.hasBlockLink();
        await chat.isAcceptDisabled();
        await chat.isDenyDisabled();
        await chat.dismiss();
        await chat.acceptContactRequest();
        await appPage.logOut();
    });

    test('should be able to delete all created users', async () => {
        const users = [snowWhite, ...Object.values(dwarfs), huntsman, evilQueen];
        await appPage.deleteUsers(adminLogin.username, adminLogin.password, users);
        test.expect(appPage.errorLogs.length).toBe(0);
    });
});
