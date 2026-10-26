import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CANDIDATE_PROMPT,candidatePromptInput,renderCandidatePrompt} from '../src/candidate-prompt.js';
import {DEFAULT_PLAN_INPUT,DEFAULT_PLAN_PROMPT,renderPlanPrompt} from '../src/plan-prompt.js';
import {defaultTemplate} from '../src/workbench-model.js';

test('first step sends the six supported fields including calories and never injects region',()=>{
  const text=renderPlanPrompt(DEFAULT_PLAN_PROMPT,{...DEFAULT_PLAN_INPUT,地域范围:'中国大陆'});
  const sent=JSON.parse(text.slice(text.lastIndexOf('\n\n')+2));
  assert.deepEqual(sent,DEFAULT_PLAN_INPUT);
  assert.ok(!text.includes('地域范围'));
  assert.equal(sent.每日目标摄入热量,1650);
});

test('second step composes region and first-step output into candidate input',()=>{
  const t={...defaultTemplate(),name:'均衡饮食减脂7日计划',planDescription:[{type:'饮食特点',content:'均衡搭配。'}],slotConstraints:[{slot:'staple',rules:'优先全谷物。'}]};
  const source={目的:'减脂',运动习惯:'规律运动',饮食策略:'日常饮食'};
  const input=candidatePromptInput(t,'中国大陆',source);
  assert.deepEqual(input,{...source,地域范围:'中国大陆',planName:t.name,planDescription:t.planDescription,slotConstraints:t.slotConstraints});
  const rendered=renderCandidatePrompt(DEFAULT_CANDIDATE_PROMPT,t,'中国大陆',source);
  const sent=JSON.parse(rendered.slice(rendered.lastIndexOf('\n\n')+2));
  assert.deepEqual(sent,input);
  assert.match(rendered,/best/);assert.match(rendered,/secondary/);
  assert.match(rendered,/fruit槽位以10至20种/);
});

test('candidate custom template preserves testContent contract',()=>{
  const custom=JSON.parse(DEFAULT_CANDIDATE_PROMPT.split(/\n\s*用户输入：\s*\n/)[0]);
  custom.Rules.push('优先使用超市常见食物');
  const template=`${JSON.stringify(custom)}\n\n用户输入：\n\n\${testContent}`;
  const rendered=renderCandidatePrompt(template,defaultTemplate(),'全球通用',DEFAULT_PLAN_INPUT);
  assert.ok(rendered.includes('优先使用超市常见食物'));
  assert.equal(JSON.parse(rendered.slice(rendered.lastIndexOf('\n\n')+2)).地域范围,'全球通用');
});

test('invalid prompt templates and plan inputs fail before model request',()=>{
  assert.throws(()=>renderCandidatePrompt('{}',defaultTemplate()),/testContent/);
  assert.throws(()=>renderCandidatePrompt('{"x":"${testContent}"',defaultTemplate()),SyntaxError);
  assert.throws(()=>renderPlanPrompt('{}',DEFAULT_PLAN_INPUT),/testContent/);
  assert.throws(()=>renderPlanPrompt(DEFAULT_PLAN_PROMPT,{...DEFAULT_PLAN_INPUT,计划天数:5}),/7天/);
  assert.throws(()=>renderPlanPrompt(DEFAULT_PLAN_PROMPT,{...DEFAULT_PLAN_INPUT,每日目标摄入热量:600}),/800/);
  const {每日目标摄入热量,...missingCalories}=DEFAULT_PLAN_INPUT;
  assert.throws(()=>renderPlanPrompt(DEFAULT_PLAN_PROMPT,missingCalories),/必要字段/);
});
