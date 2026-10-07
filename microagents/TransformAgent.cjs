// TransformAgent.cjs
// Specialized MicroAgent for data transformation operations

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');

class TransformAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'transform' });
  }
  
  /**
   * Execute transformation task
   * Task format:
   * {
   *   operation: 'filter' | 'map' | 'reduce' | 'sort' | 'chunk' | 'flatten' | 'custom',
   *   data: [...],
   *   params: {}
   * }
   */
  async execute(task) {
    const { operation, data, params = {} } = task;
    
    if (!operation) {
      throw new Error('Task must include operation');
    }
    
    if (!data) {
      throw new Error('Task must include data');
    }
    
    this.logger.info(`[TransformAgent:${this.id}] Transforming: ${operation}`);
    
    switch (operation) {
      case 'filter':
        return this._filter(data, params);
      
      case 'map':
        return this._map(data, params);
      
      case 'reduce':
        return this._reduce(data, params);
      
      case 'sort':
        return this._sort(data, params);
      
      case 'chunk':
        return this._chunk(data, params);
      
      case 'flatten':
        return this._flatten(data, params);
      
      case 'deduplicate':
        return this._deduplicate(data, params);
      
      case 'aggregate':
        return this._aggregate(data, params);
      
      case 'custom':
        if (!params.fn || typeof params.fn !== 'function') {
          throw new Error('Custom operation requires params.fn function');
        }
        return params.fn(data, params);
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  _filter(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for filter operation');
    }
    
    const { predicate, key, value, operator = '===' } = params;
    
    if (predicate && typeof predicate === 'function') {
      return data.filter(predicate);
    }
    
    if (key !== undefined) {
      return data.filter(item => {
        const itemValue = typeof item === 'object' ? item[key] : item;
        switch (operator) {
          case '===': return itemValue === value;
          case '!==': return itemValue !== value;
          case '>': return itemValue > value;
          case '<': return itemValue < value;
          case '>=': return itemValue >= value;
          case '<=': return itemValue <= value;
          case 'includes': return String(itemValue).includes(value);
          default: return itemValue === value;
        }
      });
    }
    
    throw new Error('Filter requires predicate function or key/value params');
  }
  
  _map(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for map operation');
    }
    
    const { mapper, key, transform } = params;
    
    if (mapper && typeof mapper === 'function') {
      return data.map(mapper);
    }
    
    if (key !== undefined) {
      return data.map(item => typeof item === 'object' ? item[key] : item);
    }
    
    if (transform) {
      return data.map(item => {
        const result = {};
        Object.keys(transform).forEach(newKey => {
          const sourceKey = transform[newKey];
          result[newKey] = item[sourceKey];
        });
        return result;
      });
    }
    
    throw new Error('Map requires mapper function, key, or transform object');
  }
  
  _reduce(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for reduce operation');
    }
    
    const { reducer, initialValue } = params;
    
    if (!reducer || typeof reducer !== 'function') {
      throw new Error('Reduce requires reducer function');
    }
    
    return data.reduce(reducer, initialValue);
  }
  
  _sort(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for sort operation');
    }
    
    const { comparator, key, order = 'asc' } = params;
    
    const sorted = [...data];
    
    if (comparator && typeof comparator === 'function') {
      return sorted.sort(comparator);
    }
    
    if (key) {
      return sorted.sort((a, b) => {
        const aVal = typeof a === 'object' ? a[key] : a;
        const bVal = typeof b === 'object' ? b[key] : b;
        
        if (order === 'desc') {
          return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
        }
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      });
    }
    
    return sorted.sort((a, b) => {
      if (order === 'desc') {
        return b > a ? 1 : b < a ? -1 : 0;
      }
      return a > b ? 1 : a < b ? -1 : 0;
    });
  }
  
  _chunk(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for chunk operation');
    }
    
    const { size = 10 } = params;
    const chunks = [];
    
    for (let i = 0; i < data.length; i += size) {
      chunks.push(data.slice(i, i + size));
    }
    
    return chunks;
  }
  
  _flatten(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for flatten operation');
    }
    
    const { depth = 1 } = params;
    return data.flat(depth);
  }
  
  _deduplicate(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for deduplicate operation');
    }
    
    const { key } = params;
    
    if (key) {
      const seen = new Set();
      return data.filter(item => {
        const val = typeof item === 'object' ? item[key] : item;
        if (seen.has(val)) return false;
        seen.add(val);
        return true;
      });
    }
    
    return [...new Set(data)];
  }
  
  _aggregate(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array for aggregate operation');
    }
    
    const { operations = {} } = params;
    const result = {};
    
    // Common aggregations
    if (operations.count !== false) {
      result.count = data.length;
    }
    
    if (operations.sum) {
      const key = typeof operations.sum === 'string' ? operations.sum : null;
      result.sum = data.reduce((acc, item) => {
        const val = key ? (typeof item === 'object' ? item[key] : 0) : item;
        return acc + (typeof val === 'number' ? val : 0);
      }, 0);
    }
    
    if (operations.avg) {
      const key = typeof operations.avg === 'string' ? operations.avg : null;
      const sum = data.reduce((acc, item) => {
        const val = key ? (typeof item === 'object' ? item[key] : 0) : item;
        return acc + (typeof val === 'number' ? val : 0);
      }, 0);
      result.avg = data.length > 0 ? sum / data.length : 0;
    }
    
    if (operations.min) {
      const key = typeof operations.min === 'string' ? operations.min : null;
      result.min = Math.min(...data.map(item => {
        const val = key ? (typeof item === 'object' ? item[key] : item) : item;
        return typeof val === 'number' ? val : Infinity;
      }));
    }
    
    if (operations.max) {
      const key = typeof operations.max === 'string' ? operations.max : null;
      result.max = Math.max(...data.map(item => {
        const val = key ? (typeof item === 'object' ? item[key] : item) : item;
        return typeof val === 'number' ? val : -Infinity;
      }));
    }
    
    return result;
  }
}

module.exports = { TransformAgent };
