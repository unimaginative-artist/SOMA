// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/ProblemTestSuite.cjs
// Test suite with real coding problems
// ═══════════════════════════════════════════════════════════

class ProblemTestSuite {
  constructor() {
    this.problems = new Map();
    this._initializeProblems();
  }

  _initializeProblems() {
    // Problem 1: FizzBuzz (Easy)
    this.problems.set('fizzbuzz', {
      name: 'FizzBuzz',
      difficulty: 'easy',
      description: 'Write a function that returns "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for multiples of both, and the number otherwise.',
      signature: 'function fizzbuzz(n)',
      tests: [
        { input: 3, expected: 'Fizz', name: 'Multiple of 3' },
        { input: 5, expected: 'Buzz', name: 'Multiple of 5' },
        { input: 15, expected: 'FizzBuzz', name: 'Multiple of both' },
        { input: 7, expected: 7, name: 'Not a multiple' },
        { input: 1, expected: 1, name: 'Edge case: 1' }
      ]
    });

    // Problem 2: Two Sum (Easy)
    this.problems.set('twosum', {
      name: 'Two Sum',
      difficulty: 'easy',
      description: 'Given an array of numbers and a target, return indices of two numbers that add up to target.',
      signature: 'function twoSum(nums, target)',
      tests: [
        {
          input: { nums: [2, 7, 11, 15], target: 9 },
          expected: [0, 1],
          name: 'Basic case'
        },
        {
          input: { nums: [3, 2, 4], target: 6 },
          expected: [1, 2],
          name: 'Middle elements'
        },
        {
          input: { nums: [3, 3], target: 6 },
          expected: [0, 1],
          name: 'Duplicate numbers'
        }
      ]
    });

    // Problem 3: Palindrome (Easy)
    this.problems.set('palindrome', {
      name: 'Palindrome Check',
      difficulty: 'easy',
      description: 'Check if a string is a palindrome (reads the same forwards and backwards).',
      signature: 'function isPalindrome(str)',
      tests: [
        { input: 'racecar', expected: true, name: 'Palindrome' },
        { input: 'hello', expected: false, name: 'Not palindrome' },
        { input: 'A man a plan a canal Panama', expected: true, name: 'Ignore spaces/case' },
        { input: 'a', expected: true, name: 'Single character' },
        { input: '', expected: true, name: 'Empty string' }
      ]
    });

    // Problem 4: Fibonacci (Medium)
    this.problems.set('fibonacci', {
      name: 'Fibonacci',
      difficulty: 'medium',
      description: 'Return the nth Fibonacci number. Fib(0)=0, Fib(1)=1, Fib(n)=Fib(n-1)+Fib(n-2).',
      signature: 'function fibonacci(n)',
      tests: [
        { input: 0, expected: 0, name: 'Base case 0' },
        { input: 1, expected: 1, name: 'Base case 1' },
        { input: 5, expected: 5, name: 'F(5) = 5' },
        { input: 10, expected: 55, name: 'F(10) = 55' },
        { input: 20, expected: 6765, name: 'F(20) = 6765' }
      ]
    });

    // Problem 5: Reverse String (Easy)
    this.problems.set('reverse', {
      name: 'Reverse String',
      difficulty: 'easy',
      description: 'Reverse a string.',
      signature: 'function reverse(str)',
      tests: [
        { input: 'hello', expected: 'olleh', name: 'Basic' },
        { input: 'a', expected: 'a', name: 'Single char' },
        { input: '', expected: '', name: 'Empty' },
        { input: 'racecar', expected: 'racecar', name: 'Palindrome' }
      ]
    });

    // Problem 6: Find Maximum (Easy)
    this.problems.set('findmax', {
      name: 'Find Maximum',
      difficulty: 'easy',
      description: 'Find the maximum number in an array.',
      signature: 'function findMax(arr)',
      tests: [
        { input: [1, 5, 3, 9, 2], expected: 9, name: 'Basic' },
        { input: [-5, -2, -10, -1], expected: -1, name: 'All negative' },
        { input: [42], expected: 42, name: 'Single element' },
        { input: [1, 1, 1, 1], expected: 1, name: 'All same' }
      ]
    });

    // Problem 7: Rate Limiter (Hard)
    this.problems.set('rate_limiter', {
      name: 'Sliding Window Rate Limiter',
      difficulty: 'hard',
      description: 'Implement a rate limiter. input: { now: number, timestamps: number[], limit: number, window: number }. The function should: 1. Remove timestamps older than (now - window). 2. If the count of remaining timestamps is < limit, add "now" to the list and return { allowed: true, newTimestamps }. 3. Otherwise return { allowed: false, newTimestamps }.',
      signature: 'function solution(input)',
      tests: [
        { 
          input: { now: 1000, timestamps: [100, 200], limit: 3, window: 1000 }, 
          expected: { allowed: true, newTimestamps: [100, 200, 1000] },
          name: 'Allowed within limit'
        },
        { 
          input: { now: 1000, timestamps: [100, 200, 300], limit: 3, window: 1000 }, 
          expected: { allowed: false, newTimestamps: [100, 200, 300] },
          name: 'Rejected at limit'
        },
        { 
          input: { now: 1500, timestamps: [100, 200, 800], limit: 3, window: 1000 }, 
          expected: { allowed: true, newTimestamps: [800, 1500] },
          name: 'Expired old timestamps'
        },
        {
          input: { now: 2000, timestamps: [1100, 1200, 1300], limit: 3, window: 1000 },
          expected: { allowed: false, newTimestamps: [1100, 1200, 1300] },
          name: 'Wait for window - still at limit'
        }
      ]
    });

    // Problem 8: Distributed Lock (Hard)
    this.problems.set('distributed_lock', {
      name: 'Distributed Lock with TTL',
      difficulty: 'hard',
      description: 'Implement a distributed lock acquire function. input: { lockKey: string, clientId: string, currentLock: { owner: string, expires: number } | null, now: number, ttl: number }. If currentLock is null or expired (expires <= now), return the new lock object. Otherwise return null.',
      signature: 'function solution(input)',
      tests: [
        {
          input: { lockKey: 'resource1', clientId: 'clientA', currentLock: null, now: 1000, ttl: 5000 },
          expected: { owner: 'clientA', expires: 6000 },
          name: 'Acquire new lock'
        },
        {
          input: { lockKey: 'resource1', clientId: 'clientB', currentLock: { owner: 'clientA', expires: 6000 }, now: 2000, ttl: 5000 },
          expected: null,
          name: 'Fail to acquire active lock'
        },
        {
          input: { lockKey: 'resource1', clientId: 'clientB', currentLock: { owner: 'clientA', expires: 6000 }, now: 7000, ttl: 5000 },
          expected: { owner: 'clientB', expires: 12000 },
          name: 'Acquire expired lock'
        }
      ]
    });

    // Problem 9: Graph Shortest Path (Hard)
    this.problems.set('shortest_path', {
      name: 'Graph Shortest Path',
      difficulty: 'hard',
      description: 'Find the length of the shortest path between start and end nodes in an undirected graph. input: { nodes: string[], edges: [string, string][], start: string, end: string }. Return distance (number) or -1 if no path exists.',
      signature: 'function solution(input)',
      tests: [
        {
          input: { 
            nodes: ['A', 'B', 'C', 'D'], 
            edges: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['A', 'C']], 
            start: 'A', 
            end: 'D' 
          },
          expected: 2,
          name: 'Shortest path exists'
        },
        {
          input: {
            nodes: ['A', 'B', 'C'],
            edges: [['A', 'B']],
            start: 'A',
            end: 'C'
          },
          expected: -1,
          name: 'No path exists'
        }
      ]
    });
  }

  /**
   * Get a problem by ID
   */
  getProblem(id) {
    return this.problems.get(id);
  }

  /**
   * Get tests for a problem
   */
  getTestsForProblem(problemOrDescription) {
    // If it's a string, try to find matching problem
    if (typeof problemOrDescription === 'string') {
      // Try exact match first
      for (const [id, problem] of this.problems) {
        if (problemOrDescription.includes(problem.name) ||
            problemOrDescription.includes(id)) {
          return problem.tests;
        }
      }

      // No match, return empty
      return [];
    }

    // If it's a problem object, return its tests
    return problemOrDescription.tests || [];
  }

  /**
   * Get all problems
   */
  getAllProblems() {
    return Array.from(this.problems.values());
  }

  /**
   * Get problems by difficulty
   */
  getProblemsByDifficulty(difficulty) {
    return Array.from(this.problems.values())
      .filter(p => p.difficulty === difficulty);
  }

  /**
   * Get a random problem
   */
  getRandomProblem(difficulty = null) {
    let problemList = Array.from(this.problems.values());

    if (difficulty) {
      problemList = problemList.filter(p => p.difficulty === difficulty);
    }

    if (problemList.length === 0) return null;

    const index = Math.floor(Math.random() * problemList.length);
    return problemList[index];
  }

  /**
   * Validate a solution against tests
   */
  validateSolution(problemId, solution, sandbox) {
    const problem = this.getProblem(problemId);
    if (!problem) {
      throw new Error(`Problem not found: ${problemId}`);
    }

    return sandbox.runTests(solution, problem.tests);
  }

  /**
   * Get problem statistics
   */
  getStats() {
    const difficulties = {};
    for (const problem of this.problems.values()) {
      difficulties[problem.difficulty] = (difficulties[problem.difficulty] || 0) + 1;
    }

    return {
      total: this.problems.size,
      byDifficulty: difficulties
    };
  }
}

module.exports = ProblemTestSuite;
