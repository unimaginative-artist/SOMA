/**
 * Verification contract for autonomous code changes.
 *
 * This module verifies evidence. It does not apply patches and it does not
 * decide to merge by itself.
 */

import { parse } from '@babel/parser';

export const GreenLevel = {
  SYNTAX_VALID: 1,
  TESTS_DECLARED: 2,
  TESTS_PASSED: 3,
  MERGE_READY: 4
};

export class GreenContract {
  async verify(change, requiredLevel = GreenLevel.TESTS_PASSED) {
    const evidence = {
      level: 0,
      checks: [],
      ok: false
    };

    const files = Array.isArray(change?.files) ? change.files : [];
    const sourceBlocks = files
      .filter(file => /\.(mjs|cjs|js|jsx|ts|tsx)$/.test(file.path || ''))
      .map(file => ({ path: file.path, code: file.content ?? file.code ?? '' }));

    if (requiredLevel >= GreenLevel.SYNTAX_VALID) {
      for (const block of sourceBlocks) {
        const result = this._checkSyntax(block.code, block.path);
        evidence.checks.push(result);
        if (!result.ok) return evidence;
      }
      evidence.level = GreenLevel.SYNTAX_VALID;
    }

    if (requiredLevel >= GreenLevel.TESTS_DECLARED) {
      const hasTests = Array.isArray(change?.testCommands) && change.testCommands.length > 0;
      evidence.checks.push({ name: 'tests_declared', ok: hasTests });
      if (!hasTests) return evidence;
      evidence.level = GreenLevel.TESTS_DECLARED;
    }

    if (requiredLevel >= GreenLevel.TESTS_PASSED) {
      const testsPassed = change?.testResult?.ok === true;
      evidence.checks.push({
        name: 'tests_passed',
        ok: testsPassed,
        details: change?.testResult?.summary || null
      });
      if (!testsPassed) return evidence;
      evidence.level = GreenLevel.TESTS_PASSED;
    }

    if (requiredLevel >= GreenLevel.MERGE_READY) {
      const reviewed = change?.review?.approved === true;
      evidence.checks.push({
        name: 'review_approved',
        ok: reviewed,
        details: change?.review?.reviewer || null
      });
      if (!reviewed) return evidence;
      evidence.level = GreenLevel.MERGE_READY;
    }

    evidence.ok = evidence.level >= requiredLevel;
    return evidence;
  }

  _checkSyntax(code, filename = 'inline.js') {
    try {
      parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript', 'classProperties', 'topLevelAwait'],
        errorRecovery: false
      });
      return { name: 'syntax', path: filename, ok: true };
    } catch (err) {
      return { name: 'syntax', path: filename, ok: false, error: err.message };
    }
  }
}

export default GreenContract;
