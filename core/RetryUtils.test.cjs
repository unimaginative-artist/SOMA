/**
 * RetryUtils Test - Verify retry logic with exponential backoff
 * Run with: node core/RetryUtils.test.cjs
 */

const { withRetry, retry, RetriableError } = require('./RetryUtils.cjs');

console.log('\n🧪 TESTING RETRY UTILS\n');
console.log('═'.repeat(60));

// Track test results
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    testsPassed++;
  } else {
    console.log(`❌ ${message}`);
    testsFailed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Successful call on first attempt
// ═══════════════════════════════════════════════════════════════════

async function test1() {
  console.log('\n📝 Test 1: Successful call on first attempt');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    return 'success';
  };

  const result = await retry(fn, { maxRetries: 3 });
  assert(result === 'success', 'Should return success');
  assert(callCount === 1, `Should only call once (called ${callCount} times)`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Retry on 429 error, succeed on second attempt
// ═══════════════════════════════════════════════════════════════════

async function test2() {
  console.log('\n📝 Test 2: Retry on 429 error, succeed on second attempt');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount === 1) {
      const error = new Error('Rate limit exceeded');
      error.status = 429;
      throw error;
    }
    return 'success after retry';
  };

  const startTime = Date.now();
  const result = await retry(fn, { maxRetries: 3, baseDelay: 100 });
  const duration = Date.now() - startTime;

  assert(result === 'success after retry', 'Should succeed after retry');
  assert(callCount === 2, `Should call twice (called ${callCount} times)`);
  assert(duration >= 100, `Should wait at least 100ms (waited ${duration}ms)`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Exponential backoff
// ═══════════════════════════════════════════════════════════════════

async function test3() {
  console.log('\n📝 Test 3: Exponential backoff timing');

  let callCount = 0;
  const delays = [];
  let lastTime = Date.now();

  const fn = async () => {
    const now = Date.now();
    if (callCount > 0) {
      delays.push(now - lastTime);
    }
    lastTime = now;
    callCount++;

    if (callCount < 3) {
      const error = new Error('Rate limit');
      error.status = 429;
      throw error;
    }
    return 'success';
  };

  await retry(fn, { maxRetries: 3, baseDelay: 100, maxDelay: 500 });

  assert(delays.length === 2, `Should have 2 delays (got ${delays.length})`);
  assert(delays[0] >= 100 && delays[0] < 150, `First delay ~100ms (got ${delays[0]}ms)`);
  assert(delays[1] >= 200 && delays[1] < 250, `Second delay ~200ms (got ${delays[1]}ms)`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Max retries exceeded
// ═══════════════════════════════════════════════════════════════════

async function test4() {
  console.log('\n📝 Test 4: Max retries exceeded, should throw error');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    const error = new Error('Persistent rate limit');
    error.status = 429;
    throw error;
  };

  try {
    await retry(fn, { maxRetries: 3, baseDelay: 50 });
    assert(false, 'Should have thrown error');
  } catch (error) {
    assert(error.message === 'Persistent rate limit', 'Should throw original error');
    assert(callCount === 3, `Should call maxRetries times (called ${callCount})`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Don't retry non-429 errors by default
// ═══════════════════════════════════════════════════════════════════

async function test5() {
  console.log('\n📝 Test 5: Should not retry non-429 errors by default');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    const error = new Error('Server error');
    error.status = 500;
    throw error;
  };

  try {
    await retry(fn, { maxRetries: 3, baseDelay: 50 });
    assert(false, 'Should have thrown error');
  } catch (error) {
    assert(error.message === 'Server error', 'Should throw original error');
    assert(callCount === 1, `Should only call once (called ${callCount} times)`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEST 6: Retry all errors when retryAllErrors = true
// ═══════════════════════════════════════════════════════════════════

async function test6() {
  console.log('\n📝 Test 6: Should retry all errors when retryAllErrors = true');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount === 1) {
      const error = new Error('Network error');
      error.status = 500;
      throw error;
    }
    return 'success';
  };

  const result = await retry(fn, { maxRetries: 3, baseDelay: 50, retryAllErrors: true });
  assert(result === 'success', 'Should succeed after retry');
  assert(callCount === 2, `Should call twice (called ${callCount} times)`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 7: RetriableError class
// ═══════════════════════════════════════════════════════════════════

async function test7() {
  console.log('\n📝 Test 7: RetriableError class should be retried');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount === 1) {
      throw new RetriableError('Custom retriable error', 100);
    }
    return 'success';
  };

  const result = await retry(fn, { maxRetries: 3, baseDelay: 50 });
  assert(result === 'success', 'Should succeed after retry');
  assert(callCount === 2, `Should call twice (called ${callCount} times)`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 8: Retry-After header (delta-seconds)
// ═══════════════════════════════════════════════════════════════════

async function test8() {
  console.log('\n📝 Test 8: Retry-After header with delta-seconds');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount === 1) {
      const error = new Error('Rate limit');
      error.status = 429;
      error.headers = { 'retry-after': '1' }; // 1 second
      throw error;
    }
    return 'success';
  };

  const startTime = Date.now();
  const result = await retry(fn, { maxRetries: 3 });
  const duration = Date.now() - startTime;

  assert(result === 'success', 'Should succeed after retry');
  assert(duration >= 1000, `Should wait at least 1000ms (waited ${duration}ms)`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 9: Retry-After header (Unix timestamp)
// ═══════════════════════════════════════════════════════════════════

async function test9() {
  console.log('\n📝 Test 9: Retry-After header with Unix timestamp');

  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (callCount === 1) {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 1; // 1 second from now
      const error = new Error('Rate limit');
      error.status = 429;
      error.headers = { 'retry-after': futureTimestamp.toString() };
      throw error;
    }
    return 'success';
  };

  const startTime = Date.now();
  const result = await retry(fn, { maxRetries: 3 });
  const duration = Date.now() - startTime;

  assert(result === 'success', 'Should succeed after retry');
  assert(duration >= 900, `Should wait ~1000ms (waited ${duration}ms)`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 10: onRetryAttempt callback
// ═══════════════════════════════════════════════════════════════════

async function test10() {
  console.log('\n📝 Test 10: onRetryAttempt callback');

  let callCount = 0;
  const retryAttempts = [];

  const fn = async () => {
    callCount++;
    if (callCount < 3) {
      const error = new Error('Rate limit');
      error.status = 429;
      throw error;
    }
    return 'success';
  };

  const result = await retry(fn, {
    maxRetries: 3,
    baseDelay: 50,
    onRetryAttempt: (attempt, maxRetries, delay, error) => {
      retryAttempts.push({ attempt, maxRetries, delay, errorMsg: error.message });
    }
  });

  assert(result === 'success', 'Should succeed after retries');
  assert(retryAttempts.length === 2, `Should call callback twice (called ${retryAttempts.length} times)`);
  assert(retryAttempts[0].attempt === 1, 'First callback should be attempt 1');
  assert(retryAttempts[1].attempt === 2, 'Second callback should be attempt 2');
}

// ═══════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════════

async function runTests() {
  try {
    await test1();
    await test2();
    await test3();
    await test4();
    await test5();
    await test6();
    await test7();
    await test8();
    await test9();
    await test10();

    console.log('\n' + '═'.repeat(60));
    console.log(`\n📊 RESULTS: ${testsPassed} passed, ${testsFailed} failed`);

    if (testsFailed === 0) {
      console.log('✅ ALL TESTS PASSED!\n');
    } else {
      console.log('❌ SOME TESTS FAILED\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ UNEXPECTED ERROR:', error);
    process.exit(1);
  }
}

runTests();
