// Pre-built agent templates for common use cases

import type { Agent, NodeType } from "./types"

export const agentTemplates: Record<string, Omit<Agent, "id" | "createdAt" | "updatedAt">> = {
  parser: {
    name: "Data Parser",
    type: "parser",
    description: "Parses and extracts structured data from text",
    version: 1,
    code: `
export async function parse(input: string, config: any) {
  try {
    // Extract data based on config patterns
    const patterns = config.patterns || [];
    const results: Record<string, any> = {};
    
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex, pattern.flags || 'g');
      const matches = input.match(regex);
      results[pattern.name] = matches || [];
    }
    
    return {
      success: true,
      data: results,
      raw: input
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
    `.trim(),
    config: {
      patterns: [
        { name: "emails", regex: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}" },
        { name: "urls", regex: "https?://[^\\s]+" },
      ],
    },
  },

  transformer: {
    name: "Data Transformer",
    type: "transformer",
    description: "Transforms data from one format to another",
    version: 1,
    code: `
export async function transform(input: any, config: any) {
  try {
    const { operation, mapping } = config;
    
    switch (operation) {
      case 'map':
        return Object.keys(mapping).reduce((acc, key) => {
          acc[key] = input[mapping[key]];
          return acc;
        }, {});
      
      case 'filter':
        return Array.isArray(input) 
          ? input.filter(item => eval(config.condition))
          : input;
      
      case 'reduce':
        return Array.isArray(input)
          ? input.reduce((acc, item) => {
              return eval(config.reducer);
            }, config.initialValue)
          : input;
      
      default:
        return input;
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
    `.trim(),
    config: {
      operation: "map",
      mapping: {},
    },
  },

  apiCall: {
    name: "API Caller",
    type: "api-call",
    description: "Makes HTTP requests to external APIs",
    version: 1,
    code: `
export async function callApi(input: any, config: any) {
  try {
    const { url, method = 'GET', headers = {}, body } = config;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    
    const data = await response.json();
    
    return {
      success: response.ok,
      status: response.status,
      data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
    `.trim(),
    config: {
      url: "",
      method: "GET",
      headers: {},
    },
  },
}

export function getTemplateByType(type: NodeType): Omit<Agent, "id" | "createdAt" | "updatedAt"> | null {
  return agentTemplates[type] || null
}
