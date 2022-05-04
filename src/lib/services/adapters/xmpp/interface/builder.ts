export interface Builder {
    tree(): Element;

    toString(): string;

    up(): Builder;

    attrs(moreAttrs: Record<string, string>): Builder;

    setNextId(): Builder;

    c(name: string, attrs?: Record<string, string>, text?: string): Builder;

    cNode(element: Element): Builder;

    cCreateMethod(create: (builder: Builder) => Builder): Builder;

    t(text: string): Builder;

    h(html: string): Builder;

    send(): Promise<void>;

    sendAwaitingResponse(): Promise<Element>;
}
