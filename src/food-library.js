import {getSlots, SLOT_NAMES} from './engine.js';

export function candidatePrompt(profile, template, count) {
  const definitions = Object.fromEntries(getSlots(template).map(slot => [slot, SLOT_NAMES[slot] + (slot === 'protein' && profile.style === 'chinese' ? '，适用于中式早餐' : '')]));
  return `你是候选食物推荐器。只输出合法JSON，不输出解释。
为每个槽位推荐${count}种常见、名称明确且互不重复的食物或具体菜品。
餐食形态：${profile.style === 'chinese' ? '中式家常' : '轻食'}
过敏：${JSON.stringify(profile.allergies)}
忌口：${profile.avoids || '无'}
偏好：${profile.preference || '无特殊偏好'}
槽位：${JSON.stringify(definitions)}
严格排除过敏、忌口及通常含这些食材的复合菜。粥归主食。不要跨槽位重复名称。
只输出以槽位ID为键、食物名称数组为值的JSON对象，不输出营养、热量、重量、ID、食材或说明，不逐条重复slot和name字段。
格式示例：{"staple":["馒头","花卷","白粥","小米粥"],"fruit":["苹果","橙子"]}。示例不代表完整输出，实际需覆盖所有指定槽位，每个数组包含${count}个名称。`;
}

export function groupCandidates(value) {
  const grouped = {};
  for (const f of value.foods) (grouped[f.slot] ||= []).push(f.name);
  return grouped;
}

export function validateCandidates(value, template) {
  if (value && typeof value === 'object' && !Array.isArray(value) && !Object.hasOwn(value,'foods')) {
    const foods=[];
    for (const [slot,names] of Object.entries(value)) {
      if (!getSlots(template).includes(slot) || !Array.isArray(names) || !names.length || names.some(n=>typeof n !== 'string')) throw new Error('每个有效槽位需对应非空的食物名称数组');
      for (const name of names) foods.push({slot,name});
    }
    value={foods};
  }
  if (!Array.isArray(value?.foods) || !value.foods.length || value.foods.length > 400) throw new Error('需要含1–400项的foods数组');
  const names = new Set(), slots = getSlots(template);
  const foods = value.foods.map(f => {
    if (!f || typeof f.name !== 'string' || !f.name.trim() || !slots.includes(f.slot)) throw new Error('每项需要有效的slot和name');
    if (names.has(f.name.trim())) throw new Error(`名称重复：${f.name}`);
    names.add(f.name.trim());
    return {slot:f.slot, name:f.name.trim()};
  });
  const missing = slots.filter(s => !foods.some(f => f.slot === s));
  if (missing.length) throw new Error(`缺少槽位：${missing.join('、')}`);
  return {foods};
}

export function matchingPrompt(candidates) {
  return `你正在模拟食物库名称匹配，不连接真实数据库。只输出合法JSON。
输入候选（键为槽位，数组为食物名称）：${JSON.stringify(groupCandidates(candidates))}
为每个候选返回一条模拟匹配记录，保持slot、queryName与输入一致。无法合理模拟时status为unmatched且food为null，禁止伪装真实命中。
food使用以下真实库的字段结构（值为模拟）：
{"id":"sim_rice","name":"米饭","en":"Rice","type":"food","source":"simulation","unit":"gram","weight":100,"calorie":"116","nutrition":{"protein":"2.6","fat":"0.3","fiber":"0.3","carbohydrate":"25.9"},"category":"谷薯芋、杂豆、主食","mainCategory":"staple_food","tag":"grain","customUnit":"碗","showUnits":[{"name":"克","weight":1,"type":"gram"},{"name":"碗（小）","weight":"150","type":"custom"},{"name":"碗（中）","weight":"250","type":"custom"}]}
所有id以sim_开头且唯一；source固定simulation。nutrition和calorie均按weight克基准，可食熟重或即食重量。营养值合理估算，烹调菜计入油脂。showUnits的weight表示每单位克重；鸡蛋每个约50克，饮品可按实际包装克重，普通饭菜用常见碗份。克单位本身不是1克食用份量。不要生成图片、多语言、使用次数等无关字段。
因当前库结构没有过敏原与食材，另在每条匹配的外层输出simulationIngredients与simulationAllergens数组，这也是模拟补充字段，不是真实库字段，不可声称已获安全核实。
输出：{"matches":[{"slot":"staple","queryName":"米饭","status":"simulated","food":{上述结构},"simulationIngredients":["大米"],"simulationAllergens":[]}]}。
每个输入恰好对应一个输出，不增加输入不存在的食物。`;
}

export function adaptMatches(value, candidates) {
  if (!Array.isArray(value?.matches) || !value.matches.length) throw new Error('需要matches数组，且至少包含一条匹配记录');
  const seen = new Set(), foods = [], unmatched = [];
  const required = new Set(candidates.foods.map(c => JSON.stringify([c.slot,c.name])));
  for (const m of value.matches) {
    const key = JSON.stringify([m.slot,m.queryName]);
    if (seen.has(key) || !candidates.foods.some(c => c.slot === m.slot && c.name === m.queryName)) throw new Error('匹配记录重复或与候选不一致');
    seen.add(key);
    if (m.status === 'unmatched') {unmatched.push(m.queryName);continue;}
    const f=m.food;
    if (m.status !== 'simulated' || !f || !f.id?.startsWith('sim_') || f.source !== 'simulation' || f.unit !== 'gram') throw new Error('模拟记录必须使用sim_ ID、simulation来源和gram单位');
    const number = (v, name) => { if (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v)<0) throw new Error(`${m.queryName}缺少有效${name}`);return Number(v); };
    const base = number(f.weight,'基准重量'); if (!base) throw new Error('基准重量不能为0');
    const nutritionPer100g = Object.fromEntries([['protein','protein'],['fat','fat'],['carbs','carbohydrate']].map(([to,from]) => [to,number(f.nutrition?.[from],from)*100/base]));
    nutritionPer100g.calories=number(f.calorie,'热量')*100/base;
    let portions=(f.showUnits || []).filter(u=>u.type==='custom').map(u=>({grams:number(u.weight,'单位重量'),label:`1${u.name}`}));
    if (!portions.length) {unmatched.push(`${m.queryName}（缺少可执行份量）`);continue;}
    if (portions.some(o=>!o.grams)) throw new Error('自定义单位重量必须大于0');
    if (portions.length===1) portions=[...portions,...[2,3].map(n=>({grams:portions[0].grams*n,label:`${n}${f.showUnits.find(u=>u.type==='custom').name}`}))];
    if (!Array.isArray(m.simulationIngredients) || !m.simulationIngredients.length || !Array.isArray(m.simulationAllergens)) throw new Error('模拟匹配需要附加模拟食材与过敏原数组');
    foods.push({id:f.id,name:m.queryName,slot:m.slot,ingredients:m.simulationIngredients,allergens:m.simulationAllergens,nutritionPer100g,portions,dataSource:'simulated_library',libraryRecord:f});
  }
  for (const c of candidates.foods) {
    if (!seen.has(JSON.stringify([c.slot,c.name]))) unmatched.push(`${c.name}（未返回匹配记录）`);
  }
  return {foods,unmatched};
}
