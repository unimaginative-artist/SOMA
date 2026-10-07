import assert from 'node:assert/strict';
import test from 'node:test';

test('RSI candidate runner strips credentials and uses isolated mode', () => {
    assert.equal(process.env.SOMA_ISOLATED_TEST, 'true');
    assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
    assert.equal(process.env.SOMA_OPERATOR_TOKEN, undefined);
    assert.equal(process.env.TWITCH_OAUTH_TOKEN, undefined);
});
