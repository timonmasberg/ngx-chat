import {expect, Page} from '@playwright/test';
import {Locator} from 'playwright-core';
import {ChatWindowPage} from './chat-window.po';

export class AppPage {
    readonly errorLogs = [];

    private readonly domainInput: Locator;
    private readonly serviceInput: Locator;
    private readonly usernameInput: Locator;
    private readonly passwordInput: Locator;
    private readonly loginButton: Locator;
    private readonly logoutButton: Locator;
    private readonly registerButton: Locator;
    private readonly roosterOnline: Locator;
    private readonly contactJid: Locator;

    private readonly addContactButton: Locator;
    private readonly removeContactButton: Locator;
    private readonly blockContactButton: Locator;
    private readonly unblockContactButton: Locator;
    private readonly openChatButton: Locator;

    private readonly createRoosterEntrySelector: (jid: string) => string;
    private readonly createRoosterEntryLocator: (jid: string) => Locator;
    private readonly createChatBoxInputLocator: (jid: string) => Locator;

    constructor(private readonly page: Page) {
        this.domainInput = page.locator('[name=domain]');
        this.serviceInput = page.locator('[name=service]');
        this.usernameInput = page.locator('[name=username]');
        this.passwordInput = page.locator('[name=password]');
        this.loginButton = page.locator('[name=login]');
        this.logoutButton = page.locator('[name=logout]');
        this.registerButton = page.locator('[name=register]');
        this.roosterOnline = page.locator('.roster-list[data-ngx-chat-state="online"]');
        this.contactJid = page.locator('[data-name="contact-jid"]');

        this.addContactButton = page.locator('[data-name="add-contact"]');
        this.removeContactButton = page.locator('[data-name="remove-contact"]');
        this.blockContactButton = page.locator('[data-name="block-contact"]');
        this.unblockContactButton = page.locator('[data-name="unblock-contact"]');
        this.openChatButton = page.locator('[data-name="open-chat"]');

        this.createRoosterEntrySelector = (jid) => `.roster-recipient[title="${jid.toLowerCase()}"]`;
        this.createRoosterEntryLocator = (jid) => page.locator(this.createRoosterEntrySelector(jid));
        this.createChatBoxInputLocator = (username) => page.locator(`[data-name=chat-input-${username.toLowerCase()}]`);

        page.on('console', (message) => {
            if (message.type() === 'error') {
                this.errorLogs.push(message.text());
            }
        });
        page.on('pageerror', (err) => {
            console.error(err);
        });
    }

    async navigateToIndex(): Promise<void> {
        await this.page.goto('/');
    }

    async setDomain(domain: string): Promise<void> {
        await this.domainInput.fill(domain);
    }

    async setService(service: string): Promise<void> {
        await this.serviceInput.fill(service);
    }

    async logIn(username: string, password: string): Promise<void> {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.loginButton.page().waitForTimeout(500);
        await this.loginButton.click();
    }

    async logOut(): Promise<void> {
        await waitForAngular(this.page);
        await this.logoutButton.click();
    }

    async register(username: string, password: string): Promise<void> {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.registerButton.click();
    }

    async addContact(jid: string): Promise<void> {
        await this.contactJid.fill(jid);
        await this.addContactButton.click();
    }

    async removeContact(jid: string): Promise<void> {
        await this.contactJid.fill(jid);
        await this.removeContactButton.click();
    }

    async blockContact(jid: string): Promise<void> {
        await this.contactJid.fill(jid);
        await this.blockContactButton.click();
    }

    async unblockContact(jid: string): Promise<void> {
        await this.page.pause()
        await this.contactJid.fill(jid);
        await this.unblockContactButton.click();
    }

    async isRegistrationForUserSuccessful(username: string,): Promise<boolean> {
        const selector = `[data-name="registration-success"]:has-text("${username}")`;
        await this.page.waitForSelector(selector);
        return await this.page.locator(selector).count() > 0;
    }

    async waitForOffline(): Promise<void> {
        await this.page.waitForSelector('div[data-name="chat-connection-state"]:has-text("State: disconnected")');
    }

    async isUserOnline(): Promise<boolean> {
        const count = await this.roosterOnline.count();
        return count === 1;
    }

    async isContactInRoster(jid: string): Promise<Boolean> {
        const foundCount = await this.createRoosterEntryLocator(jid).count();
        return foundCount > 0;
    }

    async isContactNotInRoster(jid: string): Promise<Boolean> {
        await this.page.waitForSelector(this.createRoosterEntrySelector(jid), {state: 'detached'});
        return true;
    }

    async openChatWithContact(jid: string): Promise<ChatWindowPage> {
        const locator = this.createRoosterEntryLocator(jid);
        await locator.click();
        return new ChatWindowPage(this.page, jid);
    }

    async openChatWith(jid: string): Promise<ChatWindowPage> {
        await this.contactJid.fill(jid);
        await this.openChatButton.click();
        return new ChatWindowPage(this.page, jid);
    }

    async getAllJabberUsersBesidesAdmin(adminUsername: string, adminPassword: string): Promise<string[]> {
        const adminBase = 'https://' + adminUsername + ':' + adminPassword + '@local-jabber.entenhausen.pazz.de:5280';
        const usersPath = '/admin/server/local-jabber.entenhausen.pazz.de/users';
        await this.page.goto(adminBase + usersPath);
        const userAnchors = this.page.locator('tbody tr td:first-child a');
        const users = await userAnchors.evaluateAll<string[], HTMLAnchorElement>(
            (anchors) => anchors.map(anchor => anchor.href.split('user/')[1].replace('/', '')));
        return users.filter((user) => user.toLowerCase() !== adminUsername.toLowerCase());
    }

    async deleteUsers(adminUsername: string, adminPassword: string, users: string[]) {
        const adminBase = 'https://' + adminUsername + ':' + adminPassword + '@local-jabber.entenhausen.pazz.de:5280';
        const hostPath = '/admin/server/local-jabber.entenhausen.pazz.de';
        const userPath = (userName: string) => '/user/' + userName.toLowerCase() + '/';
        const userUrl = (userName: string) => adminBase + hostPath + userPath(userName);

        const removeUserButton = this.page.locator('input[name=removeuser]');

        const deleteUser = async () => await removeUserButton.click();
        const goToUserSettings = async (userName: string) => await this.page.goto(userUrl(userName));
        for (const user of users) {
            await goToUserSettings(user);
            const found = await removeUserButton.count();
            expect(found, `No delete for user=${user}`).toBe(1);
            await deleteUser();
        }
    }
}

async function waitForAngular(page) {
    await page.evaluate(async () => {
        // @ts-expect-error
        if (window.getAllAngularTestabilities) {
            // @ts-expect-error
            await Promise.all(window.getAllAngularTestabilities().map(whenStable));

            async function whenStable(testability) {
                return new Promise((res) => testability.whenStable(res));
            }
        }
    });
}
