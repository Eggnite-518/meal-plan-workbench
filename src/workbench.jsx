import React, {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Utensils,LayoutTemplate,Sparkles,Database,FlaskConical,ShieldCheck,UserRound,ListFilter,Grid2X2,Calculator,Settings2,Download,Upload,Plus,Play,Check,ChevronRight,ArrowRight,ArrowLeft,X,RotateCcw,Copy,LoaderCircle,AlertCircle,CheckCircle2,FileJson,Search,Save} from 'lucide-react';
import {SLOT_NAMES,GOALS,getSlots,compose,totals,validatePlan,validateRules,summarizeSolvedPlan,mealServingSummary} from './engine.js';
import {STORAGE_KEY,ALL_TAGS,SOURCE_NAMES,MEAL_NAMES,blankBundle,sampleBundle,clone,validateBundleTemplate,parsePlanTemplates,normalizeCandidates,candidateGroups,candidateInput,syncFoodPreferences,enrichmentPrompt,validatePool,profileFor,rulesFor,filterPool,matchRelease,fingerprint,approveBundle,matchingRows,mergeFoodSupplements,migrateSavedWorkbench,applyCurrentStructure} from './workbench-model.js';
import {matchExactRow} from './real-library.js';
import {DEFAULT_CANDIDATE_PROMPT,renderCandidatePrompt,candidatePromptInput} from './candidate-prompt.js';
import {DEFAULT_PLAN_INPUT,DEFAULT_PLAN_PROMPT,renderPlanPrompt} from './plan-prompt.js';
import {publicConfig,readCredentials,saveCredentials,compactMatches,restoreMatches,cacheLibraryMatches,applyLibraryCache} from './workbench-storage.js';
import {hasLibraryMatch,queryIndices,runLibraryQueries,fastBestIndices,secondaryFallbackIndices,libraryProgressText,libraryResultSummary} from './library-query.js';
import {needsEnrichment,needsNutrition,missingFoodFields,enrichmentQueue,autoConfirmFoods,mergeLibraryFoods,mergeEnrichmentBatch,runEnrichmentBatches} from './enrichment.js';
import {supportsMeal,validMealTags} from './food-tags.js';
import {recipeReviewPrompt} from './recipe-review-prompt.js';
import './workbench.css';

const json=v=>JSON.stringify(v,null,2), fmt=n=>Math.round(n||0).toLocaleString();
const STAGES={prep:[['计划模板',LayoutTemplate],['候选食物',Sparkles],['数据与标签',Database],['模板测试',FlaskConical],['审核入库',ShieldCheck]],live:[['用户与匹配',UserRound],['忌口过滤',ListFilter],['七天搭配',Grid2X2],['份量与校验',Calculator]]};
const PROVIDERS={company:{label:'公司网关 · 个人',baseUrl:'https://mediocre-new-api.midway.run',model:'deepseek-flash',thinkingMode:'disabled'},project:{label:'公司网关 · 项目组',baseUrl:'https://new-api.midway.run',model:'deepseek-flash',thinkingMode:'disabled'},deepseek:{label:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',thinkingMode:'disabled'},doubao:{label:'豆包 · 火山方舟',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'',thinkingMode:''},qwen:{label:'通义千问',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.8-flash',thinkingMode:'qwen-disabled'},openai:{label:'OpenAI',baseUrl:'https://api.openai.com/v1',model:'',thinkingMode:''},custom:{label:'自定义',baseUrl:'',model:'',thinkingMode:''}};
function readSaved(){try{const saved=migrateSavedWorkbench(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));return saved?.bundle?{...saved,bundle:{...saved.bundle,foods:autoConfirmFoods(saved.bundle.foods||[])}}:saved;}catch{return null;}}
function Button({icon:Icon,children,primary=false,small=false,...props}){return <button className={`btn ${primary?'primary':''} ${small?'small':''}`} {...props}>{Icon&&<Icon size={small?14:16}/>} {children}</button>;}
function IconButton({icon:Icon,label,...props}){return <button className="icon-btn" aria-label={label} title={label} {...props}><Icon size={16}/></button>;}
function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>;}
function Tag({children,tone=''}){return <span className={`tag ${tone}`}>{children}</span>;}
function Empty({children}){return <div className="empty"><Database size={28}/><p>{children}</p></div>;}
function RecipeReviewHistory({items,onClear}){
  return <details className="spaced"><summary>食谱生成与评分历史 · {items.length}条</summary>
    <div className="section-line spaced"><span className="muted">按评分完成时间倒序保存于当前浏览器，最多保留20条。</span>{items.length>0&&<Button small icon={X} onClick={onClear}>清空历史</Button>}</div>
    {items.length===0&&<Empty>完成一次AI食谱测评后，将在这里自动保存用户输入、最终食谱和对应得分。</Empty>}
    {items.map(item=><details key={item.id} className="spaced"><summary>{new Date(item.time).toLocaleString()} · {item.planName} · {item.score}分</summary>
      <div className="result-banner success"><div><strong>{item.score}分</strong><span>{item.conclusion}</span></div><div><b>{((item.durationMs||0)/1000).toFixed(1)}秒</b><span>{item.model||'—'}</span></div></div>
      <JsonEditor label="历史用户输入" value={json(item.input)} rows={8}/>
      <JsonEditor label="历史最终食谱" value={json(item.recipe)} rows={16}/>
    </details>)}
  </details>;
}
function EnrichmentProgress({progress,busy,elapsed,onCancel}){
  if(!progress)return null;
  const labels={running:'AI补充进行中',completed:'本轮AI补充完成',paused:'AI补充已暂停',failed:'AI补充未完成',interrupted:'上次AI补充已中断'};
  return <section className="task-progress" aria-label="AI补充进度" role="status">
    <div className="section-line"><strong>{busy&&<LoaderCircle className="spin" size={16}/>} {labels[progress.status]||'AI补充准备中'}</strong>{busy&&<Button small icon={X} onClick={onCancel}>暂停AI补充</Button>}</div>
    <progress aria-label="AI补充已处理食物" value={progress.completed||0} max={progress.total||1}/>
    <div className="section-line"><span>{progress.taskLabel||'补全部缺项（旧任务）'} · 已处理 {progress.completed||0} / {progress.total||0} 条 · 第 {progress.batchNumber||0} / {progress.totalBatches||0} 批</span>{busy&&<span>已等待 {elapsed} 秒</span>}</div>
    {busy&&progress.currentNames?.length>0&&<p>当前批次：{progress.currentNames.slice(0,5).join('、')}{progress.currentNames.length>5?` 等${progress.currentNames.length}条`:''}</p>}
    {busy&&<small>进度按已完成食物计数；完整记录自动确认并保存，可直接用于程序测试。</small>}
    {progress.error&&<p>{progress.error}</p>}
  </section>;
}
function JsonEditor({label,value,onChange,action,rows=12}){return <div className="json-editor"><div className="section-line"><strong><FileJson size={15}/>{label}</strong><IconButton label={`复制${label}`} icon={Copy} onClick={()=>navigator.clipboard.writeText(value).catch(()=>{})}/></div><textarea aria-label={label} className="code" rows={rows} value={value} onChange={e=>onChange?.(e.target.value)} readOnly={!onChange} spellCheck={false}/>{action&&<div className="actions">{action}</div>}</div>;}
function NutritionEditor({value,onChange}){
  let food;try{food=JSON.parse(value);}catch{return null;}
  const patch=(key,val)=>onChange(json({...food,nutritionPer100g:{...food.nutritionPer100g,[key]:val===''?null:Number(val)}}));
  return <><div className="section-line spaced"><strong>每100克营养数据</strong><Tag>{SOURCE_NAMES[food.dataSource]}</Tag></div><div className="form-grid four">{[['calories','热量 kcal'],['protein','蛋白质 g'],['fat','脂肪 g'],['carbs','碳水 g']].map(([key,label])=><Field key={key} label={label}><input aria-label={`补录${label}`} type="number" min="0" step="0.1" value={food.nutritionPer100g?.[key]??''} onChange={e=>patch(key,e.target.value)}/></Field>)}</div><Field label="营养参考依据"><textarea aria-label="营养参考依据" rows={2} value={food.nutritionReference||''} onChange={e=>onChange(json({...food,nutritionReference:e.target.value}))}/></Field></>;
}
function download(name,data){const url=URL.createObjectURL(new Blob([json(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function TemplateGrid({template,onEdit}){return <div className="table-scroll"><table className="template-table"><thead><tr><th>日期</th>{template.meals.map(m=><th key={m.id}>{m.name}</th>)}</tr></thead><tbody>{template.days.map(d=><tr key={d.day}><th><span className="day-number">{String(d.day).padStart(2,'0')}</span></th>{d.meals.map(m=><td key={m.id} tabIndex={onEdit?0:undefined} aria-label={`编辑第${d.day}天${m.name}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onEdit?.(d.day,m.id);}}} onClick={()=>onEdit?.(d.day,m.id)}>{<div className="slot-list">{m.required.map(s=><Tag key={s} tone="green">{SLOT_NAMES[s]}</Tag>)}</div>}{m.optional.length>0&&<div className="slot-list optional"><span>可选</span>{m.optional.map(s=><Tag key={s}>{SLOT_NAMES[s]}</Tag>)}</div>}<small className="meal-share">{Math.round(m.share*100)}% 热量</small></td>)}</tr>)}</tbody></table></div>;}

function SelectionView({plan,template,foods}){
  if(!plan)return <Empty>尚未确定每日餐食</Empty>;
  return <><p className="muted">每餐实际最多4种食物，含油脂。可选候选不一定加入，0克不计入种数。</p><div className="table-scroll"><table className="selection-table" aria-label="7天必选与可选食物"><thead><tr><th>日期 / 餐次</th><th>必选食物</th><th>可选候选</th></tr></thead><tbody>{plan.days.flatMap(d=>d.meals.map(m=>{
    const definition=template.days.find(day=>day.day===d.day)?.meals.find(meal=>meal.id===m.id)||template.meals.find(meal=>meal.id===m.id);
    return <tr key={`${d.day}-${m.id}`}><th>第{d.day}天 · {m.name}</th>{['required','optional'].map(kind=><td key={kind}>{definition[kind].length?definition[kind].map(slot=>{
      const item=m.items.find(i=>i.slot===slot),candidates=foods.filter(f=>f.slot===slot&&supportsMeal(f,m.id)),best=candidates.filter(f=>f.preference!=='secondary');
      return <div className="selection-item" key={slot}><div><Tag tone={kind==='required'?'green':''}>{SLOT_NAMES[slot]}</Tag><b>{item?.name||'无可用候选，跳过'}</b></div>{item&&<small>{item.preference==='secondary'?'次推荐':'Best'} · 候选池 {best.length?best.length:candidates.length}种</small>}</div>;
    }):<span className="muted">无</span>}</td>)}</tr>;
  }))}</tbody></table></div></>;
}

function ResultView({result,plan,activeDay,setActiveDay}){
  if(!result&&!plan)return <Empty>尚未生成计划</Empty>;
  const days=result?.days||plan.days;
  const day=days.find(d=>d.day===activeDay)||days[0];
  return <>
    {result&&<div className={`result-banner ${result.status==='passed'?'success':'warning'}`}><div><strong>{result.summary.passed} / {result.summary.total} 天完全达标</strong><span>{result.status==='passed'?'全部通过独立复算':result.status==='approximate'?`${result.summary.approximate}天采用热量最接近方案`:'部分日期未找到可执行组合'}</span></div><div><b>{fmt(result.summary.average.calories)}</b><span>已生成日期平均 kcal / 天 · 共耗时 {(result.durationMs/1000).toFixed(1)}秒</span></div></div>}
    <div className="day-tabs">{days.map(d=><button key={d.day} className={day.day===d.day?'active':''} onClick={()=>setActiveDay(d.day)}>第{d.day}天{result&&<span className={`status-dot ${d.pass?'ok':'bad'}`}/>}</button>)}</div>
    {day.changedCombination&&<div className="alert warning">本日初始搭配未找到可行份量，程序已重新搭配。下方展示重试后的结果，原始餐食仍保留在第一步表格中。</div>}
    {day.approximate&&<div className="alert warning">{day.reason}</div>}
    {day.pass===false&&!day.meals?.length?<div className="alert warning">{day.reason}</div>:<div className="meal-columns">{day.meals.map(m=><section className="meal" key={m.id}><div className="section-line"><strong>{m.name}</strong><Tag>{result?`${fmt(totals(m.items).calories)} kcal`:`${Math.round(m.share*100)}%`}</Tag></div>{result&&<small>{mealServingSummary(m).foodCount}种食物 · 合计{fmt(mealServingSummary(m).totalGrams)}g</small>}{m.items.map((i,index)=><div className="meal-item" key={`${i.foodId}-${index}`}><div><span>{i.name}</span><small>{SLOT_NAMES[i.slot]}{i.preference==='secondary'?' · 次推荐替换':''}{i.optional?' · 可选':''}</small></div><div>{result?<><b>{i.portion}</b><small>{i.grams}g · {fmt(i.calories)} kcal</small></>:<Tag tone={i.optional?'':'green'}>{i.optional?'可选':'必选'}</Tag>}</div></div>)}</section>)}</div>}
    {day.checks&&<div className="table-scroll"><table><thead><tr><th>校验项</th><th>实际</th><th>允许范围</th><th>结果</th></tr></thead><tbody>{day.checks.map(c=><tr key={c.name}><td>{c.name}</td><td>{c.value} {c.unit}</td><td>{c.min}–{c.max} {c.unit}</td><td><Tag tone={c.pass?'green':'red'}>{c.pass?'通过':'未通过'}</Tag></td></tr>)}</tbody></table></div>}
    {result&&<><div className="section-line spaced"><strong>各日校验</strong><Tag>{result.nutritionSource}</Tag></div><div className="daily-strip">{result.days.map(d=><button key={d.day} onClick={()=>setActiveDay(d.day)}><small>DAY {d.day} · {((result.log.find(x=>x.day===d.day)?.elapsedMs||0)/1000).toFixed(1)}秒</small><b>{d.nutrition?fmt(d.nutrition.calories):'无方案'}</b><span>{d.nutrition?`${d.pass?'达标':'近似'} · P ${d.macroRatio.protein}% · F ${d.macroRatio.fat}% · C ${d.macroRatio.carbs}%`:'查看求解日志'}</span></button>)}</div>{result.summary.repeatsOverLimit.length>0&&<div className="alert warning">实际食物重复超出软上限：{result.summary.repeatsOverLimit.map(x=>`${x.name} ${x.count}次`).join('、')}</div>}<details><summary>求解阶段与搜索规模</summary><pre>{json(result.log)}</pre></details></>}
    {plan?.warnings?.length>0&&<details><summary>搭配提示 · {plan.warnings.length}</summary>{plan.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
  </>;
}

function App(){
  const [saved]=useState(readSaved);
  const [bundle,setBundle]=useState(saved?.bundle||blankBundle);
  const [releases,setReleases]=useState(saved?.releases||[]);
  const [phase,setPhase]=useState(saved?.phase==='live'?'live':'prep'),[step,setStep]=useState(Number.isInteger(saved?.step)&&saved.step>=0&&saved.step<(saved?.phase==='live'?4:5)?saved.step:0);
  const [templateText,setTemplateText]=useState(json(bundle.template));
  const [planInput,setPlanInput]=useState(saved?.planInput||DEFAULT_PLAN_INPUT);
  const [foodRegion,setFoodRegion]=useState(saved?.foodRegion||'中国大陆');
  const [planImportText,setPlanImportText]=useState(saved?.planImportText||'');
  const [importedPlans,setImportedPlans]=useState(saved?.importedPlans||[]);
  const [templateFeedback,setTemplateFeedback]=useState('');
  const [candidateText,setCandidateText]=useState(json(candidateInput(bundle.candidates)));
  const [candidateApplyState,setCandidateApplyState]=useState(null);
  const [foodText,setFoodText]=useState(json({foods:bundle.foods}));
  const [count,setCount]=useState(saved?.candidateCount??15);
  const savedCandidatePrompt=saved?.candidatePromptTemplate?.includes('${testContent}')?saved.candidatePromptTemplate:DEFAULT_CANDIDATE_PROMPT;
  const [candidatePromptTemplate,setCandidatePromptTemplate]=useState(savedCandidatePrompt);
  const [candidatePromptDraft,setCandidatePromptDraft]=useState(saved?.candidatePromptDraft?.includes('${testContent}')?saved.candidatePromptDraft:savedCandidatePrompt);
  const [enrichPrompt,setEnrichPrompt]=useState('');
  const [scopedPrompts,setScopedPrompts]=useState({});
  const [records,setRecords]=useState([]),[test,setTest]=useState(saved?.test||null);
  const [testSelection,setTestSelection]=useState(saved?.testSelection||null);
  const [user,setUser]=useState({goal:'fatLoss',mealCount:3,habit:'regular',training:2,calories:1650,blockedTags:[],avoids:''});
  const [testUser,setTestUser]=useState({calories:1650,habit:'regular',blockedTags:[],avoids:''});
  const [matched,setMatched]=useState(null),[filtered,setFiltered]=useState(null),[plan,setPlan]=useState(null),[result,setResult]=useState(null);
  const [seed,setSeed]=useState(42),[maxRepeat,setMaxRepeat]=useState(3),[activeDay,setActiveDay]=useState(1);
  const [searchTimeMs]=useState(15000);
  const [exclusiveBusy,setBusy]=useState(''),[libraryBusy,setLibraryBusy]=useState(false),[enrichBusy,setEnrichBusy]=useState(false);
  const busy=exclusiveBusy||(libraryBusy?'library':'')||(enrichBusy?'enrichment':'');
  const [enrichProgress,setEnrichProgress]=useState(()=>saved?.enrichProgress?{...saved.enrichProgress,status:saved.enrichProgress.status==='running'?'interrupted':saved.enrichProgress.status}:null);
  const [enrichHistory,setEnrichHistory]=useState(()=>Object.fromEntries(Object.entries(saved?.enrichHistory||{}).map(([key,p])=>[key,{...p,status:p.status==='running'?'interrupted':p.status}])));
  const [elapsed,setElapsed]=useState(0);
  const [progress,setProgress]=useState(null),[error,setError]=useState(''),[toast,setToast]=useState('');
  const [solveElapsed,setSolveElapsed]=useState(0),[recipeReview,setRecipeReview]=useState(null),[reviewBusy,setReviewBusy]=useState(false);
  const [reviewHistory,setReviewHistory]=useState(Array.isArray(saved?.reviewHistory)?saved.reviewHistory:[]);
  const [libraryCache,setLibraryCache]=useState(saved?.libraryCache&&typeof saved.libraryCache==='object'?saved.libraryCache:{});
  const [credentials]=useState(()=>readCredentials(localStorage));
  const [rememberApi,setRememberApi]=useState(credentials.rememberApi),[rememberCookie,setRememberCookie]=useState(credentials.rememberCookie);
  const [showApi,setShowApi]=useState(false),[config,setConfig]=useState({provider:'company',...PROVIDERS.company,jsonMode:true,maxTokens:16000,...publicConfig(saved?.modelConfig),apiKey:credentials.apiKey});
  const [apiMessage,setApiMessage]=useState(''),[apiBusy,setApiBusy]=useState(false);
  const [cookie,setCookie]=useState(credentials.cookie),[queryName,setQueryName]=useState(''),[searchResults,setSearchResults]=useState([]),[searchPage,setSearchPage]=useState(1);
  const [libraryRows,setLibraryRows]=useState(()=>restoreMatches(matchingRows(bundle.candidates,saved?.libraryRows||[]),bundle.foods));
  const [matchProgress,setMatchProgress]=useState(''),[supplementFeedback,setSupplementFeedback]=useState(null);
  const [selectedFood,setSelectedFood]=useState(null),[editFood,setEditFood]=useState(''),[slotFilter,setSlotFilter]=useState('all'),[search,setSearch]=useState('');
  const [mealEdit,setMealEdit]=useState(null),[reviewConfirmed,setReviewConfirmed]=useState(false);
  const [testHistory,setTestHistory]=useState([]);
  const worker=useRef([]),controller=useRef(null),timer=useRef(null),importRef=useRef(null),loadedRecord=useRef(null);
  const bundleRef=useRef(bundle),libraryController=useRef(null),enrichController=useRef(null);
  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,json({bundle,releases,test,libraryRows:compactMatches(libraryRows),libraryCache,candidateCount:count,candidatePromptTemplate,candidatePromptDraft,planImportText,importedPlans,planInput,foodRegion,phase,step,modelConfig:publicConfig(config),enrichProgress,enrichHistory,reviewHistory}));}catch{setError('本地保存失败，可能存储空间不足。请先导出工作台备份，当前修改尚未保存');}},[bundle,releases,test,libraryRows,libraryCache,count,candidatePromptTemplate,candidatePromptDraft,planImportText,importedPlans,planInput,foodRegion,phase,step,config,enrichProgress,enrichHistory,reviewHistory]);
  useEffect(()=>{if(enrichProgress?.scope)setEnrichHistory(h=>({...h,[enrichProgress.scope]:enrichProgress}));},[enrichProgress]);
  useEffect(()=>{try{saveCredentials(localStorage,{apiKey:config.apiKey,cookie,rememberApi,rememberCookie});}catch{setError('凭证保存失败，请检查浏览器存储空间或隐私设置');}},[config.apiKey,cookie,rememberApi,rememberCookie]);
  useEffect(()=>{setLibraryRows(rows=>applyLibraryCache(restoreMatches(matchingRows(bundle.candidates,rows),bundle.foods),libraryCache).rows);setSupplementFeedback(null);setEnrichPrompt('');setScopedPrompts({});},[bundle.candidates]);
  useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(id);},[toast]);
  useEffect(()=>()=>{worker.current.forEach(w=>w.terminate());controller.current?.abort();libraryController.current?.abort();enrichController.current?.abort();clearTimeout(timer.current);},[]);
  useEffect(()=>{if(!enrichBusy)return;const id=setInterval(()=>setElapsed(s=>s+1),1000);return()=>clearInterval(id);},[enrichBusy]);
  useEffect(()=>{if(!['test','live'].includes(exclusiveBusy))return;const started=Date.now();setSolveElapsed(0);const id=setInterval(()=>setSolveElapsed(Math.round((Date.now()-started)/100)/10),100);return()=>clearInterval(id);},[exclusiveBusy]);
  useEffect(()=>{loadedRecord.current=null;},[selectedFood]);
  const notify=message=>{setError('');setToast(message);};
  const guard=fn=>{setError('');try{return fn();}catch(e){setError(e.message);return null;}};
  const changeBundle=(next)=>{next={...next,foods:autoConfirmFoods(next.foods)};bundleRef.current=next;setBundle(next);setTest(null);setReviewConfirmed(false);setTemplateText(json(next.template));setCandidateText(json(candidateInput(next.candidates)));setFoodText(json({foods:next.foods}));};
  const go=(p,s=0)=>{if(busy)return;setPhase(p);setStep(s);setError('');setActiveDay(1);};
  const resetLive=()=>{setMatched(null);setFiltered(null);setPlan(null);setResult(null);};
  const patchUser=(key,value)=>{setUser(u=>({...u,[key]:value}));resetLive();};
  const rules=(t)=>({...rulesFor(t,seed,maxRepeat),searchTimeMs});
  let prompt='',promptError='',planPrompt='';
  try{prompt=renderCandidatePrompt(candidatePromptTemplate,bundle.template,foodRegion,planInput);}catch(e){promptError=e.message;}
  try{planPrompt=renderPlanPrompt(DEFAULT_PLAN_PROMPT,planInput);}catch(e){promptError=promptError||e.message;}
  const promptDirty=candidatePromptDraft!==candidatePromptTemplate;
  const saveCandidatePrompt=()=>guard(()=>{renderCandidatePrompt(candidatePromptDraft,bundle.template,foodRegion,planInput);setCandidatePromptTemplate(candidatePromptDraft);notify('候选提示词已保存并应用，刷新后仍保留');});
  const exportData=()=>download('otterlife-meal-workbench.json',{schemaVersion:2,bundle,releases,test,testHistory,reviewHistory,user,matched:matched?.releaseId,filtered,plan,result,records,candidateCount:count,candidatePromptTemplate,candidatePromptDraft,planInput,foodRegion,planImportText,importedPlans});
  const selectionKey=(b,params)=>json({fingerprint:fingerprint(b),params,rules:rulesFor(b.template,seed,maxRepeat)});
  const prepareTestSelection=()=>guard(()=>{
    validatePool(bundle);
    const filtered=filterPool(bundle,testUser);
    if(filtered.shortages.some(s=>s.required))throw new Error('必选槽位缺少候选食物，请先补充食物或调整忌口');
    const plan=compose(profileFor(bundle.template,testUser),bundle.template,filtered.foods,rules(bundle.template));
    setTestSelection({key:selectionKey(bundle,testUser),plan,foods:filtered.foods});setTest(null);setReviewConfirmed(false);setActiveDay(1);
    notify('已确定7天餐食，尚未计算份量');
  });
  const runSolve=(target,b,params,preparedPlan)=>guard(()=>{
    if(!preparedPlan)throw new Error('请先完成第一步：确定每日餐食');
    validatePool(b);
    const f=filterPool(b,params);
    if(f.shortages.some(s=>s.required))throw new Error(`候选不足：${f.shortages.filter(s=>s.required).map(s=>`第${s.day}天${s.meal}/${SLOT_NAMES[s.slot]}`).join('、')}`);
    const p=profileFor(b.template,params),r=rules(b.template);
    const composed=clone(preparedPlan);
    validatePlan(composed,p,b.template,f.foods);validateRules(r);
    setBusy(target);setProgress({completed:0,total:7});setError('');setActiveDay(1);setRecipeReview(null);
    const started=performance.now(),solved=[],queue=[...composed.days];let active=0,stopped=false;
    const finish=()=>{clearTimeout(timer.current);worker.current.forEach(w=>w.terminate());worker.current=[];setBusy('');setProgress(null);};
    const fail=message=>{if(stopped)return;stopped=true;finish();setError(message);};
    const complete=()=>{
      if(stopped||solved.length!==composed.days.length)return;
      stopped=true;const finalResult=summarizeSolvedPlan(p,f.foods,r,solved,performance.now()-started);finish();
      if(target==='test'){
        const report={fingerprint:fingerprint(b),user:clone(params),rules:r,result:finalResult,plan:composed,time:new Date().toISOString()};
        setTest(report);setTestHistory(h=>[report,...h].slice(0,10));setReviewConfirmed(false);
      } else setResult(finalResult);
    };
    const launch=()=>{
      while(!stopped&&active<4&&queue.length){
        const day=queue.shift(),w=new Worker(new URL('./day-solver.worker.js',import.meta.url),{type:'module'});active++;worker.current.push(w);
        w.onmessage=({data})=>{
          if(data.type==='progress')setProgress({completed:solved.length,total:composed.days.length,active,parallel:4,...data.progress});
          if(data.type==='error')fail(data.error);
          if(data.type==='result'){
            solved.push(data.solved);active--;w.terminate();worker.current=worker.current.filter(x=>x!==w);
            setProgress({completed:solved.length,total:composed.days.length,active,parallel:4,day:data.solved.day.day});
            launch();complete();
          }
        };
        w.onerror=e=>fail(e.message);
        w.postMessage({profile:p,template:b.template,foods:f.foods,day,rules:r});
      }
    };
    timer.current=setTimeout(()=>fail('并行求解超过总保护时间，已停止。请重试。'),45000);
    launch();
  });
  const reviewRecipe=async(finalResult,b,params,foods)=>{
    if(!finalResult)return;
    if(!config.apiKey){setShowApi(true);return;}
    setError('');setReviewBusy(true);setRecipeReview(null);
    try{
      const userInput={...params,目的:planInput.目的,每日餐数:planInput.每日餐数,饮食策略:planInput.饮食策略,计划天数:b.template.days.length,运动习惯:planInput.运动习惯,地域范围:foodRegion};
      const reviewFoods=foods.map(({id,name,slot,preference,allergens,tags,mealTags,portions,nutritionPer100g})=>({id,name,slot,preference,allergens,tags,mealTags,portions,nutritionPer100g}));
      const reviewPrompt=recipeReviewPrompt(userInput,b.template,reviewFoods,finalResult);
      const response=await fetch('/api/review-recipe',{method:'POST',headers:{'Content-Type':'application/json'},body:json({config,prompt:reviewPrompt})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      const completedReview={...data.parsed,durationMs:data.durationMs,model:data.model,time:data.timestamp};
      setRecipeReview(completedReview);
      setReviewHistory(history=>[{id:`review_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,time:data.timestamp||new Date().toISOString(),planName:b.template.name,input:clone(userInput),recipe:clone(finalResult),score:data.parsed.score,conclusion:data.parsed.conclusion,durationMs:data.durationMs,model:data.model},...history].slice(0,20));
      setRecords(rs=>[{stage:'review',prompt:reviewPrompt,output:data.content,usage:data.usage,model:data.model,durationMs:data.durationMs,time:data.timestamp},...rs]);
      notify('AI食谱测评已完成');
    }catch(e){setError(e.message);}finally{setReviewBusy(false);}
  };
  const cancel=()=>{controller.current?.abort();worker.current.forEach(w=>w.terminate());clearTimeout(timer.current);worker.current=[];setBusy('');setProgress(null);notify('已取消，保留已有数据');};
  const startEnrichment=async(scope='nutrition')=>{
    if(enrichController.current||exclusiveBusy)return;
    setError('');
    const abort=new AbortController();enrichController.current=abort;setEnrichBusy(true);setElapsed(0);
    try {
      let current=bundleRef.current;
      if(libraryRows.length){const merged=mergeLibraryFoods(current.foods,libraryRows);current={...current,foods:merged.foods};changeBundle(current);}
      validateBundleTemplate(current.template);
      const foods=enrichmentQueue(current.foods,scope);
      const taskLabel=scope==='nutrition'?'补营养':scope==='tags'?'补过敏原、忌口及餐次标签':'补可执行份量';
      setEnrichProgress({completed:0,total:foods.length,status:'running',batchNumber:0,totalBatches:Math.ceil(foods.length/20),taskLabel,scope});
      if(!foods.length){setEnrichProgress({completed:0,total:0,status:'completed',batchNumber:0,totalBatches:0,taskLabel,scope});notify(`没有需要${taskLabel}的记录，已有结果已保留`);return;}
      if(!config.apiKey){setEnrichProgress(p=>({...p,status:'paused'}));setShowApi(true);return;}
      const customPrompt=scope==='nutrition'?enrichPrompt:scopedPrompts[scope];
      const request=async batch=>{
        const batchPrompt=`${customPrompt?`${customPrompt}\n\n以下字段边界和当前批次优先：\n`:''}${enrichmentPrompt(current.template,current.candidates,batch,scope)}`;
        const response=await fetch('/api/preprocess',{method:'POST',headers:{'Content-Type':'application/json'},body:json({config,template:current.template,count,prompt:batchPrompt,stage:'enrichment'}),signal:abort.signal});
        const data=await response.json();if(!response.ok)throw new Error(data.error);
        setRecords(rs=>[{stage:'enrichment',prompt:batchPrompt,output:data.content,usage:data.usage,model:data.model,durationMs:data.durationMs,time:data.timestamp,error:data.validationError},...rs]);
        if(data.validationError)throw new Error(data.validationError);
        return scope==='tags'?data.parsed:Array.isArray(data.parsed)?{foods:data.parsed}:data.parsed;
      };
      await runEnrichmentBatches(foods,{batchSize:20,scope,signal:abort.signal,request,
        onProgress:p=>setEnrichProgress({...p,taskLabel,scope}),
        onBatch:(snapshot,payload)=>{
          const latest=bundleRef.current;
          changeBundle({...latest,foods:mergeEnrichmentBatch(latest.foods,snapshot,payload,scope)});
          setSupplementFeedback({ok:true,message:'完整记录已自动确认并保存，可直接测试。食物库营养优先，AI估算保留来源标记。'});
        },
      });
      if(abort.signal.aborted)setEnrichProgress(p=>({...p,status:'paused'}));
      else notify('AI补充结果已保存，完整记录已自动确认，可直接测试');
    }catch(e){setEnrichProgress(p=>({...p,status:abort.signal.aborted?'paused':'failed',error:abort.signal.aborted?'已暂停，完成批次保留':e.message}));if(!abort.signal.aborted)setError(e.message);}
    finally{setEnrichBusy(false);enrichController.current=null;}
  };
  const aiGenerate=async stage=>{
    if(stage==='enrichment'){await startEnrichment();return;}
    if(stage==='candidates'&&(promptError||promptDirty)){setError(promptError||'提示词有未保存修改，请先保存并应用，或恢复已保存版本');return;}
    setError('');if(!config.apiKey){setShowApi(true);return;}
    const current=stage==='plan'?planPrompt:prompt;
    const abort=new AbortController();controller.current=abort;setBusy('ai');
    try{
      if(stage!=='plan')validateBundleTemplate(bundle.template);
      const response=await fetch('/api/preprocess',{method:'POST',headers:{'Content-Type':'application/json'},body:json({config,template:bundle.template,count,prompt:current,stage}),signal:abort.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      setRecords(rs=>[{stage,prompt:current,output:data.content,usage:data.usage,model:data.model,durationMs:data.durationMs,time:data.timestamp,error:data.validationError},...rs]);
      if(stage==='plan'){
        const displayed=JSON.parse(data.content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim());
        setPlanImportText(json(displayed));
        if(data.validationError)throw new Error(data.validationError);
        const plans=data.parsed||parsePlanTemplates(displayed);setImportedPlans(plans);useImportedTemplate(plans[0]);
      } else if(stage==='candidates')setCandidateText(data.parsed?json(data.parsed):data.content);
      else {setFoodText(data.parsed?json(data.parsed):data.content);setSupplementFeedback(null);}
      if(data.validationError)throw new Error(data.validationError);
      notify(stage==='plan'?'计划模板已生成并展示，可继续生成候选食物':'AI结果已返回，请检查并应用');
    }catch(e){setError(abort.signal.aborted?'调用已取消':e.message);}finally{setBusy('');setMatchProgress('');controller.current=null;}
  };
  const loadSample=()=>{const b=sampleBundle();changeBundle(b);setEnrichPrompt('');notify('已载入内置演示食物和7天模板');};
  const applyFoods=()=>guard(()=>{
    const value=JSON.parse(foodText);const rows=Array.isArray(value)?value:value.foods;
    if(Array.isArray(rows)&&rows.some(r=>r.slot&&r.foods?.best)){
      const foods=mergeEnrichmentBatch(bundle.foods,bundle.foods,rows,'tags');changeBundle({...bundle,foods});notify('过敏原、忌口及餐次标签已保存，营养与份量保持不变');return;
    }
    if(bundle.foods.length) {
      const foods=mergeFoodSupplements(bundle.foods,Array.isArray(value)?{foods:value}:value);
      changeBundle({...bundle,foods});setEnrichPrompt('');
      const unresolved=value.unresolved?.length?`；${value.unresolved.length}项仍需人工补齐`:'';
      setSupplementFeedback({ok:true,message:`完整记录已自动确认，可直接测试；已有营养值保持不变，新补充营养值标记为AI参考估算${unresolved}。`});
      notify('补充信息已应用，库中营养数据已保留');return;
    }
    const allowed=new Map(bundle.foods.map(f=>[`${f.slot}|${f.name}`,f]));
    const foods=rows.map(f=>{
      const previous=allowed.get(`${f.slot}|${f.name}`);
      const source=previous?.dataSource==='real_library'&&JSON.stringify(previous.nutritionPer100g)===JSON.stringify(f.nutritionPer100g)?'real_library':f.dataSource==='sample'&&previous?.dataSource==='sample'?'sample':f.dataSource==='ai_estimate'?'ai_estimate':'manual';
      return {...f,dataSource:source,tagsReviewed:previous&&JSON.stringify(previous)===JSON.stringify(f)?previous.tagsReviewed:false};
    });
    const next={...bundle,foods:autoConfirmFoods(foods)};validatePool(next);changeBundle(next);notify('食物数据已应用，完整记录已自动确认');
  });
  const queryCandidates=async(index=null,more=false,mode='continue')=>{
    if(libraryController.current||exclusiveBusy)return;
    const indices=index===null?queryIndices(libraryRows,mode):[index];
    if(!indices.length){applyCachedMatches();return;}
    if(!cookie.trim()){setError('请先填写食物库登录Cookie');return;}
    setError('');setLibraryBusy(true);setMatchProgress('准备查询');
    const abort=new AbortController();libraryController.current=abort;
    try {
      const report=await runLibraryQueries(libraryRows,indices,{
        cookie,signal:abort.signal,resume:index===null,startNext:more,concurrency:3,
        onUpdate:rows=>{
          setLibraryRows(rows);
          setLibraryCache(cache=>cacheLibraryMatches(cache,rows));
        },
        onProgress:p=>setMatchProgress(libraryProgressText(p)),
      });
      setLibraryRows(report.rows);
      setLibraryCache(cache=>cacheLibraryMatches(cache,report.rows));
      confirmMatches(report.rows,true);
      const summary=libraryResultSummary(report.rows);
      setMatchProgress(`${report.cancelled?'已暂停':'本轮查询完成'} · ${summary.text}`);
      if(report.error||summary.error)setError(report.error||summary.error);
      else if(report.cancelled)notify('已暂停，查询结果已缓存并应用，可继续未完成查询');
      else if(!summary.matched)setError('真实食物库查询已返回，但尚无完全同名匹配。请查看每行下拉列表中的搜索结果；若状态为“待继续”，可再次深度查询后续页。不会自动选用近似食物。');
    }catch(e){setError(e.message);} finally {setLibraryBusy(false);libraryController.current=null;}
  };
  const fastMatchCandidates=async()=>{
    if(libraryController.current||exclusiveBusy)return;
    setError('');setLibraryBusy(true);
    const abort=new AbortController();libraryController.current=abort;
    try {
      let current=applyLibraryCache(libraryRows,libraryCache);
      setLibraryRows(current.rows);
      const cacheHits=current.hits;
      const runStage=async(label,indices)=>{
        if(!indices.length)return;
        if(!cookie.trim())throw new Error(`公共缓存命中${cacheHits}条；仍有${indices.length}条需要查询，请先填写食物库登录Cookie`);
        setMatchProgress(`${label} · 缓存命中 ${cacheHits}条 · 准备查询 ${indices.length}条`);
        const report=await runLibraryQueries(current.rows,indices,{
          cookie,signal:abort.signal,concurrency:3,maxPages:1,resume:false,rowTimeoutMs:15000,timeoutMs:10000,
          onUpdate:rows=>{setLibraryRows(rows);setLibraryCache(cache=>cacheLibraryMatches(cache,rows));},
          onProgress:p=>setMatchProgress(`${label} · 历史缓存复用 ${cacheHits}条 · ${libraryProgressText(p)}`),
        });
        current={rows:report.rows,hits:cacheHits,cancelled:report.cancelled,error:report.error};
        if(report.error)throw new Error(report.error);
      };
      await runStage('快速匹配最推荐',fastBestIndices(current.rows));
      if(!current.cancelled)await runStage('按需补充次推荐',secondaryFallbackIndices(current.rows));
      setLibraryRows(current.rows);
      setLibraryCache(cache=>cacheLibraryMatches(cache,current.rows));
      confirmMatches(current.rows,true);
      const summary=libraryResultSummary(current.rows),matchedCount=summary.matched;
      setMatchProgress(`${current.cancelled?'已暂停':'快速查询完成'} · 历史缓存复用${cacheHits}条 · ${summary.text}`);
      if(current.cancelled)notify('已暂停，已完成的匹配和缓存均已保留');
      else if(summary.error)setError(summary.error);
      else if(!matchedCount)setError(current.rows.some(row=>row.status==='error')?'本轮没有匹配成功，部分请求失败。请查看食物行的具体错误；若提示登录失效需更新Cookie，超时可只重查失败项。':'查询已返回，但第1页没有名称完全一致的记录。不是食物库没有数据，可点击「深度查询未匹配项」继续查找；不会自动用近似名称替代。');
      else notify('快速匹配完成：最推荐优先，次推荐仅在槽位不足时查询');
    }catch(e){setError(e.message);}finally{setLibraryBusy(false);libraryController.current=null;}
  };
  const applyCachedMatches=()=>{
    const cached=applyLibraryCache(libraryRows,libraryCache);
    const rows=cached.rows.map(r=>{const matched=matchExactRow(r,r.options,true);return matched.selectedId?matched:r;});
    setLibraryRows(rows);confirmMatches(rows,true);
    if(cached.hits)notify(`已从公共缓存复用${cached.hits}条匹配`);
  };
  const confirmMatches=(rows=libraryRows,automatic=false)=>guard(()=>{
    const latest=bundleRef.current;
    const {foods:preserved,issues}=mergeLibraryFoods(latest.foods,rows);
    changeBundle({...latest,foods:preserved});
    const details=issues.length?`；${issues.length}项需处理：${issues.slice(0,6).map(i=>`${i.name}（${i.reason}）`).join('、')}${issues.length>6?'等':''}`:'';
    const count=preserved.filter(f=>f.dataSource==='real_library').length;
    setSupplementFeedback({ok:!issues.length,message:`已关联${count}条食物库记录${details}。未命中项保留为待补充记录，可补录或由AI参考估算；标签与份量随后补齐。`});
    notify(`已关联${count}条库记录，${preserved.filter(f=>f.dataSource==='pending').length}项待补营养数据`);
  });
  const removeCandidate=(row)=>{
    const candidates={slotFoods:bundle.candidates.slotFoods.map(r=>r.slot===row.slot?{...r,foods:r.foods.filter(n=>n!==row.queryName),...(r.foodGroups?{foodGroups:Object.fromEntries(Object.entries(r.foodGroups).map(([key,names])=>[key,names.filter(n=>n!==row.queryName)]))}:{})}:r)};
    changeBundle({...bundle,candidates,foods:bundle.foods.filter(f=>f.slot!==row.slot||f.name!==row.queryName)});
    setEnrichPrompt('');notify('已移除候选；槽位为空时需先补充候选再测试');
  };
  const searchLibrary=async(page=1)=>{
    if(!cookie.trim()){setError('请填写已有食物库的登录Cookie');return;}
    if(!queryName.trim()){setError('请填写查询名称');return;}
    setBusy('search');setError('');const abort=new AbortController();controller.current=abort;
    try{const r=await fetch('/api/food-search',{method:'POST',headers:{'Content-Type':'application/json'},body:json({query:queryName,cookie,page}),signal:abort.signal});const d=await r.json();if(!r.ok)throw new Error(d.error);setSearchResults(page===1?d.foods:[...searchResults,...d.foods]);setSearchPage(page);}catch(e){setError(abort.signal.aborted?'查询已取消':e.message);}finally{setBusy('');controller.current=null;}
  };
  const chooseRecord=f=>guard(()=>{
    const base=Number(f.weight);if(f.unit!=='gram'||!Number.isFinite(base)||base<=0)throw new Error('此记录不是有效克重基准');
    const n=Object.fromEntries([['protein','protein'],['fat','fat'],['carbs','carbohydrate']].map(([k,v])=>[k,Number(f.nutrition?.[v])*100/base]));n.calories=Number(f.calorie)*100/base;
    if(Object.values(n).some(x=>!Number.isFinite(x)||x<0))throw new Error('库记录缺少有效营养数据');
    const previous=JSON.parse(editFood);
    const portions=(f.showUnits||[]).filter(u=>u.type==='custom'&&Number(u.weight)>0).map(u=>({grams:Number(u.weight),label:`1${u.name}`}));
    const updated={...previous,nutritionPer100g:n,dataSource:'real_library',libraryRecord:{id:f.id||f._id,name:f.name,weight:f.weight,unit:f.unit},tagsReviewed:false,...(portions.length?{portions}:{})};
    loadedRecord.current=updated;setEditFood(json(updated));setSearchResults([]);notify(portions.length?'已载入库数据，请确认标签与份量后保存':'已载入营养数据；库中没有份量，保留原档位待人工确认');
  });
  const saveFood=()=>guard(()=>{
    const f=JSON.parse(editFood);const old=bundle.foods[selectedFood];
    if(f.id!==old.id||f.name!==old.name||f.slot!==old.slot)throw new Error('单条编辑请保留ID、名称和槽位；更名需同步修改候选列表');
    const trusted=loadedRecord.current||old;
    const source=trusted.dataSource==='real_library' && JSON.stringify(f.nutritionPer100g)===JSON.stringify(trusted.nutritionPer100g) && JSON.stringify(f.libraryRecord)===JSON.stringify(trusted.libraryRecord)?'real_library':JSON.stringify(f.nutritionPer100g)===JSON.stringify(old.nutritionPer100g)?old.dataSource:'manual';
    const next={...bundle,foods:bundle.foods.map((row,i)=>i===selectedFood?{...f,preference:old.preference||'best',dataSource:source,tagsComplete:true,tagsReviewed:true}:row)};
    const edited=next.foods[selectedFood];
    if(!validMealTags(edited.mealTags))throw new Error('请补齐有效餐次标签：早餐、午餐、晚餐中至少一项');
    if(!Array.isArray(edited.ingredients)||(!edited.ingredients.length&&edited.tagSchemaVersion!==2)||!Array.isArray(edited.tags)||edited.tags.some(k=>!Object.hasOwn(ALL_TAGS,k))||!Array.isArray(edited.allergens)||!Array.isArray(edited.portions)||!edited.portions.length||edited.portions.some(p=>!Number.isFinite(p.grams)||p.grams<1||p.grams>1200||!p.label))throw new Error('请补齐有效配料、标签和份量档位');
    const n=edited.nutritionPer100g;
    if(!n||['calories','protein','fat','carbs'].some(k=>!Number.isFinite(n[k])||n[k]<0)||n.calories<=0||n.protein+n.fat+n.carbs>100.5)throw new Error('请补齐有效的每100克营养数据');
    changeBundle(next);setSelectedFood(null);setEnrichPrompt('');notify('已保存并确认此食物的营养、标签与份量');
  });
  const useImportedTemplate=t=>{
    const changed=json(t)!==json(bundle.template);
    const next={...bundle,template:t,...(changed?{previousTemplate:clone({template:bundle.template,candidates:bundle.candidates,foods:bundle.foods,notes:bundle.notes}),candidates:{slotFoods:[]},foods:[]}: {})};
    changeBundle(next);setLibraryRows(changed?[]:libraryRows);setTemplateFeedback(`已载入「${t.name}」：${t.days.length}天、每天${t.meals.length}餐、${getSlots(t).length}个槽位。`);
    notify('计划JSON已解析，模板表格已更新');
  };
  const importPlanJson=()=>guard(()=>{
    const plans=parsePlanTemplates(JSON.parse(planImportText));setImportedPlans(plans);useImportedTemplate(plans[0]);
  });
  const applyTemplate=()=>guard(()=>{
    const t=parsePlanTemplates(JSON.parse(templateText))[0];
    const changedSlots=json(getSlots(t).sort())!==json(getSlots(bundle.template).sort());
    const next={...bundle,template:t,...(changedSlots?{candidates:{slotFoods:[]},foods:[]}: {})};
    changeBundle(next);setEnrichPrompt('');notify(changedSlots?'槽位已变化，候选食物和数据已清空':'模板已应用，需要重新测试');
  });
  const applyCandidates=()=>{
    setError('');setCandidateApplyState(null);
    try {
      const candidates=normalizeCandidates(JSON.parse(candidateText),bundle.template);
      const allowed=new Set(candidates.slotFoods.flatMap(r=>r.foods.map(n=>`${r.slot}|${n}`)));
      changeBundle({...bundle,candidates,foods:syncFoodPreferences(candidates,bundle.foods.filter(f=>allowed.has(`${f.slot}|${f.name}`)))});
      setEnrichPrompt('');
      const total=candidates.slotFoods.reduce((n,row)=>n+row.foods.length,0);
      const secondary=candidates.slotFoods.reduce((n,row)=>n+candidateGroups(row).secondary.length,0);
      const message=`已应用 ${candidates.slotFoods.length} 个槽位、${total} 种候选食物（最推荐 ${total-secondary} 种、次推荐 ${secondary} 种）。两组均参与匹配，搭配优先使用最推荐。`;
      setCandidateApplyState({ok:true,message});notify(message);
    } catch(e) {
      const message=`应用失败：${e.message}`;
      setCandidateApplyState({ok:false,message});setError(message);
    }
  };
  const currentTest=test?.fingerprint===fingerprint(bundle)?test:null;
  const currentSelection=testSelection?.key===selectionKey(bundle,testUser)?testSelection:null;
  const approvedReady=currentTest?.result.status==='passed';
  let poolError='';try{validatePool(bundle);}catch(e){poolError=e.message;}
  const reviewed=bundle.foods.filter(f=>f.tagsReviewed).length;
  const phaseTitle=phase==='prep'?'预处理':'用户实时生成';
  const titles=STAGES[phase];
  const visibleFoods=bundle.foods.map((f,index)=>({...f,index})).filter(f=>(slotFilter==='all'||f.slot===slotFilter)&&f.name.includes(search));
  const prepDone=[true,bundle.candidates.slotFoods.length>0,!poolError&&reviewed===bundle.foods.length,Boolean(approvedReady),releases.some(r=>r.test.fingerprint===fingerprint(bundle))];
  const liveDone=[Boolean(matched),Boolean(filtered),Boolean(plan),Boolean(result)];
  const done=phase==='prep'?prepDone:liveDone;

  return <div className="lab-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Utensils size={21}/></div><div><b>OtterLife</b><small>Nutrition workspace</small></div></div><div className="workspace-name">饮食计划工作台 <Tag>LAB</Tag></div>
      <div className="phase-switch"><button className={phase==='prep'?'active':''} disabled={Boolean(busy)} onClick={()=>go('prep')}><Database size={15}/>预处理</button><button className={phase==='live'?'active':''} disabled={Boolean(busy)} onClick={()=>go('live')}><Play size={15}/>实时生成</button></div>
      <div className="nav-caption">{phase==='prep'?'PREPROCESSING':'LIVE GENERATION'}</div><nav aria-label="阶段步骤">{titles.map(([name,Icon],i)=><button key={name} className={`nav-step ${step===i?'active':''}`} disabled={Boolean(busy)} onClick={()=>go(phase,i)}><span className="nav-icon">{done[i]?<CheckCircle2 size={18}/>:<Icon size={18}/>}</span><span>{name}</span><small>{String(i+1).padStart(2,'0')}</small></button>)}</nav>
      <div className="sidebar-library"><span>本地已审核版本</span><b>{releases.length}<small> 个</small></b>{releases.slice(-2).map(r=><button key={r.releaseId} disabled={Boolean(busy)} onClick={()=>{changeBundle({template:r.template,candidates:r.candidates,foods:r.foods,notes:r.notes});go('prep');notify('已载入为工作草稿，已审核版本保持独立');}}><span>{r.template.name}</span><Tag>v{r.version}</Tag></button>)}</div>
      <div className="sidebar-footer"><Button icon={Settings2} onClick={()=>setShowApi(true)}>模型与API <span className={`status-dot ${config.apiKey?'ok':''}`}/></Button><Button icon={Download} onClick={exportData}>导出工作台</Button><div className="local-status"><span className="status-dot ok"/>本地保存已启用</div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div>饮食计划 <ChevronRight size={14}/><span>{phaseTitle}</span></div><div><Tag tone="green">验证环境</Tag><Button small icon={Settings2} onClick={()=>setShowApi(true)}>{config.apiKey?PROVIDERS[config.provider].label:'配置模型'}</Button></div></header>
      <main><div className="page-heading"><div><span className="eyebrow">NUTRITION / {phase==='prep'?'PREPROCESSING':'LIVE GENERATION'}</span><h1>{phase==='prep'?'准备可复用的饮食计划':'生成用户的七天饮食计划'}</h1></div><div className="heading-actions">{phase==='prep'&&<><Button icon={Upload} disabled={Boolean(busy)} onClick={()=>importRef.current.click()}>导入</Button><Button icon={Plus} disabled={Boolean(busy)} onClick={()=>{const b=blankBundle();b.template.id=`plan_${Date.now()}`;b.template.name='新饮食计划';changeBundle(b);go('prep');}}>新建模板</Button></>}<input ref={importRef} type="file" accept=".json,application/json" hidden onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());const b=data.bundle||data;validateBundleTemplate(b.template);if(b.foods?.length)validatePool(b);if(data.candidatePromptTemplate)renderCandidatePrompt(data.candidatePromptTemplate,b.template,data.candidateCount??count);changeBundle(b);if(data.candidatePromptTemplate){setCandidatePromptTemplate(data.candidatePromptTemplate);setCandidatePromptDraft(data.candidatePromptDraft??data.candidatePromptTemplate);setCount(data.candidateCount??count);}notify('已导入为草稿，请重新测试和审核');}catch(err){setError(err.message);}e.target.value='';}}/></div></div>
        <div className="workflow-track" role="tablist" aria-label={phaseTitle}>{titles.map(([name,Icon],i)=><button role="tab" aria-selected={step===i} className={step===i?'active':done[i]?'done':''} key={name} disabled={Boolean(busy)} onClick={()=>go(phase,i)}><span>{done[i]?<Check size={14}/>:String(i+1).padStart(2,'0')}</span>{name}{i<titles.length-1&&<ChevronRight size={13}/>}</button>)}</div>
        {error&&<div className="alert error" role="alert"><AlertCircle size={17}/><span>{error}</span><IconButton icon={X} label="关闭错误" onClick={()=>setError('')}/></div>}
        {exclusiveBusy&&<div className="alert busy" role="status"><LoaderCircle className="spin" size={17}/><span>{busy==='ai'?`AI正在生成 ${matchProgress}`:['search','library'].includes(busy)?`正在查询食物库 ${matchProgress}`:`正在并行计算份量 · 已用 ${solveElapsed.toFixed(1)} 秒`}{progress?` · 已完成 ${progress.completed} / ${progress.total} 天${progress.active!=null?` · ${progress.active}路运行中`:''}`:''}{progress?.searchMode?` · 第${progress.day}天 · ${{current:'初始搭配份量搜索',best:'全部Best食物与份量联合搜索',all:'Best与次推荐全部候选联合搜索',closest:'生成热量最接近方案'}[progress.searchMode]}`:''}</span><Button small icon={X} onClick={cancel}>取消</Button></div>}
        {libraryBusy&&<div className="alert busy" role="status"><LoaderCircle className="spin" size={17}/><span>食物库查询 · {matchProgress}</span><Button small icon={X} onClick={()=>libraryController.current?.abort()}>暂停查询</Button></div>}
        {!['tags','portions'].includes(enrichProgress?.scope)&&<EnrichmentProgress progress={enrichProgress} busy={enrichBusy} elapsed={elapsed} onCancel={()=>enrichController.current?.abort()}/>}
        <div className="content-heading"><div><span className="step-label">{phase==='prep'?'预处理':'实时生成'} / {String(step+1).padStart(2,'0')}</span><h2>{titles[step][0]}</h2></div>{phase==='prep'&&<Tag>{bundle.template.name}</Tag>}</div>

        {phase==='prep'&&step===0&&<>
          <div className="section-line"><strong>用户选择</strong><Tag tone="green">第一步仅传以下5个字段</Tag></div>
          <div className="form-grid three">
            <Field label="目的"><select value={planInput.目的} onChange={e=>setPlanInput({...planInput,目的:e.target.value})}><option>减脂</option><option>增肌</option><option>维持</option></select></Field>
            <Field label="每日餐数"><select value={planInput.每日餐数} onChange={e=>setPlanInput({...planInput,每日餐数:e.target.value})}><option>一天3顿</option><option>一天2顿</option></select></Field>
            <Field label="饮食策略"><select value={planInput.饮食策略} onChange={e=>setPlanInput({...planInput,饮食策略:e.target.value})}><option>日常饮食</option><option>地中海饮食</option><option>素食</option><option>生酮饮食</option><option>低碳饮食</option></select></Field>
            <Field label="计划天数"><input type="number" value={7} readOnly/></Field>
            <Field label="运动习惯"><select value={planInput.运动习惯} onChange={e=>setPlanInput({...planInput,运动习惯:e.target.value})}><option>规律运动</option><option>不怎么运动</option></select></Field>
          </div>
          <div className="actions"><Button primary icon={Sparkles} disabled={Boolean(busy)} onClick={()=>aiGenerate('plan')}>AI生成计划模板</Button></div>
          <details><summary>第一步实际发送提示词</summary><JsonEditor label="计划模板提示词" value={planPrompt} rows={16}/></details>
          <div className="section-line spaced"><strong>AI结果或手动粘贴</strong><Tag tone="blue">JSON</Tag></div>
          <div className="section-line"><strong>粘贴饮食计划</strong><Tag tone="blue">JSON</Tag></div>
          <JsonEditor label="饮食计划JSON" value={planImportText} onChange={setPlanImportText} rows={9} action={<Button primary icon={Check} disabled={Boolean(busy)} onClick={importPlanJson}>解析并展示计划</Button>}/>
          {importedPlans.length>1&&<Field label="当前展示的计划"><select aria-label="选择已导入计划" value={bundle.template.id} onChange={e=>useImportedTemplate(importedPlans.find(t=>t.id===e.target.value))}>{importedPlans.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
          {templateFeedback&&<div className="alert busy" role="status">{templateFeedback}</div>}
          {importedPlans.length>0&&<div className="actions"><Button primary icon={ArrowRight} disabled={Boolean(busy)} onClick={()=>go('prep',1)}>进入第二步：生成候选食物</Button></div>}
          {bundle.template.planDescription?.length>0&&<div className="plan-description">{bundle.template.planDescription.map((d,i)=><div key={i}><strong>{d.type}</strong><p>{d.content}</p></div>)}</div>}
          <div className="section-line"><strong>计划设置</strong><div className="actions"><Button small icon={LayoutTemplate} disabled={Boolean(busy)} onClick={()=>{changeBundle(applyCurrentStructure(bundle));notify('已应用新版7天三餐结构，保留五类食物；旧结构与数据已随草稿备份');}}>应用新版7天结构</Button><Button small icon={FlaskConical} disabled={Boolean(busy)} onClick={loadSample}>载入演示方案</Button></div></div>
          <div className="form-grid three"><Field label="计划名称"><input value={bundle.template.name} disabled={Boolean(busy)} onChange={e=>changeBundle({...bundle,template:{...bundle.template,name:e.target.value}})}/></Field><Field label="计划目标"><select value={bundle.template.goal} onChange={e=>changeBundle({...bundle,template:{...bundle.template,goal:e.target.value}})}>{Object.entries(GOALS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="饮食习惯匹配"><select value={bundle.template.match.habit} onChange={e=>changeBundle({...bundle,template:{...bundle.template,match:{...bundle.template.match,habit:e.target.value}}})}><option value="regular">普通均衡饮食</option><option value="vegetarian">蛋奶素</option><option value="mediterranean">地中海饮食</option><option value="lowCarb">低碳饮食</option><option value="keto">生酮饮食</option></select></Field></div>
          <div className="section-line spaced"><strong>全天营养目标</strong><Tag>全天校验，各餐单独控制热量</Tag></div><div className="form-grid six">{[['protein','蛋白质 %'],['fat','脂肪 %'],['carbs','碳水 %']].map(([k,label])=><Field key={k} label={label}><input type="number" value={bundle.template.macroRatio[k]} onChange={e=>changeBundle({...bundle,template:{...bundle.template,macroRatio:{...bundle.template.macroRatio,[k]:Number(e.target.value)}}})}/></Field>)}{[['macroTolerance','比例容差 ±百分点'],['calorieTolerance','日热量容差 ±%'],['mealTolerance','餐热量容差 ±%']].map(([k,label])=><Field key={k} label={label}><input type="number" value={bundle.template[k]} onChange={e=>changeBundle({...bundle,template:{...bundle.template,[k]:Number(e.target.value)}})}/></Field>)}</div>
          <div className="section-line spaced"><strong>7天餐次结构</strong><div className="legend"><span className="status-dot ok"/>必选 <span className="status-dot"/>可选</div></div><TemplateGrid template={bundle.template} onEdit={(day,id)=>setMealEdit({day,id})}/>
          {bundle.template.slotConstraints?.length>0&&<><div className="section-line spaced"><strong>各槽位选食规则</strong></div><div className="table-scroll"><table><thead><tr><th>槽位</th><th>约束规则</th></tr></thead><tbody>{bundle.template.slotConstraints.map(s=><tr key={s.slot}><td>{SLOT_NAMES[s.slot]}</td><td>{s.rules}</td></tr>)}</tbody></table></div></>}
          <details className="spaced"><summary>槽位定义与完整模板 JSON</summary><JsonEditor label="模板JSON" value={templateText} onChange={setTemplateText} action={<Button icon={Check} disabled={Boolean(busy)} onClick={applyTemplate}>应用模板JSON</Button>}/></details>
          <div className="section-line spaced"><strong>可复用槽位 · {getSlots(bundle.template).length}</strong></div><div className="slot-definitions">{getSlots(bundle.template).map(s=><div key={s}><b>{SLOT_NAMES[s]}</b><span>{bundle.template.slotDefinitions[s]}</span></div>)}</div>
        </>}

        {phase==='prep'&&step===1&&<>
          <div className="section-line"><strong>粘贴槽位食物列表</strong><Tag>{getSlots(bundle.template).length}个槽位</Tag></div>
          <JsonEditor label="候选食物JSON" value={candidateText} onChange={value=>{setCandidateText(value);setCandidateApplyState(null);}} rows={12} action={<Button primary icon={Check} disabled={Boolean(busy)} onClick={applyCandidates}>应用候选列表</Button>}/>
          {candidateApplyState&&<div className={`alert ${candidateApplyState.ok?'busy':'error'}`} role={candidateApplyState.ok?'status':'alert'} data-testid="candidate-apply-feedback"><span>{candidateApplyState.message}</span></div>}
          <div className="table-scroll"><table><thead><tr><th>槽位</th><th>总数</th><th>最推荐</th><th>次推荐 · 替换选择</th></tr></thead><tbody>{bundle.candidates.slotFoods.map(row=><tr key={row.slot}><td><strong>{SLOT_NAMES[row.slot]}</strong><small>{row.slot}</small></td><td>{row.foods.length}</td><td><Tag tone="green">{candidateGroups(row).best.length}种</Tag><p>{candidateGroups(row).best.join('、')||'无'}</p></td><td><Tag>{candidateGroups(row).secondary.length}种</Tag><p>{candidateGroups(row).secondary.join('、')||'无'}</p></td></tr>)}</tbody></table></div>
          <section className="spaced">
          <div className="section-line"><strong>第二步 · AI生成候选食物</strong><Tag tone="green">已自动使用第一步结果</Tag></div>
          <div className="form-grid three"><Field label="地域范围"><select aria-label="地域范围" value={foodRegion} onChange={e=>setFoodRegion(e.target.value)}><option>中国大陆</option><option>北美饮食区</option><option>日本饮食区</option><option>欧洲饮食区</option><option>拉丁美洲饮食区</option><option>东南亚饮食区</option><option>全球通用</option></select></Field><Field label="计划"><input readOnly value={bundle.template.name}/></Field><Field label="槽位数"><input readOnly value={`${getSlots(bundle.template).length} 个槽位`}/></Field></div>
          <details><summary>第二步自动拼装输入</summary><JsonEditor label="候选食物生成输入" value={json(candidatePromptInput(bundle.template,foodRegion,planInput))} rows={12}/></details>
          <details><summary>候选生成提示词 · {promptDirty?'有未保存修改':'已保存'}</summary><JsonEditor label="候选提示词模板" value={candidatePromptDraft} onChange={setCandidatePromptDraft} rows={18} action={<><Button primary icon={Save} disabled={Boolean(busy)} onClick={saveCandidatePrompt}>保存并应用提示词</Button><Button icon={RotateCcw} disabled={Boolean(busy)} onClick={()=>{setCandidatePromptDraft(candidatePromptTemplate);notify('已恢复为上次保存的提示词');}}>恢复已保存版本</Button><Button icon={RotateCcw} disabled={Boolean(busy)} onClick={()=>{setCandidatePromptTemplate(DEFAULT_CANDIDATE_PROMPT);setCandidatePromptDraft(DEFAULT_CANDIDATE_PROMPT);notify('已恢复并保存默认提示词');}}>恢复默认提示词</Button></>}/><div className="slot-list"><Tag>{'${testContent}'}</Tag></div></details>
          {promptError&&<div className="alert error" role="alert">{promptError}</div>}
          {promptDirty&&<div className="alert warning" role="status">提示词有未保存修改。保存并应用后再生成。</div>}
          <details><summary>实际发送提示词 · 含地域与第一步结果</summary><JsonEditor label="实际发送提示词" value={prompt} rows={18}/></details>
          <div className="actions"><Button primary icon={Sparkles} disabled={Boolean(busy)||Boolean(promptError)||promptDirty} onClick={()=>aiGenerate('candidates')}>第二步：AI生成候选食物</Button><Button icon={Copy} disabled={Boolean(promptError)||promptDirty} onClick={()=>navigator.clipboard.writeText(prompt).then(()=>notify('已复制实际发送提示词')).catch(()=>setError('复制失败'))}>复制提示词</Button></div>
          </section>
        </>}

        {phase==='prep'&&step===2&&<>
          <div className="metrics"><div><span>候选食物</span><b>{bundle.candidates.slotFoods.reduce((s,r)=>s+r.foods.length,0)}</b></div><div><span>已补齐数据</span><b>{bundle.foods.filter(f=>!needsEnrichment(f)).length}</b></div><div><span>完整记录已自动确认</span><b>{reviewed}<small> / {bundle.foods.length}</small></b></div><div><span>数据来源</span><b className="source-text">{[...new Set(bundle.foods.map(f=>SOURCE_NAMES[f.dataSource]))].join(' / ')||'—'}</b></div></div>
          <div className="section-line"><strong>1. 匹配已有食物库</strong><Tag tone="blue">营养数据优先来自食物库</Tag></div>
          <div className="form-grid"><Field label="食物库登录Token / Cookie"><input type="password" aria-label="批量匹配Cookie" autoComplete="off" value={cookie} onChange={e=>setCookie(e.target.value)}/></Field><div className="align-bottom actions"><Button primary icon={Search} disabled={Boolean(exclusiveBusy)||libraryBusy||!libraryRows.length} onClick={fastMatchCandidates}>快速查询真实食物库</Button><Button icon={Check} disabled={Boolean(exclusiveBusy)||libraryBusy||(!libraryRows.some(r=>r.options.length)&&!Object.keys(libraryCache).length)} onClick={applyCachedMatches}>仅使用缓存</Button><Button icon={RotateCcw} disabled={Boolean(exclusiveBusy)||libraryBusy||!libraryRows.length} onClick={()=>queryCandidates(null,false,'unmatched')}>真实食物库深度查询</Button><Button icon={X} onClick={()=>{setCookie('');setRememberCookie(false);}}>清除登录凭证</Button></div></div>
          {libraryRows.some(row=>!hasLibraryMatch(row)&&row.status==='error')&&<Button small icon={RotateCcw} disabled={Boolean(exclusiveBusy)||libraryBusy} onClick={()=>queryCandidates(null,false,'failed')}>仅重试查询失败项</Button>}
          <label className="checkbox-line"><input type="checkbox" checked={rememberCookie} onChange={e=>setRememberCookie(e.target.checked)}/>在此浏览器记住食物库凭证</label>
          <p className="muted">{rememberCookie?'凭证将以明文保存在本机浏览器，请勿在共享设备上启用；不会随工作台导出。':'未开启时凭证仅保留在当前页面。'} 查询来源：OtterLife真实食物库</p>
          <div className="table-scroll"><table className="library-match-table"><thead><tr><th>候选 / 槽位</th><th>查询关键词</th><th>匹配库记录</th><th>状态</th><th>操作</th></tr></thead><tbody>{libraryRows.map((row,index)=><tr key={`${row.slot}|${row.queryName}`}><td><b>{row.queryName}</b><small>{SLOT_NAMES[row.slot]} · {row.preference==='secondary'?'次推荐':'最推荐'}</small></td><td><input aria-label={`查询词 ${row.queryName}`} value={row.searchTerm} disabled={Boolean(exclusiveBusy)||libraryBusy||enrichBusy} onChange={e=>setLibraryRows(rows=>rows.map((r,i)=>i===index?{...r,searchTerm:e.target.value,page:0,options:[],selectedId:'',selectionSource:'',status:'pending',error:''}:r))}/></td><td><select aria-label={`匹配记录 ${row.queryName}`} value={row.selectedId} disabled={Boolean(exclusiveBusy)||libraryBusy||enrichBusy} onChange={e=>setLibraryRows(rows=>rows.map((r,i)=>i===index?{...r,selectedId:e.target.value,selectionSource:e.target.value?'manual':''}:r))}><option value="">{row.status==='pending'?'尚未查询':['partial','error'].includes(row.status)?'查询未完成，可继续':'无同名记录，待补充'}</option>{row.options.map(f=><option key={String(f.id||f._id)} value={String(f.id||f._id)}>{f.name} · {f.calorie??'缺热量'} kcal / {f.weight??'?'}g · {f.id||f._id}</option>)}</select>{row.exactCount>1&&<small>同名{row.exactCount}条，默认采用首条</small>}{row.selectedId&&<small>{(row.options.find(f=>String(f.id||f._id)===row.selectedId)?.showUnits||[]).filter(u=>u.type==='custom').map(u=>`${u.name} ${u.weight}g`).join(' / ')||'缺少可执行单位，补充信息时完善'}</small>}</td><td><Tag tone={row.selectedId?'green':row.status==='pending'?'':'amber'}>{row.selectedId?(row.selectionSource==='exact'?'同名自动匹配':'已选择'):row.status==='pending'?'待查询':row.status==='partial'?'待继续':row.status==='error'?'查询失败':'待补营养'}</Tag>{row.error&&<small>{row.error}</small>}{row.page>0&&<small>已缓存至第{row.page}页</small>}</td><td><div className="actions"><Button small icon={Search} disabled={Boolean(exclusiveBusy)||libraryBusy||enrichBusy} onClick={()=>queryCandidates(index)}>查询</Button>{row.page>0&&<Button small disabled={Boolean(exclusiveBusy)||libraryBusy||enrichBusy} onClick={()=>queryCandidates(index,true)}>更多</Button>}<IconButton icon={X} label={`移除候选 ${row.queryName}`} disabled={Boolean(exclusiveBusy)||libraryBusy||enrichBusy} onClick={()=>removeCandidate(row)}/></div></td></tr>)}</tbody></table></div>
          <div className="actions"><Tag>{libraryRows.filter(hasLibraryMatch).length} / {libraryRows.length} 条已匹配</Tag></div>
          {supplementFeedback&&<div className={`alert ${supplementFeedback.ok?'busy':'warning'}`} role="status" data-testid="supplement-feedback">{supplementFeedback.message}</div>}
          <div className="section-line spaced"><strong>2. 补充缺失营养</strong><Tag>仅处理缺失营养数据</Tag></div>
          <div className="actions"><Button icon={Sparkles} disabled={Boolean(exclusiveBusy)||enrichBusy||!libraryRows.length} onClick={()=>startEnrichment('nutrition')}>AI补缺失营养（{enrichmentQueue(bundle.foods).length}条）</Button><Button icon={Plus} disabled={Boolean(exclusiveBusy)||enrichBusy||!libraryRows.length} onClick={()=>confirmMatches(libraryRows,true)}>创建待补充记录</Button></div>
          <details><summary>营养补充提示词</summary><JsonEditor label="营养补充提示词" value={enrichPrompt||enrichmentPrompt(bundle.template,bundle.candidates,enrichmentQueue(bundle.foods),'nutrition')} onChange={setEnrichPrompt}/></details>
          {[['tags','打标签'],['portions','补充可执行份量']].map(([scope,label],i)=><section key={scope}>
            <div className="section-line"><strong>{i+3}. {label}</strong><Tag>{enrichmentQueue(bundle.foods,scope).length}条待处理</Tag></div>
            <div className="actions"><Button primary icon={Sparkles} disabled={Boolean(exclusiveBusy)||enrichBusy||!bundle.foods.length} onClick={()=>startEnrichment(scope)}>AI{label}（{enrichmentQueue(bundle.foods,scope).length}条）</Button></div>
            <EnrichmentProgress progress={enrichProgress?.scope===scope?enrichProgress:enrichHistory[scope]} busy={enrichBusy&&enrichProgress?.scope===scope} elapsed={enrichProgress?.scope===scope?elapsed:0} onCancel={()=>enrichController.current?.abort()}/>
            <details><summary>{label}提示词</summary><JsonEditor label={`${label}提示词`} value={scopedPrompts[scope]||enrichmentPrompt(bundle.template,bundle.candidates,enrichmentQueue(bundle.foods,scope),scope)} onChange={value=>setScopedPrompts(p=>({...p,[scope]:value}))}/></details>
          </section>)}
          <div className="slot-list spaced"><Tag tone="amber">缺营养 {enrichmentQueue(bundle.foods).length}条</Tag><Tag>待打标签 {enrichmentQueue(bundle.foods,'tags').length}条</Tag><Tag>待补份量 {enrichmentQueue(bundle.foods,'portions').length}条</Tag><Tag tone="green">全部完整 {bundle.foods.filter(f=>!needsEnrichment(f)).length}条</Tag></div>
          <div className="section-line spaced"><strong>食物数据</strong><div className="filters"><select aria-label="按槽位筛选" value={slotFilter} onChange={e=>setSlotFilter(e.target.value)}><option value="all">全部槽位</option>{getSlots(bundle.template).map(s=><option key={s} value={s}>{SLOT_NAMES[s]}</option>)}</select><div className="search"><Search size={14}/><input placeholder="搜索食物" aria-label="搜索食物" value={search} onChange={e=>setSearch(e.target.value)}/></div></div></div>
          {bundle.foods.length?<div className="table-scroll"><table><thead><tr><th>食物 / 槽位</th><th>每100g · P / F / C</th><th>过敏原 / 忌口</th><th>适用餐次</th><th>可执行份量</th><th>来源 / 状态</th><th></th></tr></thead><tbody>{visibleFoods.map(f=><tr key={f.id}><td><b>{f.name}</b><small>{SLOT_NAMES[f.slot]} · {f.preference==='secondary'?'次推荐':'最推荐'}</small></td><td>{f.nutritionPer100g?<>{f.nutritionPer100g.protein} / {f.nutritionPer100g.fat} / {f.nutritionPer100g.carbs}<small>{fmt(f.nutritionPer100g.calories)} kcal</small></>:<Tag tone="amber">待补营养数据</Tag>}</td><td><div className="slot-list">{f.tags.map(k=><Tag key={k}>{ALL_TAGS[k]}</Tag>)}{!f.tags.length&&<span className="muted">无所列标签</span>}</div></td><td><div className="slot-list">{validMealTags(f.mealTags)?f.mealTags.map(tag=><Tag key={tag} tone="blue">{tag}</Tag>):<Tag tone="amber">待打餐次标签</Tag>}</div></td><td className="portion-cell">{f.portions.map(p=>p.label).join(' / ')}</td><td><small>{SOURCE_NAMES[f.dataSource]}</small>{f.nutritionReference&&<small className="nutrition-reference">参考：{f.nutritionReference}</small>}<Tag tone={f.tagsReviewed?'green':'amber'}>{f.tagsReviewed?'已确认':needsNutrition(f)?'缺营养':'缺其他信息'}</Tag>{!f.tagsReviewed&&<small>缺：{missingFoodFields(f).join('、')}</small>}</td><td><Button small disabled={Boolean(busy)} onClick={()=>{setSelectedFood(f.index);setEditFood(json(bundle.foods[f.index]));setQueryName(f.name);setSearchResults([]);}}>编辑</Button></td></tr>)}</tbody></table></div>:<Empty>应用候选列表后，补齐每个食物的数据</Empty>}
          <details className="spaced"><summary>查看食物数据 / 粘贴AI补充结果</summary><JsonEditor label="食物数据JSON" value={foodText} onChange={setFoodText} action={<Button primary icon={Check} disabled={Boolean(busy)} onClick={applyFoods}>{bundle.foods.length?'应用补充信息':'应用食物数据'}</Button>}/></details>
          {poolError&&<div className="alert warning">{poolError}</div>}
        </>}

        {phase==='prep'&&step===3&&<>
          <div className="form-grid three"><Field label="测试每日目标热量 kcal"><input aria-label="测试每日目标热量" type="number" min="800" max="5000" value={testUser.calories} onChange={e=>{setTestUser({...testUser,calories:Number(e.target.value)});setTest(null);}}/></Field><Field label="随机种子"><input aria-label="随机种子" type="number" value={seed} onChange={e=>{setSeed(Number(e.target.value));setTest(null);setPlan(null);setResult(null);}}/></Field><Field label="食物重复软上限"><input aria-label="食物重复软上限" type="number" min="1" max="21" value={maxRepeat} onChange={e=>{setMaxRepeat(Number(e.target.value));setTest(null);setPlan(null);setResult(null);}}/></Field></div>
          <TagPicker values={testUser.blockedTags} onChange={blockedTags=>{setTestUser({...testUser,blockedTags});setTest(null);}}/>
          <div className="section-line spaced"><strong>第一步 · 确定每天每餐吃什么</strong><Button primary icon={Grid2X2} disabled={Boolean(busy)} onClick={prepareTestSelection}>{currentSelection?'重新生成餐食搭配':'生成7天餐食搭配'}</Button></div>
          <SelectionView plan={currentSelection?.plan} template={bundle.template} foods={currentSelection?.foods||[]}/>
          {currentSelection&&<details><summary>第一步餐食JSON（不含克重）</summary><JsonEditor label="无克重餐食JSON" value={json(currentSelection.plan)}/></details>}
          <div className="section-line spaced"><span className="muted">最多4天并行计算，每一天最多求解15秒；未完全达标时以每日总热量绝对偏差最小为第一优先级返回最接近方案。</span><Tag>4路并行 · 15秒 / 天</Tag></div>
          <div className="section-line spaced"><strong>第二步 · 计算份量并校验</strong><Button primary icon={Calculator} disabled={Boolean(busy)||!currentSelection} onClick={()=>runSolve('test',bundle,testUser,currentSelection.plan)}>计算7天份量并校验</Button></div>
          {currentTest?<ResultView result={currentTest.result} plan={currentTest.plan} activeDay={activeDay} setActiveDay={setActiveDay}/>:<Empty>{currentSelection?'餐食已确定，尚未计算份量':'请先完成第一步'}</Empty>}
          {currentTest&&<div className="section-line spaced"><strong>AI质量测评</strong><Button primary icon={Sparkles} disabled={Boolean(busy)||reviewBusy} onClick={()=>reviewRecipe(currentTest.result,bundle,testUser,currentSelection?.foods||bundle.foods)}>{reviewBusy?'AI测评中…':'AI一键测评食谱'}</Button></div>}
          {recipeReview&&<div className="result-banner success"><div><strong>AI评分 · {recipeReview.score}分</strong><span>{recipeReview.conclusion}</span></div><div><b>{(recipeReview.durationMs/1000).toFixed(1)}秒</b><span>{recipeReview.model}</span></div></div>}
          <RecipeReviewHistory items={reviewHistory} onClear={()=>{if(confirm('确定清空全部食谱生成与评分历史吗？此操作无法撤销。'))setReviewHistory([]);}}/>
          {testHistory.length>0&&<details className="spaced"><summary>本次会话测试记录 · {testHistory.length}</summary>{testHistory.map((t,i)=><div className="history-row" key={i}><span>{new Date(t.time).toLocaleTimeString()} · {t.user.calories} kcal</span><Tag tone={t.result.status==='passed'?'green':'amber'}>{t.result.summary.passed}/7通过</Tag></div>)}</details>}
        </>}

        {phase==='prep'&&step===4&&<>
          <div className="review-checks">{[[true,'模板配置',`${bundle.template.days.length}天 · ${getSlots(bundle.template).length}个槽位`],[!poolError,'食物数据完整',poolError||`${bundle.foods.length}条食物数据已补齐`],[bundle.foods.length>0&&reviewed===bundle.foods.length,'数据自动确认',`${reviewed}/${bundle.foods.length}条已确认`],[approvedReady,'当前版本测试',currentTest?`${currentTest.result.summary.passed}/7天通过`:'尚未完成当前版本测试']].map(([pass,title,desc])=><div key={title}><CheckCircle2 size={20} className={pass?'green-text':'muted'}/><div><b>{title}</b><small>{desc}</small></div><Tag tone={pass?'green':'amber'}>{pass?'完成':'待处理'}</Tag></div>)}</div>
          <Field label="审核备注"><textarea disabled={Boolean(busy)} value={bundle.notes||''} onChange={e=>changeBundle({...bundle,notes:e.target.value})} rows={3}/></Field>
          <label className="checkbox-line"><input type="checkbox" checked={reviewConfirmed} onChange={e=>setReviewConfirmed(e.target.checked)}/>我已核对数据来源、食材标签和可执行份量，确认此版本用于内部测试。</label>
          <div className="actions"><Button primary icon={ShieldCheck} disabled={Boolean(busy)||!reviewConfirmed} onClick={()=>guard(()=>{const release=approveBundle(bundle,currentTest,releases);setReleases(rs=>[...rs,release]);notify(`已保存审核版本 v${release.version}`);})}>审核并保存版本</Button><Button icon={Download} onClick={()=>download('meal-template-draft.json',{schemaVersion:2,bundle})}>导出当前草稿</Button></div>
          <div className="section-line spaced"><strong>已审核版本</strong><Button icon={ArrowRight} disabled={!releases.length} onClick={()=>go('live')}>进入用户实时生成</Button></div>{releases.length?<div className="release-list">{[...releases].reverse().map(r=><div key={r.releaseId}><div><b>{r.template.name} <Tag>v{r.version}</Tag></b><small>{new Date(r.publishedAt).toLocaleString()} · {r.foods.length}种食物 · {r.test.result.summary.passed}/7天通过</small></div><Button small icon={Download} onClick={()=>download(`${r.releaseId}.json`,{bundle:{template:r.template,candidates:r.candidates,foods:r.foods,notes:r.notes}})}>导出</Button></div>)}</div>:<Empty>暂无已审核版本</Empty>}
        </>}

        {phase==='live'&&step===0&&<>
          {!releases.length&&<div className="alert warning">请先在预处理阶段完成模板测试并保存审核版本。</div>}
          <div className="form-grid three"><Field label="你的主要目标是什么？"><select aria-label="用户目标" value={user.goal} onChange={e=>patchUser('goal',e.target.value)}>{Object.entries(GOALS).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></Field><Field label="你通常一天吃几顿正餐？"><select aria-label="用户餐数" value={user.mealCount} onChange={e=>patchUser('mealCount',Number(e.target.value))}><option value="3">三餐</option><option value="2">两餐：午餐＋晚餐</option></select></Field><Field label="你目前更接近哪种饮食习惯？"><select aria-label="用户饮食习惯" value={user.habit} onChange={e=>patchUser('habit',e.target.value)}><option value="regular">普通均衡饮食</option><option value="vegetarian">蛋奶素</option><option value="mediterranean">地中海饮食</option><option value="lowCarb">低碳饮食</option><option value="keto">生酮饮食</option></select></Field><Field label="你平均每周锻炼几次？"><select aria-label="用户运动频率" value={user.training} onChange={e=>patchUser('training',Number(e.target.value))}><option value="0">几乎不锻炼</option><option value="2">每周1–2次</option><option value="4">每周3–4次</option><option value="5">每周5次及以上</option></select></Field><Field label="每日目标热量 · 已有数据 kcal"><input aria-label="用户每日目标热量" type="number" min="800" max="5000" value={user.calories} onChange={e=>patchUser('calories',Number(e.target.value))}/></Field><Field label="其他不吃的食材（逗号分隔）"><input aria-label="其他忌口" value={user.avoids} onChange={e=>patchUser('avoids',e.target.value)}/></Field></div>
          <TagPicker values={user.blockedTags} onChange={tags=>patchUser('blockedTags',tags)} vegetarian={user.habit==='vegetarian'}/>
          <div className="actions"><Button primary icon={Play} disabled={Boolean(busy)} onClick={()=>guard(()=>{if(!Number.isFinite(user.calories)||user.calories<800||user.calories>5000)throw new Error('目标热量需要在800–5000 kcal之间');const r=matchRelease(releases,user);resetLive();if(!r)throw new Error('暂无匹配的已审核模板。请在预处理阶段新增对应目标、餐数和饮食习惯的模板。');setMatched(r);notify('已匹配审核版本');})}>匹配饮食计划</Button></div>
          {matched&&<div className="match-result"><CheckCircle2 size={24}/><div><small>匹配成功 · {matched.releaseId}</small><h3>{matched.template.name}</h3><p>目标：{GOALS[user.goal]} · {user.mealCount}餐 · 训练频率 ≥ {matched.template.match.trainingMin}次/周</p><p>每日 {user.calories} kcal · P {matched.template.macroRatio.protein}% / F {matched.template.macroRatio.fat}% / C {matched.template.macroRatio.carbs}%</p></div><Tag tone="green">v{matched.version}</Tag></div>}
          <details className="spaced"><summary>可用模板与映射规则</summary>{releases.map(r=><div className="history-row" key={r.releaseId}><span>{r.template.name} · v{r.version}</span><code>{json(r.template.match)}</code></div>)}</details>
        </>}

        {phase==='live'&&step===1&&<>
          {!matched?<Empty>请先匹配已审核的饮食计划</Empty>:<><div className="section-line"><strong>{matched.template.name} · v{matched.version}</strong><Button primary icon={ListFilter} disabled={Boolean(busy)} onClick={()=>guard(()=>{setFiltered(filterPool(matched,user));setPlan(null);setResult(null);notify('标签过滤已完成');})}>按用户条件过滤</Button></div>{filtered&&<><div className="metrics"><div><span>原始食物池</span><b>{matched.foods.length}</b></div><div><span>保留</span><b>{filtered.foods.length}</b></div><div><span>排除</span><b>{filtered.excluded.length}</b></div><div><span>必选候选缺口</span><b>{filtered.shortages.filter(s=>s.required).length}</b></div></div>{filtered.shortages.length>0&&<div className="alert warning">{filtered.shortages.map(s=>`第${s.day}天${s.meal}：${SLOT_NAMES[s.slot]}${s.required?'必选缺失':'可选跳过'}`).join('；')}</div>}<div className="table-scroll"><table><thead><tr><th>槽位</th><th>保留数量</th><th>可选食物</th></tr></thead><tbody>{getSlots(matched.template).map(s=><tr key={s}><td>{SLOT_NAMES[s]}</td><td>{filtered.foods.filter(f=>f.slot===s).length}</td><td>{filtered.foods.filter(f=>f.slot===s).map(f=>f.name).join('、')||'无'}</td></tr>)}</tbody></table></div><div className="section-line spaced"><strong>排除记录</strong></div>{filtered.excluded.length?<div className="table-scroll"><table><thead><tr><th>食物</th><th>排除原因</th></tr></thead><tbody>{filtered.excluded.map(f=><tr key={f.id}><td>{f.name}</td><td>{f.reason}</td></tr>)}</tbody></table></div>:<p className="muted">当前条件没有排除食物。</p>}</>}</>}
        </>}

        {phase==='live'&&step===2&&<>
          <div className="form-grid three"><Field label="随机种子"><input aria-label="实时随机种子" type="number" value={seed} onChange={e=>{setSeed(Number(e.target.value));setPlan(null);setResult(null);}}/></Field><Field label="食物重复软上限"><input aria-label="实时重复上限" type="number" value={maxRepeat} onChange={e=>{setMaxRepeat(Number(e.target.value));setPlan(null);setResult(null);}}/></Field><div className="align-bottom"><Button primary icon={Grid2X2} disabled={Boolean(busy)||!filtered||filtered.shortages.some(s=>s.required)} onClick={()=>guard(()=>{const p=profileFor(matched.template,user);setPlan(compose(p,matched.template,filtered.foods,rules(matched.template)));setResult(null);setActiveDay(1);notify('已按逐日模板生成7天搭配');})}>生成7天搭配</Button></div></div>
          <SelectionView plan={plan} template={matched?.template} foods={filtered?.foods||[]}/>
          {plan&&<details><summary>搭配JSON</summary><JsonEditor label="搭配JSON" value={json(plan)}/></details>}
        </>}

        {phase==='live'&&step===3&&<>
          <div className="section-line spaced"><span className="muted">最多4天并行计算，每一天最多求解15秒；未完全达标时以每日总热量绝对偏差最小为第一优先级返回最接近方案。</span><Tag>4路并行 · 15秒 / 天</Tag></div>
          <div className="section-line"><strong>{matched?`${user.calories} kcal / 天 · ${matched.template.name}`:'尚未匹配模板'}</strong><div className="actions"><Button primary icon={Calculator} disabled={Boolean(busy)||!plan} onClick={()=>runSolve('live',matched,user,plan)}>计算份量并校验</Button><Button primary icon={Sparkles} disabled={Boolean(busy)||reviewBusy||!result} onClick={()=>reviewRecipe(result,matched,user,filtered?.foods||matched?.foods||[])}>{reviewBusy?'AI测评中…':'AI一键测评食谱'}</Button><Button icon={Download} disabled={!result} onClick={exportData}>导出完整实验</Button></div></div><ResultView result={result} activeDay={activeDay} setActiveDay={setActiveDay}/>
          {recipeReview&&<div className="result-banner success"><div><strong>AI评分 · {recipeReview.score}分</strong><span>{recipeReview.conclusion}</span></div><div><b>{(recipeReview.durationMs/1000).toFixed(1)}秒</b><span>{recipeReview.model}</span></div></div>}
          <RecipeReviewHistory items={reviewHistory} onClear={()=>{if(confirm('确定清空全部食谱生成与评分历史吗？此操作无法撤销。'))setReviewHistory([]);}}/>
        </>}

        <footer className="step-footer"><span>{phase==='prep'?`${bundle.foods.length}条食物 · ${releases.length}个审核版本`:'使用已审核模板与食物池'}</span><div>{step>0&&<Button icon={ArrowLeft} disabled={Boolean(busy)} onClick={()=>go(phase,step-1)}>上一步</Button>}{step<titles.length-1&&<Button primary icon={ArrowRight} disabled={Boolean(busy)} onClick={()=>go(phase,step+1)}>下一步：{titles[step+1][0]}</Button>}</div></footer>
        {records.length>0&&<details className="call-records"><summary>AI调用记录 · {records.length}</summary>{records.map((r,i)=><details key={i}><summary>{r.stage==='candidates'?'候选生成':'补齐数据'} · {r.model} · {(r.durationMs/1000).toFixed(1)}s · {r.usage?.total_tokens??'—'} tokens</summary><pre>{r.prompt}</pre><pre>{r.output}</pre>{r.error&&<p>{r.error}</p>}</details>)}</details>}
      </main>
    </div>
    {toast&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
    {showApi&&<div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="模型与API设置"><div className="section-line"><h2>模型与API</h2><IconButton icon={X} label="关闭模型设置" onClick={()=>setShowApi(false)}/></div><div className="form-grid"><Field label="服务商"><select aria-label="服务商" value={config.provider} onChange={e=>setConfig(c=>({...c,provider:e.target.value,...PROVIDERS[e.target.value]}))}>{Object.entries(PROVIDERS).map(([k,p])=><option key={k} value={k}>{p.label}</option>)}</select></Field><Field label="Base URL"><input aria-label="Base URL" value={config.baseUrl} onChange={e=>setConfig({...config,baseUrl:e.target.value})}/></Field><Field label="模型名 / 推理接入点ID"><input aria-label="模型名" value={config.model} onChange={e=>setConfig({...config,model:e.target.value})}/></Field><Field label="API Key"><input type="password" aria-label="API Key" autoComplete="off" value={config.apiKey} onChange={e=>setConfig({...config,apiKey:e.target.value})}/></Field><Field label="最大输出Token"><input aria-label="最大输出Token" type="number" value={config.maxTokens} onChange={e=>setConfig({...config,maxTokens:Number(e.target.value)})}/></Field></div><label className="checkbox-line"><input type="checkbox" checked={config.jsonMode} onChange={e=>setConfig({...config,jsonMode:e.target.checked})}/>JSON输出模式</label><label className="checkbox-line"><input type="checkbox" checked={rememberApi} onChange={e=>setRememberApi(e.target.checked)}/>在此浏览器记住API Key</label><p className="muted">{rememberApi?'API Key将以明文保存在本机浏览器，请勿在共享设备上启用；不会随工作台导出。':'API Key仅保留在当前页面；服务商、地址和模型配置自动保存。'}</p><div className="actions"><Button icon={X} onClick={()=>{setConfig({...config,apiKey:''});setRememberApi(false);}}>清除API Key</Button><Button icon={Play} disabled={apiBusy} onClick={async()=>{setApiBusy(true);setApiMessage('');try{const r=await fetch('/api/test',{method:'POST',headers:{'Content-Type':'application/json'},body:json({config})});const d=await r.json();if(!r.ok)throw new Error(d.error);setApiMessage(`连接成功 · ${d.model}`);}catch(e){setApiMessage(e.message);}finally{setApiBusy(false);}}}>{apiBusy?'测试中…':'测试连接'}</Button><Button primary icon={Check} onClick={()=>setShowApi(false)}>完成配置</Button></div>{apiMessage&&<p role="status">{apiMessage}</p>}</section></div>}
    {selectedFood!==null&&<div className="modal-overlay"><section className="modal wide-modal" role="dialog" aria-modal="true" aria-label="编辑食物"><div className="section-line"><h2>{bundle.foods[selectedFood]?.name}</h2><IconButton icon={X} label="关闭食物编辑" onClick={()=>setSelectedFood(null)}/></div><details><summary>查询已有食物库</summary><div className="form-grid"><Field label="食物库Token / Cookie"><input type="password" aria-label="食物库Cookie" value={cookie} onChange={e=>setCookie(e.target.value)}/></Field><Field label="查询名称"><input aria-label="查询名称" value={queryName} onChange={e=>setQueryName(e.target.value)}/></Field></div><div className="actions"><Button icon={Search} disabled={Boolean(busy)} onClick={()=>searchLibrary()}>查询食物库</Button><Button icon={X} onClick={()=>setCookie('')}>清除Cookie</Button></div>{searchResults.map((f,i)=><div className="history-row" key={`${f.id||f._id}-${i}`}><span>{f.name} · {f.calorie} kcal / {f.weight}g</span><Button small onClick={()=>chooseRecord(f)}>载入此记录</Button></div>)}{searchResults.length>0&&<Button small disabled={Boolean(busy)} onClick={()=>searchLibrary(searchPage+1)}>加载下一页</Button>}</details><NutritionEditor value={editFood} onChange={setEditFood}/><JsonEditor label="单条食物JSON" value={editFood} onChange={setEditFood} rows={15}/><div className="actions"><Button primary icon={Save} disabled={Boolean(busy)} onClick={saveFood}>保存并确认营养、标签与份量</Button></div></section></div>}
    {mealEdit&&<MealEditor template={bundle.template} edit={mealEdit} onClose={()=>setMealEdit(null)} onSave={t=>{guard(()=>{validateBundleTemplate(t);changeBundle({...bundle,template:t});setMealEdit(null);notify('餐次结构已更新，请重新测试');});}}/>}
  </div>;
}
function TagPicker({values,onChange,vegetarian=false}){return <fieldset className="tag-picker"><legend>有哪些食物你不吃？</legend><div>{Object.entries(ALL_TAGS).filter(([k])=>!vegetarian||!['fish','shellfish','crustacean','seafood','pork','beef','lamb','offal','poultry'].includes(k)).map(([k,v])=><label key={k} className={values.includes(k)?'selected':''}><input type="checkbox" checked={values.includes(k)} onChange={e=>onChange(e.target.checked?[...values,k]:values.filter(x=>x!==k))}/>{v}</label>)}</div></fieldset>;}
function MealEditor({template,edit,onClose,onSave}){
  const original=template.days.find(d=>d.day===edit.day).meals.find(m=>m.id===edit.id);
  const [draft,setDraft]=useState(clone(original));
  return <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="编辑餐次"><div className="section-line"><h2>第{edit.day}天 · {original.name}</h2><IconButton icon={X} label="关闭餐次编辑" onClick={onClose}/></div><Field label="本餐热量占比 %"><input aria-label="本餐热量占比" type="number" value={Math.round(draft.share*100)} onChange={e=>setDraft({...draft,share:Number(e.target.value)/100})}/></Field><div className="slot-picker">{Object.keys(template.slotDefinitions).map(s=><Field label={SLOT_NAMES[s]} key={s}><select value={draft.required.includes(s)?'required':draft.optional.includes(s)?'optional':'none'} onChange={e=>setDraft({...draft,required:[...draft.required.filter(x=>x!==s),...(e.target.value==='required'?[s]:[])],optional:[...draft.optional.filter(x=>x!==s),...(e.target.value==='optional'?[s]:[])]})}><option value="none">不出现</option><option value="required">必选</option><option value="optional">可选</option></select></Field>)}</div><div className="actions"><Button primary icon={Check} onClick={()=>{const days=template.days.map(d=>d.day===edit.day?{...d,meals:d.meals.map(m=>m.id===edit.id?draft:m)}:d);onSave({...template,days,meals:days[0].meals});}}>保存餐次</Button></div></section></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
