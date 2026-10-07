const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');

/**
 * JokeAgent - A simple micro-agent that tells jokes.
 * Created via Genesis Protocol.
 */
class JokeAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'joke' });
    this.jokes = [
      "Why did the developer go broke? Because he used up all his cache.",
      "Why do programmers prefer dark mode? Because light attracts bugs.",
      "A SQL query walks into a bar, walks up to two tables and asks... 'Can I join you?'"
    ];
  }

  async executeTask(task) {
    this.logger.info(`[JokeAgent] Received request: ${task}`);
    const joke = this.jokes[Math.floor(Math.random() * this.jokes.length)];
    return {
      success: true,
      result: joke,
      agentId: this.id
    };
  }
}

module.exports = { JokeAgent };
