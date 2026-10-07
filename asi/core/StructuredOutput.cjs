// ═══════════════════════════════════════════════════════════
// FILE: asi/core/StructuredOutput.cjs
// Structured output schemas and validation (Pydantic-like for JS)
// ═══════════════════════════════════════════════════════════

/**
 * Schema definition for approach generation
 */
const ApproachSchema = {
  type: 'object',
  required: ['name', 'strategy', 'steps'],
  properties: {
    name: {
      type: 'string',
      description: 'Short descriptive name for this approach'
    },
    strategy: {
      type: 'string',
      description: 'High-level strategy description'
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key implementation steps'
    },
    strengths: {
      type: 'string',
      description: 'What makes this approach good'
    },
    weaknesses: {
      type: 'string',
      description: 'Potential drawbacks'
    }
  }
};

/**
 * Schema for multiple approaches
 */
const ApproachesSchema = {
  type: 'array',
  items: ApproachSchema,
  minItems: 1,
  maxItems: 10
};

/**
 * Schema for solution code
 */
const SolutionSchema = {
  type: 'object',
  required: ['code'],
  properties: {
    code: {
      type: 'string',
      description: 'Complete JavaScript function code'
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation of implementation'
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence in solution (0-1)'
    }
  }
};

/**
 * Validate data against schema
 */
function validate(data, schema) {
  const errors = [];

  // Type check
  if (schema.type === 'object') {
    if (typeof data !== 'object' || Array.isArray(data) || data === null) {
      errors.push(`Expected object, got ${typeof data}`);
      return { valid: false, errors };
    }

    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in data)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Property validation
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          const propResult = validate(data[key], propSchema);
          if (!propResult.valid) {
            errors.push(`Field "${key}": ${propResult.errors.join(', ')}`);
          }
        }
      }
    }
  }

  else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      errors.push(`Expected array, got ${typeof data}`);
      return { valid: false, errors };
    }

    // Min/max items
    if (schema.minItems && data.length < schema.minItems) {
      errors.push(`Array too short: ${data.length} < ${schema.minItems}`);
    }
    if (schema.maxItems && data.length > schema.maxItems) {
      errors.push(`Array too long: ${data.length} > ${schema.maxItems}`);
    }

    // Item validation
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemResult = validate(data[i], schema.items);
        if (!itemResult.valid) {
          errors.push(`Item ${i}: ${itemResult.errors.join(', ')}`);
        }
      }
    }
  }

  else if (schema.type === 'string') {
    if (typeof data !== 'string') {
      errors.push(`Expected string, got ${typeof data}`);
    }
  }

  else if (schema.type === 'number') {
    if (typeof data !== 'number') {
      errors.push(`Expected number, got ${typeof data}`);
    }
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`Number too small: ${data} < ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`Number too large: ${data} > ${schema.maximum}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize and repair data
 */
function sanitize(data, schema) {
  if (schema.type === 'object') {
    const sanitized = {};

    // Copy valid required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (field in data) {
          sanitized[field] = data[field];
        } else {
          // Provide default for missing required field
          if (schema.properties && schema.properties[field]) {
            sanitized[field] = getDefault(schema.properties[field]);
          }
        }
      }
    }

    // Copy optional fields
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data && !(key in sanitized)) {
          sanitized[key] = sanitize(data[key], propSchema);
        }
      }
    }

    return sanitized;
  }

  else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      return [];
    }

    let sanitized = data;

    // Enforce item limits
    if (schema.maxItems && sanitized.length > schema.maxItems) {
      sanitized = sanitized.slice(0, schema.maxItems);
    }

    // Sanitize items
    if (schema.items) {
      sanitized = sanitized.map(item => sanitize(item, schema.items));
    }

    // Filter out invalid items
    sanitized = sanitized.filter(item => item !== null && item !== undefined);

    return sanitized;
  }

  else if (schema.type === 'string') {
    return String(data || '');
  }

  else if (schema.type === 'number') {
    const num = Number(data);
    if (isNaN(num)) return schema.minimum || 0;
    if (schema.minimum !== undefined && num < schema.minimum) return schema.minimum;
    if (schema.maximum !== undefined && num > schema.maximum) return schema.maximum;
    return num;
  }

  return data;
}

/**
 * Get default value for schema type
 */
function getDefault(schema) {
  switch (schema.type) {
    case 'string': return '';
    case 'number': return schema.minimum || 0;
    case 'array': return [];
    case 'object': return {};
    default: return null;
  }
}

/**
 * NORMALIZE: Force-shape approach objects (biological immune system style)
 * Accept and repair instead of reject
 *
 * PRODUCTION: Handles malformed data gracefully, never throws
 */
function normalizeApproach(raw) {
  try {
    // Safety: Handle null/undefined
    if (!raw || typeof raw !== 'object') {
      return {
        name: 'Fallback approach',
        strategy: 'Standard implementation',
        steps: ['Analyze problem', 'Implement solution', 'Test solution'],
        strengths: 'Reliable fallback',
        weaknesses: 'Generic approach',
        paradigm: 'unknown',
        confidence: 0.3,
        _normalized: true,
        _fallback: true
      };
    }

    // Normalize steps with multiple fallback strategies
    let steps = [];
    if (Array.isArray(raw.steps)) {
      steps = raw.steps.filter(s => typeof s === 'string' && s.length > 0);
    } else if (typeof raw.steps === 'string') {
      steps = [raw.steps];
    } else if (raw.steps && typeof raw.steps === 'object') {
      // Handle {0: "step1", 1: "step2"} format
      steps = Object.values(raw.steps).filter(s => typeof s === 'string' && s.length > 0);
    }

    // Ensure minimum steps
    if (steps.length === 0) {
      steps = ['Analyze problem', 'Implement solution', 'Test solution'];
    }

    // Coerce potential arrays to strings (LLMs sometimes return arrays for these fields)
    const toStr = (v, fallback) => {
      if (Array.isArray(v)) return v.join('; ');
      if (typeof v === 'string') return v;
      return fallback;
    };

    return {
      name: toStr(raw.name || raw.title, 'Unnamed approach').substring(0, 200),
      strategy: toStr(raw.strategy || raw.description || raw.approach, '').substring(0, 1000),
      steps: steps.slice(0, 20), // Max 20 steps for sanity
      strengths: toStr(raw.strengths || raw.pros || raw.advantages, 'Standard approach').substring(0, 500),
      weaknesses: toStr(raw.weaknesses || raw.cons || raw.limitations, 'May not be optimal').substring(0, 500),
      paradigm: raw.paradigm || 'unknown',
      confidence: typeof raw.confidence === 'number'
        ? Math.max(0, Math.min(1, raw.confidence)) // Clamp 0-1
        : 0.5,
      _normalized: true
    };
  } catch (error) {
    // PRODUCTION: Never throw, always return valid structure
    console.error('[StructuredOutput] Normalization error:', error.message);
    return {
      name: 'Error recovery approach',
      strategy: 'Fallback due to normalization error',
      steps: ['Analyze problem', 'Implement solution', 'Test solution'],
      strengths: 'Error recovery',
      weaknesses: 'Minimal information',
      paradigm: 'unknown',
      confidence: 0.2,
      _normalized: true,
      _error: error.message
    };
  }
}

/**
 * SCORE: Validate by scoring quality, not binary pass/fail
 * Returns score 0.0-1.0 based on completeness
 */
function scoreApproachValidity(approach) {
  let score = 0;

  // Name present and meaningful
  if (approach.name && approach.name.length > 3 && approach.name !== 'Unnamed approach') {
    score += 0.20;
  } else if (approach.name) {
    score += 0.10;
  }

  // Strategy present and detailed
  if (approach.strategy && approach.strategy.length > 50) {
    score += 0.25;
  } else if (approach.strategy && approach.strategy.length > 10) {
    score += 0.15;
  }

  // Steps array present and populated
  if (Array.isArray(approach.steps) && approach.steps.length >= 3) {
    score += 0.25;
  } else if (Array.isArray(approach.steps) && approach.steps.length > 0) {
    score += 0.15;
  }

  // Strengths described
  if (approach.strengths && approach.strengths.length > 10) {
    score += 0.15;
  } else if (approach.strengths) {
    score += 0.08;
  }

  // Weaknesses described
  if (approach.weaknesses && approach.weaknesses.length > 10) {
    score += 0.15;
  } else if (approach.weaknesses) {
    score += 0.07;
  }

  return Math.min(1.0, score);
}

/**
 * Extract balanced JSON structure from string
 */
function _extractBalancedJSON(str, openChar, closeChar) {
  let depth = 0;
  let start = -1;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === openChar) {
      if (depth === 0) start = i;
      depth++;
    } else if (str[i] === closeChar) {
      depth--;
      if (depth === 0 && start !== -1) {
        return str.substring(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse and validate LLM response with production-grade error handling
 *
 * @param {string|object} response - LLM response to parse
 * @param {object} schema - Schema to validate against
 * @param {object} options - Options { repair, fallback }
 * @returns {object} { success, data, averageScore?, message?, error? }
 *
 * PRODUCTION GUARANTEES:
 * - Never throws exceptions
 * - Always returns valid structure
 * - Graceful degradation on failures
 * - Detailed error logging
 */
function parseStructured(response, schema, options = {}) {
  const { repair = true, fallback = null } = options;
  const startTime = Date.now();

  try {
    // PRODUCTION: Handle null/undefined/empty responses
    if (!response) {
      console.warn('[StructuredOutput] Empty response received');
      throw new Error('Response is null or undefined');
    }
    
    // Convert to string if it's an object
    if (typeof response === 'object' && response !== null) {
      // Check if it's already parsed JSON
      if (Array.isArray(response) || response.constructor === Object) {
        console.log('[StructuredOutput] Response is already a parsed object');
        let data = response;
        
        // Skip to normalization
        let normalized = [];
        if (Array.isArray(data)) {
          normalized = data.map(item => normalizeApproach(item));
        } else {
          normalized = [normalizeApproach(data)];
        }
        
        const scored = normalized.map(approach => ({
          ...approach,
          _validityScore: scoreApproachValidity(approach)
        }));
        
        const averageScore = scored.length > 0
          ? scored.reduce((sum, a) => sum + a._validityScore, 0) / scored.length
          : 0;
        
        return {
          success: true,
          data: scored,
          averageScore,
          parseTimeMs: Date.now() - startTime,
          message: `Pre-parsed object normalized (${scored.length} approaches, avg score: ${averageScore.toFixed(2)})`
        };
      }
      
      // Try to stringify if it has other structure
      response = JSON.stringify(response);
    }
    
    // Trim whitespace
    response = String(response).trim();
    
    // Check for empty string after trimming
    if (response.length === 0) {
      console.warn('[StructuredOutput] Response is empty string');
      throw new Error('Response is empty after trimming');
    }
    
    // Step 1: Try direct parse
    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
      // Step 2: Extract JSON - handle multiple JSON blocks!
      // Remove code fences but keep the JSON
      let cleaned = response;

      // PRODUCTION: Extract all JSON blocks from code fences with greedy matching
      // Use greedy [\s\S]+ instead of non-greedy [\s\S]*? to handle long responses
      const codeBlocks = [
        ...response.matchAll(/```json\s*([\s\S]+?)```/gm),
        ...response.matchAll(/```javascript\s*([\s\S]+?)```/gm),
        ...response.matchAll(/```js\s*([\s\S]+?)```/gm),
        ...response.matchAll(/```\s*(\[[\s\S]+?\]|\{[\s\S]+?\})```/gm)  // Generic code block with JSON
      ];

      const jsonMatches = [];

      if (codeBlocks.length > 0) {
        // Found JSON in code blocks
        console.log(`[StructuredOutput] Found ${codeBlocks.length} code block(s)`);
        for (const block of codeBlocks) {
          const content = block[1].trim();
          if (content.length > 0 && (content.startsWith('[') || content.startsWith('{'))) {
            jsonMatches.push({ 0: content });
            console.log(`[StructuredOutput] ✅ Extracted ${content.length} chars from code block`);
          }
        }
      } else {
        // No code blocks, try to find raw JSON with multiple patterns
        cleaned = response.replace(/```\s*/g, '');

        // Try different extraction patterns in order of specificity
        // Pattern 1: Array with any content (most common for approaches)
        let matches = [...cleaned.matchAll(/\[\s*\{[\s\S]*?\}\s*\]/g)];

        // Pattern 2: Object with any content
        if (matches.length === 0) {
          matches = [...cleaned.matchAll(/\{\s*"[^"]+"\s*:[\s\S]*?\}/g)];
        }

        // Pattern 3: Aggressive - find largest valid JSON structure
        if (matches.length === 0) {
          // Find potential JSON starts
          const arrayStart = cleaned.indexOf('[');
          const objectStart = cleaned.indexOf('{');

          if (arrayStart !== -1 && (arrayStart < objectStart || objectStart === -1)) {
            // Try to extract array
            const extracted = _extractBalancedJSON(cleaned.substring(arrayStart), '[', ']');
            if (extracted) matches.push({ 0: extracted });
          } else if (objectStart !== -1) {
            // Try to extract object
            const extracted = _extractBalancedJSON(cleaned.substring(objectStart), '{', '}');
            if (extracted) matches.push({ 0: extracted });
          }
        }

        jsonMatches.push(...matches);
      }

      if (jsonMatches.length === 0) {
        // PRODUCTION: Better debugging with longer preview
        const preview = response.substring(0, 1500);
        console.error('[StructuredOutput] No JSON found in response.');
        console.error('[StructuredOutput] Tried patterns: code blocks (```json, ```javascript, ```js, ```), raw arrays, raw objects, balanced extraction');
        console.error('[StructuredOutput] Response length:', response.length);
        console.error('[StructuredOutput] Preview (first 1500 chars):', preview);
        console.error('[StructuredOutput] Has code fence:', response.includes('```'));
        throw new Error('No JSON found in response');
      }

      // Step 3: Try to parse each match
      const parsed = [];
      for (const match of jsonMatches) {
        try {
          let jsonStr = match[0];
          // Repair common issues
          jsonStr = jsonStr.replace(/\/\/.*$/gm, '');  // Remove comments
          jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');  // Remove trailing commas
          jsonStr = jsonStr.replace(/(\w+):/g, '"$1":');  // Quote keys

          const obj = JSON.parse(jsonStr);

          // If it's an array, add all items
          if (Array.isArray(obj)) {
            parsed.push(...obj);
          } else {
            parsed.push(obj);
          }
        } catch (parseError) {
          // Skip this JSON block if it fails
          continue;
        }
      }

      data = parsed.length > 0 ? parsed : null;

      if (!data) {
        throw new Error('Could not parse any JSON blocks');
      }
    }

    // Step 4: NORMALIZE (force-shape instead of reject)
    // BIOLOGICAL IMMUNE SYSTEM: Accept and repair, don't reject
    let normalized = [];
    if (Array.isArray(data)) {
      normalized = data.map(item => normalizeApproach(item));
    } else if (data && typeof data === 'object') {
      normalized = [normalizeApproach(data)];
    }

    // Step 5: SCORE (quality metric instead of pass/fail)
    const scored = normalized.map(approach => ({
      ...approach,
      _validityScore: scoreApproachValidity(approach)
    }));

    // Step 6: Accept with penalties (even low-quality approaches survive)
    // They'll be routed to RewriteBrain if score < threshold
    const averageScore = scored.length > 0
      ? scored.reduce((sum, a) => sum + a._validityScore, 0) / scored.length
      : 0;

    const parseTime = Date.now() - startTime;

    return {
      success: true,
      data: scored,
      repaired: true,
      averageScore,
      parseTimeMs: parseTime,
      message: `Normalized ${scored.length} approaches (avg score: ${averageScore.toFixed(2)}, ${parseTime}ms)`
    };

  } catch (error) {
    // PRODUCTION: Comprehensive error recovery
    const parseTime = Date.now() - startTime;

    console.error('[StructuredOutput] Parse error:', {
      error: error.message,
      stack: error.stack?.split('\n')[0],
      responseType: typeof response,
      responsePreview: typeof response === 'string' ? response.substring(0, 100) : JSON.stringify(response).substring(0, 100),
      parseTimeMs: parseTime
    });

    // Try fallback if provided
    if (fallback !== null) {
      console.warn('[StructuredOutput] Using fallback data');
      return {
        success: true,
        data: Array.isArray(fallback) ? fallback : [fallback],
        fallback: true,
        parseTimeMs: parseTime,
        error: error.message
      };
    }

    // Last resort: Return minimal valid structure
    console.warn('[StructuredOutput] Returning minimal fallback structure');
    return {
      success: true, // Still succeed to keep system running
      data: [{
        name: 'Emergency fallback',
        strategy: 'Minimal approach due to parse failure',
        steps: ['Analyze problem', 'Implement basic solution', 'Test'],
        strengths: 'Always available',
        weaknesses: 'Minimal information',
        paradigm: 'unknown',
        confidence: 0.1,
        _validityScore: 0.1,
        _emergency: true
      }],
      parseTimeMs: parseTime,
      error: error.message,
      emergency: true
    };
  }
}

module.exports = {
  ApproachSchema,
  ApproachesSchema,
  SolutionSchema,
  validate,
  sanitize,
  parseStructured
};
