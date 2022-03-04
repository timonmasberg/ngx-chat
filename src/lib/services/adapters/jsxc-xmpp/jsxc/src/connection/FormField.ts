
export interface IFormFieldData {
    label?: string;
    type?: string;
    name: string;
    description?: string;
    isRequired?: boolean;
    values?: string[];
    options?: Option2[];
}

export interface IFormFieldJSONData {
    type?: string;
    name: string;
    values: string[];
}

class Option2 {
    public static fromXML(optionElement) {
        const label = optionElement.attr('label'); // optional
        const value = optionElement.find('value').text();

        return new Option2(label, value);
    }

    private constructor(private label: string, private value: string) {
    }

    public getValue(): string {
        return this.value;
    }

    public toHTML() {
        const optionElement = document.createElement('<option>');

        optionElement.append(this.label || this.value);
        optionElement.setAttribute('value', this.value);

        return optionElement;
    }
}

export default class FormField {
    private ALLOWED_TYPES = [
        'boolean',
        'fixed',
        'hidden',
        'jid-multi',
        'jid-single',
        'list-multi',
        'list-single',
        'text-multi',
        'text-private',
        'text-single',
    ];

    public static fromXML(fieldElement: Element) {
        return new FormField({
            label: fieldElement.getAttribute('label'), // MAY
            type: (fieldElement.getAttribute('type') || 'text-single').toLowerCase(),
            name: fieldElement.getAttribute('var'), // MUST, if type != fixed. Unique, if form != result
            description: fieldElement.getAttribute('desc'), // MAY
            isRequired: fieldElement.getAttribute('required').length > 0, // MAY
            values: Array.from(fieldElement
                .querySelectorAll('>value'))
                .map((element) => element.textContent),
            options: Array.from(fieldElement
                .querySelectorAll('option'))
                .map((element) => Option2.fromXML(element))
        });
    }

    public static fromHTML(formElement) {
        formElement = document.createElement(formElement);
        const type = formElement.attr('data-type');
        const name = formElement.attr('data-name');
        let values;

        switch (type) {
            case 'list-multi':
            case 'list-single':
                values = formElement.find('select').val();
                break;
            case 'text-multi':
            case 'jid-multi':
                values = formElement.find('textarea').text().split('\n');
                break;
            case 'boolean':
                values = formElement.find('input').prop('checked') ? '1' : '0';
                break;
            default:
                values = formElement.find('input').val();
        }

        if (!(values instanceof Array)) {
            values = [values];
        }

        if (type === 'list-single' && values.length > 1) {
            throw new Error('list-single should have only one selected option.');
        }

        return new FormField({
            type,
            name,
            values,
        });
    }

    public static fromJSON(data: IFormFieldJSONData) {
        return new FormField(data);
    }

    constructor(private data: IFormFieldData) {
        if (this.ALLOWED_TYPES.indexOf(data.type) < 0) {
            this.data.type = 'text-single'; // default value according to XEP-0004
        }

        if (!this.data.values) {
            this.data.values = [];
        }

        if (
            this.data.values.length > 1 &&
            ['jid-multi', 'list-multi', 'text-multi', 'hidden'].indexOf(this.data.type) < 0
        ) {
            throw new Error('Fields of type ' + data.type + ' are not allowed to have multiple value elements.');
        }

        if (!this.data.options) {
            this.data.options = [];
        }

        if (this.data.options.length > 0 && ['list-multi', 'list-single'].indexOf(this.data.type) < 0) {
            throw new Error('Only fields of type list-multi or list-single are allowed to have option elements.');
        }
    }

    public getName(): string {
        return this.data.name;
    }

    public getType(): string {
        return this.data.type;
    }

    public getLabel(): string {
        return this.data.label;
    }

    public getValues(): string[] {
        return this.data.values;
    }

    public toJSON() {
        return {
            type: this.data.type,
            name: this.data.name,
            values: this.data.values,
        };
    }

    public toXML() {
        const xmlElement = $build('field', {
            type: this.data.type,
            var: this.data.name,
        });

        for (const value of this.data.values) {
            xmlElement.c('value').t(value).up();
        }

        return xmlElement.tree();
    }

    public toHTML() {
        let element;

        switch (this.data.type) {
            case 'fixed':
                const paragraphs = Array.from(this.data.values.map((value) => {
                        const p = document.createElement('<p>');
                        p.append(value);
                        return p;
                    }
                ));
                const divElement = document.createElement('<div>');
                divElement.append(...paragraphs);
                element = divElement;
                break;
            case 'boolean':
            case 'hidden':
            case 'jid-single':
            case 'text-private':
            case 'text-single':
                element = this.createInputElement();
                break;
            case 'jid-multi':
            case 'text-multi':
                element = this.createTextareaElement();
                break;
            case 'list-multi':
            case 'list-single':
                element = this.createSelectElement();
                break;
        }

        // @TODO add description

        element.attr('name', this.data.name);

        if (this.data.isRequired) {
            element.attr('required', 'required');
        }

        if (this.data.type !== 'boolean') {
            const id = this.data.name; // @REVIEW is this unique enough
            const groupElement = document.createElement('<div>');
            groupElement.classList.add('form-group');

            if (this.data.label) {
                const labelElement = document.createElement('<label>');
                labelElement.append(this.data.label);
                labelElement.setAttribute('for', id);
                labelElement.classList.add('col-sm-4');

                element.attr('id', id);
                element.addClass('col-sm-8');

                groupElement.append(labelElement);
            }

            groupElement.append(element);

            element = groupElement;
        }

        if (this.data.type !== 'fixed') {
            element.addClass('jabber-x-data');
            element.attr('data-type', this.data.type);
            element.attr('data-name', this.data.name);
        }

        return element;
    }

    private createInputElement() {
        let element = document.createElement('<input>');
        element.setAttribute('autocomplete', 'off');

        if (this.data.values.length > 0) {
            element.setAttribute('value', this.data.values[0]);
        }

        switch (this.data.type) {
            case 'boolean':
                element.setAttribute('type', 'checkbox');
                const value = this.data.values.length === 1 ? this.data.values[0] : 0;
                if (value === 'true' || value === '1') {
                    element.setAttribute('checked', 'checked');
                }
                if (this.data.label) {
                    const label = document.createElement('<label>');
                    label.append(element);
                    element = label;
                    element.classList.add('col-sm-8 col-sm-offset-4');
                    element.append(this.data.label);
                    const wrapDiv = document.createElement('<div>');
                    wrapDiv.classList.add('checkbox');
                    wrapDiv.append(element);
                    element = wrapDiv; // @REVIEW
                    const wrapWrapDiv = document.createElement('<div>');
                    wrapWrapDiv.classList.add('form-group');
                    wrapWrapDiv.append(element);
                    element = wrapWrapDiv;
                }
                break;
            case 'hidden':
                element.setAttribute('type', 'hidden');
                break;
            case 'jid-single':
                element.setAttribute('type', 'email'); // @REVIEW no jids with resources
                break;
            case 'text-private':
                element.setAttribute('type', 'password');
                element.setAttribute('autocomplete', 'new-password');
                break;
            case 'text-single':
                element.setAttribute('type', 'text');
                break;
        }

        return element;
    }

    private createTextareaElement() {
        const element = document.createElement('<textarea>');

        if (this.data.values.length > 0) {
            element.append(this.data.values.join('\n'));
        }

        return element;
    }

    private createSelectElement() {
        const element = document.createElement('<select>');

        if (this.data.type === 'list-multi') {
            element.setAttribute('multiple', 'multiple');
        }

        const options = this.data.options.map(option => {
            const optionElement = option.toHTML();

            if (this.data.values.indexOf(option.getValue()) > -1) {
                optionElement.setAttribute('selected', 'selected');
            }

            return optionElement;
        });

        for (const option of options) {
            element.append(option);
        }

        return element;
    }
}
