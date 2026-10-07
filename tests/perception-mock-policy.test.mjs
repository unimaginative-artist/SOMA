import test from 'node:test';
import assert from 'node:assert/strict';

import { mockVisionModeEnabled } from '../server/routes/perceptionRoutes.js';

test('development mode alone never enables fake perception', () => {
  assert.equal(mockVisionModeEnabled({ NODE_ENV: 'development', SOMA_MOCK_VISION_MODEL: 'false' }), false);
  assert.equal(mockVisionModeEnabled({ NODE_ENV: 'development' }), false);
});

test('fake perception requires an explicit opt-in', () => {
  assert.equal(mockVisionModeEnabled({ SOMA_MOCK_VISION_MODEL: 'true' }), true);
  assert.equal(mockVisionModeEnabled({ SOMA_MOCK_VISION_MODEL: 'TRUE' }), true);
});
