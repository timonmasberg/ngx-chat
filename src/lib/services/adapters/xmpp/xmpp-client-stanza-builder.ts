import {Element as XmppElement} from '@xmpp/xml';
import {Builder} from './interface/builder';

export class XmppClientStanzaBuilder implements Builder {
    constructor(
        private element: XmppElement,
        private readonly getNextId: () => string,
        private readonly sendInner: (content: Element) => Promise<void>,
        private readonly sendInnerAwaitingResponse: (content: Element) => Promise<Element>,
    ) {
    }

    attrs(moreAttrs: string | { [p: string]: any }): Builder {
        this.element.setAttrs(moreAttrs);
        return this;
    }

    setNextId(): Builder {
        return this.attrs({id: this.getNextId()});
    }

    c(name: string, attrs?: any, text?: string): Builder {
        this.element = this.element.c(name, attrs);
        if (text) {
            this.element.text(text);
        }
        return this;
    }

    cNode(element: Element): Builder {
        this.element = this.element.cnode(toLtxElement(element));
        return this;
    }

    cCreateMethod(create: (builder: Builder) => Builder): Builder {
        return create(this);
    }

    h(html: string): Builder {
        const node = toLtxElement(new DOMParser().parseFromString(html, 'text/html').documentElement);
        this.element = this.element.cnode(node);
        return this;
    }

    send(): Promise<void> {
        return this.sendInner(toXMLElement(this.element));
    }

    sendAwaitingResponse(): Promise<Element> {
        return this.sendInnerAwaitingResponse(toXMLElement(this.element));
    }

    t(text: string): Builder {
        this.element = this.element.t(text);
        return this;
    }

    tree(): Element {
        return toXMLElement(this.element.tree());
    }

    up(): Builder {
        this.element = this.element.up();
        return this;
    }
}


function toXMLElement(ltxElement: XmppElement): Element {
    const parser = new globalThis.DOMParser();
    return parser.parseFromString(ltxElement.toString(), 'text/xml').documentElement;
}

function toLtxElement(element: Element): XmppElement {
    const attributes = element.getAttributeNames().reduce<Record<string, unknown>>((collection, attributeName) => {
        collection[attributeName] = element.getAttribute(attributeName);
        return collection;
    }, {});

    const ltxRoot = new XmppElement(element.nodeName, attributes);
    ltxRoot.children = Array.from(element.children).map(el => toLtxElement(el));
    return ltxRoot;
}
