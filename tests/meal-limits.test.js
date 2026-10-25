import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROFILE,DEFAULT_RULES,validateTemplate,compose,solveDay,closestCalorieDay,checkDay,mealServingSummary} from '../src/engine.js';

const slots=['staple','protein','vegetable','fruit','fat'];
function setup(){
  const p={...DEFAULT_PROFILE,days:1,mealCount:2,calories:800};
  const t={meals:['lunch','dinner'].map(id=>({id,name:id,share:.5,required:slots.slice(0,3),optional:slots.slice(3)}))};
  const foods=slots.map(slot=>({id:slot,name:slot,slot,mealTags:['午餐','晚餐'],portions:[{grams:100,label:'测试100g'}],nutritionPer100g:{calories:100,protein:p.protein/4,fat:p.fat/9,carbs:p.carbs/4}}));
  return {p,t,foods,day:compose(p,t,foods,DEFAULT_RULES).days[0]};
}

test('strict, replacement and approximate integer models enforce at most four nonzero foods',()=>{
  const {p,t,foods,day}=setup();
  assert.equal(day.meals[0].items.length,5);
  for(const mode of ['current','best','all'])for(const approximate of [false,true]){
    const result=solveDay(day,p,t,foods,DEFAULT_RULES,2000,mode,approximate);
    assert.ok(result.meals?.length);
    for(const meal of result.meals){
      assert.ok(meal.items.length<=4);
      assert.ok(t.meals[0].required.every(slot=>meal.items.some(i=>i.slot===slot)));
    }
  }
});

test('emergency search keeps required foods and drops optional items to honor the same cap',()=>{
  const {p,t,foods,day}=setup();
  const result=closestCalorieDay(day,p,t,foods,DEFAULT_RULES,100);
  for(const meal of result.meals){
    assert.equal(meal.items.length,4);
    assert.deepEqual(mealServingSummary(meal),{foodCount:4,totalGrams:400});
    assert.ok(t.meals[0].required.every(slot=>meal.items.some(i=>i.slot===slot)));
  }
  const excessive={...result,meals:result.meals.map(m=>({...m,items:[...m.items,{grams:100,calories:0}]}))};
  assert.ok(checkDay(excessive,p,t,DEFAULT_RULES).checks.some(c=>c.name.endsWith('食物种数')&&!c.pass));
  assert.equal(mealServingSummary({items:[{grams:100},{grams:0}]}).foodCount,1);
});

test('templates cannot require more than four foods in a meal',()=>{
  const {t}=setup();
  t.meals[0]={...t.meals[0],required:slots,optional:[]};
  assert.throws(()=>validateTemplate(t),/必选食物超过4种/);
});
