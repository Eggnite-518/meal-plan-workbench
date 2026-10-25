export const CREDENTIALS_KEY = 'otter-meal-lab-credentials-v1';
export const LIBRARY_CACHE_LIMIT = 400;
const CONFIG_KEYS = ['provider','baseUrl','model','thinkingMode','jsonMode','maxTokens'];

export function publicConfig(config = {}) {
  return Object.fromEntries(CONFIG_KEYS.filter(k => config[k] !== undefined).map(k => [k, config[k]]));
}

export function readCredentials(storage) {
  try {
    const value = JSON.parse(storage.getItem(CREDENTIALS_KEY) || 'null');
    return {
      apiKey: value?.rememberApi && typeof value.apiKey === 'string' ? value.apiKey : '',
      cookie: value?.rememberCookie && typeof value.cookie === 'string' ? value.cookie : '',
      rememberApi: value?.rememberApi === true,
      rememberCookie: value?.rememberCookie === true,
    };
  } catch { return {apiKey:'',cookie:'',rememberApi:false,rememberCookie:false}; }
}

export function saveCredentials(storage, {apiKey,cookie,rememberApi,rememberCookie}) {
  if (!rememberApi && !rememberCookie) { storage.removeItem(CREDENTIALS_KEY); return; }
  storage.setItem(CREDENTIALS_KEY, JSON.stringify({rememberApi,rememberCookie,
    ...(rememberApi ? {apiKey} : {}), ...(rememberCookie ? {cookie} : {}),
  }));
}

// Keep exact hits and a bounded preview, including unfinished pages for resume.
export function compactMatches(rows) {
  return rows.map(row => {
    const options=row.options||[],selected=options.filter(f=>String(f.id||f._id)===row.selectedId||String(f.name).normalize('NFKC').trim().toLowerCase()===String(row.queryName).normalize('NFKC').trim().toLowerCase());
    return {...row,options:[...new Map([...selected,...options.slice(0,10)].map(f=>[String(f.id||f._id),f])).values()]};
  });
}

export function restoreMatches(rows, foods) {
  return rows.map(row => {
    if (row.selectedId && row.options?.some(f => String(f.id || f._id) === row.selectedId)) return row;
    const food = foods.find(f => f.slot === row.slot && f.name === row.queryName && f.dataSource === 'real_library');
    const record = food?.libraryRecord;
    if (!record?.id && !record?._id) return row;
    return {...row,options:[record],selectedId:String(record.id || record._id),selectionSource:'exact',status:'exact',error:''};
  });
}

const normalizeFoodName = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();

// Successful exact matches are safe to reuse across plans. Only the whitelisted
// food record is cached; credentials and search responses are never stored here.
export function cacheLibraryMatches(cache = {}, rows = []) {
  const next={...cache};
  for(const row of rows) {
    if(!row.selectedId)continue;
    const record=(row.options||[]).find(food=>String(food.id||food._id)===row.selectedId);
    if(!record||normalizeFoodName(record.name)!==normalizeFoodName(row.queryName))continue;
    next[normalizeFoodName(row.queryName)]={record,updatedAt:new Date().toISOString()};
  }
  const entries=Object.entries(next).sort((a,b)=>String(b[1]?.updatedAt||'').localeCompare(String(a[1]?.updatedAt||''))).slice(0,LIBRARY_CACHE_LIMIT);
  return Object.fromEntries(entries);
}

export function applyLibraryCache(rows = [], cache = {}) {
  let hits=0;
  const result=rows.map(row=>{
    if(row.selectedId&&(row.options||[]).some(food=>String(food.id||food._id)===row.selectedId))return row;
    const record=cache[normalizeFoodName(row.queryName)]?.record;
    if(!record||normalizeFoodName(record.name)!==normalizeFoodName(row.queryName)||(record.id==null&&record._id==null))return row;
    hits++;
    const id=String(record.id||record._id),options=[record,...(row.options||[]).filter(food=>String(food.id||food._id)!==id)];
    return {...row,options,selectedId:id,selectionSource:'cache',status:'exact',exactCount:1,error:''};
  });
  return {rows:result,hits};
}

export function needsLibraryQuery(row) {
  return !(row.selectedId && row.options?.some(f => String(f.id || f._id) === row.selectedId)) && !(row.status === 'unmatched' && row.page > 0);
}
