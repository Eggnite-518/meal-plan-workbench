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
  assert.match(prompt,/餐次标签的总体判定规则/);
  const input=JSON.parse(prompt.split('\n\n用户输入：\n\n')[1]);
  assert.ok(Array.isArray(input));
  assert.equal(input[0].slot,foods[0].slot);
  assert.ok(!prompt.includes('"region"'));
});

test('tag parser accepts common AI wrappers and single-slot object responses',()=>{
  const foods=[
    {id:'oat',name:'燕麦粥',slot:'staple',preference:'best'},
    {id:'rice',name:'糙米饭',slot:'staple',preference:'secondary'},
  ];
  const row={slot:'staple',foods:{
    best:[{foodName:'燕麦粥',allergenTags:[],avoidanceTags:[],mealTags:['早餐']}],
    secondary:[{foodName:'糙米饭',allergenTags:[],avoidanceTags:[],mealTags:['午餐','晚餐']}],
  }};
  assert.deepEqual(parseTaggingResult(foods,row).map(f=>f.foodName||f.name),['燕麦粥','糙米饭']);
  assert.deepEqual(parseTaggingResult(foods,{taggedFoods:[row]}).map(f=>f.mealTags),[['早餐'],['午餐','晚餐']]);
  assert.deepEqual(parseTaggingResult(foods,{result:{data:[row]}}).map(f=>f.tagsConfirmed),[true,true]);
  assert.throws(()=>parseTaggingResult(foods,{Role:'候选食物过敏原、忌口与餐次标签标注大师',Rules:[]}),/提示词\/规则对象/);
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

test('required slots relax only meal tags and never restore filtered foods',async()=>{
  const p={...DEFAULT_PROFILE,days:1,mealCount:2};
  const t={meals:[{id:'breakfast',name:'早餐',share:.5,required:['protein'],optional:['fruit']},{id:'lunch',name:'午餐',share:.5,required:['protein'],optional:['fruit']}]};
  const safe={id:'safe-protein',name:'安全正餐蛋白',slot:'protein',preference:'best',mealTags:['午餐'],ingredients:['鸡肉'],allergens:[],tags:[],tagsConfirmed:true,tagsReviewed:true,nutritionPer100g:{calories:120,protein:20,fat:3,carbs:2},portions:[{grams:100,label:'100克'}]};
  const optional={...safe,id:'lunch-fruit',name:'正餐水果',slot:'fruit',mealTags:['午餐']};
  const plan=compose(p,t,[safe,optional],DEFAULT_RULES);
  assert.equal(plan.status,'ready');
  assert.equal(plan.days[0].meals[0].items.length,1);
  assert.equal(plan.days[0].meals[0].items[0].foodId,'safe-protein');
  assert.equal(plan.days[0].meals[0].items[0].mealTagRelaxed,true);
  validatePlan(plan,p,t,[safe,optional]);

  const b=sampleBundle();
  b.foods=b.foods.map(f=>f.slot==='protein'?{...f,tags:[...new Set([...f.tags,'milk'])]}:f);
  const excludedProteinIds=new Set(b.foods.filter(f=>f.slot==='protein').map(f=>f.id));
  const filtered=filterPool(b,{habit:'regular',blockedTags:['milk'],avoids:''});
  const incomplete=compose(p,t,filtered.foods,DEFAULT_RULES);
  assert.equal(incomplete.status,'incomplete');
  assert.equal(incomplete.days[0].meals[0].items[0].unresolved,true);
  assert.ok(!incomplete.days.flatMap(d=>d.meals).flatMap(m=>m.items).some(i=>excludedProteinIds.has(i.foodId)));
  await assert.rejects(()=>solvePlan(p,t,filtered.foods,incomplete,DEFAULT_RULES),/没有安全候选/);
});

test('manual meal-tag relaxation is rejected while a compatible candidate exists',()=>{
  const p={...DEFAULT_PROFILE,days:1,mealCount:2};
  const t={meals:[{id:'breakfast',name:'早餐',share:.5,required:['protein'],optional:[]},{id:'lunch',name:'午餐',share:.5,required:['protein'],optional:[]}]};
  const base={slot:'protein',preference:'best',ingredients:['测试'],allergens:[],tags:[],nutritionPer100g:{calories:100,protein:10,fat:4,carbs:6},portions:[{grams:100,label:'100克'}]};
  const foods=[{...base,id:'breakfast',name:'早餐食物',mealTags:['早餐']},{...base,id:'lunch',name:'午餐食物',mealTags:['午餐']}];
  const plan=compose(p,t,foods,DEFAULT_RULES);
  plan.days[0].meals[0].items[0]={...plan.days[0].meals[0].items[0],foodId:'lunch',name:'午餐食物',mealTagRelaxed:true};
  assert.throws(()=>validatePlan(plan,p,t,foods),/引用或槽位/);
});

test('AI-selected food may bypass meal tags but not slot or pool validation',()=>{
  const b=sampleBundle(),p=profileFor(b.template,{calories:1650});
  const plan=compose(p,b.template,b.foods,rulesFor(b.template));
  const item=plan.days[0].meals[0].items[0];
  const food=b.foods.find(candidate=>candidate.id===item.foodId);
  const foods=b.foods.map(candidate=>candidate.id===food.id?{...candidate,mealTags:['晚餐']}:candidate);
  for(const day of plan.days)for(const meal of day.meals)for(const selected of meal.items)if(selected.foodId===food.id)selected.aiSelected=true;
  validatePlan(plan,p,b.template,foods);
  const wrongSlot=foods.map(candidate=>candidate.id===food.id?{...candidate,slot:candidate.slot==='staple'?'protein':'staple'}:candidate);
  assert.throws(()=>validatePlan(plan,p,b.template,wrongSlot),/引用或槽位/);
  assert.throws(()=>validatePlan(plan,p,b.template,foods.filter(candidate=>candidate.id!==food.id)),/引用或槽位/);
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
