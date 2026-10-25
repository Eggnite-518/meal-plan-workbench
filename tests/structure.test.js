import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultTemplate,sampleBundle,applyCurrentStructure,migrateSavedWorkbench,clone,validateBundleTemplate} from '../src/workbench-model.js';
import {getSlots} from '../src/engine.js';

const expected=[
  ['staple,protein,fruit|fat','staple,protein,vegetable|fruit','protein,vegetable|staple,fat'],
  ['staple,protein|fruit,fat','staple,protein,vegetable,fruit|','protein,vegetable|staple'],
  ['protein,fruit,fat|staple','staple,protein,vegetable|','staple,protein,vegetable|'],
  ['staple,protein,fruit|fat','staple,protein,vegetable|fruit','protein,vegetable|fruit,staple'],
  ['staple,protein|fruit,fat','staple,protein,vegetable,fruit|','protein,vegetable,fat|staple'],
  ['staple,protein,fruit|','staple,protein,vegetable|','staple,protein,vegetable|fruit'],
  ['protein,fruit,fat|staple','staple,protein,vegetable,fruit|','protein,vegetable|staple'],
];
test('all 21 meals match the supplied seven-day required/optional structure',()=>{
  const t=defaultTemplate();validateBundleTemplate(t);
  assert.deepEqual(t.days.map(d=>d.meals.map(m=>`${m.required.join(',')}|${m.optional.join(',')}`)),expected);
  assert.deepEqual(getSlots(t),['staple','protein','fruit','fat','vegetable']);
  assert.deepEqual(t.meals,t.days[0].meals);
  assert.ok(sampleBundle().foods.every(f=>getSlots(t).includes(f.slot)));
});

test('explicit structure update retains settings and five-slot data with a recoverable backup',()=>{
  const b=sampleBundle();b.template.name='我的计划';b.template.macroRatio={protein:30,fat:30,carbs:40};
  b.candidates.slotFoods.push({slot:'compositeStaple',foods:['三明治']});
  b.foods.push({id:'old',slot:'compositeStaple',name:'三明治'});
  const original=clone(b),updated=applyCurrentStructure(b);
  assert.deepEqual(b,original);
  assert.deepEqual(updated.previousTemplate, {template:b.template,candidates:b.candidates,foods:b.foods});
  assert.equal(updated.template.name,'我的计划');
  assert.deepEqual(updated.template.macroRatio,b.template.macroRatio);
  assert.ok(updated.foods.every(f=>f.slot!=='compositeStaple'));
  assert.ok(updated.candidates.slotFoods.every(r=>r.slot!=='compositeStaple'));
  assert.equal(migrateSavedWorkbench({bundle:updated}).bundle,updated);
  assert.equal(migrateSavedWorkbench(null),null);
});

test('legacy saved default upgrades without deleting approved versions or prompt settings',()=>{
  const legacy=[
    ['staple,protein|fruit','staple,meatDish,vegetable|fat','protein,vegDish|staple,fruit'],
    ['compositeStaple|fruit,protein','staple,protein,vegDish|fruit','staple,meatDish,vegetable|fat'],
    ['staple,protein,fruit|fat','compositeStaple,vegetable|protein','protein,vegDish|staple,fruit'],
    ['staple,protein|fruit','staple,meatDish,vegDish|fruit','compositeStaple,vegetable|protein'],
    ['compositeStaple|protein,fruit','staple,protein,vegetable|fat','staple,meatDish,vegDish|fruit'],
    ['staple,protein,fruit|','compositeStaple,vegetable|protein','protein,vegDish|staple,fat'],
    ['staple,protein|fruit,fat','staple,meatDish,vegetable|fruit','staple,protein,vegDish|fat'],
  ];
  const b=sampleBundle();delete b.template.structureVersion;
  b.template.days=legacy.map((rows,i)=>({day:i+1,meals:rows.map((text,j)=>{
    const [required,optional]=text.split('|');
    return {...b.template.meals[j],required:required.split(','),optional:optional?optional.split(','):[]};
  })}));
  b.template.meals=clone(b.template.days[0].meals);
  b.candidates.slotFoods.push({slot:'compositeStaple',foods:['三明治']});
  const saved={bundle:b,test:{old:true},releases:[{releaseId:'old'}],candidateCount:5,candidatePromptTemplate:'custom',libraryRows:[{slot:'staple'},{slot:'compositeStaple'}]};
  const upgraded=migrateSavedWorkbench(saved);
  assert.deepEqual(upgraded.bundle.template.days,defaultTemplate().days);
  assert.equal(upgraded.test,null);
  assert.deepEqual(upgraded.releases,saved.releases);
  assert.equal(upgraded.candidateCount,5);
  assert.equal(upgraded.candidatePromptTemplate,'custom');
  assert.deepEqual(upgraded.libraryRows,[{slot:'staple'}]);
  assert.deepEqual(upgraded.bundle.previousTemplate.template,b.template);
  const custom=clone(saved);custom.bundle.template.days[0].meals[0].optional=[];
  assert.equal(migrateSavedWorkbench(custom),custom);
});
