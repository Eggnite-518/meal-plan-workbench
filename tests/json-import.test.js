import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlanTemplates,normalizeCandidates,matchingRows,confirmLibraryMatches,mergeFoodSupplements,enrichmentPrompt,profileFor,validatePool,blankBundle} from '../src/workbench-model.js';
import {validateProfile} from '../src/engine.js';
import {matchExactRow} from '../src/real-library.js';

function plan(){
  return {planName:'生酮饮食维持7日计划',
    planDescription:[{type:'饮食特点',content:'低碳水、高脂肪。'}],
    macroRatio:{carbohydrate:8,protein:22,fat:70},
    mealCalorieDistribution:[{mealCode:'lunch',mealName:'午餐',caloriePercentage:52},{mealCode:'dinner',mealName:'晚餐',caloriePercentage:48}],
    slotConstraints:[{slot:'staple',rules:'仅可选低碳水类别。'}],
    mealPlanTemplate:Array.from({length:7},(_,i)=>({day:i+1,meals:[
      {mealCode:'lunch',mealName:'午餐',requiredSlots:['protein','vegetable','fat'],optionalSlots:['fruit']},
      {mealCode:'dinner',mealName:'晚餐',requiredSlots:['protein','vegetable','fat'],optionalSlots:['staple']},
    ]})),
  };
}
const record={id:'rice',name:'米饭',unit:'gram',weight:100,calorie:116,nutrition:{protein:2.6,fat:.3,carbohydrate:25.9},showUnits:[]};
const metadata={ingredients:['大米'],allergens:[],tags:[],mealTags:['午餐','晚餐'],portions:[{grams:150,label:'1小碗'}]};

test('pasted external plan arrays retain descriptions, constraints and all meal structure',()=>{
  const [t]=parsePlanTemplates([plan()]);
  assert.equal(t.goal,'maintain');assert.equal(t.match.habit,'keto');assert.equal(t.match.mealCount,2);
  assert.deepEqual(t.macroRatio,{protein:22,fat:70,carbs:8});
  assert.equal(t.days[6].meals[0].share,.52);
  assert.deepEqual(t.days[3].meals[1].optional,['staple']);
  assert.equal(t.planDescription[0].content,plan().planDescription[0].content);
  assert.equal(t.slotConstraints[0].rules,'仅可选低碳水类别。');
  assert.deepEqual(parsePlanTemplates(t),[t]);
  assert.equal(parsePlanTemplates([plan(),{...plan(),planName:'均衡减脂7日计划',macroRatio:{protein:25,fat:30,carbohydrate:45}}]).length,2);
  assert.equal(profileFor(t,{calories:1800,habit:'regular'}).habit,'keto');
  assert.throws(()=>validateProfile({...profileFor(t,{calories:1800}),habit:'regular'}),/fat/);
});
test('external plan parsing rejects partial days, inconsistent shares and unknown slots',()=>{
  const missing=plan();missing.mealPlanTemplate.pop();assert.throws(()=>parsePlanTemplates(missing),/7天/);
  const shares=plan();shares.mealCalorieDistribution[0].caloriePercentage=60;assert.throws(()=>parsePlanTemplates(shares),/合计/);
  const slots=plan();slots.mealPlanTemplate[0].meals[0].requiredSlots=['unknown'];assert.throws(()=>parsePlanTemplates(slots),/槽位/);
  assert.throws(()=>parsePlanTemplates([]),/不能为空/);
});
test('direct slot arrays support different counts and preserve validation',()=>{
  const [t]=parsePlanTemplates(plan());
  const slots=['protein','vegetable','fat','fruit','staple'].map((slot,i)=>({slot,foods:Array.from({length:i+21},(_,j)=>slot+j)}));
  assert.equal(normalizeCandidates(slots,t).slotFoods[4].foods.length,25);
  assert.throws(()=>normalizeCandidates(slots.slice(1),t),/每一个槽位/);
  slots[1].foods.push(slots[0].foods[0]);assert.throws(()=>normalizeCandidates(slots,t),/重复/);
});
test('automatic first-name matching leaves missing candidates ready for nutrition supplementation',()=>{
  const rows=matchingRows({slotFoods:[{slot:'staple',foods:['米饭','燕麦粥']}]});
  rows[0]=matchExactRow(rows[0],[record,{...record,id:'rice2'}]);
  rows[1]=matchExactRow(rows[1],[{...record,id:'oats',name:'生燕麦'}]);
  const {foods,issues}=confirmLibraryMatches(rows,true);
  assert.equal(foods.length,2);assert.equal(issues.length,1);
  assert.equal(foods[0].libraryRecord.id,'rice');
  assert.equal(foods[1].dataSource,'pending');assert.equal(foods[1].nutritionPer100g,null);
  const allMissing=confirmLibraryMatches([rows[1]],true);
  assert.equal(allMissing.foods[0].dataSource,'pending');
  const prompt=enrichmentPrompt(blankBundle().template,{},foods);
  assert.match(prompt,/nutritionReference/);assert.match(prompt,/仅dataSource=pending/);
  const patch={foods:foods.map(f=>({...f,...metadata,nutritionPer100g:{calories:70,protein:2,fat:1,carbs:13},nutritionReference:'参考熟燕麦粥，每100克约70千卡，含水量较高。'}))};
  const merged=mergeFoodSupplements(foods,patch);
  assert.equal(merged[0].nutritionPer100g.calories,116);
  assert.equal(merged[0].dataSource,'real_library');
  assert.equal(merged[1].nutritionPer100g.calories,70);
  assert.equal(merged[1].dataSource,'ai_estimate');assert.equal(merged[1].tagsReviewed,true);
  assert.equal(merged[1].nutritionReference,patch.foods[1].nutritionReference);
  delete patch.foods[1].nutritionReference;
  assert.throws(()=>mergeFoodSupplements(foods,patch),/参考依据/);
  const unresolved=mergeFoodSupplements(foods,{foods:foods.map(f=>({...f,...metadata}))});
  assert.equal(unresolved[1].dataSource,'pending');
  const b=blankBundle();b.candidates={slotFoods:Object.keys(b.template.slotDefinitions).map((slot,i)=>({slot,foods:['food'+i]}))};
  b.foods=confirmLibraryMatches(matchingRows(b.candidates),true).foods;
  assert.throws(()=>validatePool(b),/尚未补齐营养数据/);
});
