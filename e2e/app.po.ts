import {Page} from '@playwright/test';
import {Locator} from 'playwright-core';

export class AppPage {
    private readonly domainInput: Locator;
    private readonly serviceInput: Locator;
    private readonly usernameInput: Locator;
    private readonly passwordInput: Locator;
    private readonly loginButton: Locator;
    private readonly logoutButton: Locator;
    private readonly registerButton: Locator;
    private readonly roosterOnline: Locator;
    private readonly registrationSuccessful: Locator;
    private readonly contactJid: Locator;
    private readonly addContactButton: Locator;
    private readonly removeContactButton: Locator;
    private readonly openChatButton: Locator;

    constructor(private readonly page: Page) {
        this.domainInput = page.locator('[name=domain]');
        this.serviceInput = page.locator('[name=service]');
        this.usernameInput = page.locator('[name=username]');
        this.passwordInput = page.locator('[name=password]');
        this.loginButton = page.locator('[name=login]');
        this.logoutButton = page.locator('[name=logout]');
        this.registerButton = page.locator('[name=register]');
        this.roosterOnline= page.locator('.roster-list[data-ngx-chat-state="online"]');
        this.registrationSuccessful= page.locator('[data-test=registration-success]');
        this.contactJid= page.locator('[data-test=contact-jid]');
        this.addContactButton = page.locator('[data-test=add-contact]');
        this.removeContactButton = page.locator('[data-test=remove-contact]');
        this.openChatButton = page.locator('[data-test=open-chat]');
    }

    async navigateToIndex() {
        return this.page.goto('/');
    }

    async setDomain(domain: string) {
        await this.domainInput.fill(domain);
    }

    async setService(service: string) {
        await this.serviceInput.fill(service);
    }

    async logIn(username: string, password: string) {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.loginButton.click();
    }

    async logOut() {
        await this.logoutButton.click();
    }

    async register(username: string, password: string) {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.registerButton.click();
    }

    async addContact(jid: string) {
        await this.contactJid.fill(jid);
        await this.addContactButton.click();
    }

    async isRegistrationSuccessful() {
        const text = await this.registrationSuccessful.textContent();
        return text === 'registration successful';
    }

    async isUserOnline() : Promise<boolean> {
        const count = await this.roosterOnline.count();
        return count === 1;
    }
}
