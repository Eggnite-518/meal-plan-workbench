export const FOOD_ENDPOINT = 'https://otter-api.midway.run/management/food/list';

export function normalizeFoodCookie(value) {
  if (typeof value !== 'string' || value.length > 16000) throw new Error('请填写有效的食物库登录 Cookie');
  let cookie=value.trim().replace(/^cookie\s*:\s*/i,'');
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cookie)) cookie=`JIKE-AUTH-JWT=${cookie}`;
  if (!cookie || /[\r\n]/.test(cookie) || !/^[\x20-\x7E]+$/.test(cookie) || !cookie.includes('=')) throw new Error('请填写完整 Cookie（JIKE-AUTH-JWT=…）或 JWT 值，不要包含换行或省略号');
  return cookie;
}

export async function searchFoods(query, cookie, page = 1, fetcher = fetch, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 120) throw new Error('请输入有效食物名称');
  cookie=normalizeFoodCookie(cookie);
  if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('无效页码');
  const response = await fetcher(FOOD_ENDPOINT, {
    method: 'POST', redirect: 'manual', signal,
    headers: {'Content-Type':'application/json', Cookie:cookie.trim(), Origin:'https://otter-admin.midway.run', Referer:'https://otter-admin.midway.run/'},
    body:JSON.stringify({page,limit:10,query:query.trim()}),
  });
  if ([301,302,303,307,308].includes(response.status)) throw new Error('食物库要求重新登录（跳转到认证页）。Cookie 无效、已过期或复制不完整，请在后台重新登录并复制最新请求中的 Cookie');
  if ([401,403].includes(response.status)) throw new Error('食物库登录失效或没有权限，请更新 Cookie');
  if (!response.ok) throw new Error(`食物库查询失败（HTTP ${response.status}）`);
  let result;
  try { result = await response.json(); } catch { throw new Error('食物库没有返回 JSON，请检查登录状态'); }
  if (result.success !== true || !Array.isArray(result.data?.foods)) throw new Error('食物库返回失败或数据结构不符合预期，请检查登录状态');
  // Whitelist food fields: never relay upstream headers, credentials or account data.
  const foods = result.data.foods.map(f => Object.fromEntries(['id','_id','name','en','unit','weight','calorie','nutrition','showUnits','source','category','mainCategory','tag','ingredients','allergens'].filter(k=>Object.hasOwn(f,k)).map(k=>[k,f[k]])));
  return {foods,page,limit:10,total:result.data.total ?? null};
}

export function uniqueExact(foods, query) {
  const normalize = s => String(s).normalize('NFKC').trim().toLowerCase();
  const found = [...new Map(foods.filter(f=>f.name!=null&&(f.id||f._id)&&normalize(f.name)===normalize(query)).map(f=>[String(f.id||f._id),f])).values()];
  return found.length === 1 ? String(found[0].id || found[0]._id) : '';
}

export function matchExactRow(row, options, preserveManual=false) {
  const normalize=s=>String(s??'').normalize('NFKC').trim().toLowerCase();
  const exact=options.filter(f=>f.name!=null&&(f.id||f._id)&&normalize(f.name)===normalize(row.queryName));
  const count=new Set(exact.map(f=>String(f.id||f._id))).size;
  const keepManual=preserveManual&&row.selectionSource==='manual'&&options.some(f=>String(f.id||f._id)===row.selectedId);
  const selectedId=keepManual?row.selectedId:exact.length?String(exact[0].id||exact[0]._id):'';
  return {...row,options,selectedId,selectionSource:keepManual?'manual':selectedId?'exact':'',status:selectedId?'exact':'unmatched',exactCount:count,error:''};
}

export function adaptRealMatches(rows) {
  const foods=[], unmatched=[], seen=new Set();
  for (const row of rows) {
    const f=row.options.find(f=>String(f.id || f._id)===row.selectedId);
    if (!f) { unmatched.push(row.queryName); continue; }
    const id=String(f.id || f._id);
    if (seen.has(id)) throw new Error(`同一个库食物重复匹配：${f.name}，请只保留一次`);
    seen.add(id);
    const num=(v,label)=>{if(v==null || v==='' || !Number.isFinite(Number(v)) || Number(v)<0)throw new Error(`${f.name}缺少有效${label}`);return Number(v);};
    const base=num(f.weight,'基准重量');
    if (f.unit !== 'gram' || base<=0) throw new Error(`${f.name}不是有效的克重基准，暂不能计算`);
    const nutritionPer100g=Object.fromEntries([['protein','protein'],['fat','fat'],['carbs','carbohydrate']].map(([to,from])=>[to,num(f.nutrition?.[from],from)*100/base]));
    nutritionPer100g.calories=num(f.calorie,'热量')*100/base;
    let portions=(f.showUnits || []).filter(u=>u.type==='custom' && Number(u.weight)>0).map(u=>({grams:Number(u.weight),label:`1${u.name}`}));
    if (row.portionText?.trim()) {
      portions=row.portionText.split(/[,，、\s]+/).filter(Boolean).map(v=>({grams:num(v,'人工份量'),label:`${Number(v)}克（人工确认）`}));
    }
    portions=portions.filter((p,i,a)=>a.findIndex(x=>x.grams===p.grams)===i);
    if (!portions.length) throw new Error(`${f.name}没有可执行份量，请填写人工确认的克重档位`);
    foods.push({id,name:f.name,queryName:row.queryName,slot:row.slot,nutritionPer100g,portions,ingredients:Array.isArray(f.ingredients)?f.ingredients:[],allergens:Array.isArray(f.allergens)?f.allergens:[],dataSource:'real_library',safetyVerified:false,libraryRecord:f});
  }
  return {foods,unmatched};
}
