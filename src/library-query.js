import {matchExactRow} from './real-library.js';

export const hasLibraryMatch = row => Boolean(row.selectedId && row.options?.some(f=>String(f.id||f._id)===row.selectedId));
export function queryIndices(rows,mode='continue') {
  if(mode==='failed')return rows.flatMap((row,i)=>!hasLibraryMatch(row)&&row.status==='error'?[i]:[]);
  return rows.flatMap((row,i)=>mode==='all'||(!hasLibraryMatch(row)&&(mode==='unmatched'||row.status!=='unmatched'||!row.page))?[i]:[]);
}

export const FAST_MATCH_MINIMUMS={staple:8,protein:8,vegetable:8,fruit:5,fat:8};
export const fastBestIndices=rows=>rows.flatMap((row,index)=>row.preference!=='secondary'&&!hasLibraryMatch(row)?[index]:[]);
export function secondaryFallbackIndices(rows,minimums=FAST_MATCH_MINIMUMS) {
  const slots=[...new Set(rows.map(row=>row.slot))],needed=new Set();
  for(const slot of slots) {
    const best=rows.filter(row=>row.slot===slot&&row.preference!=='secondary');
    const target=Math.min(best.length,minimums[slot]??8);
    if(best.filter(hasLibraryMatch).length<target)needed.add(slot);
  }
  return rows.flatMap((row,index)=>row.preference==='secondary'&&needed.has(row.slot)&&!hasLibraryMatch(row)?[index]:[]);
}

export async function runLibraryQueries(rows,indices,{cookie,signal,onUpdate=()=>{},onProgress=()=>{},fetcher=fetch,concurrency=3,maxPages=5,timeoutMs=12000,rowTimeoutMs=30000,resume=true,startNext=false,publishEvery=1}={}) {
  const updated=rows.map(row=>({...row,options:[...(row.options||[])]}));
  let cursor=0,completed=0,fatal='',changes=0,publishedChanges=0;
  const settled=new Set(),active=new Map();
  const reportProgress=()=>{
    const finished=[...settled].map(index=>updated[index]);
    onProgress({completed,total:indices.length,active:active.size,
      matched:finished.filter(hasLibraryMatch).length,
      unmatched:finished.filter(row=>!hasLibraryMatch(row)&&row.status!=='error').length,
      failed:finished.filter(row=>!hasLibraryMatch(row)&&row.status==='error').length,
      ...[...active.values()].at(-1)});
  };
  const publish=(force=false)=>{
    if(!force)changes++;
    if((force&&publishedChanges!==changes)||(!force&&changes%Math.max(1,publishEvery)===0)){
      onUpdate(updated.map(row=>({...row})));
      publishedChanges=changes;
    }
  };
  async function worker() {
    while(cursor<indices.length&&!signal?.aborted&&!fatal) {
      const index=indices[cursor++],original=updated[index];
      const continuing=startNext||(resume&&['partial','error','querying'].includes(original.status));
      let page=continuing?(original.page||0)+1:1;
      let options=continuing?[...original.options]:[];
      if(!continuing&&!hasLibraryMatch(original))updated[index]={...original,page:0,options:[],status:'pending',error:''};
      const started=Date.now();
      try {
        for(let count=0;count<maxPages;count++,page++) {
          if(signal?.aborted)break;
          active.set(index,{name:original.queryName,page});reportProgress();
          const request=new AbortController();
          const abort=()=>request.abort();
          signal?.addEventListener('abort',abort,{once:true});
          const timer=setTimeout(abort,Math.max(1,Math.min(timeoutMs,rowTimeoutMs-(Date.now()-started))));
          let data;
          try {
            if(signal?.aborted)request.abort();
            let response;
            try {
              response=await fetcher('/api/food-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:original.searchTerm,cookie,page}),signal:request.signal});
            } catch(error) {
              if(error.name==='AbortError')throw error;
              throw new Error('无法连接本地查询服务，请确认工作台服务已启动后重试；不是食物库无结果');
            }
            try {data=await response.json();}
            catch {throw new Error(`本地查询服务返回异常（HTTP ${response.status||'未知'}），请确认启动的是工作台后端；不是食物库无结果`);}
            if(!response.ok)throw new Error(data.error||'食物库查询失败');
            if(!Array.isArray(data.foods))throw new Error('食物库数据格式错误');
          } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
          options=[...new Map([...options,...data.foods].map(f=>[String(f.id||f._id),f])).values()];
          const matched=matchExactRow(original,options,true);
          const exhausted=data.foods.length<10||(data.total!=null&&page*10>=data.total)||page>=100;
          updated[index]={...matched,page,total:data.total,status:matched.selectedId?'exact':exhausted?'unmatched':'partial',error:''};
          publish();
          if(matched.selectedId||exhausted||Date.now()-started>=rowTimeoutMs)break;
        }
      } catch(error) {
        const last=updated[index];
        // A refresh failure must not erase a previously selected database record.
        updated[index]={...last,status:hasLibraryMatch(last)?last.status:'error',error:signal?.aborted?'已暂停，可继续查询':error.name==='AbortError'?'单次查询超时，可继续查询':error.message};
        if(/登录|权限|Cookie.*无效|认证|本地查询服务/.test(error.message))fatal=error.message;
        publish();
      }
      completed++;
      settled.add(index);active.delete(index);reportProgress();
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,indices.length)},worker));
  if(indices.length)publish(true);
  return {rows:updated,cancelled:Boolean(signal?.aborted),error:fatal};
}

export function libraryProgressText(progress) {
  return `已完成 ${progress.completed}/${progress.total} · 同名匹配 ${progress.matched}条 · 未同名匹配 ${progress.unmatched}条 · 请求失败 ${progress.failed}条 · 查询中 ${progress.active}条${progress.name?` · ${progress.name} · 第${progress.page}页`:''}`;
}

export function libraryResultSummary(rows) {
  const matched=rows.filter(hasLibraryMatch).length;
  const failed=rows.filter(row=>!hasLibraryMatch(row)&&row.status==='error');
  const pending=rows.length-matched-failed.length;
  const error=failed.length?`${failed.length}条查询失败：${failed[0].error||'请查看食物行错误'}。已成功匹配的数据保留，可仅重试失败项。`:'';
  return {matched,failed:failed.length,pending,error,text:`同名已匹配 ${matched}条 · 查询失败 ${failed.length}条 · 未匹配/待继续 ${pending}条 · 结果已保存`};
}
