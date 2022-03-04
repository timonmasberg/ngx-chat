import InvalidParameterError from '../errors/InvalidParameterError';
import Field from './FormField';
import {IFormFieldJSONData} from './FormField';
import ItemField from './FormItemField';
import ReportField from './FormReportedField';

/**
 * XEP-0004: Data Forms
 *
 * @url https://xmpp.org/extensions/xep-0004.html
 */

const NAMESPACE = 'jabber:x:data';

type TYPE = 'cancel' | 'form' | 'result' | 'submit' | 'hidden';

export interface IFormJSONData {
    type: string;
    fields: IFormFieldJSONData[];
    instructions?: string[];
    title?: string;
}

export function FormFromJSON(data: IFormJSONData) {
    return Form.fromJSON(data)
}

// @REVIEW xss

export default class Form {
    private ALLOWED_TYPES = ['cancel', 'form', 'result', 'submit', 'hidden'];

    public static fromXML(stanza: Element) {
        const stanzaElement = stanza;
        const xElement =
            stanzaElement.getAttribute('xmlns') === NAMESPACE && stanzaElement[0].tagName.toUpperCase() === 'X'
                ? stanzaElement
                : stanzaElement.querySelector('x[xmlns="jabber:x:data"]');
        const type = xElement.getAttribute('type');
        const instructions = Array.from(xElement.querySelector('>instructions').children).map(el => el.textContent);
        const title = xElement.querySelector('>title').textContent;

        const fieldElements = xElement.querySelector('>field');
        const fields = Array.from(fieldElements.children).map(element => Field.fromXML(element));

        const reportedElement = xElement.querySelector('>reported');
        const reportedFieldElements = reportedElement.querySelector('>field');
        const reportedFields = Array.from(reportedFieldElements.children).map(element => ReportField.fromXML(element));

        const itemElements = xElement.querySelector('>item');
        const items = Array.from(itemElements.children).map(itemElement => {
            const itemFieldElements = itemElement.querySelector('>field');
            return Array.from(itemFieldElements.children).map(itemFieldElement => ItemField.fromXML(itemFieldElement));
        });

        return new Form(type, fields, instructions, title, reportedFields, items);
    }

    public static fromJSON(data: IFormJSONData) {
        return new Form(
            data.type,
            data.fields.map(fieldData => Field.fromJSON(fieldData)),
            data.instructions,
            data.title
        );
    }

    public static fromHTML(element: Element): Form {
        const formElements = element.querySelector('.jabber-x-data');

        const fields = Array.from(formElements.children).map(formElement => {
            return Field.fromHTML(formElement);
        });

        if (element.getAttribute('data-type') !== 'form') {
            throw new Error('Can only process forms of type "form".');
        }

        return new Form('submit', fields);
    }

    private constructor(
        private type: string,
        private fields: Field[],
        private instructions?: string[],
        private title?: string,
        private reportedFields?: ReportField[],
        private items?: Field[][]
    ) {
        if (this.ALLOWED_TYPES.indexOf(type) < 0) {
            throw new InvalidParameterError(
                `Form type not allowed! Instead of "${type}" try one of these: ${this.ALLOWED_TYPES.join(', ')}.`
            );
        }

        if (items && items.length > 0) {
            this.checkItems();
        }
    }

    private checkItems() {
        if (!this.reportedFields || this.reportedFields.length === 0) {
            return;
        }

        this.items.forEach((fields, itemIndex) => {
            if (fields.length !== this.reportedFields.length) {
                throw new InvalidParameterError(`Item ${itemIndex} does not contain all "reported" fields.`);
            }

            this.reportedFields.forEach((field, index) => {
                // tslint:disable-next-line:max-line-length
                // because the order of reported fields must not be equal with the fields order we have to search the field name in reportedFields array
                // and cant simply use the same index here
                const reportedFieldsArray = this.reportedFields.map(rfield => rfield.getName());
                if (reportedFieldsArray.indexOf(fields[index].getName()) === -1) {
                    throw new InvalidParameterError(`Item ${itemIndex} does not contain all "reported" fields.`);
                }
            });
        });
    }

    public toJSON() {
        return {
            type: this.type,
            fields: this.fields.map(field => field.toJSON()),
            instructions: this.instructions,
            title: this.title,
        };
    }

    public toXML() {
        const xmlElement = $build('x', {
            xmlns: 'jabber:x:data',
            type: this.type,
        });

        for (const field of this.fields) {
            xmlElement.cnode(field.toXML()).up();
        }

        return xmlElement.tree();
    }

    public toHTML() {
        if (this.type === 'form') {
            return this.toHTMLForm();
        } else if (this.type === 'result') {
            return this.toHTMLResult();
        }
        return new HTMLElement();
    }

    private toHTMLForm() {
        const formElement = new HTMLFormElement();
        formElement.attr('data-type', this.type);
        formElement.attr('autocomplete', 'off');
        formElement.addClass('form-horizontal');

        if (this.title) {
            const headerElement = document.createElement('<h1>');
            headerElement.append(this.title);

            formElement.append(headerElement);
        }

        if (this.instructions) {
            const textElements = this.instructions.map(instruction => {
                const textElement = document.createElement('<p>');
                textElement.append(instruction);
                return textElement;
            }
        )

            formElement.append(...textElements);
        }

        for (const field of this.fields) {
            formElement.append(field.toHTML());
        }

        return formElement;
    }

    private toHTMLResult() {
        const tableElement = document.createElement('<table>');
        const tableHeader = document.createElement('<thead>');
        const headerRow = document.createElement('<tr>');
        const tableBody = document.createElement('<tbody>');

        this.reportedFields.forEach(field => {
            const header = document.createElement('<th>');
            header.append(field.getName());
            headerRow.append(header);
        });

        tableHeader.append(headerRow);
        tableElement.append(tableHeader);

        this.items.forEach(fieldRow => {
            const tableRow = document.createElement('<tr>');

            fieldRow.forEach(field => {
                const cell = document.createElement('<td>');
                cell.append(field.getValues()[0]);
                tableRow.append(cell);
            });

            tableBody.append(tableRow);
        });

        tableElement.append(tableBody);

        return tableElement;
    }

    public getValues(key: string): string[] {
        const fields = this.fields.filter(field => field.getName() === key);

        return fields.length > 0 ? fields[0].getValues() : undefined;
    }

    public getFields(): Field[] {
        return this.fields;
    }

    public getType(): TYPE {
        return this.type as TYPE;
    }

    public getTitle(): string | undefined {
        return this.title;
    }

    public getInstructions(): string[] | undefined {
        return this.instructions;
    }
}
