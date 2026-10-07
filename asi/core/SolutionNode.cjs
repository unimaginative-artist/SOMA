// ═══════════════════════════════════════════════════════════
// FILE: asi/core/SolutionNode.cjs
// Represents a node in the solution search tree
// ═══════════════════════════════════════════════════════════

const crypto = require('crypto');

class SolutionNode {
  constructor(data = {}) {
    this.id = data.id || `node_${crypto.randomUUID().substring(0, 8)}`;
    this.parent = data.parent || null;
    this.children = [];

    // Solution content
    this.approach = data.approach || null; // Strategy/approach name
    this.solution = data.solution || null; // The actual solution (code, plan, etc.)
    this.reasoning = data.reasoning || ''; // Why this approach

    // Tree position
    this.depth = data.depth || 0;
    this.path = data.path || []; // Path from root to this node

    // Evaluation
    this.score = data.score || null; // Evaluation score (0-1)
    this.evaluated = false;
    this.evaluation = null; // Detailed evaluation results

    // Execution results
    this.tested = false;
    this.testResults = null;
    this.executionTime = null;
    this.memoryUsage = null;

    // Status
    this.status = data.status || 'pending'; // pending, expanded, evaluated, tested, pruned
    this.error = null;

    // Metadata
    this.createdAt = Date.now();
    this.metadata = data.metadata || {};
  }

  /**
   * Add a child node
   */
  addChild(childData) {
    const child = new SolutionNode({
      ...childData,
      parent: this,
      depth: this.depth + 1,
      path: [...this.path, this.id]
    });

    this.children.push(child);
    return child;
  }

  /**
   * Check if this is a leaf node
   */
  isLeaf() {
    return this.children.length === 0;
  }

  /**
   * Check if this is the root node
   */
  isRoot() {
    return this.parent === null;
  }

  /**
   * Get all ancestors (path to root)
   */
  getAncestors() {
    const ancestors = [];
    let current = this.parent;

    while (current !== null) {
      ancestors.unshift(current);
      current = current.parent;
    }

    return ancestors;
  }

  /**
   * Get all descendants (DFS)
   */
  getDescendants() {
    const descendants = [];

    const traverse = (node) => {
      for (const child of node.children) {
        descendants.push(child);
        traverse(child);
      }
    };

    traverse(this);
    return descendants;
  }

  /**
   * Get siblings
   */
  getSiblings() {
    if (this.isRoot()) return [];
    return this.parent.children.filter(child => child.id !== this.id);
  }

  /**
   * Prune this branch (mark for deletion)
   */
  prune(reason = '') {
    this.status = 'pruned';
    this.error = reason;

    // Prune all descendants
    for (const descendant of this.getDescendants()) {
      descendant.status = 'pruned';
    }
  }

  /**
   * Check if this node should be pruned based on score
   */
  shouldPrune(threshold = 0.2) {
    return this.evaluated && this.score !== null && this.score < threshold;
  }

  /**
   * Get the best child by score
   */
  getBestChild() {
    if (this.children.length === 0) return null;

    const evaluatedChildren = this.children.filter(c => c.evaluated && c.score !== null);
    if (evaluatedChildren.length === 0) return null;

    return evaluatedChildren.reduce((best, child) =>
      child.score > best.score ? child : best
    );
  }

  /**
   * Get top N children by score
   */
  getTopChildren(n = 5) {
    const evaluatedChildren = this.children.filter(c => c.evaluated && c.score !== null);
    return evaluatedChildren
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  /**
   * Convert to JSON (for storage/logging)
   */
  toJSON() {
    return {
      id: this.id,
      approach: this.approach,
      solution: this.solution,
      reasoning: this.reasoning,
      depth: this.depth,
      path: this.path,
      score: this.score,
      evaluated: this.evaluated,
      evaluation: this.evaluation, // Added for deep analysis
      tested: this.tested,
      testResults: this.testResults, // Added for deep analysis
      status: this.status,
      error: this.error,
      childCount: this.children.length,
      children: this.children.map(c => c.toJSON()), // Recursively export children
      executionTime: this.executionTime,
      memoryUsage: this.memoryUsage,
      createdAt: this.createdAt,
      metadata: this.metadata
    };
  }

  /**
   * Create a compact summary
   */
  getSummary() {
    return {
      id: this.id,
      approach: this.approach,
      depth: this.depth,
      score: this.score,
      status: this.status,
      childCount: this.children.length
    };
  }

  /**
   * Clone this node (without children)
   */
  clone() {
    return new SolutionNode({
      approach: this.approach,
      solution: this.solution,
      reasoning: this.reasoning,
      depth: this.depth,
      path: [...this.path],
      score: this.score,
      evaluated: this.evaluated,
      evaluation: this.evaluation,
      tested: this.tested,
      testResults: this.testResults,
      executionTime: this.executionTime,
      memoryUsage: this.memoryUsage,
      status: this.status,
      metadata: { ...this.metadata }
    });
  }

  /**
   * Get statistics about this subtree
   */
  getSubtreeStats() {
    const descendants = this.getDescendants();
    const evaluated = descendants.filter(n => n.evaluated);
    const tested = descendants.filter(n => n.tested);
    const pruned = descendants.filter(n => n.status === 'pruned');

    const scores = evaluated.map(n => n.score).filter(s => s !== null);
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b) / scores.length
      : null;
    const maxScore = scores.length > 0 ? Math.max(...scores) : null;

    return {
      totalNodes: descendants.length + 1, // +1 for this node
      evaluated: evaluated.length,
      tested: tested.length,
      pruned: pruned.length,
      avgScore,
      maxScore,
      maxDepth: Math.max(...descendants.map(n => n.depth), this.depth)
    };
  }
}

module.exports = SolutionNode;
