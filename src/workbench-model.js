import { DEFAULT_PROFILE, SLOT_NAMES, getSlots, validateTemplate, validateProfile, validateFoods } from './engine.js';
import {buildTagPrompt,parseTaggingResult,validMealTags,supportsMeal} from './food-tags.js';
import { SAMPLE_FOODS } from './sample.js';
import { DEFAULT_CANDIDATE_PROMPT, renderCandidatePrompt } from './candidate-prompt.js';

export const STORAGE_KEY = 'otter-meal-lab-v2';
export const SLOT_DEFINITIONS = {
  staple: '主食：谷薯类基础食物，写明即食或熟制状态，不含完整的混合主食餐。',
  protein: '蛋白质来源：蛋、奶、豆制品、鱼肉等；奶和豆浆统一在此槽位，不另设饮品。',
  vegetable: '蔬菜：简单处理的非淀粉蔬菜，不包括以蔬菜为主的复合菜肴。',
  fruit: '水果：完整或切块水果，不含果汁。',
  fat: '脂肪来源：坚果、种子、牛油果及可计量的食用油。',
  compositeStaple: '复合主食：以谷薯为基础、搭配蛋白质或蔬菜的完整成品，如三明治、意面或杂粮饭碗。',
  meatDish: '蛋白质为主的复合菜肴：以肉鱼蛋豆制品为主的菜肴，不含作为主食的米面。',
  vegDish: '蔬菜为主的复合菜肴：以非淀粉蔬菜为主的菜肴，允许少量配料，不含主食。',
};
export const ALL_TAGS = {
  milk: '奶类', egg: '蛋类', soy: '大豆', wheat: '小麦', peanut: '花生',
  treeNut: '树坚果', fish: '鱼类', shellfish: '虾蟹贝类', sesame: '芝麻',
  pork: '猪肉', beef: '牛肉', poultry: '禽肉', lamb:'羊肉',offal:'内脏',seafood:'海鲜',crustacean:'甲壳类海鲜',gluten:'麸质',
};
export const SOURCE_NAMES = { sample: '内置演示估算', ai_estimate: 'AI参考估算', manual: '人工录入', real_library: '已有食物库', pending: '待补营养数据' };
export const MEAL_NAMES = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
export const clone = value => JSON.parse(JSON.stringify(value));
const meal = (id, required, optional = []) => ({ id, name: MEAL_NAMES[id], share: {breakfast:.25,lunch:.4,dinner:.35}[id], required, optional });

export function defaultTemplate() {
  const patterns = [
    [meal('breakfast',['staple','protein','fruit'],['fat']), meal('lunch',['staple','protein','vegetable'],['fruit']), meal('dinner',['protein','vegetable'],['staple','fat'])],
    [meal('breakfast',['staple','protein'],['fruit','fat']), meal('lunch',['staple','protein','vegetable','fruit']), meal('dinner',['protein','vegetable'],['staple'])],
    [meal('breakfast',['protein','fruit','fat'],['staple']), meal('lunch',['staple','protein','vegetable']), meal('dinner',['staple','protein','vegetable'])],
    [meal('breakfast',['staple','protein','fruit'],['fat']), meal('lunch',['staple','protein','vegetable'],['fruit']), meal('dinner',['protein','vegetable'],['fruit','staple'])],
    [meal('breakfast',['staple','protein'],['fruit','fat']), meal('lunch',['staple','protein','vegetable','fruit']), meal('dinner',['protein','vegetable','fat'],['staple'])],
    [meal('breakfast',['staple','protein','fruit']), meal('lunch',['staple','protein','vegetable']), meal('dinner',['staple','protein','vegetable'],['fruit'])],
    [meal('breakfast',['protein','fruit','fat'],['staple']), meal('lunch',['staple','protein','vegetable','fruit']), meal('dinner',['protein','vegetable'],['staple'])],
  ];
  return {
    id: 'balanced_fat_loss_3', name: '均衡膳食减脂餐 · 三餐版', goal: 'fatLoss', structureVersion: 2,
    match: { mealCount: 3, habit: 'regular', trainingMin: 0 },
    macroRatio: { protein: 25, fat: 30, carbs: 45 },
    macroTolerance: 5, calorieTolerance: 8, mealTolerance: 25,
    slotDefinitions: Object.fromEntries(['staple','protein','vegetable','fruit','fat'].map(s=>[s,SLOT_DEFINITIONS[s]])),
    meals: clone(patterns[0]), days: patterns.map((meals,i) => ({day:i+1,meals})),
  };
}
export function blankBundle() { return { template: defaultTemplate(), candidates: {slotFoods:[]}, foods: [], notes: '' }; }

export function applyCurrentStructure(bundle) {
  const current=defaultTemplate(),slots=getSlots(current);
  return {...bundle,
    previousTemplate:clone({template:bundle.template,candidates:bundle.candidates,foods:bundle.foods}),
    template:{...bundle.template,structureVersion:current.structureVersion,match:{...bundle.template.match,mealCount:3},meals:current.meals,days:current.days,slotDefinitions:current.slotDefinitions},
    candidates:{slotFoods:(bundle.candidates?.slotFoods||[]).filter(r=>slots.includes(r.slot))},
    foods:(bundle.foods||[]).filter(f=>slots.includes(f.slot)),
  };
}

export function migrateSavedWorkbench(saved) {
  const t=saved?.bundle?.template;
  if(!t||t.id!=='balanced_fat_loss_3'||t.structureVersion>=2||t.match?.mealCount!==3)return saved;
  // Only migrate the shipped legacy structure; leave user-edited structures intact.
  const legacy=[
    ['staple,protein|fruit','staple,meatDish,vegetable|fat','protein,vegDish|staple,fruit'],
    ['compositeStaple|fruit,protein','staple,protein,vegDish|fruit','staple,meatDish,vegetable|fat'],
    ['staple,protein,fruit|fat','compositeStaple,vegetable|protein','protein,vegDish|staple,fruit'],
    ['staple,protein|fruit','staple,meatDish,vegDish|fruit','compositeStaple,vegetable|protein'],
    ['compositeStaple|protein,fruit','staple,protein,vegetable|fat','staple,meatDish,vegDish|fruit'],
    ['staple,protein,fruit|','compositeStaple,vegetable|protein','protein,vegDish|staple,fat'],
    ['staple,protein|fruit,fat','staple,meatDish,vegetable|fruit','staple,protein,vegDish|fat'],
  ];
  const signature=t.days?.map(d=>d.meals.map(m=>`${m.required.join(',')}|${m.optional.join(',')}`));
  if(JSON.stringify(signature)!==JSON.stringify(legacy))return saved;
  const bundle=applyCurrentStructure(saved.bundle),slots=getSlots(bundle.template);
  return {...saved,bundle,test:null,libraryRows:(saved.libraryRows||[]).filter(r=>slots.includes(r.slot))};
}

export function validateBundleTemplate(t) {
  validateTemplate(t);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(t.id || '') || !t.name?.trim()) throw new Error('模板需要有效ID和名称');
  if (!['fatLoss','muscleGain','maintain'].includes(t.goal)) throw new Error('模板目标无效');
  if (!t.days || t.days.length !== 7) throw new Error('本期模板需要固定7天');
  if (![2,3].includes(t.match?.mealCount) || t.meals.length !== t.match.mealCount) throw new Error('匹配餐数与模板不一致');
  if (!['regular','vegetarian','mediterranean','lowCarb','keto'].includes(t.match.habit)) throw new Error('匹配饮食习惯无效');
  if (!Number.isInteger(t.match.trainingMin) || t.match.trainingMin < 0 || t.match.trainingMin > 7) throw new Error('最低训练频率需要在0–7次之间');
  if (t.match.mealCount === 2 && t.meals.map(m=>m.id).join(',') !== 'lunch,dinner') throw new Error('本期两餐固定为午餐＋晚餐');
  if (t.match.mealCount === 3 && t.meals.map(m=>m.id).join(',') !== 'breakfast,lunch,dinner') throw new Error('三餐顺序应为早餐、午餐、晚餐');
  const {protein, fat, carbs} = t.macroRatio || {};
  validateProfile({...DEFAULT_PROFILE, ...t.macroRatio, habit:t.match.habit, mealCount:t.match.mealCount});
  if (protein+fat+carbs !== 100) throw new Error('营养素供能比总和需要为100%');
  for (const [key,min,max] of [['macroTolerance',1,15],['calorieTolerance',1,25],['mealTolerance',5,60]])
    if (!Number.isFinite(t[key]) || t[key]<min || t[key]>max) throw new Error(`${key}超出有效范围`);
  getSlots(t).forEach(slot => {if (!t.slotDefinitions?.[slot]?.trim()) throw new Error(`${SLOT_NAMES[slot]}缺少槽位定义`);});
  return t;
}
export function parsePlanTemplates(input) {
  const plans=Array.isArray(input)?input:[input];
  if(!plans.length)throw new Error('计划列表不能为空');
  return plans.map((p,index)=>{
    if(!p||typeof p!=='object')throw new Error(`第${index+1}个计划格式无效`);
    if(p.meals&&p.days){validateBundleTemplate(p);return clone(p);}
    if(typeof p.planName!=='string'||!p.planName.trim()||!Array.isArray(p.mealPlanTemplate)||!Array.isArray(p.mealCalorieDistribution))throw new Error('计划需要planName、mealPlanTemplate和mealCalorieDistribution');
    const name=p.planName.trim(),defaults=defaultTemplate();
    const goal=p.goal||(/增肌/.test(name)?'muscleGain':/维持/.test(name)?'maintain':'fatLoss');
    const habit=p.match?.habit||(/生酮/.test(name)?'keto':/地中海/.test(name)?'mediterranean':/素食|蛋奶素/.test(name)?'vegetarian':/低碳/.test(name)?'lowCarb':'regular');
    const shares=new Map();
    for(const m of p.mealCalorieDistribution){
      if(!MEAL_NAMES[m.mealCode]||shares.has(m.mealCode)||!Number.isFinite(m.caloriePercentage))throw new Error('餐次热量分配存在无效或重复记录');
      shares.set(m.mealCode,m.caloriePercentage/100);
    }
    const days=p.mealPlanTemplate.map(d=>({day:d.day,meals:(d.meals||[]).map(m=>({
      id:m.mealCode,name:m.mealName||MEAL_NAMES[m.mealCode],share:shares.get(m.mealCode),
      required:m.requiredSlots,optional:m.optionalSlots||[],
    }))}));
    if(days[0]?.meals.length!==shares.size)throw new Error('热量分配餐次与每日模板不一致');
    if(p.planDescription!==undefined&&(!Array.isArray(p.planDescription)||p.planDescription.some(d=>typeof d.type!=='string'||typeof d.content!=='string')))throw new Error('planDescription需要type、content文本数组');
    if(p.slotConstraints!==undefined&&(!Array.isArray(p.slotConstraints)||p.slotConstraints.some(s=>!SLOT_DEFINITIONS[s.slot]||typeof s.rules!=='string')||new Set(p.slotConstraints.map(s=>s.slot)).size!==p.slotConstraints.length))throw new Error('slotConstraints需要唯一的slot及rules文本');
    let hash=2166136261;for(const c of name)hash=Math.imul(hash^c.charCodeAt(0),16777619);
    const t={...defaults,id:p.id||`import_${(hash>>>0).toString(16)}`,name,goal,
      match:{mealCount:days[0]?.meals.length,habit,trainingMin:p.match?.trainingMin??0},
      macroRatio:{protein:p.macroRatio?.protein,fat:p.macroRatio?.fat,carbs:p.macroRatio?.carbohydrate??p.macroRatio?.carbs},
      meals:days[0]?.meals,days,planDescription:clone(p.planDescription||[]),slotConstraints:clone(p.slotConstraints||[]),
      slotDefinitions:{...SLOT_DEFINITIONS},imported:true};
    validateBundleTemplate(t);return t;
  });
}
export function normalizeCandidates(input, t, count) {
  const slots=getSlots(t);
  const aliases = Object.fromEntries(Object.entries(SLOT_NAMES).map(([id,name])=>[name,id]));
  Object.assign(aliases, { '蛋白类':'protein', '荤菜':'meatDish', '素菜':'vegDish' });
  const sourceRows = Array.isArray(input)?input:input?.slotFoods || (input && Object.entries(input).map(([slot,foods])=>({slot,foods})));
  const rows = Array.isArray(sourceRows) ? sourceRows.map(row=>{
    if (!row || typeof row.slot!=='string') throw new Error('每组候选需要slot名称和foods数组');
    const label=row.slot.trim();
    const slot=slots.includes(label)?label:aliases[label];
    if (!slots.includes(slot)) throw new Error(`无法识别槽位“${label}”。当前模板支持：${slots.map(s=>SLOT_NAMES[s]).join('、')}`);
    const grouped=!Array.isArray(row.foods)?row.foods:row.foodGroups;
    if(grouped!==undefined){
      if(!grouped||!Array.isArray(grouped.best)||!Array.isArray(grouped.secondary)||Object.keys(grouped).some(k=>!['best','secondary'].includes(k)))throw new Error(`${SLOT_NAMES[slot]}的foods需要best和secondary两个数组`);
      return {slot,foods:[...grouped.best,...grouped.secondary],foodGroups:grouped};
    }
    return {...row,slot};
  }) : sourceRows;
  if (!Array.isArray(rows) || rows.length !== slots.length) throw new Error('候选列表必须覆盖模板的每一个槽位');
  const seen=new Set(), names=new Set();
  rows.forEach(row=>{
    if (!slots.includes(row.slot) || seen.has(row.slot) || !Array.isArray(row.foods) || !row.foods.length) throw new Error('候选槽位无效、重复或为空');
    seen.add(row.slot);
    if (count && row.foods.length !== count) throw new Error(`${SLOT_NAMES[row.slot]}需要恰好${count}种食物`);
    row.foods.forEach(name=>{
      if (typeof name !== 'string' || !name.trim()) throw new Error('食物名称需要为非空文本');
      if (names.has(name.trim())) throw new Error(`食物重复：${name}`);
      names.add(name.trim());
    });
  });
  return {slotFoods:rows.map(r=>({slot:r.slot,foods:r.foods.map(n=>n.trim()),...(r.foodGroups?{foodGroups:{best:r.foodGroups.best.map(n=>n.trim()),secondary:r.foodGroups.secondary.map(n=>n.trim())}}:{})}))};
}
export function candidateGroups(row){
  return row.foodGroups||(!Array.isArray(row.foods)?row.foods:{best:row.foods,secondary:[]});
}
export function candidatePreference(row,name){return candidateGroups(row).secondary.includes(name)?'secondary':'best';}
export function syncFoodPreferences(candidates,foods){
  return foods.map(f=>({...f,preference:candidatePreference(candidates.slotFoods.find(r=>r.slot===f.slot)||{foods:[]},f.name)}));
}
export function candidateInput(candidates){
  return {slotFoods:candidates.slotFoods.map(r=>({slot:r.slot,foods:r.foodGroups?clone(r.foodGroups):r.foods}))};
}
export function candidatePrompt(t,region='全球通用',source={}) {
  return renderCandidatePrompt(DEFAULT_CANDIDATE_PROMPT,t,region,source);
}
export function enrichmentPrompt(t,candidates,foods=[],scope='all') {
  if(scope==='tags')return buildTagPrompt(t,candidates,foods);
  if(scope!=='all'){
    const fields=scope==='portions'?['portions']:['nutritionPer100g','nutritionReference'];
    const records=foods.map(f=>Object.fromEntries(['id','slot','name',...fields].filter(k=>f[k]!==undefined).map(k=>[k,f[k]])));
    const example=scope==='portions'?{portions:[{grams:100,label:'小份100克'},{grams:150,label:'中份150克'}]}:{nutritionPer100g:{calories:120,protein:3,fat:1,carbs:24},nutritionReference:'说明参考食物、熟制状态和换算依据'};
    return `你是饮食计划数据整理员。本次任务仅为${scope==='portions'?'补充可执行份量':'补充缺失营养'}。只输出合法JSON。
待处理记录：${JSON.stringify(records)}
每条恰好返回一次，保持id、slot、name不变。只允许返回身份字段及${fields.join('、')}，禁止输出其他字段；禁止生成餐次限制。
输出示例：${JSON.stringify({foods:[{id:'matched_001',slot:'staple',name:'熟糙米饭',...example}]})}
${scope==='portions'?'仅补充portions，已有份量不修改。给2–6个合理离散档位，每项包含grams和label。鸡蛋以50克整数倍，面包用片、牛奶用杯，标明对应克重，不以1克为一份。禁止输出标签、配料、过敏原或营养数据。':'仅估算每100克calories、protein、fat、carbs，必须提供nutritionReference说明依据。不得伪造数据库查询或权威来源。禁止输出标签、配料或份量。'}
无法合理补齐时保留对应空值或空数组，并在顶层unresolved列出id和原因。结果按批保存。`;
  }
  const pending=foods.filter(f=>f.dataSource==='pending');
  return `你是饮食计划数据整理员，为食物补充缺失信息并打标。只输出合法JSON。
槽位定义：${JSON.stringify(t.slotDefinitions)}
槽位选择约束：${JSON.stringify(t.slotConstraints||[])}
待处理记录：${JSON.stringify(foods)}
只处理上面列出的记录，每条恰好返回一次，保持slot、name和id不变。${pending.length?'仅dataSource=pending的记录允许补充nutritionPer100g（calories、protein、fat、carbs，均为每100克），同时必须提供nutritionReference文本，说明参考食物、熟制状态、参考值或配方和换算依据；无法可靠估算时不要硬填，保持营养值为空并在unresolved列出原因。不得声称已查询数据库或伪造权威来源。所有新营养值属于AI估算，不能冒充食物库数据。':'未匹配候选不参与本步，不要生成或推测其营养数据。'}
输出{"foods":[{"id":"matched_001","slot":"staple","name":"熟糙米饭","ingredients":["糙米","水"],"allergens":[],"tags":[],"portions":[{"grams":100,"label":"小份100克"},{"grams":150,"label":"中份150克"}]}]}
对已有营养值的记录，禁止输出或修改nutritionPer100g、libraryRecord、dataSource等字段。已有ingredients、allergens和portions原样保留，仅在缺失时补充。tags必须从${JSON.stringify(ALL_TAGS)}的键中选，结合名称明确的配料与过敏原，不推测可选配料或调味料。每餐必选/可选槽位由模板决定；每个食物必须提供mealTags，从早餐、午餐、晚餐中按顺序选择至少一项，结合日常食用习惯判断，不机械标记全部餐次。缺失份量时给2–6个合理离散档位，鸡蛋以50克整数倍计，面包用片、牛奶用杯等单位，不以1克作为食用份量。缺失配料或份量无法合理推断时，保留空数组并在unresolved列出id和原因，等待补齐。完整结果通过格式校验后将自动确认，用于程序测试，保留AI估算来源。`;
}

export function matchingRows(candidates, previous=[]) {
  return candidates.slotFoods.flatMap(row=>row.foods.map(name=>{
    const existing=previous.find(r=>r.slot===row.slot&&r.queryName===name);
    return {...(existing || {slot:row.slot,queryName:name,searchTerm:name,options:[],selectedId:'',page:0,status:'pending',error:''}),preference:candidatePreference(row,name)};
  }));
}

export function libraryFood(record,row,index=0) {
  const num=(value,label)=>{
    if(value==null || value==='' || !Number.isFinite(Number(value)) || Number(value)<0) throw new Error(`${row.queryName}缺少有效${label}`);
    return Number(value);
  };
  const base=num(record.weight,'基准重量');
  if(record.unit!=='gram'||base<=0)throw new Error(`${row.queryName}不是有效的克重基准`);
  const nutritionPer100g=Object.fromEntries([['protein','protein'],['fat','fat'],['carbs','carbohydrate']].map(([key,source])=>[key,num(record.nutrition?.[source],source)*100/base]));
  nutritionPer100g.calories=num(record.calorie,'热量')*100/base;
  if(nutritionPer100g.calories<=0 || nutritionPer100g.protein+nutritionPer100g.fat+nutritionPer100g.carbs>100.5)throw new Error(`${row.queryName}的营养数据不完整或不合理，请换一条库记录`);
  const portions=(record.showUnits||[]).filter(u=>u.type==='custom'&&Number(u.weight)>0&&Number(u.weight)<=1200).map(u=>({grams:Number(u.weight),label:`1${u.name}`}));
  return {id:`matched_${index+1}`,slot:row.slot,name:row.queryName,preference:row.preference||'best',nutritionPer100g,libraryRecord:clone(record),dataSource:'real_library',ingredients:Array.isArray(record.ingredients)?clone(record.ingredients):[],allergens:Array.isArray(record.allergens)?clone(record.allergens):[],portions,tags:[],tagsComplete:false,tagsReviewed:false,supplementSource:null};
}

export function confirmLibraryMatches(rows,includeMissing=false) {
  const foods=[],issues=[],used=new Set();
  rows.forEach((row,index)=>{
    const record=row.options.find(f=>String(f.id||f._id)===row.selectedId);
    const missing=reason=>{
      issues.push({name:row.queryName,reason});
      if(includeMissing)foods.push({id:`matched_${index+1}`,slot:row.slot,name:row.queryName,preference:row.preference||'best',nutritionPer100g:null,dataSource:'pending',ingredients:[],allergens:[],portions:[],tags:[],tagsComplete:false,tagsReviewed:false});
    };
    if(!record){missing(row.error||(row.status==='pending'?'尚未查询':'没有名称完全一致的记录'));return;}
    try{
      if(used.has(row.selectedId))throw new Error('同一食物库记录已被其他候选使用，请核对重复候选');
      const food=libraryFood(record,row,index);used.add(row.selectedId);foods.push(food);
    }catch(error){missing(error.message);}
  });
  if(!foods.length)throw new Error('没有可确认的库记录，请先查询并选择包含完整营养数据的食物');
  return {foods,issues};
}

export function mergeFoodSupplements(foods,input,scope='all') {
  const matched=foods;
  if(!matched.length)throw new Error('请先确认食物库匹配，再补充缺失信息');
  if(scope==='tags')return parseTaggingResult(foods,input);
  if(!Array.isArray(input?.foods)||input.foods.length!==matched.length)throw new Error('补充结果需要覆盖全部待处理记录，每条恰好一次');
  const seen=new Set();
  for(const patch of input.foods){
    const existing=matched.find(f=>f.id===patch.id&&f.name===patch.name&&f.slot===patch.slot);
    if(!existing||seen.has(patch.id))throw new Error('补充记录的ID、名称、槽位不一致或重复');
    seen.add(patch.id);
  }
  return foods.map(f=>{
    const patch=input.foods.find(p=>p.id===f.id);
    if(scope==='portions'){
      if(Object.keys(patch).some(k=>!['id','name','slot','portions'].includes(k)))throw new Error(`${f.name}的份量结果包含其他步骤字段`);
      const portions=f.portions?.length?f.portions:patch.portions;
      if(!Array.isArray(portions)||portions.length>12||portions.some(p=>!Number.isFinite(p.grams)||p.grams<1||p.grams>1200||typeof p.label!=='string'||!p.label.trim()))throw new Error(`${f.name}的份量档位无效`);
      return {...f,portions:clone(portions),supplementSource:'ai_supplement'};
    }
    if(scope==='nutrition'&&Object.keys(patch).some(k=>!['id','name','slot','nutritionPer100g','nutritionReference'].includes(k)))throw new Error(`${f.name}的营养结果包含其他步骤字段`);
    let nutrition={};
    if(f.dataSource==='pending'){
      if(!patch.nutritionPer100g)return {...f};
      const n=patch.nutritionPer100g;
      if(['calories','protein','fat','carbs'].some(k=>!Number.isFinite(n[k])||n[k]<0)||n.calories<=0||n.protein+n.fat+n.carbs>100.5||['protein','fat','carbs'].some(k=>n[k]>100))throw new Error(`${f.name}的每100克营养数据无效`);
      if(typeof patch.nutritionReference!=='string'||!patch.nutritionReference.trim())throw new Error(`${f.name}需要说明营养估算的参考依据`);
      nutrition={nutritionPer100g:clone(n),dataSource:'ai_estimate',nutritionReference:patch.nutritionReference.trim()};
    }
    if(scope==='nutrition')return {...f,...nutrition,supplementSource:'ai_supplement'};
    const ingredients=f.ingredients.length?f.ingredients:patch.ingredients;
    const allergens=f.ingredients.length?f.allergens:patch.allergens;
    const portions=f.portions.length?f.portions:patch.portions;
    if(!Array.isArray(ingredients)||ingredients.some(v=>typeof v!=='string')||!Array.isArray(allergens)||allergens.some(v=>typeof v!=='string'))throw new Error(`${f.name}的配料或过敏原格式无效`);
    if(!Array.isArray(patch.tags)||patch.tags.some(k=>!Object.hasOwn(ALL_TAGS,k)))throw new Error(`${f.name}的标签无效`);
    if(!Array.isArray(portions)||portions.length>12||portions.some(p=>!Number.isFinite(p.grams)||p.grams<1||p.grams>1200||typeof p.label!=='string'||!p.label.trim()))throw new Error(`${f.name}的份量档位无效`);
    const mealTags=patch.mealTags||f.mealTags;
    return {...f,...nutrition,ingredients:clone(ingredients),allergens:clone(allergens),portions:clone(portions),tags:clone(patch.tags),...(mealTags?{mealTags:clone(mealTags)}:{}),tagsComplete:ingredients.length>0,tagsReviewed:ingredients.length>0&&portions.length>0&&validMealTags(mealTags),supplementSource:'ai_supplement'};
  });
}
const ingredientTags = { milk:/牛奶|酸奶|乳清|奶酪/, egg:/鸡蛋|蛋清|蛋黄/, soy:/大豆|豆腐|豆浆|酱油/, wheat:/小麦|面粉|面包|意面/, peanut:/花生/, treeNut:/核桃|杏仁|腰果/, fish:/鱼/, shellfish:/虾|蟹|贝/, sesame:/芝麻/, pork:/猪|肉丸/, beef:/牛肉/, poultry:/鸡胸|鸡丁|鸡肉|火鸡/ };
export function inferredTags(f) {
  const text=[f.name,...(f.ingredients || []),...(f.allergens || [])].join('|');
  return Object.entries(ingredientTags).filter(([,rx])=>rx.test(text)).map(([key])=>key);
}
export function sampleBundle() {
  const template=defaultTemplate();
  const base=SAMPLE_FOODS.filter(f=>getSlots(template).includes(f.slot)).map(clone);
  base.push(...SAMPLE_FOODS.filter(f=>f.slot==='drink').map(f=>({...clone(f),slot:'protein'})));
  const foods=base.map(f=>({...f, tags:inferredTags(f),mealTags:['早餐','午餐','晚餐'], tagsReviewed:true, dataSource:'sample',nutritionPer100g:{...f.nutritionPer100g,calories:Math.round((f.nutritionPer100g.protein*4+f.nutritionPer100g.fat*9+f.nutritionPer100g.carbs*4)*10)/10}}));
  return {template,candidates:{slotFoods:getSlots(template).map(slot=>({slot,foods:foods.filter(f=>f.slot===slot).map(f=>f.name)}))},foods,notes:'内置演示估算，供测试程序链路；不是已审核营养数据库。'};
}
export function validatePool(bundle, requireReviewed=false) {
  validateBundleTemplate(bundle.template);
  const candidates=normalizeCandidates(bundle.candidates,bundle.template);
  const expected=candidates.slotFoods.flatMap(r=>r.foods.map(name=>`${r.slot}|${name}`));
  if (!Array.isArray(bundle.foods) || bundle.foods.length !== expected.length) {
    const available=new Set((Array.isArray(bundle.foods)?bundle.foods:[]).map(f=>`${f.slot}|${f.name}`));
    const missing=candidates.slotFoods.flatMap(r=>r.foods.filter(name=>!available.has(`${r.slot}|${name}`)));
    throw new Error(missing.length?`有${missing.length}种候选尚未关联食物数据：${missing.slice(0,8).join('、')}${missing.length>8?'等':''}。请到“数据与标签”自动匹配，未命中项可修改名称、手动选择或移除。`:'候选名称与食物数据数量不一致，请检查多余或重复的记录');
  }
  bundle.foods.forEach(f=>{
    if(f.dataSource==='pending')throw new Error(`${f.name}尚未补齐营养数据，请先补录或参考估算`);
    if (!expected.includes(`${f.slot}|${f.name}`)) throw new Error(`${f.name}与候选名称列表不一致`);
    if (!Array.isArray(f.tags) || f.tags.some(k=>!Object.hasOwn(ALL_TAGS,k))) throw new Error(`${f.name}标签无效`);
    if(!validMealTags(f.mealTags))throw new Error(`${f.name}缺少有效餐次标签，请先执行AI打标签`);
    if (!SOURCE_NAMES[f.dataSource]) throw new Error(`${f.name}缺少有效数据来源`);
    if (!Number.isFinite(f.nutritionPer100g?.calories) || f.nutritionPer100g.calories<=0) throw new Error(`${f.name}缺少每100克热量`);
    if (requireReviewed && !f.tagsReviewed) throw new Error(`${f.name}的标签与份量尚未确认`);
  });
  const profile={...DEFAULT_PROFILE,...bundle.template.macroRatio,habit:bundle.template.match.habit,mealCount:bundle.template.match.mealCount,allergies:[],avoids:''};
  return validateFoods({foods:syncFoodPreferences(candidates,bundle.foods)},bundle.template,profile).foods;
}
export function profileFor(t,user) {
  const p={...DEFAULT_PROFILE,...user,...t.macroRatio,habit:t.match.habit,days:7,mealCount:t.match.mealCount,style:'light',calorieMode:'manual'};
  validateProfile(p); return p;
}
export function rulesFor(t,seed=42,maxRepeat=3) {return {calorieTolerance:t.calorieTolerance,macroTolerance:t.macroTolerance,mealTolerance:t.mealTolerance,seed,maxRepeat};}
export function filterPool(bundle,user) {
  const verifiedFoods=validatePool(bundle);
  const excluded=[], accepted=[];
  const blocked=user.blockedTags || [];
  verifiedFoods.forEach(f=>{
    const hits=f.tags.filter(k=>blocked.includes(k)||(k==='crustacean'&&blocked.includes('shellfish'))||(k==='gluten'&&blocked.includes('wheat'))||(k==='seafood'&&blocked.includes('shellfish')));
    const vegetarian=user.habit==='vegetarian' && f.tags.some(k=>['fish','shellfish','crustacean','seafood','pork','beef','lamb','offal','poultry'].includes(k));
    const unknown=blocked.length>0 && !f.tagsReviewed;
    const text=(user.avoids || '').split(/[,，、;；\n]/).map(s=>s.trim()).filter(Boolean).find(word=>[f.name,...f.ingredients,...f.allergens].join('|').includes(word));
    if (hits.length || vegetarian || unknown || text) excluded.push({...f,reason:unknown?'限制条件下，未确认的标签不参与生成':vegetarian?'不符合蛋奶素饮食':hits.length?`包含${hits.map(k=>ALL_TAGS[k]).join('、')}`:`包含自定义忌口：${text}`});
    else accepted.push(f);
  });
  const shortages=[];
  bundle.template.days.forEach(d=>d.meals.forEach(m=>[...m.required,...m.optional].forEach(slot=>{
    if (!accepted.some(f=>f.slot===slot&&supportsMeal(f,m.id))) shortages.push({day:d.day,meal:m.name,slot,required:m.required.includes(slot)});
  })));
  return {foods:accepted,excluded,shortages};
}
export function matchRelease(releases,user) {
  return releases.filter(r=>r.template.goal===user.goal && r.template.match.mealCount===user.mealCount && r.template.match.habit===user.habit && user.training>=r.template.match.trainingMin)
    .sort((a,b)=>b.template.match.trainingMin-a.template.match.trainingMin || b.version-a.version)[0] || null;
}
export function fingerprint(bundle) {return JSON.stringify({template:bundle.template,candidates:bundle.candidates,foods:bundle.foods});}
export function approveBundle(bundle, test, releases) {
  validatePool(bundle,true);
  if (!test || test.fingerprint!==fingerprint(bundle) || test.result?.status!=='passed') throw new Error('请先对当前版本完成7天全部通过的模板测试');
  const version=Math.max(0,...releases.filter(r=>r.template.id===bundle.template.id).map(r=>r.version))+1;
  return {...clone(bundle),version,releaseId:`${bundle.template.id}_v${version}`,publishedAt:new Date().toISOString(),test:clone(test)};
}
