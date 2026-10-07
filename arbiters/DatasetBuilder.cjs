const fs = require('fs').promises;

/**
 * DatasetBuilder
 * 
 * Converts raw experience logs (JSONL) into specific training formats
 * for Llama 3, Alpaca, and ShareGPT.
 * 
 * Part of the SOMA Self-Training Loop.
 */
class DatasetBuilder {
  constructor(config = {}) {
    this.maxTokens = config.maxTokens || 2048;
    this.minTokens = config.minTokens || 10;
    this.includeSystemPrompt = config.includeSystemPrompt !== false;
  }

  /**
   * Convert JSONL to Alpaca format
   * Format: { instruction, input, output }
   */
  async convertToAlpaca(inputPath, outputPath) {
    console.log(`[DatasetBuilder] Converting ${inputPath} to Alpaca format...`);
    const jsonlData = await this._readJSONL(inputPath);
    const alpacaData = [];

    for (const item of jsonlData) {
      // Extract instruction (question/task)
      const instruction = item.input;

      // Extract input (context if available)
      const input = item.context ? JSON.stringify(item.context) : '';

      // Extract output (response)
      const output = item.output;

      // Token count check (approximate)
      const estimated = (instruction + input + output).length / 4;
      if (estimated < this.minTokens || estimated > this.maxTokens) {
        continue; // Skip if too short or too long
      }

      alpacaData.push({
        instruction,
        input,
        output
      });
    }

    await this._writeJSON(outputPath, alpacaData);

    console.log(`[DatasetBuilder] ✅ Converted ${alpacaData.length} examples to Alpaca format`);
    return outputPath;
  }

  /**
   * Convert JSONL to ShareGPT format
   * Format: { conversations: [{ from: 'human'|'gpt', value: '...' }] }
   */
  async convertToShareGPT(inputPath, outputPath) {
    console.log(`[DatasetBuilder] Converting ${inputPath} to ShareGPT format...`);
    const jsonlData = await this._readJSONL(inputPath);
    const sharegptData = [];

    for (const item of jsonlData) {
      const conversations = [
        { from: 'human', value: item.input },
        { from: 'gpt', value: item.output }
      ];

      sharegptData.push({ conversations });
    }

    await this._writeJSON(outputPath, sharegptData);

    console.log(`[DatasetBuilder] ✅ Converted ${sharegptData.length} examples to ShareGPT format`);
    return outputPath;
  }

  /**
   * Convert JSONL to Llama-3 Chat format
   * Format: <|begin_of_text|><|start_header_id|>user<|end_header_id|>
   *         {prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
   *         {response}<|eot_id|>
   */
  async convertToLlamaChatML(inputPath, outputPath) {
    console.log(`[DatasetBuilder] Converting ${inputPath} to Llama ChatML format...`);
    const jsonlData = await this._readJSONL(inputPath);
    const chatMLData = [];

    const systemPrompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are SOMA (Self-Optimizing Merovingian Architecture), an autonomous AI system with 4 specialized brains:
- LOGOS: Logical reasoning and analysis
- AURORA: Creative exploration and innovation
- PROMETHEUS: Action execution and building
- THALAMUS: Integration and decision synthesis

You are helpful, harmless, and honest.<|eot_id|>`;

    for (const item of jsonlData) {
      // Basic ChatML structure for Llama 3
      const formatted = `${systemPrompt}<|start_header_id|>user<|end_header_id|>

${item.input}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

${item.output}<|eot_id|>`;

      chatMLData.push({ text: formatted });
    }

    await this._writeJSONL(outputPath, chatMLData);

    console.log(`[DatasetBuilder] ✅ Converted ${chatMLData.length} examples to Llama ChatML format`);
    return outputPath;
  }

  async _readJSONL(path) {
    try {
      const content = await fs.readFile(path, 'utf8');
      return content.split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      console.error(`[DatasetBuilder] Error reading JSONL: ${error.message}`);
      return [];
    }
  }

  async _writeJSON(path, data) {
    await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  }

  async _writeJSONL(path, data) {
    const jsonl = data.map(item => JSON.stringify(item)).join('\n');
    await fs.writeFile(path, jsonl, 'utf8');
  }
}

module.exports = { DatasetBuilder };