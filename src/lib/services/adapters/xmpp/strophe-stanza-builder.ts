import {Builder} from './interface/builder';

export class StropheStanzaBuilder implements Builder {
    constructor(
        private stropheBuilder: Strophe.Builder,
        private readonly sendInner: (content: Element) => Promise<void>,
        private readonly sendInnerAwaitingResponse: (content: Element) => Promise<Element>,
    ) {
    }

    attrs(moreAttrs: Record<string, string>): Builder {
        this.stropheBuilder = this.stropheBuilder.attrs(moreAttrs);
        return this;
    }

    setNextId(): Builder {
        // do nothing here, strophe manages stanza id's by itself
        return this;
    }

    c(name: string, attrs?: Record<string, string>, text?: string): Builder {
        this.stropheBuilder = this.stropheBuilder.c(name, attrs, text);
        return this;
    }

    cNode(element: Element): Builder {
        this.stropheBuilder = this.stropheBuilder.cnode(element);
        return this;
    }

    cCreateMethod(create: (builder: Builder) => Builder): Builder {
        return create(this);
    }

    h(html: string): Builder {
        this.stropheBuilder = this.stropheBuilder.h(html);
        return this;
    }

    send(): Promise<void> {
        return this.sendInner(this.stropheBuilder.tree());
    }

    sendAwaitingResponse(): Promise<Element> {
        return this.sendInnerAwaitingResponse(this.stropheBuilder.tree());
    }

    t(text: string): Builder {
        this.stropheBuilder = this.stropheBuilder.t(text);
        return this;
    }

    tree(): Element {
        return this.stropheBuilder.tree();
    }

    up(): Builder {
        this.stropheBuilder = this.stropheBuilder.up();
        return this;
    }
}


export class MockBuilder {
    static build(
        name: string,
        attrs: Record<string, string>
    ): StropheStanzaBuilder {
        return new StropheStanzaBuilder($build(name, attrs), Promise.resolve, Promise.resolve);
    }

    static $iq(attrs?: Record<string, string>): StropheStanzaBuilder {
        return MockBuilder.build('iq', attrs);
    }

    static $msg(attrs?: Record<string, string>): StropheStanzaBuilder {
        return MockBuilder.build('message', attrs);
    }

    static $pres(attrs?: Record<string, string>): StropheStanzaBuilder {
        return MockBuilder.build('presence', attrs);
    }
}
