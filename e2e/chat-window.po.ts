import {Locator} from 'playwright-core';
import {Page} from '@playwright/test';

export class ChatWindowPage {
    private readonly windowLocator: Locator;
    private readonly closeChatButton: Locator;

    private readonly acceptLink: Locator;
    private readonly denyLink: Locator;
    private readonly blockLink: Locator;
    private readonly blockAndReportLink: Locator;
    private readonly dismissLink: Locator;

    private readonly inMessage: Locator;
    private readonly outMessage: Locator;
    private readonly chatInput: Locator;

    constructor(page: Page, jid: string) {
        this.windowLocator = page.locator(`.window`, {hasText: jid.toLowerCase()});
        this.closeChatButton = this.windowLocator.locator('[data-name="close-chat"]');
        this.inMessage = this.windowLocator.locator('.chat-message--in ngx-chat-message-text');
        this.outMessage = this.windowLocator.locator('.chat-message--out ngx-chat-message-text');

        this.acceptLink = this.windowLocator.locator('a[data-name="accept-user"]');
        this.denyLink = this.windowLocator.locator('a[data-name="deny-user"]');
        this.blockLink = this.windowLocator.locator('a[data-name="block-user"]');
        this.blockAndReportLink = this.windowLocator.locator('a[data-name="block-and-report-user"]');
        this.dismissLink = this.windowLocator.locator('a[data-name="dismiss-block-message"]');

        this.chatInput = this.windowLocator.locator(`[data-name="chat-input"]`);
    }

    async writeTo(username: string, message: string) {
        await this.chatInput.fill(message);
        await this.windowLocator.press('Enter');
    }

    async close() {
        await this.closeChatButton.click();
    }

    async getNthChatInMessageText(n: number) {
        const count = await this.inMessage.count();
        if (n > count) {
            throw new Error('There are less requested incoming messages than the requested N');
        }

        if (count === 1) {
            return await this.inMessage.first().textContent();
        }

        return this.inMessage.nth(n).textContent();
    }

    async block() {
        await this.blockLink.click();
    }

    async hasLinkWithUrl(url: string): Promise<boolean> {
        const found = await this.windowLocator.locator(`a[href="${url}"]`).count();
        return found > 0;
    }

    async hasImageWithUrl(url: string): Promise<boolean> {
        const found = await this.windowLocator.locator(`img[src="${url}"]`).count();
        return found > 0;
    }

    async denyContactRequest(): Promise<void> {
        await this.denyLink.click();
    }

    async hasBlockLink(): Promise<boolean> {
        const found = await this.blockLink.count();
        return found > 0;
    }

    async isAcceptDisabled(): Promise<boolean> {
        return this.acceptLink.isDisabled();
    }

    async isDenyDisabled(): Promise<boolean> {
        return this.denyLink.isDisabled();
    }

    async dismiss(): Promise<void> {
        await this.dismissLink.click();
    }

    async acceptContactRequest(): Promise<void> {
        await this.acceptLink.click();
    }
}
