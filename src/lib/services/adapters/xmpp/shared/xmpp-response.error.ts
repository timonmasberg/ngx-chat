import {Stanza} from '../../../../core/stanza';
import {Finder} from './finder';

export class XmppResponseError extends Error {
    static readonly ERROR_ELEMENT_NS = 'urn:ietf:params:xml:ns:xmpp-stanzas';
    readonly errorCode?: number;
    readonly errorType?: string;
    readonly errorCondition?: string;

    constructor(readonly errorStanza: Stanza) {
        super(
            XmppResponseError.extractErrorTextFromErrorResponse(
                errorStanza,
                XmppResponseError.extractErrorDataFromErrorResponse(errorStanza),
            ),
        );

        const {code, type, condition} = XmppResponseError.extractErrorDataFromErrorResponse(errorStanza);
        this.errorCode = code;
        this.errorType = type;
        this.errorCondition = condition;
    }

    private static extractErrorDataFromErrorResponse(stanza: Stanza): {
        code?: number,
        type?: string,
        condition?: string
    } {
        const errorElement = Finder.create(stanza).searchByTag('error').result;
        const errorCode = Number(errorElement?.getAttribute('code')) || undefined;
        const errorType = errorElement?.getAttribute('type') as string | undefined;
        const errorCondition =
            Array.from(errorElement?.children)
                .filter(childElement =>
                    childElement.nodeName !== 'text' &&
                    childElement.getAttribute('xmlns') === XmppResponseError.ERROR_ELEMENT_NS,
                )[0].nodeName;

        return {
            code: errorCode,
            type: errorType,
            condition: errorCondition,
        };
    }

    private static extractErrorTextFromErrorResponse(
        stanza: Stanza,
        {code, type, condition}: {
            code?: number,
            type?: string,
            condition?: string
        }): string {
        const additionalData = [
            `errorCode: ${code ?? '[unknown]'}`,
            `errorType: ${type ?? '[unknown]'}`,
            `errorCondition: ${condition ?? '[unknown]'}`,
        ].join(', ');
        const stanzaError = Finder
            .create(stanza)
            ?.searchByTag('error')
            ?.searchByTag('text')
            ?.searchByNamespace(XmppResponseError.ERROR_ELEMENT_NS)
            ?.result
            ?.textContent;
        const errorText = stanzaError || 'Unknown error';

        return `XmppResponseError: ${errorText}${additionalData ? ` (${additionalData})` : ''}`;
    }
}
