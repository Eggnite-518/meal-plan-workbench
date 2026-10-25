import test from 'node:test';
import assert from 'node:assert/strict';
import {searchFoods,uniqueExact,matchExactRow,adaptRealMatches,FOOD_ENDPOINT,normalizeFoodCookie} from '../src/real-library.js';
const rice={id:'rice',name:'米饭',unit:'gram',weight:100,calorie:'116',nutrition:{protein:'2.6',fat:'0.3',carbohydrate:'25.9'},showUnits:[{type:'gram',weight:1},{type:'custom',name:'小碗',weight:'150'}]};
test('exact matching auto-selects identical names without fuzzy substitutions',()=>{
  const row={queryName:'米饭',options:[],selectedId:'',status:'pending'};
  assert.equal(matchExactRow(row,[rice]).selectionSource,'exact');
  assert.equal(matchExactRow(row,[rice]).selectedId,'rice');
  assert.equal(matchExactRow({...row,queryName:'熟米饭'},[rice]).status,'unmatched');
  assert.equal(uniqueExact([rice,{...rice}],'米饭'),'rice');
  assert.equal(uniqueExact([{id:'milk',name:'Milk'}],' milk '),'milk');
  assert.equal(matchExactRow(row,[rice,{...rice,id:'other'}]).exactCount,2);
  assert.equal(matchExactRow(row,[rice,{...rice,id:'other'}]).selectedId,'rice');
});
test('expanded results re-evaluate exact names and preserve explicit manual choices',()=>{
  const other={...rice,id:'other',name:'熟米饭'};
  const row={queryName:'米饭',options:[other],selectedId:'',status:'unmatched'};
  assert.equal(matchExactRow(row,[other,rice],true).selectedId,'rice');
  const automatic=matchExactRow(row,[rice]);
  assert.equal(matchExactRow(automatic,[rice,{...rice,id:'second'}],true).selectedId,'rice');
  const manual={...row,selectedId:'other',selectionSource:'manual'};
  assert.equal(matchExactRow(manual,[other,rice],true).selectedId,'other');
  assert.equal(matchExactRow(manual,[other,rice],true).selectionSource,'manual');
  assert.equal(matchExactRow(manual,[other,rice]).selectedId,'rice');
});
test('real search uses fixed endpoint and whitelists fields',async()=>{
  const result=await searchFoods('米饭','session=test-cookie',1,async(url,options)=>{
    assert.equal(url,FOOD_ENDPOINT);assert.equal(options.headers.Cookie,'session=test-cookie');
    assert.deepEqual(JSON.parse(options.body),{page:1,limit:10,query:'米饭'});
    return {ok:true,status:200,json:async()=>({success:true,data:{foods:[{...rice,secret:'not relayed'}],total:10}})};
  });
  assert.equal(result.foods[0].secret,undefined);
  assert.equal(uniqueExact(result.foods,'米饭'),'rice');
  assert.equal(uniqueExact([rice,{...rice,id:'other'}],'米饭'),'');
  assert.equal(uniqueExact([rice],'白米饭'),'');
});
test('real record keeps database calories and never invents portions or allergens',()=>{
  const row={slot:'staple',queryName:'米饭',selectedId:'rice',options:[rice]};
  const adapted=adaptRealMatches([row]);
  assert.equal(adapted.foods[0].nutritionPer100g.calories,116);
  assert.equal(adapted.foods[0].portions.length,1);
  assert.deepEqual(adapted.foods[0].ingredients,[]);
  assert.equal(adapted.foods[0].safetyVerified,false);
  const noUnits={...row,options:[{...rice,showUnits:[]}]};
  assert.throws(()=>adaptRealMatches([noUnits]),/没有可执行份量/);
  assert.equal(adaptRealMatches([{...noUnits,portionText:'50,100'}]).foods[0].portions.length,2);
});
test('auth failures do not echo upstream response',async()=>{
  await assert.rejects(searchFoods('米饭','session=test',1,async()=>({ok:false,status:401})),/登录失效/);
  await assert.rejects(searchFoods('米饭','session=test',1,async(url,options)=>{assert.equal(options.redirect,'manual');return {ok:false,status:302};}),/要求重新登录/);
});
test('cookie accepts raw JWT and header prefix but rejects malformed input',()=>{
  assert.equal(normalizeFoodCookie('aaa.bbb.ccc'),'JIKE-AUTH-JWT=aaa.bbb.ccc');
  assert.equal(normalizeFoodCookie('Cookie: JIKE-AUTH-JWT=abc'),'JIKE-AUTH-JWT=abc');
  assert.throws(()=>normalizeFoodCookie('JIKE-AUTH-JWT=…'),/完整 Cookie/);
  assert.throws(()=>normalizeFoodCookie('a=b\nc=d'),/完整 Cookie/);
});
