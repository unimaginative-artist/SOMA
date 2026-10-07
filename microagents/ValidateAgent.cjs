// ValidateAgent.cjs
// Specialized MicroAgent for data validation and schema checking

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');

class ValidateAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'validate' });
  }
  
  /**
   * Execute validation task
   * Task format:
   * {
   *   validation: 'schema' | 'type' | 'range' | 'format' | 'custom',
   *   data: any,
   *   schema: {} (for schema validation),
   *   rules: {} (for custom validation)
   * }
   */
  async execute(task) {
    const { validation, data, schema, rules } = task;
    
    if (!validation) {
      throw new Error('Task must include validation type');
    }
    
    if (data === undefined) {
      throw new Error('Task must include data');
    }
    
    this.logger.info(`[ValidateAgent:${this.id}] Validating: ${validation}`);
    
    switch (validation) {
      case 'schema':
        return this._validateSchema(data, schema);
      
      case 'type':
        return this._validateType(data, rules);
      
      case 'range':
        return this._validateRange(data, rules);
      
      case 'format':
        return this._validateFormat(data, rules);
      
      case 'custom':
        return this._validateCustom(data, rules);
      
      case 'email':
        return this._validateEmail(data);
      
      case 'url':
        return this._validateURL(data);
      
      case 'json':
        return this._validateJSON(data);
      
      default:
        throw new Error(`Unknown validation type: ${validation}`);
    }
  }
  
  _validateSchema(data, schema) {
    if (!schema) {
      throw new Error('Schema validation requires schema');
    }
    
    const errors = [];
    const warnings = [];
    
    // Validate required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in data)) {
          errors.push({
            field,
            type: 'required',
            message: `Missing required field: ${field}`
          });
        }
      }
    }
    
    // Validate field types
    if (schema.properties) {
      for (const [field, fieldSchema] of Object.entries(schema.properties)) {
        if (field in data) {
          const value = data[field];
          const expectedType = fieldSchema.type;
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          
          if (expectedType && actualType !== expectedType) {
            errors.push({
              field,
              type: 'type_mismatch',
              message: `Expected ${expectedType}, got ${actualType}`,
              expected: expectedType,
              actual: actualType
            });
          }
          
          // Validate min/max for numbers
          if (expectedType === 'number') {
            if (fieldSchema.min !== undefined && value < fieldSchema.min) {
              errors.push({
                field,
                type: 'range',
                message: `Value ${value} < min ${fieldSchema.min}`
              });
            }
            
            if (fieldSchema.max !== undefined && value > fieldSchema.max) {
              errors.push({
                field,
                type: 'range',
                message: `Value ${value} > max ${fieldSchema.max}`
              });
            }
          }
          
          // Validate minLength/maxLength for strings
          if (expectedType === 'string') {
            if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
              errors.push({
                field,
                type: 'length',
                message: `Length ${value.length} < minLength ${fieldSchema.minLength}`
              });
            }
            
            if (fieldSchema.maxLength !== undefined && value.length > fieldSchema.maxLength) {
              errors.push({
                field,
                type: 'length',
                message: `Length ${value.length} > maxLength ${fieldSchema.maxLength}`
              });
            }
            
            // Validate pattern
            if (fieldSchema.pattern) {
              const regex = new RegExp(fieldSchema.pattern);
              if (!regex.test(value)) {
                errors.push({
                  field,
                  type: 'pattern',
                  message: `Value doesn't match pattern: ${fieldSchema.pattern}`
                });
              }
            }
          }
          
          // Validate enum
          if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
            errors.push({
              field,
              type: 'enum',
              message: `Value not in enum: ${fieldSchema.enum.join(', ')}`
            });
          }
        }
      }
    }
    
    // Check for extra fields
    if (schema.additionalProperties === false) {
      const allowedFields = new Set([
        ...(schema.required || []),
        ...Object.keys(schema.properties || {})
      ]);
      
      for (const field of Object.keys(data)) {
        if (!allowedFields.has(field)) {
          warnings.push({
            field,
            type: 'extra_field',
            message: `Extra field not in schema: ${field}`
          });
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      errorCount: errors.length,
      warningCount: warnings.length
    };
  }
  
  _validateType(data, rules) {
    const { expectedType, allowNull = false } = rules || {};
    
    if (!expectedType) {
      throw new Error('Type validation requires expectedType in rules');
    }
    
    if (data === null) {
      return {
        valid: allowNull,
        actualType: 'null',
        expectedType,
        message: allowNull ? 'Null is allowed' : 'Null is not allowed'
      };
    }
    
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    const valid = actualType === expectedType;
    
    return {
      valid,
      actualType,
      expectedType,
      message: valid ? 'Type matches' : `Expected ${expectedType}, got ${actualType}`
    };
  }
  
  _validateRange(data, rules) {
    const { min, max, inclusive = true } = rules || {};
    
    if (typeof data !== 'number') {
      return {
        valid: false,
        message: 'Range validation requires numeric data'
      };
    }
    
    const errors = [];
    
    if (min !== undefined) {
      const valid = inclusive ? data >= min : data > min;
      if (!valid) {
        errors.push(`Value ${data} ${inclusive ? '<' : '<='} min ${min}`);
      }
    }
    
    if (max !== undefined) {
      const valid = inclusive ? data <= max : data < max;
      if (!valid) {
        errors.push(`Value ${data} ${inclusive ? '>' : '>='} max ${max}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      value: data,
      min,
      max,
      inclusive,
      errors
    };
  }
  
  _validateFormat(data, rules) {
    const { format } = rules || {};
    
    if (!format) {
      throw new Error('Format validation requires format in rules');
    }
    
    if (typeof data !== 'string') {
      return {
        valid: false,
        message: 'Format validation requires string data'
      };
    }
    
    let regex;
    let description;
    
    switch (format) {
      case 'email':
        return this._validateEmail(data);
      
      case 'url':
        return this._validateURL(data);
      
      case 'uuid':
        regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        description = 'UUID';
        break;
      
      case 'date':
        regex = /^\d{4}-\d{2}-\d{2}$/;
        description = 'Date (YYYY-MM-DD)';
        break;
      
      case 'time':
        regex = /^\d{2}:\d{2}:\d{2}$/;
        description = 'Time (HH:MM:SS)';
        break;
      
      case 'phone':
        regex = /^[\d\s\-\+\(\)]+$/;
        description = 'Phone number';
        break;
      
      case 'hex':
        regex = /^[0-9a-f]+$/i;
        description = 'Hexadecimal';
        break;
      
      case 'base64':
        regex = /^[A-Za-z0-9+/]+=*$/;
        description = 'Base64';
        break;
      
      default:
        // Custom regex
        if (rules.pattern) {
          regex = new RegExp(rules.pattern);
          description = 'Custom pattern';
        } else {
          throw new Error(`Unknown format: ${format}`);
        }
    }
    
    const valid = regex.test(data);
    
    return {
      valid,
      format,
      description,
      message: valid ? `Valid ${description}` : `Invalid ${description}`
    };
  }
  
  _validateCustom(data, rules) {
    if (!rules || !rules.validator || typeof rules.validator !== 'function') {
      throw new Error('Custom validation requires validator function in rules');
    }
    
    try {
      const result = rules.validator(data);
      
      if (typeof result === 'boolean') {
        return {
          valid: result,
          message: result ? 'Validation passed' : 'Validation failed'
        };
      }
      
      // Assume result is validation object
      return result;
    } catch (err) {
      return {
        valid: false,
        error: err.message,
        message: 'Validator threw an error'
      };
    }
  }
  
  _validateEmail(data) {
    if (typeof data !== 'string') {
      return { valid: false, message: 'Email must be a string' };
    }
    
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid = regex.test(data);
    
    return {
      valid,
      format: 'email',
      message: valid ? 'Valid email' : 'Invalid email format'
    };
  }
  
  _validateURL(data) {
    if (typeof data !== 'string') {
      return { valid: false, message: 'URL must be a string' };
    }
    
    try {
      const url = new URL(data);
      return {
        valid: true,
        format: 'url',
        protocol: url.protocol,
        hostname: url.hostname,
        message: 'Valid URL'
      };
    } catch {
      return {
        valid: false,
        format: 'url',
        message: 'Invalid URL format'
      };
    }
  }
  
  _validateJSON(data) {
    if (typeof data !== 'string') {
      return { valid: false, message: 'JSON validation requires string' };
    }
    
    try {
      const parsed = JSON.parse(data);
      return {
        valid: true,
        format: 'json',
        parsed,
        message: 'Valid JSON'
      };
    } catch (err) {
      return {
        valid: false,
        format: 'json',
        error: err.message,
        message: 'Invalid JSON'
      };
    }
  }
}

module.exports = { ValidateAgent };
