import test from 'node:test';
import assert from 'node:assert/strict';
import {queryIndices,runLibraryQueries,fastBestIndices,secondaryFallbackIndices,libraryProgressText,libraryResultSummary} from '../src/library-query.js';
import {compactMatches} from '../src/workbench-storage.js';
const row=name=>({queryName:name,searchTerm:name,slot:'staple',options:[],selectedId:'',status:'pending',page:0});
const response=(foods,total=foods.length)=>({ok:true,json:async()=>({foods,total})});

test('continue and retry-unmatched never query already matched foods',()=>{
  const rows=[{...row('a'),options:[{id:'a',name:'a'}],selectedId:'a',status:'exact'},{...row('b'),status:'unmatched',page:1},row('c'),{...row('d'),status:'error',page:2}];
  assert.deepEqual(queryIndices(rows),[2,3]);
  assert.deepEqual(queryIndices(rows,'unmatched'),[1,2,3]);
  assert.deepEqual(queryIndices(rows,'failed'),[3]);
});

test('batch queries are bounded, cache every page and resume at the next page',async()=>{
  const pages=[],snapshots=[];
  const fetcher=async(_,req)=>{const {page}=JSON.parse(req.body);pages.push(page);return response(Array.from({length:10},(_,i)=>({id:`${page}-${i}`,name:'other'})),100);};
  const first=await runLibraryQueries([row('a')],[0],{fetcher,maxPages:2,onUpdate:rows=>snapshots.push(JSON.parse(JSON.stringify(rows)))});
  assert.deepEqual(pages,[1,2]);assert.equal(first.rows[0].status,'partial');assert.equal(snapshots.length,2);
  const saved=compactMatches(first.rows);
  assert.equal(saved[0].options.length,10);
  const next=await runLibraryQueries(saved,[0],{maxPages:1,fetcher:async(_,req)=>{assert.equal(JSON.parse(req.body).page,3);return response([{id:'a',name:'a'}],21);}});
  assert.equal(next.rows[0].selectedId,'a');
});

test('single request timeout does not block remaining foods and preserves completed results',async()=>{
  const fetcher=(_,req)=>JSON.parse(req.body).query==='slow'?new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(Object.assign(new Error('abort'),{name:'AbortError'})),{once:true})):Promise.resolve(response([{id:'fast',name:'fast'}]));
  const report=await runLibraryQueries([row('slow'),row('fast')],[0,1],{fetcher,timeoutMs:10,concurrency:1});
  assert.equal(report.rows[0].status,'error');assert.match(report.rows[0].error,/超时/);assert.equal(report.rows[1].selectedId,'fast');
});

test('cancel retains cached pages and authorization failures stop new queries',async()=>{
  const controller=new AbortController();let calls=0;
  const cancelled=await runLibraryQueries([row('a'),row('b')],[0,1],{concurrency:1,signal:controller.signal,fetcher:async()=>response(Array.from({length:10},(_,i)=>({id:String(i),name:'other'})),50),onUpdate:()=>controller.abort()});
  assert.equal(cancelled.cancelled,true);assert.equal(cancelled.rows[0].page,1);assert.equal(cancelled.rows[0].status,'partial');assert.equal(cancelled.rows[1].page,0);
  const failed=await runLibraryQueries([row('a'),row('b')],[0,1],{concurrency:1,fetcher:async()=>{calls++;return {ok:false,json:async()=>({error:'食物库登录失效或没有权限，请更新 Cookie'})};}});
  assert.equal(calls,1);assert.match(failed.error,/登录失效/);
});

test('fast matching queries Best first and Secondary only for deficient slots',()=>{
  const matched=name=>({...row(name),slot:'staple',preference:'best',options:[{id:name,name}],selectedId:name,status:'exact'});
  const rows=[...Array.from({length:7},(_,i)=>matched(`best-${i}`)),{...row('best-pending'),preference:'best'},{...row('secondary'),preference:'secondary'}];
  assert.deepEqual(fastBestIndices(rows),[7]);
  assert.deepEqual(secondaryFallbackIndices(rows),[8]);
  const enough=[...rows];enough[7]=matched('best-pending');
  assert.deepEqual(secondaryFallbackIndices(enough),[]);
});

test('live progress separates cache-independent matches, no exact names and request failures',async()=>{
  const progress=[],snapshots=[];
  const rows=[row('米饭'),row('老豆腐'),row('失败')];
  await runLibraryQueries(rows,[0,1,2],{concurrency:1,onProgress:p=>progress.push(p),onUpdate:r=>snapshots.push(r),fetcher:async(_,req)=>{
    const {query}=JSON.parse(req.body);
    if(query==='失败')return {ok:false,json:async()=>({error:'食物库查询失败（HTTP 503）'})};
    return response([{id:query,name:query==='老豆腐'?'豆腐':query}]);
  }});
  const last=progress.at(-1);
  assert.deepEqual({completed:last.completed,matched:last.matched,unmatched:last.unmatched,failed:last.failed,active:last.active},{completed:3,matched:1,unmatched:1,failed:1,active:0});
  assert.equal(last.name,undefined);
  assert.match(libraryProgressText(last),/同名匹配 1条.*未同名匹配 1条.*请求失败 1条/);
  assert.equal(snapshots[0][0].selectedId,'米饭');
  assert.ok(progress.some(p=>p.active===1&&p.name==='老豆腐'&&p.matched===1));
});

test('unavailable local backend stops dispatch and remains a failure in the final summary',async()=>{
  let calls=0;
  const report=await runLibraryQueries([row('米饭'),row('豆腐')],[0,1],{concurrency:1,fetcher:async()=>{calls++;throw new TypeError('Failed to fetch');}});
  assert.equal(calls,1);
  assert.equal(report.rows[0].status,'error');
  assert.match(report.error,/无法连接本地查询服务/);
  const summary=libraryResultSummary(report.rows);
  assert.equal(summary.failed,1);assert.equal(summary.pending,1);
  assert.match(summary.error,/本地查询服务/);
  assert.match(summary.text,/查询失败 1条/);
});

test('non-JSON backend responses are not reported as empty food searches',async()=>{
  const report=await runLibraryQueries([row('米饭')],[0],{fetcher:async()=>({ok:false,status:502,json:async()=>{throw new SyntaxError('bad JSON');}})});
  assert.equal(report.rows[0].status,'error');
  assert.match(report.error,/本地查询服务返回异常.*502/);
});
