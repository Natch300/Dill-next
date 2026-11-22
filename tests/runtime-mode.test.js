import test from 'node:test';
import assert from 'node:assert/strict';
import {isLiveMode} from '../js/runtime-mode.js';

test('hosted accounts default to live and explicit exploration remains local',()=>{
  assert.equal(isLiveMode(new URLSearchParams(),true),true);
  assert.equal(isLiveMode(new URLSearchParams(),false),false);
  for(const query of ['explore=1','demo=1','live=0'])assert.equal(isLiveMode(new URLSearchParams(query),true),false);
  assert.equal(isLiveMode(new URLSearchParams('live=1'),false),true);
  assert.equal(isLiveMode(new URLSearchParams('live=1&explore=1'),true),true);
});
