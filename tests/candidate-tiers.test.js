import test from 'node:test';
import assert from 'node:assert/strict';
import {blankBundle,normalizeCandidates,candidateInput,candidateGroups,matchingRows,confirmLibraryMatches,mergeFoodSupplements,syncFoodPreferences,sampleBundle,filterPool} from '../src/workbench-model.js';
import {compose,solvePlan,DEFAULT_PROFILE,DEFAULT_RULES} from '../src/engine.js';

function grouped(){
  return Object.keys(blankBundle().template.slotDefinitions).map(slot=>({slot,foods:{best:[slot+'首选'],secondary:[slot+'替换']}}));
}
test('tiered JSON normalizes both lists and round-trips without losing recommendation levels',()=>{
  const t=blankBundle().template,input=grouped();
  const normalized=normalizeCandidates(input,t);
  assert.deepEqual(normalized.slotFoods[0].foods,['staple首选','staple替换']);
  assert.deepEqual(candidateInput(normalized),{slotFoods:input});
  assert.deepEqual(normalizeCandidates(normalized,t),normalized);
  const rows=matchingRows(normalized);
  assert.equal(rows.length,10);
  assert.equal(rows[0].preference,'best');assert.equal(rows[1].preference,'secondary');
  const updated=structuredClone(input);updated[0].foods.best=['staple替换'];updated[0].foods.secondary=['staple首选'];
  assert.equal(matchingRows(normalizeCandidates(updated,t),rows)[0].preference,'best');
  const foods=confirmLibraryMatches(rows,true).foods;
  assert.equal(foods[1].preference,'secondary');
  const synced=syncFoodPreferences(normalizeCandidates(updated,t),foods);
  assert.equal(synced[0].preference,'secondary');assert.equal(synced[1].preference,'best');
});
test('legacy lists remain best and malformed or duplicate tier lists are rejected',()=>{
  const t=blankBundle().template,input=grouped();
  const legacy=input.map(r=>({slot:r.slot,foods:r.foods.best}));
  assert.deepEqual(candidateGroups(normalizeCandidates(legacy,t).slotFoods[0]),{best:['staple首选'],secondary:[]});
  input[0].foods.secondary.push('staple首选');assert.throws(()=>normalizeCandidates(input,t),/重复/);
  input[0].foods={best:[],secondary:['替换']};assert.equal(normalizeCandidates(input,t).slotFoods[0].foods.length,1);
  input[0].foods={best:[],secondary:[]};assert.throws(()=>normalizeCandidates(input,t),/为空/);
  input[0].foods={best:['首选']};assert.throws(()=>normalizeCandidates(input,t),/两个数组/);
});
test('candidate tiers survive nutrition supplementation and filtering overrides edited metadata',()=>{
  const b=sampleBundle();
  b.candidates.slotFoods=b.candidates.slotFoods.map(r=>({...r,foodGroups:{best:r.foods.slice(0,1),secondary:r.foods.slice(1)}}));
  const food=b.foods.find(f=>f.slot===b.candidates.slotFoods[0].slot&&f.name===b.candidates.slotFoods[0].foods[1]);
  const enriched=mergeFoodSupplements([{...food,preference:'secondary'}],{foods:[{...food,preference:'best'}]});
  assert.equal(enriched[0].preference,'secondary');
  const filtered=filterPool(b,{habit:'regular',blockedTags:[],avoids:''});
  assert.equal(filtered.foods.find(f=>f.id===food.id).preference,'secondary');
});
const p={...DEFAULT_PROFILE,days:1,mealCount:2,calories:1000};
const t={meals:['lunch','dinner'].map(id=>({id,name:id,share:.5,required:['protein'],optional:[]}))};
const base={slot:'protein',ingredients:['食材'],allergens:[],mealTags:['午餐','晚餐'],nutritionPer100g:{calories:100,protein:6.25,fat:10/3,carbs:11.25},portions:[{grams:500,label:'测试份'}]};
test('compose strictly prefers best even when its repeat soft limit is reached',()=>{
  const foods=[{...base,id:'best',name:'首选',preference:'best'},{...base,id:'secondary',name:'替换',preference:'secondary'}];
  const plan=compose(p,t,foods,{...DEFAULT_RULES,maxRepeat:1});
  assert.ok(plan.days[0].meals.every(m=>m.items[0].foodId==='best'));
  const fallback=compose(p,t,foods.filter(f=>f.id!=='best'),DEFAULT_RULES);
  assert.ok(fallback.days[0].meals.every(m=>m.items[0].preference==='secondary'));
  const mealRestricted=compose(p,t,[{...foods[0],mealTypes:['lunch']},foods[1]],DEFAULT_RULES);
  assert.equal(mealRestricted.days[0].meals[1].items[0].foodId,'best');
});
test('portion solving tries best first and secondary only after best attempts fail',async()=>{
  const foods=[{...base,id:'best',name:'首选',preference:'best',portions:[{grams:1,label:'过小测试份'}]},{...base,id:'secondary',name:'替换',preference:'secondary'}];
  const plan=compose(p,t,foods,DEFAULT_RULES);
  const result=await solvePlan(p,t,foods,plan,DEFAULT_RULES);
  assert.equal(result.status,'passed');
  assert.deepEqual(result.log[0].attempts.map(a=>a.searchMode),['current','best','all']);
  assert.ok(result.days[0].meals.every(m=>m.items[0].preference==='secondary'));
  foods[0].portions=base.portions;
  const preferred=await solvePlan(p,t,foods,compose(p,t,foods,DEFAULT_RULES),DEFAULT_RULES);
  assert.equal(preferred.log[0].attempts.length,1);
  assert.ok(preferred.days[0].meals.every(m=>m.items[0].foodId==='best'));
});

test('joint search finds a feasible Best candidate beyond the old random retry limit',async()=>{
  const foods=Array.from({length:12},(_,i)=>({...base,id:`food${i}`,name:`候选${i}`,preference:'best',portions:[{grams:i===11?500:1,label:'测试份'}]}));
  const plan={days:[{day:1,meals:t.meals.map(m=>({...m,items:[{foodId:'food0',name:'候选0',slot:'protein',optional:false,preference:'best'}]}))}]};
  const original=structuredClone(plan),progress=[];
  const result=await solvePlan(p,t,foods,plan,{...DEFAULT_RULES,searchTimeMs:0},s=>progress.push(s));
  assert.equal(result.status,'passed');
  assert.deepEqual(result.log[0].attempts.map(a=>a.searchMode),['current','best']);
  assert.ok(result.days[0].meals.every(m=>m.items[0].foodId==='food11'));
  assert.equal(result.days[0].changedCombination,true);
  assert.deepEqual(plan,original);
  assert.ok(progress.some(s=>s.searchMode==='best'));
});

test('all-candidate search supports a mix of Best and Secondary and proves small infeasible pools',async()=>{
  const foods=[{...base,id:'best',name:'首选',preference:'best',portions:[{grams:400,label:'400克'}]},{...base,id:'secondary',name:'替换',preference:'secondary',portions:[{grams:600,label:'600克'}]}];
  const rules={...DEFAULT_RULES,mealTolerance:30,calorieTolerance:1};
  const result=await solvePlan(p,t,foods,compose(p,t,foods,rules),rules);
  assert.equal(result.status,'passed');
  assert.equal(result.log[0].attempts.at(-1).searchMode,'all');
  assert.deepEqual(result.days[0].meals.map(m=>m.items[0].preference).sort(),['best','secondary']);
  const tiny=foods.map(f=>({...f,portions:[{grams:1,label:'1克'}]}));
  const impossible=await solvePlan(p,t,tiny,compose(p,t,tiny,rules),rules);
  assert.equal(impossible.days[0].searchStatus,'approximate');
  assert.equal(impossible.days[0].pass,false);
  assert.equal(impossible.log[0].searchScope,'closest');
  assert.match(impossible.days[0].reason,/热量最接近/);
});
