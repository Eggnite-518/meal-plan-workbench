import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeLibraryFoods,mergeEnrichmentBatch,runEnrichmentBatches,needsEnrichment,needsNutrition,missingFoodFields,enrichmentQueue,autoConfirmFoods} from '../src/enrichment.js';
import {enrichmentPrompt,sampleBundle} from '../src/workbench-model.js';

const pending=(name='米饭',id='matched_1')=>({id,name,slot:'staple',preference:'best',dataSource:'pending',nutritionPer100g:null,ingredients:[],allergens:[],portions:[],tags:[],mealTypes:[],tagsReviewed:false});
const patch=f=>({...f,nutritionPer100g:{calories:120,protein:3,fat:1,carbs:24},nutritionReference:'测试估算',ingredients:['米'],allergens:[],portions:[{grams:100,label:'测试100克'}],tags:[],mealTags:['午餐','晚餐']});
const rows=(name='米饭')=>[{queryName:name,slot:'staple',preference:'best',selectedId:'rice',options:[{id:'rice',name,unit:'gram',weight:100,calorie:130,nutrition:{protein:3,fat:2,carbohydrate:25},showUnits:[{type:'custom',name:'碗',weight:150}]}]}];

test('nutrition and metadata queues are disjoint; default task requests only missing nutrition',async()=>{
  const full=patch(pending('完整','a'));
  const metadata={...patch(pending('有营养缺餐次','b')),mealTypes:[],ingredients:[]};
  const foods=[full,metadata,pending('缺营养','c')];
  assert.equal(needsNutrition(metadata),false);
  assert.deepEqual(missingFoodFields(metadata),['配料']);
  assert.deepEqual(enrichmentQueue(foods).map(f=>f.name),['缺营养']);
  assert.deepEqual(enrichmentQueue(foods,'metadata').map(f=>f.name),['有营养缺餐次']);
  const requested=[];
  const report=await runEnrichmentBatches(enrichmentQueue(foods),{request:async batch=>{requested.push(...batch.map(f=>f.name));return {foods:batch.map(patch)};}});
  assert.equal(report.total,1);
  assert.deepEqual(requested,['缺营养']);
});

test('complete unreviewed foods and valid empty tags do not need enrichment',()=>{
  const food=patch(pending());
  assert.equal(food.tagsReviewed,false);
  assert.equal(needsEnrichment(food),false);
  for(const field of ['ingredients','portions']) {
    assert.equal(needsEnrichment({...food,[field]:[]}),true,field);
  }
  for(const field of ['tags','allergens']) {
    assert.equal(needsEnrichment({...food,[field]:undefined}),true,field);
  }
  assert.equal(needsEnrichment({...food,nutritionPer100g:{calories:120}}),true);
  const {mealTypes,...withoutMeals}=food;
  assert.equal(needsEnrichment(withoutMeals),false);
  assert.deepEqual(autoConfirmFoods([food])[0].mealTags,['午餐','晚餐']);
});

test('only incomplete foods are requested and a completed rerun makes no AI calls',async()=>{
  let foods=[patch(pending('已完整','a')),pending('缺信息','b')];
  const requested=[];
  const options={request:async batch=>{requested.push(batch.map(f=>f.name));return {foods:batch.map(patch)};},
    onBatch:(snapshot,payload)=>{foods=mergeEnrichmentBatch(foods,snapshot,payload);}};
  const first=await runEnrichmentBatches(foods,options);
  assert.deepEqual(requested,[['缺信息']]);
  assert.equal(first.total,1);
  const second=await runEnrichmentBatches(foods,options);
  assert.equal(second.total,0);
  assert.equal(requested.length,1);
});

test('AI finishing after library query preserves database nutrition and units',()=>{
  const snapshot=[pending()];
  const fromLibrary=mergeLibraryFoods(snapshot,rows()).foods;
  const result=mergeEnrichmentBatch(fromLibrary,snapshot,{foods:snapshot.map(patch)});
  assert.equal(result[0].nutritionPer100g.calories,130);
  assert.equal(result[0].dataSource,'real_library');
  assert.equal(result[0].portions[0].grams,150);
  assert.equal(result[0].tagsReviewed,true);
});

test('library query finishing after AI preserves supplemented metadata and upgrades nutrition',()=>{
  const snapshot=[pending()];
  const enriched=mergeEnrichmentBatch(snapshot,snapshot,{foods:snapshot.map(patch)});
  const result=mergeLibraryFoods(enriched,rows()).foods;
  assert.equal(result[0].nutritionPer100g.calories,130);
  assert.equal(result[0].nutritionReference,undefined);
  assert.equal(result[0].supplementSource,'ai_supplement');
  assert.deepEqual(result[0].ingredients,['米']);
  assert.equal(needsEnrichment(result[0]),false);
  assert.equal(result[0].tagsReviewed,true);
  const missing=mergeLibraryFoods(result,[{...rows()[0],options:[],selectedId:''}]).foods;
  assert.equal(missing[0].nutritionPer100g.calories,130);
});

test('saved complete foods auto-confirm without AI, while unresolved records stay incomplete',()=>{
  const saved=[patch(pending()),pending('待补齐','b')];
  const result=autoConfirmFoods(saved);
  assert.equal(result[0].tagsReviewed,true);
  assert.equal(result[1].tagsReviewed,false);
  assert.equal(saved[0].tagsReviewed,false);
  assert.deepEqual(autoConfirmFoods(result),result);
});

test('AI unresolved portions are not auto-confirmed',()=>{
  const snapshot=[pending()];
  const result=mergeEnrichmentBatch(snapshot,snapshot,{foods:[{...patch(snapshot[0]),portions:[]}]});
  assert.equal(result[0].tagsReviewed,false);
  assert.equal(needsEnrichment(result[0]),true);
});

test('late AI results preserve newly added foods, current metadata and recommendation tier',()=>{
  const snapshot=[pending()];
  const current=[{...snapshot[0],preference:'secondary',portions:[{grams:200,label:'人工200克'}]},pending('面条','matched_2')];
  const result=mergeEnrichmentBatch(current,snapshot,{foods:snapshot.map(patch)});
  assert.equal(result.length,2);assert.equal(result[0].preference,'secondary');
  assert.equal(result[0].portions[0].grams,200);assert.equal(result[1].name,'面条');
});

test('enrichment reports actual completed counts and saves each completed batch before failure',async()=>{
  const foods=Array.from({length:5},(_,i)=>pending(`测试${i}`,`id${i}`));
  const progress=[],saved=[];let calls=0;
  await assert.rejects(runEnrichmentBatches(foods,{batchSize:2,
    request:async batch=>{if(++calls===2)throw new Error('测试中断');return {foods:batch.map(patch)};},
    onProgress:p=>progress.push(p),onBatch:batch=>saved.push(batch),
  }),/测试中断/);
  assert.equal(saved.length,1);assert.equal(progress[1].completed,2);
  assert.equal(progress[2].batchNumber,2);assert.equal(progress[2].totalBatches,3);
});

test('pausing enrichment keeps finished batches and does not start another',async()=>{
  const abort=new AbortController();let calls=0;
  const foods=[pending('a','a'),pending('b','b')];
  const report=await runEnrichmentBatches(foods,{batchSize:1,signal:abort.signal,
    request:async batch=>{calls++;return {foods:batch.map(patch)};},onBatch:()=>abort.abort(),
  });
  assert.equal(calls,1);assert.equal(report.completed,1);
});

test('tag and portion tasks work independently even before nutrition is available',async()=>{
  let foods=[{...pending(),tagsComplete:false}];
  const identity=f=>({id:f.id,slot:f.slot,name:f.name});
  const tagRequest=async batch=>[{slot:'staple',foods:{best:batch.map(f=>({foodName:f.name,allergenTags:[],avoidanceTags:[],mealTags:['午餐','晚餐']})),secondary:[]}}];
  await runEnrichmentBatches(foods,{scope:'tags',request:tagRequest,onBatch:(snapshot,payload)=>{foods=mergeEnrichmentBatch(foods,snapshot,payload,'tags');}});
  assert.equal(enrichmentQueue(foods,'tags').length,0);
  assert.equal(enrichmentQueue(foods,'portions').length,1);
  assert.equal(needsNutrition(foods[0]),true);
  assert.deepEqual(foods[0].portions,[]);
  let calls=0;
  await runEnrichmentBatches(foods,{scope:'tags',request:async()=>{calls++;}});
  assert.equal(calls,0);
  await runEnrichmentBatches(foods,{scope:'portions',request:async batch=>({foods:batch.map(f=>({...identity(f),portions:[{grams:150,label:'1碗150克'}]}))}),onBatch:(snapshot,payload)=>{foods=mergeEnrichmentBatch(foods,snapshot,payload,'portions');}});
  assert.equal(enrichmentQueue(foods,'portions').length,0);
  assert.equal(foods[0].tagsComplete,true);
  assert.equal(needsNutrition(foods[0]),true);
  assert.equal(foods[0].portions[0].grams,150);
});

test('tag enrichment sends the full pending food list in one request',async()=>{
  const foods=[
    {...pending(),id:'staple-best',name:'燕麦粥',slot:'staple',preference:'best',tagsComplete:false},
    {...pending(),id:'staple-secondary',name:'荞麦粥',slot:'staple',preference:'secondary',tagsComplete:false},
    {...pending(),id:'protein-best',name:'水煮鸡蛋',slot:'protein',preference:'best',tagsComplete:false},
  ];
  const batches=[];
  await runEnrichmentBatches(foods,{scope:'tags',batchSize:20,
    request:async batch=>{
      batches.push(batch.map(f=>`${f.slot}|${f.preference||'best'}|${f.name}`));
      return [
        {slot:'staple',foods:{
          best:[{foodName:'燕麦粥',allergenTags:[],avoidanceTags:[],mealTags:['早餐']}],
          secondary:[{foodName:'荞麦粥',allergenTags:[],avoidanceTags:[],mealTags:['早餐']}],
        }},
        {slot:'protein',foods:{
          best:[{foodName:'水煮鸡蛋',allergenTags:[],avoidanceTags:[],mealTags:['早餐']}],
          secondary:[],
        }},
      ];
    },
  });
  assert.deepEqual(batches,[
    ['staple|best|燕麦粥','staple|secondary|荞麦粥','protein|best|水煮鸡蛋'],
  ]);
});

test('scoped tasks reject cross-step fields and preserve existing data',()=>{
  const food={...patch(pending()),dataSource:'real_library',tagsComplete:false};
  const identity={id:food.id,name:food.name,slot:food.slot};
  assert.throws(()=>mergeEnrichmentBatch([food],[food],{foods:[{...identity,tags:[],ingredients:['米'],allergens:[],portions:[]}]},'tags'),/结构/);
  assert.throws(()=>mergeEnrichmentBatch([food],[food],{foods:[{...identity,portions:[],tags:[]}]},'portions'),/其他步骤字段/);
  const tagged=mergeEnrichmentBatch([food],[food],[{slot:'staple',foods:{best:[{foodName:food.name,allergenTags:[],avoidanceTags:[],mealTags:['午餐','晚餐']}],secondary:[]}}],'tags')[0];
  assert.deepEqual(tagged.nutritionPer100g,food.nutritionPer100g);
  assert.deepEqual(tagged.portions,food.portions);
  assert.equal(tagged.tagsComplete,true);
  assert.equal(enrichmentQueue(JSON.parse(JSON.stringify([tagged])),'tags').length,0);
  const tagPrompt=enrichmentPrompt(sampleBundle().template,sampleBundle().candidates,[food],'tags');
  assert.match(tagPrompt,/候选食物过敏原、忌口与餐次标签标注大师/);
  assert.doesNotMatch(tagPrompt,/\$\{testContent\}/);
  for(const scope of ['portions']){
    const prompt=enrichmentPrompt(sampleBundle().template,{},[food],scope);
    const records=JSON.parse(prompt.match(/待处理记录：(.*)\n/)[1]);
    assert.equal(records[0].nutritionPer100g,undefined);
    assert.equal(records[0][scope==='tags'?'portions':'tags'],undefined);
  }
});
