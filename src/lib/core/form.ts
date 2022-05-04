import {Builder} from '../services/adapters/xmpp/interface/builder';

// implements https://xmpp.org/extensions/xep-0004.html

export const FORM_NS = 'jabber:x:data';

export type FormType = 'form' | 'submit' | 'cancel' | 'result';

export interface Form {
    type: FormType;
    title?: string;
    instructions: string[];
    fields: FormField[];
}

export type FieldType =
    | 'fixed'
    | 'boolean'
    | 'hidden'
    | 'jid-single'
    | 'jid-multi'
    | 'list-single'
    | 'list-multi'
    | 'text-single'
    | 'text-private'
    | 'text-multi';

export interface FieldValueType {
    fixed: string;
    boolean: boolean;
    hidden: string;
    'jid-single': string;
    'jid-multi': string[];
    'list-single': string;
    'list-multi': string[];
    'text-single': string;
    'text-private': string;
    'text-multi': string[];
}

export type FormField =
    | FixedFormField
    | BooleanFormField
    | TextualFormField
    | JidSingleFormField
    | JidMultiFormField
    | ListSingleFormField
    | ListMultiFormField
    | TextMultiFormField;

export interface FixedFormField {
    type: 'fixed';
    variable?: string;
    value: string;
}

interface FormFieldBase<TFieldType extends FieldType> {
    type: TFieldType;
    variable: string;
    label?: string;
    required?: boolean;
    description?: string;
    value?: FieldValueType[TFieldType];
}

export type BooleanFormField = FormFieldBase<'boolean'>;
export type TextualFormField = FormFieldBase<'hidden' | 'text-single' | 'text-private'>;
export type JidSingleFormField = FormFieldBase<'jid-single'>;
export type JidMultiFormField = FormFieldBase<'jid-multi'>;
export type TextMultiFormField = FormFieldBase<'text-multi'>;

interface ListFormField<TFieldType extends 'list-single' | 'list-multi'> extends FormFieldBase<TFieldType> {
    options?: FieldOption[];
}

export type ListSingleFormField = ListFormField<'list-single'>;
export type ListMultiFormField = ListFormField<'list-multi'>;

export interface FieldOption {
    label?: string;
    value: string;
}

function parseStringValue([valueEl]: Element[]): string {
    return valueEl?.textContent;
}

function parseMultipleStringValues(valueEls: Element[]): string[] {
    return valueEls.map(el => parseStringValue([el]));
}

function parseJidValue([valueEl]: Element[]): string {
    return valueEl && valueEl.textContent;
}

const valueParsers = {
    fixed: parseStringValue,
    boolean: ([valueEl]: Element[]): boolean => {
        if (!valueEl) {
            return false;
        }
        const value = valueEl.textContent;
        return value === '1' || value === 'true';
    },
    hidden: parseStringValue,
    'jid-single': parseJidValue,
    'jid-multi': (valueEls: Element[]): string[] =>
        [
            ...new Set(
                valueEls.map(el => parseStringValue([el])),
            ),
        ],
    'list-single': parseStringValue,
    'list-multi': parseMultipleStringValues,
    'text-single': parseStringValue,
    'text-private': parseStringValue,
    'text-multi': parseMultipleStringValues,
};

export function parseForm(formEl: Element): Form {
    if (formEl.nodeName !== 'x' || formEl.getAttribute('xmlns') !== FORM_NS) {
        throw new Error(`Provided element is not a form element: elementName=${formEl.tagName}, xmlns=${formEl.getAttribute('xmlns')}, form=${formEl.toString()}`);
    }

    return {
        type: formEl.getAttribute('type') as FormType,
        title: formEl.getAttribute('title') ?? undefined,
        instructions: Array.from(formEl.querySelectorAll('instructions')).map(descEl => descEl?.textContent),
        fields: Array.from(formEl.querySelectorAll('field'))
            .map(fieldEl => {
                const rawType = fieldEl.getAttribute('type');
                const type = rawType in valueParsers ? rawType as keyof typeof valueParsers : 'text-single';
                const variable = fieldEl.getAttribute('var');
                const label = fieldEl.getAttribute('label');
                let options: FieldOption[] | undefined;
                if (type === 'list-single' || type === 'list-multi') {
                    options = Array.from(fieldEl.querySelectorAll('option')).map(optionEl => ({
                        value: optionEl.querySelector('value')?.textContent,
                        label: optionEl.getAttribute('label'),
                    }));
                }
                return {
                    type,
                    variable,
                    label,
                    description: fieldEl.querySelector('desc')?.textContent ?? undefined,
                    required: fieldEl.querySelector('required') != null,
                    value: valueParsers[type](Array.from(fieldEl.querySelectorAll('value'))),
                    options,
                } as FormField;
            }),
    };
}

export function getField<TFormField extends FormField>(form: Form, variable: string): TFormField | undefined {
    return form.fields.find(field => field.variable === variable) as TFormField ?? undefined;
}

export function setFieldValue<TFieldType extends FieldType, TValue extends FieldValueType[TFieldType]>(
    form: Form,
    type: TFieldType,
    variable: string,
    value: TValue,
    createField = false,
) {
    const field = form.fields.find((f) => f.variable === variable);

    if (field && field.type === type) {
        field.value = value;
        return;
    }

    if (field && field.type !== type) {
        throw new Error(`type mismatch setting field value: variable=${field.variable}, field.type=${field.type}, requested type=${type}`);
    }

    if (!createField) {
        throw new Error(`field for variable not found! variable=${variable}, type=${type}, value=${value}`);
    }

    form.fields.push({
        type,
        variable,
        value,
    } as FormField);
}

function serializeTextualField(field: TextualFormField | ListSingleFormField): string[] {
    return field.value != null ? [field.value] : [];
}

function serializeTextualMultiField(field: ListMultiFormField | TextMultiFormField): string[] {
    return field.value;
}

const valueSerializers: Record<FieldType, (field: FormField) => string[]> = {
    fixed: serializeTextualField,
    boolean: (field: BooleanFormField) => field.value != null ? [String(field.value)] : [],
    hidden: serializeTextualField,
    'jid-single': (field: JidSingleFormField) => field.value ? [field.value.toString()] : [],
    'jid-multi': (field: JidMultiFormField) => field.value.map(jid => jid.toString()),
    'list-single': serializeTextualField,
    'list-multi': serializeTextualMultiField,
    'text-single': serializeTextualField,
    'text-private': serializeTextualField,
    'text-multi': serializeTextualMultiField,
};

export function serializeToSubmitForm(builder: Builder, form: Form): Builder {
    const serializedFields = form.fields
        .reduce<[string, string[]][]>((collectedFields, field) => {
            const serializer = valueSerializers[field.type];
            if (!serializer) {
                throw new Error(`unknown field type: ${field.type}`);
            }

            const values = serializer(field);

            if (field.variable != null && values.length > 0) {
                collectedFields.push([field.variable, values]);
            }

            return collectedFields;
        }, []);

    const childBuilder = builder.c('x', {xmlns: FORM_NS, type: 'submit'});
    serializedFields.map(
        ([variable, values]) => {
            const childChildBuilder = childBuilder.c('field', {var: variable});
            values.map(value => childChildBuilder.c('value', {}, value));
        });

    return builder;
}
