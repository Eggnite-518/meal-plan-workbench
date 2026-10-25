import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROFILE,getTemplate,buildPrompt,validateFoods} from '../src/engine.js';
import {adaptMatches, validateCandidates, groupCandidates} from '../src/food-library.js';
test('candidate prompt contains no calorie, ratio or database output schema',()=>{
  const text=buildPrompt(DEFAULT_PROFILE,getTemplate(DEFAULT_PROFILE),5);
  for(const word of ['1650','macroRatio','nutritionPer100g','showUnits','"goal"']) assert.ok(!text.includes(word));
  assert.ok(text.includes('食物名称数组'));
});
test('grouped candidates and old flat candidates normalize identically',()=>{
  const t={meals:[{id:'a',share:.5,required:['staple'],optional:[]},{id:'b',share:.5,required:['staple'],optional:[]}]};
  const grouped={staple:['馒头','花卷','白粥','小米粥']};
  const flat=validateCandidates(grouped,t);
  assert.deepEqual(groupCandidates(flat),grouped);
  assert.deepEqual(validateCandidates(flat,t),flat);
  assert.throws(()=>validateCandidates({stable:['馒头']},t));
  assert.throws(()=>validateCandidates({staple:['馒头','馒头']},t),/重复/);
});
test('library adapter preserves supplied calories and numeric strings, using weight basis',()=>{
  const candidates={foods:[{slot:'staple',name:'米饭'}]};
  const record={slot:'staple',queryName:'米饭',status:'simulated',food:{id:'sim_rice',name:'米饭',source:'simulation',unit:'gram',weight:100,calorie:'116',nutrition:{protein:'2.6',fat:'0.3',carbohydrate:'25.9'},showUnits:[{type:'gram',name:'克',weight:1},{type:'custom',name:'碗（小）',weight:'150'},{type:'custom',name:'碗（中）',weight:'250'}]},simulationIngredients:['大米'],simulationAllergens:[]};
  const adapted=adaptMatches({matches:[record]},candidates);
  assert.equal(adapted.foods[0].nutritionPer100g.calories,116);
  assert.deepEqual(adapted.foods[0].portions.map(p=>p.grams),[150,250]);
  const template={meals:[{id:'a',share:.5,required:['staple'],optional:[]},{id:'b',share:.5,required:['staple'],optional:[]}]};
  const checked=validateFoods(adapted,template,DEFAULT_PROFILE);
  assert.equal(checked.foods[0].nutritionPer100g.calories,116);
  assert.equal(checked.foods[0].dataSource,'simulated_library');
  assert.throws(()=>adaptMatches({matches:[record,record]},candidates),/重复/);
  const partial=adaptMatches({matches:[record]},{foods:[{slot:'staple',name:'米饭'},{slot:'staple',name:'馒头'}]});
  assert.deepEqual(partial.unmatched,['馒头（未返回匹配记录）']);
});
