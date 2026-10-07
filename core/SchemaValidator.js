/**
 * core/SchemaValidator.js
 * 
 * Reliability layer for LLM outputs.
 * Ensures model responses match expected JSON schemas.
 */

import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Validate data against a JSON schema
 * @param {Object} schema JSON Schema object
 * @param {any} data Data to validate
 * @returns {any} Returns the data if valid, throws error otherwise.
 */
export function validateSchema(schema, data) {
    const validate = ajv.compile(schema);
    const valid = validate(data);

    if (!valid) {
        const errorDetails = ajv.errorsText(validate.errors);
        throw new Error(`Schema validation failed: ${errorDetails}`);
    }

    return data;
}

export default validateSchema;
