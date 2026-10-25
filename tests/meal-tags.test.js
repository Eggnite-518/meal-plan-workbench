import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleBundle,profileFor,rulesFor,filterPool,mergeFoodSupplements,enrichmentPrompt} from '../src/workbench-model.js';
import {compose,validatePlan,solvePlan,DEFAULT_PROFILE,DEFAULT_RULES} from '../src/engine.js';
import {taggingInput,parseTaggingResult} from '../src/food-tags.js';
import {needsTags,mergeEnrichmentBatch} from '../src/enrichment.js';

test('grouped tags preserve tiers and identities and reject missing meals, changed names and extra fields',()=>{
  const b=sampleBundle(),foods=b.foods.slice(0,2).map((f,i)=>({...f,preference:i?'secondary':'best',mealTags:undefined}));
  const candidates={slotFoods:[{slot:foods[0].slot,foods:foods.map(f=>f.name)}]};
  const response=taggingInput(candidates,foods).map(r=>({...r,foods:Object.fromEntries(Object.entries(r.foods).map(([tier,names])=>[tier,names.map(name=>({foodName:name,allergenTags:['麸质'],avoidanceTags:[],mealTags:['早餐']}))]))}));
  const result=mergeEnrichmentBatch(foods,foods,response,'tags');
  assert.equal(needsTags(foods[0]),true);assert.equal(needsTags(result[0]),false);
  assert.deepEqual(result.map(f=>f.id),foods.map(f=>f.id));
  assert.deepEqual(result.map(f=>f.preference),['best','secondary']);
  assert.deepEqual(result[0].nutritionPer100g,foods[0].nutritionPer100g);
  assert.deepEqual(result[0].portions,foods[0].portions);
  assert.deepEqual(result[0].tags,['gluten']);
  const invalid=structuredClone(response);invalid[0].foods.best[0].mealTags=[];
  assert.throws(()=>parseTaggingResult(foods,invalid),/餐次/);
  invalid[0].foods.best[0].mealTags=['早饭'];assert.throws(()=>parseTaggingResult(foods,invalid),/餐次/);
  invalid[0].foods.best[0].mealTags=['早餐'];invalid[0].foods.best[0].foodName='改名';
  assert.throws(()=>parseTaggingResult(foods,invalid),/名称/);
  invalid[0].foods.best[0].foodName=foods[0].name;invalid[0].foods.best[0].portions=[];
  assert.throws(()=>mergeFoodSupplements(foods,invalid,'tags'),/字段/);
  const prompt=enrichmentPrompt(b.template,candidates,foods,'tags');
  assert.match(prompt,/餐次标签的总体判定规则/);assert.match(prompt,/全球通用/);
});

test('meal eligibility filters before Best priority and blocks manual plan edits',()=>{
  const b=sampleBundle();
  b.foods=b.foods.map(f=>({...f,preference:f.id==='bread'?'secondary':'best',mealTags:f.slot==='staple'&&f.id!=='bread'?['午餐','晚餐']:f.slot==='staple'?['早餐']:['早餐','午餐','晚餐']}));
  const p=profileFor(b.template,{calories:1650}),rules=rulesFor(b.template);
  const plan=compose(p,b.template,b.foods,rules);
  for(const d of plan.days)for(const m of d.meals)for(const i of m.items.filter(i=>i.slot==='staple'))assert.equal(i.foodId==='bread',m.id==='breakfast');
  const altered=structuredClone(plan);altered.days[0].meals[0].items.find(i=>i.slot==='staple').foodId='rice';
  assert.throws(()=>validatePlan(altered,p,b.template,b.foods),/引用或槽位/);
  b.foods=b.foods.filter(f=>f.id!=='bread');
  b.candidates.slotFoods.find(r=>r.slot==='staple').foods=b.foods.filter(f=>f.slot==='staple').map(f=>f.name);
  assert.ok(filterPool(b,{habit:'regular',blockedTags:[],avoids:''}).shortages.some(s=>s.meal==='早餐'&&s.slot==='staple'&&s.required));
});

test('optional slots with no meal-eligible food are skipped without borrowing from another meal',()=>{
  const b=sampleBundle(),p={...DEFAULT_PROFILE,days:1},t={meals:['breakfast','lunch','dinner'].map(id=>({id,name:id,share:1/3,required:['staple'],optional:['fruit']}))};
  const foods=b.foods.filter(f=>['staple','fruit'].includes(f.slot)).map(f=>({...f,mealTags:f.slot==='fruit'?['午餐','晚餐']:['早餐','午餐','晚餐']}));
  const plan=compose(p,t,foods,DEFAULT_RULES);
  assert.deepEqual(plan.days[0].meals[0].items.map(i=>i.slot),['staple']);
});

test('joint solving cannot use feasible breakfast-only replacements at lunch or dinner',async()=>{
  const p={...DEFAULT_PROFILE,days:1,mealCount:2,calories:1000};
  const t={meals:['lunch','dinner'].map(id=>({id,name:id,share:.5,required:['protein'],optional:[]}))};
  const base={slot:'protein',ingredients:['测试食材'],allergens:[],nutritionPer100g:{calories:100,protein:6.25,fat:10/3,carbs:11.25},preference:'best'};
  const foods=[{...base,id:'tiny',name:'正餐候选',mealTags:['午餐','晚餐'],portions:[{grams:1,label:'测试1克'}]},{...base,id:'large',name:'仅早餐候选',mealTags:['早餐'],portions:[{grams:500,label:'测试500克'}]}];
  const plan=compose(p,t,foods,DEFAULT_RULES);
  assert.ok(plan.days[0].meals.every(m=>m.items[0].foodId==='tiny'));
  const result=await solvePlan(p,t,foods,plan,{...DEFAULT_RULES,searchTimeMs:0});
  assert.equal(result.days[0].searchStatus,'approximate');
  assert.equal(result.days[0].pass,false);
  assert.ok(result.days[0].meals.every(m=>m.items.every(i=>i.foodId==='tiny')));
});
