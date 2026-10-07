/**
 * ToolErrorHandler Test - Verify error standardization
 * Run with: node core/ToolErrorHandler.test.cjs
 */

const {
  handleToolError,
  createToolErrorResponse,
  withErrorHandling,
  HttpError,
  RateLimitError,
  extractStatusCode,
  sanitizeStatusCode,
  extractErrorMessage,
  extractHeaders
} = require('./ToolErrorHandler.cjs');

console.log('\n🧪 TESTING TOOL ERROR HANDLER\n');
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
// TEST 1: Handle fetch API error
// ═══════════════════════════════════════════════════════════════════

function test1() {
  console.log('\n📝 Test 1: Handle fetch API error (429)');

  const fetchError = new Error('Too Many Requests');
  fetchError.response = {
    status: 429,
    statusText: 'Too Many Requests',
    headers: { 'retry-after': '60' }
  };

  const result = handleToolError(fetchError, {
    toolName: 'api_call',
    context: 'Gemini API'
  });

  assert(result.status === 429, `Status should be 429 (got ${result.status})`);
  assert(result.message === 'Too Many Requests', 'Message should match');
  assert(result.headers['retry-after'] === '60', 'Should preserve retry-after header');
  assert(result.isError === true, 'Should be marked as error');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Handle axios error
// ═══════════════════════════════════════════════════════════════════

function test2() {
  console.log('\n📝 Test 2: Handle axios error (500)');

  const axiosError = new Error('Request failed');
  axiosError.isAxiosError = true;
  axiosError.response = {
    status: 500,
    data: { message: 'Internal server error' }
  };

  const result = handleToolError(axiosError, {
    toolName: 'brave_search',
    isProd: true
  });

  assert(result.status === 500, `Status should be 500 (got ${result.status})`);
  assert(result.message === 'Internal Server Error', 'Should hide message in prod');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Handle HttpError class
// ═══════════════════════════════════════════════════════════════════

function test3() {
  console.log('\n📝 Test 3: Handle HttpError class');

  const error = new HttpError('Not found', 404);
  const result = handleToolError(error, { toolName: 'resource_lookup' });

  assert(result.status === 404, `Status should be 404 (got ${result.status})`);
  assert(result.message === 'Not found', 'Should preserve message');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Handle RateLimitError class
// ═══════════════════════════════════════════════════════════════════

function test4() {
  console.log('\n📝 Test 4: Handle RateLimitError class');

  const error = new RateLimitError('Rate limit exceeded', 120);
  const result = handleToolError(error, { toolName: 'api_call' });

  assert(result.status === 429, `Status should be 429 (got ${result.status})`);
  assert(result.headers['retry-after'] === 120, 'Should have retry-after header');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Sanitize invalid status codes
// ═══════════════════════════════════════════════════════════════════

function test5() {
  console.log('\n📝 Test 5: Sanitize invalid status codes');

  assert(sanitizeStatusCode(200) === 200, 'Valid status should pass through');
  assert(sanitizeStatusCode(999) === 500, 'Invalid status (999) should default to 500');
  assert(sanitizeStatusCode(-1) === 500, 'Negative status should default to 500');
  assert(sanitizeStatusCode('abc') === 500, 'String status should default to 500');
  assert(sanitizeStatusCode(null) === 500, 'Null status should default to 500');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 6: Extract headers correctly
// ═══════════════════════════════════════════════════════════════════

function test6() {
  console.log('\n📝 Test 6: Extract rate limit headers');

  const error = new Error('Rate limit');
  error.response = {
    headers: {
      'retry-after': '60',
      'x-ratelimit-limit': '1000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1704067200',
      'content-type': 'application/json' // Should not be extracted
    }
  };

  const headers = extractHeaders(error);

  assert(headers['retry-after'] === '60', 'Should extract retry-after');
  assert(headers['x-ratelimit-limit'] === '1000', 'Should extract ratelimit-limit');
  assert(headers['x-ratelimit-remaining'] === '0', 'Should extract ratelimit-remaining');
  assert(headers['x-ratelimit-reset'] === '1704067200', 'Should extract ratelimit-reset');
  assert(headers['content-type'] === undefined, 'Should not extract irrelevant headers');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 7: Create tool error response
// ═══════════════════════════════════════════════════════════════════

function test7() {
  console.log('\n📝 Test 7: Create tool error response');

  const error = new Error('API call failed');
  error.statusCode = 503;

  const response = createToolErrorResponse(error, {
    toolName: 'external_api',
    context: 'Third-party service'
  });

  assert(response.success === false, 'Should be marked as failed');
  assert(response.status === 503, `Status should be 503 (got ${response.status})`);
  assert(response.error === 'API call failed', 'Should have error message');
  assert(response.metadata.toolName === 'external_api', 'Should have metadata');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 8: withErrorHandling wrapper (success)
// ═══════════════════════════════════════════════════════════════════

async function test8() {
  console.log('\n📝 Test 8: withErrorHandling wrapper (success case)');

  const successFn = async () => {
    return { data: 'success' };
  };

  const wrappedFn = withErrorHandling(successFn, { toolName: 'test_tool' });
  const result = await wrappedFn();

  assert(result.success === true, 'Should be marked as successful');
  assert(result.data.data === 'success', 'Should return original data');
  assert(result.status === 200, `Status should be 200 (got ${result.status})`);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 9: withErrorHandling wrapper (error)
// ═══════════════════════════════════════════════════════════════════

async function test9() {
  console.log('\n📝 Test 9: withErrorHandling wrapper (error case)');

  const errorFn = async () => {
    const error = new Error('Operation failed');
    error.statusCode = 400;
    throw error;
  };

  const wrappedFn = withErrorHandling(errorFn, { toolName: 'test_tool' });
  const result = await wrappedFn();

  assert(result.success === false, 'Should be marked as failed');
  assert(result.status === 400, `Status should be 400 (got ${result.status})`);
  assert(result.error === 'Operation failed', 'Should have error message');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 10: Extract message from various error formats
// ═══════════════════════════════════════════════════════════════════

function test10() {
  console.log('\n📝 Test 10: Extract error message from various formats');

  // Standard error
  const error1 = new Error('Standard error');
  assert(
    extractErrorMessage(error1) === 'Standard error',
    'Should extract from Error.message'
  );

  // Axios-style error
  const error2 = {
    response: {
      data: { message: 'API error message' }
    }
  };
  assert(
    extractErrorMessage(error2) === 'API error message',
    'Should extract from response.data.message'
  );

  // Fetch-style error
  const error3 = {
    statusText: 'Bad Request',
    response: { statusText: 'Bad Request' }
  };
  assert(
    extractErrorMessage(error3) === 'Bad Request',
    'Should extract from statusText'
  );

  // Production mode hiding 5xx details
  const error4 = new Error('Database connection failed');
  error4.statusCode = 500;
  assert(
    extractErrorMessage(error4, { isProd: true }) === 'Internal Server Error',
    'Should hide 5xx details in production'
  );
}

// ═══════════════════════════════════════════════════════════════════
// TEST 11: Extract status from various error formats
// ═══════════════════════════════════════════════════════════════════

function test11() {
  console.log('\n📝 Test 11: Extract status code from various formats');

  assert(extractStatusCode({ status: 404 }) === 404, 'Should extract from .status');
  assert(extractStatusCode({ statusCode: 403 }) === 403, 'Should extract from .statusCode');
  assert(
    extractStatusCode({ response: { status: 502 } }) === 502,
    'Should extract from .response.status'
  );
  assert(extractStatusCode({}) === 500, 'Should default to 500 for unknown errors');
}

// ═══════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════════

async function runTests() {
  try {
    test1();
    test2();
    test3();
    test4();
    test5();
    test6();
    test7();
    await test8();
    await test9();
    test10();
    test11();

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
