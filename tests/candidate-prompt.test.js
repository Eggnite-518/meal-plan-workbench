import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CANDIDATE_PROMPT,candidatePromptInput,renderCandidatePrompt} from '../src/candidate-prompt.js';
import {DEFAULT_PLAN_INPUT,DEFAULT_PLAN_PROMPT,renderPlanPrompt} from '../src/plan-prompt.js';
import {defaultTemplate} from '../src/workbench-model.js';

test('first step sends only the original five fields and never injects region',()=>{
  const text=renderPlanPrompt(DEFAULT_PLAN_PROMPT,{...DEFAULT_PLAN_INPUT,地域范围:'中国大陆'});
  const sent=JSON.parse(text.slice(text.lastIndexOf('\n\n')+2));
  assert.deepEqual(sent,DEFAULT_PLAN_INPUT);
  assert.ok(!text.includes('地域范围'));
});

test('second step composes region and first-step output into candidate input',()=>{
  const t={...defaultTemplate(),name:'均衡饮食减脂7日计划',planDescription:[{type:'饮食特点',content:'均衡搭配。'}],slotConstraints:[{slot:'staple',rules:'优先全谷物。'}]};
  const source={目的:'减脂',运动习惯:'规律运动',饮食策略:'日常饮食'};
  const input=candidatePromptInput(t,'中国大陆',source);
  assert.deepEqual(input,{...source,地域范围:'中国大陆',planName:t.name,planDescription:t.planDescription,slotConstraints:t.slotConstraints});
  const rendered=renderCandidatePrompt(DEFAULT_CANDIDATE_PROMPT,t,'中国大陆',source);
  const parsed=JSON.parse(rendered);
  assert.deepEqual(parsed.用户输入,input);
  assert.match(rendered,/best/);assert.match(rendered,/secondary/);
  assert.match(rendered,/fruit槽位以10至20种/);
});

test('candidate custom template preserves testContent contract',()=>{
  const custom=JSON.parse(DEFAULT_CANDIDATE_PROMPT);
  custom.Rules.push('优先使用超市常见食物');
  const rendered=JSON.parse(renderCandidatePrompt(JSON.stringify(custom),defaultTemplate(),'全球通用',DEFAULT_PLAN_INPUT));
  assert.ok(rendered.Rules.includes('优先使用超市常见食物'));
  assert.equal(rendered.用户输入.地域范围,'全球通用');
});

test('invalid prompt templates and plan inputs fail before model request',()=>{
  assert.throws(()=>renderCandidatePrompt('{}',defaultTemplate()),/testContent/);
  assert.throws(()=>renderCandidatePrompt('{"x":"${testContent}"',defaultTemplate()),SyntaxError);
  assert.throws(()=>renderPlanPrompt('{}',DEFAULT_PLAN_INPUT),/testContent/);
  assert.throws(()=>renderPlanPrompt(DEFAULT_PLAN_PROMPT,{...DEFAULT_PLAN_INPUT,计划天数:5}),/7天/);
});
