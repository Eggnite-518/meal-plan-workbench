import test from 'node:test';
import assert from 'node:assert/strict';
import {mealPlanInput,parseAiMealPlan,renderMealPlanPrompt} from '../src/meal-plan-prompt.js';

const template={goal:'fatLoss',match:{habit:'mediterranean'},days:Array.from({length:7},(_,index)=>({day:index+1,meals:[{id:'breakfast',name:'早餐',share:.3,required:['staple','protein'],optional:['fruit']}]}))};
const foods=[
  {id:'oats',name:'燕麦粥',slot:'staple',preference:'best'},
  {id:'bread',name:'全麦面包',slot:'staple',preference:'secondary'},
  {id:'egg',name:'水煮鸡蛋',slot:'protein',preference:'best'},
  {id:'apple',name:'苹果',slot:'fruit',preference:'best'},
];
const valid=()=>({status:'success',days:template.days.map(day=>({day:day.day,meals:[{mealType:'breakfast',items:[{slot:'staple',foodName:'燕麦粥',source:'best',required:true},{slot:'protein',foodName:'水煮鸡蛋',source:'best',required:true},{slot:'fruit',foodName:'苹果',source:'best',required:false}]}]})),errors:[]});

test('meal plan input contains the four requested sections and preserves tiers',()=>{
  const input=mealPlanInput(template,foods,1650);
  assert.deepEqual(Object.keys(input),['goal','dailyTargetCalories','mealTemplate','filteredFoodPools']);
  assert.equal(input.dailyTargetCalories,1650);
  assert.deepEqual(input.filteredFoodPools.find(pool=>pool.slot==='staple').foods,{best:['燕麦粥'],secondary:['全麦面包']});
  assert.ok(!JSON.stringify(input).includes('mealTags'));
  assert.ok(renderMealPlanPrompt(template,foods,1650).includes('只能从filteredFoodPools中选择食物'));
});

test('valid AI plan converts to internal plan and marks AI selections',()=>{
  const plan=parseAiMealPlan(valid(),template,foods);
  assert.equal(plan.days.length,7);
  assert.equal(plan.generatedBy,'ai');
  assert.ok(plan.days.every(day=>day.meals[0].items.every(item=>item.aiSelected)));
});

test('AI plan rejects hallucinations, tier changes and template changes',()=>{
  const hallucinated=valid();hallucinated.days[0].meals[0].items[0].foodName='模型编造的饭';
  assert.throws(()=>parseAiMealPlan(hallucinated,template,foods),/候选池外/);
  const wrongTier=valid();wrongTier.days[0].meals[0].items[0].source='secondary';
  assert.throws(()=>parseAiMealPlan(wrongTier,template,foods),/推荐等级/);
  const wrongRequired=valid();wrongRequired.days[0].meals[0].items[0].required=false;
  assert.throws(()=>parseAiMealPlan(wrongRequired,template,foods),/必选属性/);
  const missing=valid();missing.days[0].meals[0].items=missing.days[0].meals[0].items.filter(item=>item.slot!=='protein');
  assert.throws(()=>parseAiMealPlan(missing,template,foods),/缺少必选槽位/);
  const duplicate=valid();duplicate.days[0].meals[0].items.push({...duplicate.days[0].meals[0].items[0]});
  assert.throws(()=>parseAiMealPlan(duplicate,template,foods),/重复槽位/);
});
