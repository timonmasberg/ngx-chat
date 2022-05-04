export class Finder {
    private currentElements: Element[];

    get result(): Element {
        return this.currentElements?.[0];
    }

    get results(): Element[] {
        return this.currentElements;
    }

    private constructor(private readonly root: Element) {
        this.currentElements = [root];
    }

    static create(root: Element) {
        return new Finder(root);
    }

    searchByTag(tagName: string): Finder {
        const helper = new Element();
        helper.append(...this.currentElements);
        this.currentElements = Array.from(helper.querySelectorAll(tagName));
        return this;
    }

    searchByNamespace(nameSpace: string): Finder {
        this.currentElements = this.currentElements.filter(el => el.namespaceURI === nameSpace);
        return this;
    }

    searchByAttribute(attributeName: string, attributeValue): Finder {
        this.currentElements = this.currentElements.filter(el => el.getAttribute(attributeName) === attributeValue);
        return this;
    }
}
