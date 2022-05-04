const parser = new DOMParser()

export function fromXML(xml: string): Element {
    return parser.parseFromString(xml, 'text/xml').documentElement;
}
