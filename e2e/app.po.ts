import {LogInRequest} from '@pazznetwork/ngx-chat';
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

    constructor(private readonly page: Page) {
        this.domainInput = page.locator('[name=domain]');
        this.serviceInput = page.locator('[name=service]');
        this.usernameInput = page.locator('[name=username]');
        this.passwordInput = page.locator('[name=password]');
        this.loginButton = page.locator('[name=login]');
        this.logoutButton = page.locator('[name=logout]');
        this.registerButton = page.locator('[name=register]');
        this.roosterOnline= page.locator('.roster-list[data-ngx-chat-state="online"]');
    }

    async navigateToIndex() {
        return this.page.goto('/');
    }

    async logIn(logInRequest: LogInRequest) {
        await this.domainInput.fill('');
        await this.domainInput.fill(logInRequest.domain);
        await this.serviceInput.fill('');
        await this.serviceInput.fill(logInRequest.service);
        await this.usernameInput.fill('');
        await this.usernameInput.fill(logInRequest.username);
        await this.passwordInput.fill('');
        await this.passwordInput.fill(logInRequest.password);
        await this.loginButton.click();
    }

    async userIsOnline() : Promise<boolean> {
        return await this.roosterOnline.isVisible()
    }

    async logOut() {
        await this.logoutButton.click();
    }
}
