import test from 'node:test';
import assert from 'node:assert/strict';
import {CREDENTIALS_KEY,publicConfig,readCredentials,saveCredentials,compactMatches,restoreMatches,needsLibraryQuery,cacheLibraryMatches,applyLibraryCache} from '../src/workbench-storage.js';
import {blankBundle,matchingRows} from '../src/workbench-model.js';

function memoryStorage() {
  const entries = new Map();
  return {getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
}

test('credentials persist only after opt-in, independently, and clear on opt-out',()=>{
  const storage=memoryStorage(), values={apiKey:'fake-api-test',cookie:'fake-cookie-test'};
  saveCredentials(storage,{...values,rememberApi:false,rememberCookie:false});
  assert.equal(storage.getItem(CREDENTIALS_KEY),null);
  saveCredentials(storage,{...values,rememberApi:false,rememberCookie:true});
  assert.equal(readCredentials(storage).cookie,values.cookie);
  assert.equal(readCredentials(storage).apiKey,'');
  assert.ok(!storage.getItem(CREDENTIALS_KEY).includes(values.apiKey));
  saveCredentials(storage,{...values,rememberApi:true,rememberCookie:true});
  assert.equal(readCredentials(storage).apiKey,values.apiKey);
  saveCredentials(storage,{...values,cookie:'',rememberApi:true,rememberCookie:false});
  assert.equal(readCredentials(storage).cookie,'');
  saveCredentials(storage,{...values,rememberApi:false,rememberCookie:false});
  assert.equal(storage.getItem(CREDENTIALS_KEY),null);
  storage.setItem(CREDENTIALS_KEY,'invalid JSON');
  assert.equal(readCredentials(storage).rememberApi,false);
});

test('public model settings never include API keys or cookies',()=>{
  const config={provider:'custom',baseUrl:'https://example.com',model:'test-model',maxTokens:8000,jsonMode:true,apiKey:'secret',cookie:'secret'};
  assert.deepEqual(publicConfig(config),{provider:'custom',baseUrl:'https://example.com',model:'test-model',maxTokens:8000,jsonMode:true});
  assert.deepEqual(publicConfig(),{});
});

test('selected matches and food data survive storage roundtrip without unrelated search pages',()=>{
  const bundle=blankBundle();
  bundle.candidates={slotFoods:[{slot:'staple',foods:['糙米饭','白米饭'],foodGroups:{best:['糙米饭'],secondary:['白米饭']}}]};
  const record={id:'rice',name:'糙米饭',unit:'gram',weight:100,calorie:120};
  bundle.foods=[{slot:'staple',name:'糙米饭',dataSource:'real_library',libraryRecord:record,nutritionPer100g:{calories:120},tagsReviewed:true,portions:[{grams:100,label:'一碗'}]}];
  const rows=matchingRows(bundle.candidates).map((row,i)=>i===0?{...row,options:[record,{id:'other',name:'其他饭'}],selectedId:'rice',status:'exact',page:1}: {...row,status:'unmatched',page:2});
  const saved=JSON.parse(JSON.stringify({bundle,libraryRows:compactMatches(rows)}));
  assert.equal(saved.libraryRows[0].options.length,2);
  const restored=restoreMatches(matchingRows(saved.bundle.candidates,saved.libraryRows),saved.bundle.foods);
  assert.equal(restored[0].selectedId,'rice');
  assert.equal(restored[1].preference,'secondary');
  assert.equal(needsLibraryQuery(restored[0]),false);
  assert.equal(needsLibraryQuery(restored[1]),false);
  assert.equal(needsLibraryQuery({...restored[1],status:'pending',page:0}),true);
  assert.deepEqual(saved.bundle.foods,bundle.foods);
  const recovered=restoreMatches(matchingRows(bundle.candidates),bundle.foods);
  assert.equal(recovered[0].selectedId,'rice');
  assert.equal(needsLibraryQuery(recovered[0]),false);
  assert.equal(needsLibraryQuery(recovered[1]),true);
});

test('successful exact matches are reusable across plans without storing credentials',()=>{
  const record={id:'rice',name:'糙米饭',unit:'gram',weight:100,calorie:120};
  const cache=cacheLibraryMatches({},[{queryName:'糙米饭',options:[record],selectedId:'rice',selectionSource:'exact'}]);
  assert.ok(cache['糙米饭']);
  assert.ok(!JSON.stringify(cache).includes('cookie'));
  const applied=applyLibraryCache([{slot:'staple',queryName:'糙米饭',options:[],selectedId:'',status:'pending'}],cache);
  assert.equal(applied.hits,1);
  assert.equal(applied.rows[0].selectedId,'rice');
  assert.equal(applied.rows[0].selectionSource,'cache');
});
