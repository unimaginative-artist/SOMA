const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const { STATUS } = require('../core/GoalLifecycle.cjs');

class SwarmDelegationArbiter extends BaseArbiter {
  static role = 'swarm-delegation';
  static capabilities = ['decompose-goals', 'delegate-tasks', 'monitor-subgoals'];

  constructor(config = {}) {
    super(config);
    this.name = config.name || 'SwarmDelegationArbiter';
    this.system = config.system;
    
    // Interval to check for delegation logic
    this._checkInterval = setInterval(() => this._tick(), 5000);
  }

  async _tick() {
    if (!this.system?.goalPlanner) return;
    try {
      await this._interceptBroadGoals();
      await this._monitorDelegatedGoals();
    } catch (err) {
      this.logger.error(`[SwarmDelegationArbiter] Tick error: ${err.message}`);
    }
  }

  /**
   * Intercept broad, vague goals and explicitly decompose them.
   */
  async _interceptBroadGoals() {
    const goals = Array.from(this.system.goalPlanner.goals.values() || []);
    for (const goal of goals) {
      if (goal.status !== STATUS.PENDING && goal.status !== STATUS.PROPOSED) continue;
      if (goal.metadata?.decomposed) continue;

      if (this.system.goalPlanner._isComplexGoal(goal)) {
        this.logger.info(`[SwarmDelegationArbiter] Intercepted complex goal "${goal.title}". Delegating...`);
        const result = await this.system.goalPlanner.decomposeGoal(goal.id, this.name);
        
        if (result.success) {
           this.logger.info(`[SwarmDelegationArbiter] Successfully delegated "${goal.title}" into ${result.subGoals.length} sub-goals.`);
           await this._assignSubGoals(goal, result.subGoals);
        }
      }
    }
  }

  /**
   * Ping MAX over Discord for sub-goals assigned to him.
   */
  async _assignSubGoals(parentGoal, subGoals) {
    if (!this.system.discordArbiter) return;
    
    for (const sub of subGoals) {
      if (sub.assignedTo?.includes('MAX')) {
        const channelId = parentGoal.metadata?.sourceChannelId || parentGoal.channelId;
        const msg = `Hey <@1482791716821012510>, I am delegating a sub-task to you for our master goal "${parentGoal.title}".\n\nTask: **${sub.title}**\nDescription: ${sub.description}`;
        
        if (channelId) {
            await this.system.discordArbiter.sendMessage(channelId, msg).catch(() => {});
        } else {
            // Master DM or default channel if no channel context
            await this.system.discordArbiter.sendMasterMessage(msg).catch(() => {});
        }
      }
    }
  }

  /**
   * Monitor DELEGATED parent goals and wake them up when children finish.
   */
  async _monitorDelegatedGoals() {
    const goals = Array.from(this.system.goalPlanner.goals.values() || []);
    for (const parent of goals) {
      if (parent.status !== STATUS.DELEGATED) continue;

      // Find all children
      const children = goals.filter(g => g.metadata?.parentGoalId === parent.id);
      if (children.length === 0) continue;

      const allCompleted = children.every(g => g.status === STATUS.COMPLETED);
      const anyFailed = children.some(g => g.status === STATUS.FAILED || g.status === STATUS.BROKEN);

      if (allCompleted) {
         this.logger.info(`[SwarmDelegationArbiter] All sub-goals for "${parent.title}" complete. Waking parent.`);
         
         // Aggregate child summaries
         const summaries = children.map(c => `Sub-goal: ${c.title}\nStatus: ${c.status}\nOutput: ${c.metadata?.evidence || c.description}`).join('\n\n');
         parent.metadata.childSummaries = summaries;
         
         // Wake up the parent to synthesize the final result
         this.system.goalPlanner.transitionGoal(parent.id, STATUS.PENDING, {
            reason: 'all_subgoals_completed',
            actor: this.name
         });
      } else if (anyFailed) {
         this.logger.info(`[SwarmDelegationArbiter] A sub-goal for "${parent.title}" failed. Failing parent.`);
         this.system.goalPlanner.transitionGoal(parent.id, STATUS.FAILED, {
            reason: 'subgoal_failed',
            actor: this.name
         });
      }
    }
  }
}

module.exports = { SwarmDelegationArbiter };
