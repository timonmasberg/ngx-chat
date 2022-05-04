export class Matcher {
    private constructor(private readonly stanza: Element) {
    }

    static create(root: Element) {
        return new Matcher(root);
    }

    isIQ(): boolean {
        return this.stanza.nodeName === 'iq';
    }

    isPresence(): boolean {
        return this.stanza.nodeName === 'presence';
    }

    isMessage(): boolean {
        return this.stanza.nodeName === 'message';
    }

    isOther(): boolean {
        return !(this.isIQ() || this.isPresence() || this.isMessage());
    }

    hasGetAttribute(): boolean {
        return this.stanza.getAttribute('type') === 'get';
    }

    hasSetAttribute(): boolean {
        return this.stanza.getAttribute('type') === 'set';
    }

    hasChildWithNameSpace(childName: string, nameSpace: string): boolean {
        return Array.from(this.stanza.querySelectorAll(childName)).findIndex(el => el.namespaceURI === nameSpace) > -1;
    }

    hasChild(childName: string): boolean {
        return !!this.stanza.querySelectorAll(childName)
    }
}
