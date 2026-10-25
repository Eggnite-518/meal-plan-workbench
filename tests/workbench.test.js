import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compose,validatePlan,solvePlan,getMeals,getSlots,SLOT_NAMES} from '../src/engine.js';
import {sampleBundle,profileFor,rulesFor,filterPool,validatePool,normalizeCandidates,validateBundleTemplate,fingerprint,approveBundle,matchRelease,clone,candidatePrompt,matchingRows,confirmLibraryMatches,mergeFoodSupplements,enrichmentPrompt} from '../src/workbench-model.js';

const user={goal:'fatLoss',mealCount:3,habit:'regular',training:2,calories:1650,blockedTags:[],avoids:''};
const record={id:'db_rice',name:'米饭',unit:'gram',weight:200,calorie:232,nutrition:{protein:5.2,fat:.6,carbohydrate:51.2},showUnits:[]};
test('library matching preserves nutrition before AI fills only missing metadata',()=>{
  const rows=matchingRows({slotFoods:[{slot:'staple',foods:['熟米饭','未知食物']}]});
  rows[0]={...rows[0],options:[record],selectedId:'db_rice'};
  const {foods,issues}=confirmLibraryMatches(rows);
  assert.equal(foods.length,1);assert.equal(issues.length,1);
  assert.equal(foods[0].name,'熟米饭');assert.equal(foods[0].libraryRecord.name,'米饭');
  assert.equal(foods[0].nutritionPer100g.calories,116);assert.equal(foods[0].nutritionPer100g.protein,2.6);
  assert.deepEqual(foods[0].portions,[]);
  const patch={...foods[0],nutritionPer100g:{calories:999},dataSource:'ai_estimate',ingredients:['大米'],allergens:[],tags:[],mealTags:['午餐','晚餐'],portions:[{grams:150,label:'小碗150克'}]};
  const merged=mergeFoodSupplements(foods,{foods:[patch]});
  assert.deepEqual(merged[0].nutritionPer100g,foods[0].nutritionPer100g);
  assert.deepEqual(merged[0].libraryRecord,record);
  assert.equal(merged[0].dataSource,'real_library');assert.equal(merged[0].tagsReviewed,true);
  assert.equal(merged[0].portions[0].grams,150);
  const fixed={...foods[0],ingredients:['糙米'],allergens:[],portions:[{grams:200,label:'库中1碗'}]};
  const kept=mergeFoodSupplements([fixed],{foods:[patch]})[0];
  assert.deepEqual(kept.portions,fixed.portions);assert.deepEqual(kept.ingredients,fixed.ingredients);
  assert.throws(()=>mergeFoodSupplements(foods,{foods:[]}),/覆盖/);
  assert.throws(()=>mergeFoodSupplements(foods,{foods:[{...patch,id:'wrong'}]}),/不一致/);
  assert.throws(()=>confirmLibraryMatches([{...rows[0],options:[{...record,calorie:''}]}]),/没有可确认/);
  const prompt=enrichmentPrompt(sampleBundle().template,{slotFoods:[]},foods);
  assert.match(prompt,/禁止输出或修改nutritionPer100g/);assert.match(prompt,/未匹配候选不参与本步/);
});
test('candidate prompt includes region, plan context and tiered JSON contract',()=>{
  const prompt=candidatePrompt(sampleBundle().template,'中国大陆',{目的:'减脂',运动习惯:'规律运动',饮食策略:'日常饮食'});
  assert.match(prompt,/中国大陆/);
  assert.match(prompt,/planDescription/);
  assert.match(prompt,/slotConstraints/);
  assert.match(prompt,/best/);
  assert.match(prompt,/secondary/);
  assert.match(prompt,/fruit槽位以10至20种/);
});
test('food meal tags are required and determine shortages and plan validation',()=>{
  const b=sampleBundle();
  b.foods=b.foods.map(({mealTags,...food})=>food);
  assert.throws(()=>validatePool(b,true),/餐次标签/);
  const food=b.foods[0];
  const supplemented=mergeFoodSupplements([food],{foods:[food]});
  assert.equal(supplemented[0].mealTypes,undefined);
  const prompt=enrichmentPrompt(b.template,b.candidates,[food]);
  assert.doesNotMatch(prompt,/"mealTypes"\s*:/);
  b.foods=b.foods.map(f=>({...f,mealTags:['早餐']}));
  const filtered=filterPool(b,{habit:'regular',blockedTags:[],avoids:''});
  assert.ok(filtered.shortages.some(s=>s.meal==='午餐'&&s.required));
  const p=profileFor(b.template,user),rules=rulesFor(b.template);
  assert.throws(()=>compose(p,b.template,filtered.foods,rules),/没有适用候选/);
});
test('seven-day template slots survive compose and retries without food meal restrictions',async()=>{
  const b=sampleBundle();validatePool(b,true);
  const p=profileFor(b.template,user),rules=rulesFor(b.template),plan=compose(p,b.template,b.foods,rules);
  assert.notDeepEqual(getMeals(b.template,1),getMeals(b.template,2));
  validatePlan(plan,p,b.template,b.foods);
  for(const day of plan.days)for(const m of day.meals){
    const mt=getMeals(b.template,day.day).find(row=>row.id===m.id);
    assert.deepEqual(m.items.filter(i=>!i.optional).map(i=>i.slot),mt.required);
    for(const item of m.items)assert.equal(b.foods.find(f=>f.id===item.foodId).slot,item.slot);
  }
  const result=await solvePlan(p,b.template,b.foods,plan,rules);
  assert.equal(result.summary.passed,7);
  for(const day of result.days){
    assert.ok(day.checks.every(c=>c.pass));
    for(const m of day.meals){
      const mt=getMeals(b.template,day.day).find(row=>row.id===m.id);
      assert.ok(mt.required.every(slot=>m.items.some(i=>i.slot===slot)));
      for(const item of m.items){
        const food=b.foods.find(f=>f.id===item.foodId);
        assert.ok(food.portions.some(p=>p.grams===item.grams));
      }
    }
  }
  const report={fingerprint:fingerprint(b),result};
  const release=approveBundle(b,report,[]);
  assert.equal(release.version,1);
  assert.equal(approveBundle(b,report,[release]).version,2);
  assert.equal(matchRelease([release],user).releaseId,release.releaseId);
  assert.equal(matchRelease([release],{...user,mealCount:2}),null);
  assert.equal(matchRelease([release],{...user,habit:'vegetarian'}),null);
  const changed=clone(b);changed.foods[0].portions[0].grams++;
  assert.throws(()=>approveBundle(changed,report,[]),/测试/);
  changed.foods[0].tagsReviewed=false;
  assert.throws(()=>approveBundle(changed,report,[]),/尚未确认/);
  assert.equal(fingerprint({...b,notes:'review note'}),fingerprint(b));
});
test('tag filtering handles food exclusions, unknown tags and shortages',()=>{
  const b=sampleBundle();
  const result=filterPool(b,{...user,blockedTags:['wheat','milk']});
  assert.ok(result.excluded.some(f=>f.id==='bread'));
  assert.ok(result.excluded.some(f=>f.id==='milk'));
  assert.ok(result.foods.every(f=>!f.tags.includes('wheat')&&!f.tags.includes('milk')));
  b.foods.find(f=>f.id==='rice').tagsReviewed=false;
  assert.ok(filterPool(b,{...user,blockedTags:['milk']}).excluded.some(f=>f.id==='rice'));
  const denied=filterPool(b,{...user,avoids:b.foods.map(f=>f.name).join(',')});
  assert.ok(denied.shortages.some(s=>s.required));
  const noFruit=filterPool(sampleBundle(),{...user,avoids:'苹果,橙子,草莓,香蕉'});
  assert.ok(noFruit.shortages.some(s=>s.slot==='fruit'&&s.required));
});
test('candidate contract rejects counts, duplicate foods and pool mismatch',()=>{
  const b=sampleBundle();
  assert.equal(normalizeCandidates(b.candidates,b.template).slotFoods.length,getSlots(b.template).length);
  assert.throws(()=>normalizeCandidates(b.candidates,b.template,15),/15/);
  const duplicate=clone(b.candidates);duplicate.slotFoods[0].foods.push(duplicate.slotFoods[0].foods[0]);
  assert.throws(()=>normalizeCandidates(duplicate,b.template),/重复/);
  const broken=clone(b);const missing=broken.foods.pop();assert.throws(()=>validatePool(broken),error=>error.message.includes('尚未关联食物数据')&&error.message.includes(missing.name));
  const invalid=clone(b.template);invalid.days[3].meals[0].share=.8;
  assert.throws(()=>validateBundleTemplate(invalid),/合计/);
});
test('Chinese slot names with prompt metadata normalize to internal IDs',()=>{
  const b=sampleBundle();
  const input={status:'OK',goal:'fat_loss',planName:'均衡膳食减脂餐',slotFoods:b.candidates.slotFoods.map(row=>({slot:SLOT_NAMES[row.slot],foods:Array.from({length:15},(_,i)=>`${row.slot}食物${i+1}`)}))};
  const normalized=normalizeCandidates(input,b.template,15);
  assert.deepEqual(normalized.slotFoods.map(r=>r.slot),getSlots(b.template));
  assert.equal(normalized.slotFoods.flatMap(r=>r.foods).length,75);
  assert.deepEqual(normalizeCandidates(normalized,b.template,15),normalized);
  input.slotFoods[0].slot='未知分类';
  assert.throws(()=>normalizeCandidates(input,b.template),/无法识别槽位“未知分类”/);
  const duplicate=clone(b.candidates);
  duplicate.slotFoods[1].slot=SLOT_NAMES[duplicate.slotFoods[0].slot];
  assert.throws(()=>normalizeCandidates(duplicate,b.template),/重复/);
});
