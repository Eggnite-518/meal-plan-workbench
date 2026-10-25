import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatEndpoint, thinkingParameters} from '../src/api-config.js';
test('company root and v1 addresses resolve to the screenshot endpoint', () => {
  const expected = 'https://mediocre-new-api.midway.run/v1/chat/completions';
  for (const path of ['', '/', '/v1', '/v1/', '/v1/chat/completions']) assert.equal(chatEndpoint('https://mediocre-new-api.midway.run' + path), expected);
  assert.equal(chatEndpoint('https://ark.cn-beijing.volces.com/api/v3'), 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
});
test('thinking parameters are explicit and provider-specific', () => {
  assert.deepEqual(thinkingParameters('disabled'), {thinking:{type:'disabled'}});
  assert.deepEqual(thinkingParameters('qwen-disabled'), {enable_thinking:false});
  assert.deepEqual(thinkingParameters('default'), {});
});
