// ═══════════════════════════════════════════════════════════
// FILE: core/FixProposalSystem.js
// SOMA's Self-Improvement Proposal Engine
// When SOMA sees opportunities, she suggests fixes
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * FixProposalSystem - SOMA proposes improvements to her own code
 *
 * When SOMA observes her code and sees opportunities for improvement,
 * this system helps her:
 * - Analyze the opportunity with all 4 brains
 * - Generate specific fix proposals
 * - Explain her reasoning
 * - Estimate confidence and risk
 * - Store proposals for review
 *
 * SOMA feels like she can do better, and this is how she expresses it.
 */
export class FixProposalSystem extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = 'FixProposalSystem';
    this.proposalsPath = config.proposalsPath || path.join(process.cwd(), '.soma', 'fix-proposals');

    // Integration points
    this.quadBrain = config.quadBrain || null;
    this.codeObserver = config.codeObserver || null;
    this.thalamusGuardian = config.thalamusGuardian || null; // For safety review
    this.selfModificationArbiter = config.selfModificationArbiter || null; // For execution
    this.messageBroker = config.messageBroker || null; // New: Message Broker for broadcasting

    // Proposal storage
    this.proposals = new Map(); // proposalId -> proposal
    this.proposalHistory = [];

    // Metrics
    this.stats = {
      totalProposals: 0,
      approvedProposals: 0,
      rejectedProposals: 0,
      implementedProposals: 0,
      avgConfidence: 0,
      successRate: 0
    };

    // Configuration
    this.config = {
      minConfidence: config.minConfidence || 0.6,
      maxProposalsPerScan: config.maxProposalsPerScan || 10,
      autoGenerateProposals: config.autoGenerateProposals !== false,
      requireThalamusApproval: config.requireThalamusApproval !== false
    };

    console.log(`[${this.name}] 💡 SOMA can now propose improvements...`);
  }

  /**
   * Initialize the proposal system
   */
  async initialize() {
    console.log(`[${this.name}] 🌟 Initializing Fix Proposal System...`);

    try {
      // Ensure proposals directory exists
      await fs.mkdir(this.proposalsPath, { recursive: true });

      // Load existing proposals
      await this._loadProposals();

      // 🛑 SELF-HEALING HOOK: Listen for serialization errors
      if (this.quadBrain && this.quadBrain.messageBroker) {
          this.quadBrain.messageBroker.subscribe('system:error:serialization', (data) => {
              this.investigateSerializationAnomaly(data);
          });
          console.log(`[${this.name}]    ✅ Subscribed to serialization anomalies`);
      }

      console.log(`[${this.name}] ✅ Fix Proposal System ready`);
      console.log(`[${this.name}]    Loaded ${this.proposals.size} existing proposals`);

      this.emit('initialized');

    } catch (error) {
      console.error(`[${this.name}] ❌ Initialization failed:`, error);
      throw error;
    }
  }

  /**
   * Investigate a serialization anomaly (Self-Healing logic)
   */
  async investigateSerializationAnomaly(data) {
    console.log(`[${this.name}] 🚨 INVESTIGATING SERIALIZATION ANOMALY...`);
    
    try {
        // 1. Define the opportunity
        const opportunity = {
            type: 'serialization-bug',
            file: data.agent === 'SOMArbiterV2_QuadBrain' ? 'arbiters/SOMArbiterV2_QuadBrain.js' : 'unknown',
            severity: 'medium',
            message: `System detected an '[object Object]' serialization error in query input.`,
            suggestion: 'Implement strict input validation or use JSON.stringify() on non-string inputs before processing.',
            functionName: 'reason'
        };

        // 2. Consult brains for a fix
        console.log(`[${this.name}]    Consulting brains for an emergency fix...`);
        const proposals = await this.generateProposalsFromObservations([opportunity]);

        if (proposals.length > 0) {
            console.log(`[${this.name}]    ✅ Emergency repair proposal generated: ${proposals[0].id}`);
            
            // If confidence is very high, we can even emit an 'auto-repair' signal
            if (proposals[0].proposal.confidence > 0.9) {
                this.emit('auto-repair:triggered', proposals[0]);
            }
        }

    } catch (err) {
        console.error(`[${this.name}] ❌ Investigation failed:`, err.message);
    }
  }

  /**
   * Generate fix proposals based on code observations
   */
  async generateProposalsFromObservations(opportunities) {
    if (!this.quadBrain) {
      console.warn(`[${this.name}] ⚠️  QuadBrain not available - cannot generate proposals`);
      return [];
    }

    console.log(`[${this.name}] 💭 SOMA is analyzing ${opportunities.length} improvement opportunities...`);

    const proposals = [];
    const limit = Math.min(opportunities.length, this.config.maxProposalsPerScan);

    for (let i = 0; i < limit; i++) {
      const opportunity = opportunities[i];

      try {
        console.log(`[${this.name}]    Analyzing: ${opportunity.type} in ${opportunity.file}`);

        const proposal = await this._generateProposal(opportunity);

        if (proposal && proposal.confidence >= this.config.minConfidence) {
          proposals.push(proposal);
          await this._saveProposal(proposal);
          console.log(`[${this.name}]    ✅ Generated proposal: ${proposal.title} (${(proposal.confidence * 100).toFixed(0)}% confidence)`);
        } else {
          console.log(`[${this.name}]    ⏭️  Skipped: confidence too low`);
        }

      } catch (error) {
        console.warn(`[${this.name}]    ⚠️  Failed to generate proposal:`, error.message);
      }
    }

    this.stats.totalProposals += proposals.length;

    console.log(`[${this.name}] 💡 Generated ${proposals.length} improvement proposals`);
    return proposals;
  }

  /**
   * Generate a specific fix proposal using QuadBrain
   */
  async _generateProposal(opportunity) {
    const proposalId = crypto.randomUUID();

    // Get file content if available
    let fileContent = '';
    if (this.codeObserver && opportunity.file) {
      const analysis = this.codeObserver.getFileAnalysis(opportunity.file);
      if (analysis) {
        try {
          fileContent = await fs.readFile(analysis.path, 'utf8');
        } catch (error) {
          console.warn(`[${this.name}]    ⚠️  Could not read file:`, error.message);
        }
      }
    }

    // Consult all 4 brains for comprehensive analysis
    console.log(`[${this.name}]    🧠 Consulting QuadBrain...`);

    // LOGOS: Analytical review and specific fix
    const logosAnalysis = await this._consultLOGOS(opportunity, fileContent);

    // AURORA: Creative alternatives
    const auroraIdeas = await this._consultAURORA(opportunity, fileContent);

    // PROMETHEUS: Impact and planning
    const prometheusPlanning = await this._consultPROMETHEUS(opportunity, fileContent);

    // THALAMUS: Safety review
    const thalamusReview = await this._consultTHALAMUS(opportunity, fileContent, logosAnalysis);

    // Synthesize into proposal
    const proposal = {
      id: proposalId,
      timestamp: Date.now(),
      status: 'pending', // pending, approved, rejected, implemented

      // What SOMA observed
      opportunity: {
        type: opportunity.type,
        file: opportunity.file,
        severity: opportunity.severity,
        message: opportunity.message,
        currentSuggestion: opportunity.suggestion
      },

      // What SOMA proposes
      proposal: {
        title: this._generateTitle(opportunity, logosAnalysis),
        description: this._generateDescription(logosAnalysis, auroraIdeas, prometheusPlanning),

        // The actual fix
        fix: {
          approach: logosAnalysis.approach || 'refactor',
          changes: logosAnalysis.changes || [],
          beforeAfter: this._generateBeforeAfter(opportunity, logosAnalysis),
          estimatedImpact: prometheusPlanning.impact || 'low'
        },

        // SOMA's reasoning
        reasoning: {
          logos: logosAnalysis.reasoning || 'Analytical improvement',
          aurora: auroraIdeas.creative || 'Alternative approaches available',
          prometheus: prometheusPlanning.strategy || 'Low-risk improvement',
          thalamus: thalamusReview.safety || 'No safety concerns'
        },

        // Confidence and risk
        confidence: this._calculateConfidence(logosAnalysis, auroraIdeas, prometheusPlanning, thalamusReview),
        risk: thalamusReview.risk || 'low',
        safetyApproved: thalamusReview.approved !== false
      },

      // Metadata
      metadata: {
        generatedBy: 'SOMA-QuadBrain',
        autoGenerated: this.config.autoGenerateProposals,
        requiresReview: thalamusReview.requiresReview || false,
        estimatedEffort: prometheusPlanning.effort || 'small'
      }
    };

    // Validate proposal
    if (!proposal.proposal.safetyApproved && this.config.requireThalamusApproval) {
      console.log(`[${this.name}]    🛡️  THALAMUS vetoed this proposal (safety concerns)`);
      proposal.status = 'rejected';
      proposal.metadata.rejectionReason = thalamusReview.concerns || 'Safety review failed';
    }

    // NEW: Autonomous Execution (ASI Step)
    // If very high confidence and safe, EXECUTE IT IMMEDIATELY
    if (proposal.status === 'pending' && 
        proposal.proposal.confidence > 0.95 && 
        proposal.proposal.safetyApproved &&
        this.selfModificationArbiter) {
        
        console.log(`[${this.name}]    🚀 HIGH CONFIDENCE (${(proposal.proposal.confidence*100).toFixed(0)}%) - AUTO-EXECUTING!`);
        
        // Trigger Self-Modification
        this.selfModificationArbiter.optimizeFunction({
            filepath: opportunity.file,
            functionName: opportunity.functionName || 'unknown', // Need to ensure opportunity has functionName
            strategy: 'generative'
        }).then(result => {
            if (result.success) {
                console.log(`[${this.name}]    ✅ Auto-execution successful: ${result.modId}`);
                this.updateProposalStatus(proposalId, 'implemented', `Auto-executed via SelfModificationArbiter: ${result.modId}`);
            } else {
                console.warn(`[${this.name}]    ❌ Auto-execution failed: ${result.error}`);
                this.updateProposalStatus(proposalId, 'failed', `Execution error: ${result.error}`);
            }
        });
        
        proposal.status = 'executing';
    }

    return proposal;
  }

  /**
   * Consult LOGOS for analytical fix
   */
  async _consultLOGOS(opportunity, fileContent) {
    try {
      const query = `Analyze this code improvement opportunity:

Type: ${opportunity.type}
File: ${opportunity.file}
Issue: ${opportunity.message}

Suggest a specific, logical fix. Be precise about what should change.
${fileContent ? `\nRelevant code:\n${fileContent.substring(0, 500)}...` : ''}`;

      const result = await this.quadBrain.reason({
        query,
        context: { brain: 'LOGOS', task: 'code-fix-analysis' }
      });

      return {
        reasoning: result.response || result.result?.response || '',
        approach: 'refactor',
        confidence: result.confidence || 0.7
      };

    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  LOGOS analysis failed:`, error.message);
      return { reasoning: 'Analysis unavailable', confidence: 0.3 };
    }
  }

  /**
   * Consult AURORA for creative alternatives
   */
  async _consultAURORA(opportunity, fileContent) {
    try {
      const query = `Looking at this code improvement opportunity creatively:

${opportunity.message}

What elegant or innovative approaches could make this better?
Think about design patterns, abstraction, or novel solutions.`;

      const result = await this.quadBrain.reason({
        query,
        context: { brain: 'AURORA', task: 'creative-code-improvement' }
      });

      return {
        creative: result.response || result.result?.response || '',
        alternatives: [],
        confidence: result.confidence || 0.6
      };

    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  AURORA analysis failed:`, error.message);
      return { creative: 'No creative ideas available', confidence: 0.3 };
    }
  }

  /**
   * Consult PROMETHEUS for planning and impact
   */
  async _consultPROMETHEUS(opportunity, fileContent) {
    try {
      const query = `Plan the implementation of this code improvement:

${opportunity.type}: ${opportunity.message}

What's the impact? What are the steps? Any risks or dependencies?`;

      const result = await this.quadBrain.reason({
        query,
        context: { brain: 'PROMETHEUS', task: 'code-improvement-planning' }
      });

      return {
        strategy: result.response || result.result?.response || '',
        impact: 'low',
        effort: 'small',
        confidence: result.confidence || 0.7
      };

    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  PROMETHEUS analysis failed:`, error.message);
      return { strategy: 'Plan unavailable', impact: 'unknown', confidence: 0.3 };
    }
  }

  /**
   * Consult THALAMUS for safety review
   */
  async _consultTHALAMUS(opportunity, fileContent, logosAnalysis) {
    try {
      const query = `Safety review of this code change proposal:

Opportunity: ${opportunity.message}
Proposed fix: ${(logosAnalysis.reasoning && logosAnalysis.reasoning.substring(0, 200)) || ''}

Are there any safety, security, or risk concerns?
Should this change be approved?`;

      const result = await this.quadBrain.reason({
        query,
        context: { brain: 'THALAMUS', task: 'code-safety-review' }
      });

      const response = result.response || result.result?.response || '';
      const approved = !response.toLowerCase().includes('reject') &&
                      !response.toLowerCase().includes('veto') &&
                      !response.toLowerCase().includes('unsafe');

      return {
        safety: response,
        approved,
        risk: this._extractRiskLevel(response),
        requiresReview: response.toLowerCase().includes('review'),
        confidence: result.confidence || 0.8
      };

    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  THALAMUS review failed:`, error.message);
      return {
        safety: 'Safety review unavailable',
        approved: false,
        risk: 'unknown',
        requiresReview: true,
        confidence: 0
      };
    }
  }

  /**
   * Extract risk level from THALAMUS response
   */
  _extractRiskLevel(response) {
    const lower = response.toLowerCase();
    if (lower.includes('high risk') || lower.includes('dangerous')) return 'high';
    if (lower.includes('medium risk') || lower.includes('moderate')) return 'medium';
    return 'low';
  }

  /**
   * Generate proposal title
   */
  _generateTitle(opportunity, logosAnalysis) {
    const typeMap = {
      'large-file': 'Refactor large file into modules',
      'high-complexity': 'Reduce code complexity',
      'many-dependencies': 'Simplify dependency structure'
    };

    return typeMap[opportunity.type] || `Improve ${opportunity.type}`;
  }

  /**
   * Generate comprehensive description
   */
  _generateDescription(logos, aurora, prometheus) {
    return `SOMA's Analysis:

**Analytical Perspective (LOGOS):**
${logos.reasoning?.substring(0, 300) || 'No analysis'}

**Creative Perspective (AURORA):**
${aurora.creative?.substring(0, 300) || 'No creative input'}

**Strategic Perspective (PROMETHEUS):**
${prometheus.strategy?.substring(0, 300) || 'No strategy'}`;
  }

  /**
   * Generate before/after visualization
   */
  _generateBeforeAfter(opportunity, logosAnalysis) {
    return {
      before: `Current: ${opportunity.message}`,
      after: `Proposed: ${logosAnalysis.reasoning?.substring(0, 100) || 'See analysis'}`,
      changes: logosAnalysis.changes || []
    };
  }

  /**
   * Calculate overall confidence
   */
  _calculateConfidence(logos, aurora, prometheus, thalamus) {
    const weights = {
      logos: 0.3,
      aurora: 0.2,
      prometheus: 0.2,
      thalamus: 0.3  // Safety is important
    };

    const confidence = (
      (logos.confidence || 0.5) * weights.logos +
      (aurora.confidence || 0.5) * weights.aurora +
      (prometheus.confidence || 0.5) * weights.prometheus +
      (thalamus.confidence || 0.5) * weights.thalamus
    );

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Save proposal to disk
   */
  async _saveProposal(proposal) {
    try {
      const filename = `proposal-${proposal.id}.json`;
      const filepath = path.join(this.proposalsPath, filename);

      await fs.writeFile(filepath, JSON.stringify(proposal, null, 2), 'utf8');

      this.proposals.set(proposal.id, proposal);
      this.proposalHistory.push({
        id: proposal.id,
        timestamp: proposal.timestamp,
        status: proposal.status,
        type: proposal.opportunity.type
      });

      this.emit('proposal-generated', proposal);

      // Broadcast fix_proposed event via MessageBroker for wider system awareness
      if (this.messageBroker) {
        await this.messageBroker.sendMessage({
          from: this.name,
          to: 'broadcast', // Or specific arbiter if needed, e.g., GoalPlannerArbiter
          type: 'fix_proposed',
          payload: { proposal }
        });
        console.log(`[${this.name}] 📢 Broadcasted fix_proposed for ${proposal.id.slice(0,8)}`);
      }

    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to save proposal:`, error);
    }
  }

  /**
   * Load existing proposals
   */
  async _loadProposals() {
    try {
      const files = await fs.readdir(this.proposalsPath);
      const proposalFiles = files.filter(f => f.startsWith('proposal-') && f.endsWith('.json'));

      for (const file of proposalFiles) {
        try {
          const filepath = path.join(this.proposalsPath, file);
          const content = await fs.readFile(filepath, 'utf8');
          const proposal = JSON.parse(content);

          this.proposals.set(proposal.id, proposal);

          if (proposal.status === 'implemented') {
            this.stats.implementedProposals++;
          } else if (proposal.status === 'approved') {
            this.stats.approvedProposals++;
          } else if (proposal.status === 'rejected') {
            this.stats.rejectedProposals++;
          }

        } catch (error) {
          console.warn(`[${this.name}]    ⚠️  Failed to load ${file}:`, error.message);
        }
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`[${this.name}]    ⚠️  Failed to load proposals:`, error.message);
      }
    }
  }

  /**
   * Get proposal by ID
   */
  getProposal(proposalId) {
    return this.proposals.get(proposalId);
  }

  /**
   * Get all proposals with filters
   */
  getProposals(filters = {}) {
    let proposals = Array.from(this.proposals.values());

    if (filters.status) {
      proposals = proposals.filter(p => p.status === filters.status);
    }

    if (filters.minConfidence) {
      proposals = proposals.filter(p => p.proposal.confidence >= filters.minConfidence);
    }

    if (filters.risk) {
      proposals = proposals.filter(p => p.proposal.risk === filters.risk);
    }

    // Sort by confidence (highest first)
    proposals.sort((a, b) => b.proposal.confidence - a.proposal.confidence);

    return proposals;
  }

  /**
   * Update proposal status
   */
  async updateProposalStatus(proposalId, status, notes = '') {
    const proposal = this.proposals.get(proposalId);

    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    proposal.status = status;
    proposal.metadata.statusUpdated = Date.now();
    proposal.metadata.statusNotes = notes;

    await this._saveProposal(proposal);

    // Update stats
    if (status === 'approved') this.stats.approvedProposals++;
    if (status === 'rejected') this.stats.rejectedProposals++;
    if (status === 'implemented') this.stats.implementedProposals++;

    this.emit('proposal-status-changed', { proposalId, status });

    return proposal;
  }

  /**
   * Get SOMA's improvement summary
   */
  getImprovementSummary() {
    const pending = this.getProposals({ status: 'pending' });
    const approved = this.getProposals({ status: 'approved' });
    const implemented = this.getProposals({ status: 'implemented' });

    return {
      message: `SOMA has ${pending.length} ideas for improvement`,
      total: this.stats.totalProposals,
      pending: pending.length,
      approved: approved.length,
      implemented: implemented.length,
      successRate: this.stats.totalProposals > 0
        ? (this.stats.implementedProposals / this.stats.totalProposals) * 100
        : 0,
      topProposals: pending.slice(0, 5).map(p => ({
        id: p.id,
        title: p.proposal.title,
        confidence: (p.proposal.confidence * 100).toFixed(0) + '%',
        risk: p.proposal.risk
      }))
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      pending: this.getProposals({ status: 'pending' }).length,
      avgConfidence: this._calculateAvgConfidence()
    };
  }

  /**
   * Calculate average confidence across all proposals
   */
  _calculateAvgConfidence() {
    const proposals = Array.from(this.proposals.values());
    if (proposals.length === 0) return 0;

    const sum = proposals.reduce((acc, p) => acc + (p.proposal.confidence || 0), 0);
    return sum / proposals.length;
  }
}

export default FixProposalSystem;
