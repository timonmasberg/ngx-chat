

export class Finder {
    private currentElements: Element[];

    get result(): Element {
        return this.currentElements[0];
    }

    get results(): Element {
        return this.currentElements[0];
    }

    private constructor(private readonly root: Element) {
    }

    static create(root: Element) {
        return new Finder(root);
    }

    searchByTag(tagName: string): Finder {
        if(!this.currentElements) {
            this.currentElements = Array.from(this.root.querySelectorAll(tagName));
        } else {
            this.currentElements = this.currentElements.filter(el => el.tagName === tagName)
        }
        return this;
    }

    searchByNamespace(nameSpace: string): Finder {
        if(!this.currentElements) {
            this.currentElements = Array.from(this.root.children).filter(el => el.namespaceURI === nameSpace);
        } else {
            this.currentElements = this.currentElements.filter(el => el.namespaceURI === nameSpace)
        }
        return this;
    }
}
