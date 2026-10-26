import solver from "javascript-lp-solver";
import {supportsMeal} from './food-tags.js';
import {candidatePrompt} from './food-library.js';

export const SLOT_NAMES = {
  staple: "主食",
  protein: "蛋白质来源",
  vegetable: "蔬菜",
  side: "小菜 / 蔬菜",
  meatDish: "蛋白质为主的复合菜肴",
  vegDish: "蔬菜为主的复合菜肴",
  drink: "饮品",
  fruit: "水果",
  soup: "汤",
  fat: "脂肪来源",
  compositeStaple: "复合主食",
};
export const DEFAULT_PROFILE = {
  sex: "female",
  age: 29,
  height: 165,
  weight: 62,
  activity: 1.375,
  goal: "fatLoss",
  calorieMode: "manual",
  calories: 1650,
  adjustment: -300,
  protein: 25,
  fat: 30,
  carbs: 45,
  days: 7,
  mealCount: 3,
  twoMeals: "lunchDinner",
  style: "chinese",
  allergies: [],
  avoids: "",
  preference: "",
  source: "home",
};
export const DEFAULT_RULES = {
  calorieTolerance: 8,
  macroTolerance: 5,
  mealTolerance: 25,
  maxRepeat: 3,
  seed: 42,
};
export const GOALS = { fatLoss: "减脂", muscleGain: "增肌", maintain: "维持" };
const round = (n, digits = 1) => Number(n.toFixed(digits));
const finite = (n) => typeof n === "number" && Number.isFinite(n);
export function validateProfile(p) {
  const bounds = {
    age: [18, 100],
    height: [120, 230],
    weight: [35, 250],
    activity: [1.1, 2.5],
    calories: [800, 5000],
    adjustment: [-800, 800],
    days: [1, 14],
    protein: [10, 50],
    fat: [15, p.habit==='keto'?80:50],
    carbs: [p.habit==='keto'?2:10, 75],
  };
  for (const [key, [min, max]] of Object.entries(bounds))
    if (!finite(p[key]) || p[key] < min || p[key] > max)
      throw new Error(`${key} 需要在 ${min}–${max} 之间`);
  if (!Number.isInteger(p.days) || ![2, 3].includes(p.mealCount))
    throw new Error("天数需要为整数，餐数需要为 2 或 3");
  if (Math.abs(p.protein + p.fat + p.carbs - 100) > 0.001)
    throw new Error("蛋白质、脂肪、碳水比例合计必须为 100%");
  if (
    !GOALS[p.goal] ||
    !["chinese", "light"].includes(p.style) ||
    !["female", "male"].includes(p.sex)
  )
    throw new Error("目标、餐食风格或生理性别不正确");
  if (!Array.isArray(p.allergies)) throw new Error("过敏信息必须是数组");
}
export function getTargets(p) {
  validateProfile(p);
  const bmr =
    10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = Math.round(bmr * p.activity);
  const calories =
    p.calorieMode === "manual"
      ? Math.round(p.calories)
      : Math.round(tdee + p.adjustment);
  if (calories < 800 || calories > 5000)
    throw new Error(
      "推算热量超出工作台 800–5000 kcal 的可测试范围，请调整参数",
    );
  return {
    bmr: Math.round(bmr),
    tdee,
    calories,
    grams: {
      protein: round((calories * p.protein) / 100 / 4),
      fat: round((calories * p.fat) / 100 / 9),
      carbs: round((calories * p.carbs) / 100 / 4),
    },
  };
}
export function getTemplate(p) {
  const chinese = p.style === "chinese";
  const breakfast = chinese
    ? { required: ["staple", "protein"], optional: ["drink", "fruit"] }
    : {
        required: ["staple", "protein"],
        optional: ["vegetable", "fruit", "drink", "fat"],
      };
  const lunch = chinese
    ? {
        required: ["staple", "meatDish", "vegDish"],
        optional: ["soup", "fruit", "drink"],
      }
    : {
        required: ["staple", "protein", "vegetable"],
        optional: ["fruit", "fat", "soup", "drink"],
      };
  const dinner = chinese
    ? {
        required: ["meatDish", "vegDish"],
        optional: ["staple", "soup", "fruit"],
      }
    : {
        required: ["protein", "vegetable"],
        optional: ["staple", "fat", "fruit", "soup"],
      };
  let meals = [
    { id: "breakfast", name: "早餐", share: 0.25, ...breakfast },
    { id: "lunch", name: "午餐", share: 0.4, ...lunch },
    { id: "dinner", name: "晚餐", share: 0.35, ...dinner },
  ];
  if (p.mealCount === 2)
    meals =
      p.twoMeals === "breakfastLunch"
        ? [
            { ...meals[0], share: 0.4 },
            { ...meals[1], share: 0.6 },
          ]
        : [
            { ...meals[1], share: 0.5 },
            { ...meals[2], share: 0.5 },
          ];
  return {
    id: `${p.style}_${p.mealCount}_${p.mealCount === 2 ? p.twoMeals : "standard"}`,
    name: `${chinese ? "中式" : "轻食"}${p.mealCount === 2 ? "两餐" : "三餐"}模板`,
    meals,
  };
}
export const MAX_FOODS_PER_MEAL=4;
export function mealServingSummary(meal) {
  const items=meal.items.filter(item=>item.grams===undefined||item.grams>0);
  return {foodCount:items.length,totalGrams:round(items.reduce((sum,item)=>sum+(item.grams||0),0))};
}
export function validateTemplate(t) {
  validateMeals(t?.meals);
  if (t.days !== undefined) {
    if (!Array.isArray(t.days) || !t.days.length || t.days.length > 14)
      throw new Error("逐日模板需要包含1–14天");
    t.days.forEach((d, i) => {
      if (d.day !== i + 1) throw new Error("逐日模板编号必须从1连续递增");
      validateMeals(d.meals);
      if (d.meals.length !== t.meals.length || d.meals.some((m, j) => m.id !== t.meals[j].id))
        throw new Error("每天的餐次需要保持一致");
    });
  }
}
function validateMeals(meals) {
  const t = { meals };
  if (!t || !Array.isArray(t.meals) || t.meals.length < 2 || t.meals.length > 3)
    throw new Error("模板需要包含 2–3 餐");
  if (
    t.meals.some((m) => !finite(m.share)) ||
    Math.abs(t.meals.reduce((s, m) => s + m.share, 0) - 1) > 0.001
  )
    throw new Error("各餐热量分配 share 合计必须为 1");
  const ids = new Set();
  for (const m of t.meals) {
    if (
      !m.id ||
      ids.has(m.id) ||
      !finite(m.share) ||
      m.share <= 0 ||
      !Array.isArray(m.required) ||
      !Array.isArray(m.optional) ||
      !m.required.length
    )
      throw new Error("模板餐次 ID、热量分配或必选槽位无效");
    ids.add(m.id);
    if(m.required.length>MAX_FOODS_PER_MEAL)throw new Error(`${m.name||m.id}必选食物超过4种，请调整模板；可选食物可保留为候选`);
    const slots = [...m.required, ...m.optional];
    if (
      new Set(slots).size !== slots.length ||
      slots.some((s) => !SLOT_NAMES[s])
    )
      throw new Error("同餐槽位不可重复，槽位名称需使用工作台已有的分类");
  }
}
export function getMeals(t, day = 1) {
  if (!t.days) return t.meals;
  const entry = t.days.find(d => d.day === day);
  if (!entry) throw new Error(`模板缺少第${day}天的结构`);
  return entry.meals;
}
export function getSlots(t) {
  validateTemplate(t);
  const meals = t.days ? t.days.flatMap(d => d.meals) : t.meals;
  return [...new Set(meals.flatMap((m) => [...m.required, ...m.optional]))];
}
export function buildPrompt(p,t,count=10) {return candidatePrompt(p,t,count);}

export function validateFoods(input, t, p) {
  const foods = Array.isArray(input) ? input : input?.foods;
  if (!Array.isArray(foods) || !foods.length || foods.length > 400)
    throw new Error("需要 foods 数组，包含 1–400 个候选");
  const slots = getSlots(t),
    ids = new Set(),
    names = new Set(),
    accepted = [],
    excluded = [];
  const hard = [...p.allergies, ...p.avoids.split(/[,，、;；\n]+/)]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const aliases = {
    蛋: ["鸡蛋", "鸭蛋", "鹅蛋", "蛋清", "蛋黄", "蛋白粉", "egg", "mayonnaise"],
    奶: [
      "牛奶",
      "酸奶",
      "奶酪",
      "乳清",
      "黄油",
      "乳粉",
      "milk",
      "cheese",
      "yogurt",
      "whey",
      "butter",
    ],
    大豆: ["黄豆", "豆腐", "豆浆", "酱油", "soy", "tofu"],
    小麦: ["面粉", "面包", "面条", "馒头", "wheat", "bread", "pasta"],
    花生: ["花生", "peanut"],
    坚果: [
      "核桃",
      "杏仁",
      "腰果",
      "榛子",
      "开心果",
      "almond",
      "cashew",
      "walnut",
    ],
    鱼: ["三文鱼", "鳕鱼", "鲈鱼", "金枪鱼", "fish", "salmon", "tuna", "cod"],
    甲壳类: ["虾", "蟹", "龙虾", "shrimp", "crab", "lobster"],
    芝麻: ["芝麻", "sesame"],
  };
  for (const f of foods) {
    if (
      !f ||
      typeof f.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(f.id) ||
      ids.has(f.id)
    )
      throw new Error("食物 ID 必须是唯一的英文字母、数字、下划线或短横线");
    ids.add(f.id);
    if (
      typeof f.name !== "string" ||
      !f.name.trim() ||
      names.has(f.name.trim())
    )
      throw new Error(`食物名称为空或重复：${f.name}`);
    names.add(f.name.trim());
    if (!slots.includes(f.slot))
      throw new Error(`${f.name} 的槽位 ${f.slot} 不在模板中`);
    if (
      !Array.isArray(f.ingredients) ||
      (!f.ingredients.length && f.dataSource !== 'real_library'&&f.tagSchemaVersion!==2) ||
      f.ingredients.some((v) => typeof v !== "string") ||
      !Array.isArray(f.allergens) ||
      f.allergens.some((v) => typeof v !== "string")
    )
      throw new Error(`${f.name} 需要完整的 ingredients 和 allergens 数组`);
    const n = f.nutritionPer100g;
    if (
      !n ||
      ["protein", "fat", "carbs"].some(
        (k) => !finite(n[k]) || n[k] < 0 || n[k] > 100,
      ) ||
      n.protein + n.fat + n.carbs > 100.5
    )
      throw new Error(`${f.name} 每100克营养值不合理`);
    const kcal = n.protein * 4 + n.fat * 9 + n.carbs * 4;
    if (kcal < 1) throw new Error(`${f.name} 无可用能量数据`);
    if (
      !Array.isArray(f.portions) ||
      f.portions.length < 1 ||
      f.portions.length > 12 ||
      f.portions.some(
        (o) =>
          !finite(o.grams) ||
          o.grams < 1 ||
          o.grams > 1200 ||
          typeof o.label !== "string" ||
          !o.label.trim(),
      )
    )
      throw new Error(`${f.name} 需要 1–12 个含 grams、label 的可执行份量`);
    const haystack = [f.name, ...f.ingredients, ...f.allergens]
      .join("|")
      .toLowerCase();
    const hit = hard.find((word) =>
      [word, ...(aliases[word] || [])].some((term) => haystack.includes(term)),
    );
    if (hit)
      excluded.push({
        id: f.id,
        name: f.name,
        reason: `包含忌口 / 过敏项：${hit}`,
      });
    else
      accepted.push({
        ...f,
      nutritionPer100g: { ...n, calories: finite(n.calories)&&n.calories>0?n.calories:round(kcal) },
        dataSource: f.dataSource || "ai_estimate",
      });
  }
  const missing = slots.filter((s) => !accepted.some((f) => f.slot === s));
  if (missing.length)
    throw new Error(
      `过滤后缺少候选：${missing.map((s) => SLOT_NAMES[s]).join("、")}。请补充候选，或修改模板移除该可选槽位。已拦截 ${excluded.length} 个候选。`,
    );
  return {
    foods: accepted,
    excluded,
    warnings: [...(accepted.some(f=>f.dataSource==='real_library') ? ['真实食物库未核实完整食材、过敏原及生熟状态；关键词过滤不能证明过敏安全，仅供内部验证。份量只使用库中单位或人工确认值。'] : []), ...slots
      .filter((s) => accepted.filter((f) => f.slot === s).length < 3)
      .map((s) => `${SLOT_NAMES[s]}不足3种，多样性受限`)],
  };
}

function randomGenerator(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function validateRules(r) {
  for (const [key, min, max] of [
    ["calorieTolerance", 1, 25],
    ["macroTolerance", 1, 15],
    ["mealTolerance", 5, 60],
    ["maxRepeat", 1, 21],
    ["seed", 0, 999999],
  ])
    if (!finite(r[key]) || r[key] < min || r[key] > max)
      throw new Error(`${key} 需要在 ${min}–${max} 之间`);
  if (!Number.isInteger(r.maxRepeat) || !Number.isInteger(r.seed))
    throw new Error("重复上限与随机种子必须是整数");
}
export function compose(p, t, foods, rules, replacementMode='best') {
  validateTemplate(t);
  validateProfile(p);
  validateRules(rules);
  const rand = randomGenerator(rules.seed),
    usage = {},
    warnings = [];
  const days = Array.from({ length: p.days }, (_, d) => ({
    day: d + 1,
    meals: getMeals(t, d + 1).map((m) => ({
      id: m.id,
      name: m.name,
      share: m.share,
      items: [...m.required, ...m.optional].map((slot) => {
        const mealEligible = foods.filter((f) => f.slot === slot&&supportsMeal(f,m.id));
        const slotEligible = foods.filter((f) => f.slot === slot);
        if (!mealEligible.length && m.optional.includes(slot)) return null;
        if (!mealEligible.length && !slotEligible.length) {
          warnings.push(`第${d+1}天${m.name}：必选${SLOT_NAMES[slot]}在安全过滤后无候选，需人工补充`);
          return {foodId:null,name:'无安全候选，需人工补充',slot,preference:'unresolved',optional:false,unresolved:true};
        }
        const mealTagRelaxed=!mealEligible.length;
        const eligible = mealTagRelaxed ? slotEligible : mealEligible;
        const best=eligible.filter(f=>f.preference!=='secondary'),secondary=eligible.filter(f=>f.preference==='secondary');
        const pool=replacementMode==='secondary'&&secondary.length?secondary:replacementMode==='mixed'?eligible:best.length?best:secondary;
        if(mealTagRelaxed)warnings.push(`第${d+1}天${m.name}：必选${SLOT_NAMES[slot]}无当前餐次候选，已在保留过敏原、忌口和饮食条件的前提下放宽餐次标签`);
        const available = pool.filter(
          (f) => (usage[f.id] || 0) < rules.maxRepeat,
        );
        if (!available.length)
          warnings.push(
            `第${d + 1}天${m.name}：${SLOT_NAMES[slot]}候选不足，已放宽重复上限`,
          );
        const ranked = (available.length ? available : pool)
          .map((f) => ({ f, rank: (usage[f.id] || 0) + rand() }))
          .sort((a, b) => a.rank - b.rank);
        const food = ranked[0].f;
        if(food.preference==='secondary')warnings.push(`第${d+1}天${m.name}：${SLOT_NAMES[slot]}使用次推荐替换食物「${food.name}」`);
        usage[food.id] = (usage[food.id] || 0) + 1;
        return {
          foodId: food.id,
          name: food.name,
          slot,
          preference:food.preference||'best',
          optional: m.optional.includes(slot),
          mealTagRelaxed,
        };
      }).filter(Boolean),
    })),
  }));
  const unresolved=days.flatMap(day=>day.meals.flatMap(meal=>meal.items.filter(item=>item.unresolved).map(item=>({day:day.day,meal:meal.name,slot:item.slot}))));
  return { days, warnings: [...new Set(warnings)], seed: rules.seed,status:unresolved.length?'incomplete':'ready',unresolved };
}
export function validatePlan(plan, p, t, foods) {
  if (!plan || !Array.isArray(plan.days) || plan.days.length !== p.days)
    throw new Error(`计划需要恰好 ${p.days} 天`);
  const foodMap = new Map(foods.map((f) => [f.id, f]));
  const dayIds = new Set();
  for (const d of plan.days) {
    if (
      !Number.isInteger(d.day) ||
      d.day < 1 ||
      d.day > p.days ||
      dayIds.has(d.day) ||
      !Array.isArray(d.meals) ||
      d.meals.length !== getMeals(t, d.day).length
    )
      throw new Error("计划天数编号或餐数有误");
    dayIds.add(d.day);
    const mealIds = new Set();
    for (const m of d.meals) {
      const mt = getMeals(t, d.day).find((v) => v.id === m.id);
      if (!mt || mealIds.has(m.id) || !Array.isArray(m.items))
        throw new Error(`第${d.day}天餐次不合法`);
      mealIds.add(m.id);
      const present = new Set();
      for (const i of m.items) {
        if(i.unresolved===true){
          if(i.foodId!==null||i.optional||!mt.required.includes(i.slot)||present.has(i.slot))throw new Error(`第${d.day}天${m.name}未解决槽位格式无效`);
          present.add(i.slot);continue;
        }
        const f = foodMap.get(i.foodId);
        const taggedCandidates=foods.some(food=>food.slot===i.slot&&supportsMeal(food,m.id));
        const mealAllowed=supportsMeal(f||{},m.id)||i.aiSelected===true||(i.mealTagRelaxed===true&&!taggedCandidates);
        if (
          !f ||
          f.slot !== i.slot ||
          !mealAllowed ||
          ![...mt.required, ...mt.optional].includes(i.slot) ||
          present.has(i.slot)
        )
          throw new Error(`第${d.day}天${m.name}食物引用或槽位有误`);
        if (Boolean(i.optional) !== mt.optional.includes(i.slot))
          throw new Error("槽位的 optional 标记必须与模板一致");
        present.add(i.slot);
      }
      if (mt.required.some((s) => !present.has(s)))
        throw new Error(`第${d.day}天${m.name}缺少必选槽位`);
    }
  }
}
function nutrition(food, portion) {
  const n = food.nutritionPer100g,
    r = portion.grams / 100;
  return {
    calories: (n.calories ?? (n.protein * 4 + n.fat * 9 + n.carbs * 4)) * r,
    protein: n.protein * r,
    fat: n.fat * r,
    carbs: n.carbs * r,
  };
}
export function totals(items) {
  return items.reduce(
    (acc, i) => {
      for (const k of ["calories", "protein", "fat", "carbs"])
        acc[k] += i[k] || 0;
      return acc;
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
}
export function macroRatio(n) {
  const e = n.protein * 4 + n.fat * 9 + n.carbs * 4;
  return {
    protein: e ? ((n.protein * 4) / e) * 100 : 0,
    fat: e ? ((n.fat * 9) / e) * 100 : 0,
    carbs: e ? ((n.carbs * 4) / e) * 100 : 0,
  };
}
export function checkDay(day, p, t, rules) {
  const target = getTargets(p).calories,
    n = totals(day.meals.flatMap((m) => m.items)),
    ratio = macroRatio(n),
    checks = [];
  const add = (name, value, min, max, unit) =>
    checks.push({
      name,
      value: round(value),
      min: round(min),
      max: round(max),
      unit,
      pass: value >= min - 0.05 && value <= max + 0.05,
    });
  add(
    "每日热量",
    n.calories,
    target * (1 - rules.calorieTolerance / 100),
    target * (1 + rules.calorieTolerance / 100),
    "kcal",
  );
  for (const k of ["protein", "fat", "carbs"])
    add(
      { protein: "蛋白质供能比", fat: "脂肪供能比", carbs: "碳水供能比" }[k],
      ratio[k],
      p[k] - rules.macroTolerance,
      p[k] + rules.macroTolerance,
      "%",
    );
  for (const m of day.meals) {
    const mt = getMeals(t, day.day).find((v) => v.id === m.id),
      e = totals(m.items).calories;
    add(
      `${m.name}热量`,
      e,
      target * mt.share * (1 - rules.mealTolerance / 100),
      target * mt.share * (1 + rules.mealTolerance / 100),
      "kcal",
    );
    add(`${m.name}食物种数`,mealServingSummary(m).foodCount,1,MAX_FOODS_PER_MEAL,'种');
  }
  return {
    nutrition: Object.fromEntries(
      Object.entries(n).map(([k, v]) => [k, round(v)]),
    ),
    macroRatio: Object.fromEntries(
      Object.entries(ratio).map(([k, v]) => [k, round(v)]),
    ),
    checks,
    pass: checks.every((c) => c.pass),
  };
}

function localRepairPool(eligible,currentId,expectedCalories,limit){
  const current=eligible.find(f=>f.id===currentId);
  const ranked=eligible.map(food=>{
    const portionDistance=Math.min(...food.portions.map(portion=>Math.abs(nutrition(food,portion).calories-expectedCalories)));
    const nutritionDistance=current?Math.abs(food.nutritionPer100g.calories-current.nutritionPer100g.calories)*0.05+Math.abs(food.nutritionPer100g.protein-current.nutritionPer100g.protein)+Math.abs(food.nutritionPer100g.fat-current.nutritionPer100g.fat)+Math.abs(food.nutritionPer100g.carbs-current.nutritionPer100g.carbs)*0.25:0;
    return {food,score:portionDistance+nutritionDistance-(food.id===currentId?0.001:0)};
  }).sort((a,b)=>a.score-b.score).slice(0,limit).map(x=>x.food);
  if(current&&!ranked.some(f=>f.id===current.id))ranked[ranked.length-1]=current;
  return ranked;
}

export function solveDay(day, p, t, foods, rules, timeout = 650, searchMode='current', approximate=false) {
  const target = getTargets(p).calories;
  const model = {
    optimize: "cost",
    opType: "min",
    constraints: approximate ? {center:{equal:target}} : {
      daily: {
        min: target * (1 - rules.calorieTolerance / 100),
        max: target * (1 + rules.calorieTolerance / 100),
      },
      center: { equal: target },
    },
    variables: {},
    binaries: {},
    timeout,
    tolerance: searchMode==='current'?0:0.000001,
  };
  // In fallback mode the only objective is absolute daily-calorie deviation.
  // This keeps meal balance and recommendation tier from outweighing a closer
  // daily calorie result; those remain visible in the independent checks.
  model.variables.deviationBelow = { cost: 1, center: 1 };
  model.variables.deviationAbove = { cost: 1, center: -1 };
  if(searchMode!=='current'&&!approximate){
    model.variables.deviationBelow.cost=0;
    model.variables.deviationAbove.cost=0;
  }
  if(!approximate)for (const k of ["protein", "fat", "carbs"]) {
      model.constraints[`${k}Min`] = { min: 0 };
      model.constraints[`${k}Max`] = { max: 0 };
    }
  const choices = {},groupOptionCounts=[];
  day.meals.forEach((m, mi) => {
    const mt = getMeals(t, day.day).find((v) => v.id === m.id);
    model.constraints[`mealCount${mi}`]={max:MAX_FOODS_PER_MEAL};
    if(!approximate)model.constraints[`meal${mi}`] = {
        min: target * mt.share * (1 - rules.mealTolerance / 100),
        max: target * mt.share * (1 + rules.mealTolerance / 100),
      };
    m.items.forEach((i, ii) => {
      const key = `pick${mi}_${ii}`;
      model.constraints[key] = { equal: 1 };
      const eligible=foods.filter(f=>f.slot===i.slot&&(i.aiSelected===true||i.mealTagRelaxed===true||supportsMeal(f,m.id))),best=eligible.filter(f=>f.preference!=='secondary');
      const source=searchMode==='best'&&best.length?best:eligible;
      const expectedCalories=target*mt.share/Math.max(1,m.items.length);
      const pool=searchMode==='current'?eligible.filter(f=>f.id===i.foodId):localRepairPool(source,i.foodId,expectedCalories,searchMode==='best'?5:7);
      const options=pool.flatMap(food=>food.portions.map((portion,oi)=>({food,portion,oi})));
      if(i.optional&&pool.length)options.unshift({food:pool[0],portion:{grams:0,label:'不加入'},oi:0});
      groupOptionCounts.push(options.length);
      options.forEach(({food,portion,oi}, optionIndex) => {
        const name = `x${mi}_${ii}_${optionIndex}`,
          n = nutrition(food, portion);
        const v = {
          cost: portion.grams
            ? 0.02 * Math.abs(oi - Math.ceil(food.portions.length / 2)) +
              (i.optional ? 0.01 : 0)+(food.id===i.foodId?0:0.1)+(food.preference==='secondary'?1:0)
            : 0,
          [key]: 1,
          daily: n.calories,
          center: n.calories,
          [`mealCount${mi}`]:portion.grams>0?1:0,
          ...(!approximate?{[`meal${mi}`]:n.calories}:{}),
        };
        if(!approximate)for (const k of ["protein", "fat", "carbs"]) {
          const factor = k === "fat" ? 9 : 4;
          v[`${k}Min`] =
            n[k] * factor - ((p[k] - rules.macroTolerance) / 100) * (n.protein*4+n.fat*9+n.carbs*4);
          v[`${k}Max`] =
            n[k] * factor - ((p[k] + rules.macroTolerance) / 100) * (n.protein*4+n.fat*9+n.carbs*4);
        }
        // A constant positive objective stops at a feasible integer assignment.
        if(searchMode!=='current'&&!approximate)v.cost=1;
        if(approximate)v.cost=0;
        model.variables[name] = v;
        model.binaries[name] = 1;
        choices[name] = { mi, ii, food, portion, nutrition: n };
      });
    });
  });
  const start = performance.now();
  const deadline=timeout>0?Date.now()+timeout:Infinity;
  const solution = solver.Solve(model);
  const timedOut=Date.now()>=deadline;
  const durationMs = Math.round(performance.now() - start);
  const searchMetrics={optionCount:Object.keys(choices).length,groupOptionCounts,estimatedCombinations:groupOptionCounts.reduce((total,count)=>Math.min(Number.MAX_SAFE_INTEGER,total*Math.max(1,count)),1)};
  const integral=Object.keys(choices).every(name=>Math.abs((solution[name]||0)-Math.round(solution[name]||0))<0.000001);
  if (!solution.feasible)
    return {
      pass: false,
      searchStatus:timedOut?'incomplete':'infeasible',
      reason:timedOut?'搜索达到时间上限，尚未找到可行解；不代表无解':'当前候选食物及离散份量范围内不存在可行解',
      durationMs,
      searchMetrics,
    };
  const result = {
    day: day.day,
    meals: day.meals.map((m) => ({
      id: m.id,
      name: m.name,
      share: getMeals(t, day.day).find((mt) => mt.id === m.id).share,
      items: [],
    })),
  };
  const picks = new Set();
  for (const [name, c] of Object.entries(choices))
    if (solution[name] > 0.5) {
      picks.add(`${c.mi}_${c.ii}`);
      if (c.portion.grams)
        result.meals[c.mi].items.push({
          foodId: c.food.id,
          name: c.food.name,
          slot: c.food.slot,
          preference:c.food.preference||'best',
          mealTagRelaxed:day.meals[c.mi].items[c.ii].mealTagRelaxed===true,
          aiSelected:day.meals[c.mi].items[c.ii].aiSelected===true,
          grams: c.portion.grams,
          portion: c.portion.label,
          ...c.nutrition,
        });
    }
  if (!integral||picks.size !== day.meals.reduce((s, m) => s + m.items.length, 0))
    return {
      pass: false,
      searchStatus:'incomplete',
      reason: timedOut?'搜索达到时间上限，未返回完整整数份量；不代表无解':'已搜索当前候选范围，未找到完整的整数份量组合',
      durationMs,
      searchMetrics,
    };
  const report = checkDay(result, p, t, rules);
  if(result.meals.some(meal=>mealServingSummary(meal).foodCount>MAX_FOODS_PER_MEAL))
    return {pass:false,searchStatus:'incomplete',reason:'结果超过每餐最多4种食物，未采纳',durationMs,searchMetrics};
  if (!report.pass&&!approximate)
    return {
      pass: false,
      searchStatus:'incomplete',
      reason: "求解结果未通过独立复算，未采纳此结果",
      durationMs,
      searchMetrics,
    };
  return { ...result, ...report, approximate:approximate&&!report.pass, durationMs,searchMetrics,searchStatus:report.pass?'feasible':'approximate',...(approximate&&!report.pass?{reason:'15秒内未找到完全满足全部营养约束的解，已按每日总热量绝对偏差最小返回最接近目标的可执行方案；请查看未通过项。'}:{}) };
}

// Emergency bounded search used only when the MILP fallback times out before
// producing an incumbent. It keeps the calorie-closest partial sums and never
// relaxes candidate, meal-tag, slot or executable-portion constraints.
export function closestCalorieDay(day,p,t,foods,rules,beamSize=4000){
  const target=getTargets(p).calories,started=performance.now(),groups=[];
  day.meals.forEach((m,mi)=>m.items.forEach((item,ii)=>{
    const eligible=foods.filter(f=>f.slot===item.slot&&(item.aiSelected===true||item.mealTagRelaxed===true||supportsMeal(f,m.id)));
    const options=eligible.flatMap(food=>food.portions.map(portion=>({food,portion,nutrition:nutrition(food,portion)})));
    if(item.optional)options.unshift({food:null,portion:{grams:0,label:'不加入'},nutrition:{calories:0,protein:0,fat:0,carbs:0}});
    if(!options.length)throw new Error(`第${day.day}天${m.name}的${SLOT_NAMES[item.slot]}没有可执行份量`);
    groups.push({mi,ii,item,options});
  }));
  let states=[{calories:0,picks:[],counts:day.meals.map(()=>0)}];
  for(let gi=0;gi<groups.length;gi++){
    const next=new Map(),remaining=groups.length-gi-1,progressTarget=target*(gi+1)/groups.length;
    for(const state of states)for(const option of groups[gi].options){
      const counts=[...state.counts],mi=groups[gi].mi;
      counts[mi]+=option.portion.grams>0?1:0;
      const requiredRemaining=groups.slice(gi+1).filter(group=>group.mi===mi&&!group.item.optional).length;
      if(counts[mi]+requiredRemaining>MAX_FOODS_PER_MEAL)continue;
      const calories=state.calories+option.nutrition.calories,key=`${Math.round(calories*10)}|${counts.join(',')}`;
      const candidate={calories,picks:[...state.picks,option],counts};
      const previous=next.get(key);
      if(!previous||Math.abs(calories-progressTarget)<Math.abs(previous.calories-progressTarget))next.set(key,candidate);
    }
    states=[...next.values()].sort((a,b)=>Math.abs(a.calories-(remaining?progressTarget:target))-Math.abs(b.calories-(remaining?progressTarget:target))).slice(0,beamSize);
  }
  const chosen=states.sort((a,b)=>Math.abs(a.calories-target)-Math.abs(b.calories-target))[0];
  if(!chosen)return {day:day.day,pass:false,meals:[],searchStatus:'infeasible',reason:'当前候选和必选结构无法满足每餐最多4种食物',durationMs:Math.round(performance.now()-started)};
  const result={day:day.day,meals:day.meals.map(m=>({id:m.id,name:m.name,share:getMeals(t,day.day).find(mt=>mt.id===m.id).share,items:[]}))};
  groups.forEach((group,index)=>{const choice=chosen.picks[index];if(!choice.food)return;result.meals[group.mi].items.push({foodId:choice.food.id,name:choice.food.name,slot:choice.food.slot,preference:choice.food.preference||'best',mealTagRelaxed:group.item.mealTagRelaxed===true,aiSelected:group.item.aiSelected===true,grams:choice.portion.grams,portion:choice.portion.label,...choice.nutrition});});
  const report=checkDay(result,p,t,rules);
  return {...result,...report,approximate:!report.pass,durationMs:Math.round(performance.now()-started),searchStatus:report.pass?'feasible':'approximate',reason:report.pass?undefined:'整数规划在15秒内未返回完整结果，已通过快速离散份量搜索返回每日总热量最接近目标的方案，并以热量绝对偏差最小为第一优先级；请查看未通过项。'};
}
export async function solvePlanDay(p,t,foods,selected,rules,onProgress=()=>{}) {
    let result;
    const attempts = [];
    const budget=Math.min(15000,Number.isFinite(rules.searchTimeMs)&&rules.searchTimeMs>0?rules.searchTimeMs:15000);
    const started=performance.now();
    const modes=['current','best',...(foods.some(f=>f.preference==='secondary')?['all']:[])];
    // Always reserve the final five seconds for a calorie-first fallback.
    const fallbackReserve=Math.min(5000,Math.max(1000,Math.floor(budget/3)));
    const strictDeadline=budget-fallbackReserve;
    for (let modeIndex=0;modeIndex<modes.length;modeIndex++) {
      const mode=modes[modeIndex],strictRemaining=Math.max(1,strictDeadline-(performance.now()-started));
      if(strictRemaining<=1)break;
      const remainingModes=modes.length-modeIndex;
      const attemptBudget=mode==='current'?Math.min(650,strictRemaining):Math.max(1,Math.floor(strictRemaining/remainingModes));
      onProgress({day:selected.day,searchMode:mode,searchStatus:'searching',elapsedMs:Math.round(performance.now()-started)});
      await new Promise(r=>setTimeout(r,0));
      result = solveDay(selected, p, t, foods, rules,attemptBudget,mode);
      attempts.push({
        attempt: attempts.length + 1,
        stageLabel:{current:'固定食物计算份量',best:'Best小候选集局部修复',all:'Best与次推荐小候选集局部修复'}[mode],
        replaced: mode!=='current',
        candidateTier:mode==='all'?'mixed':'best',
        searchMode:mode,
        searchStatus:result.searchStatus,
        pass: result.pass,
        durationMs: result.durationMs,
        searchMetrics:result.searchMetrics,
        reason: result.reason || "全部约束通过",
      });
      if (result.pass) break;
      if(performance.now()-started>=strictDeadline){
        if(mode!==modes.at(-1))result={...result,searchStatus:'incomplete',reason:'搜索达到时间上限，尚未完成全部候选范围搜索；不代表无解'};
        break;
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    if(!result?.pass){
      onProgress({day:selected.day,searchMode:'closest',searchStatus:'searching',elapsedMs:Math.round(performance.now()-started)});
      await new Promise(r=>setTimeout(r,0));
      const fallback=closestCalorieDay(selected,p,t,foods,rules);
      attempts.push({attempt:attempts.length+1,stageLabel:'全候选热量最接近兜底',replaced:true,candidateTier:'mixed',searchMode:'closest',searchStatus:fallback.searchStatus,pass:fallback.pass,durationMs:fallback.durationMs,reason:fallback.reason||'快速搜索返回热量最接近方案'});
      result=fallback;
    }
    const day=result.meals?.length
        ? { ...result, changedCombination: result.meals.some((m,mi)=>m.items.some(i=>!selected.meals[mi].items.some(s=>s.foodId===i.foodId&&s.slot===i.slot))) }
        : {
            day: selected.day,
            pass: false,
            meals: [],
            reason: result.reason,
            searchStatus:result.searchStatus,
          };
    const log={day:selected.day,attempts,searchStatus:result.searchStatus,searchScope:attempts.at(-1).searchMode,elapsedMs:Math.round(performance.now()-started)};
    return {day,log};
}

export function summarizeSolvedPlan(p,foods,rules,solved,durationMs=0) {
  const ordered=[...solved].sort((a,b)=>a.day.day-b.day.day),days=ordered.map(x=>x.day),log=ordered.map(x=>x.log);
  const valid = days.filter((d) => d.pass),resolved=days.filter(d=>d.meals?.length&&d.nutrition),
    avg = totals(resolved.map((d) => d.nutrition));
  for (const key of Object.keys(avg))
    avg[key] = resolved.length ? round(avg[key] / resolved.length) : 0;
  const actualUsage = {};
  resolved
    .flatMap((d) => d.meals.flatMap((m) => m.items))
    .forEach((i) => {
      actualUsage[i.foodId] = (actualUsage[i.foodId] || 0) + 1;
    });
  const repeated = Object.entries(actualUsage)
    .filter(([, count]) => count > rules.maxRepeat)
    .map(([id, count]) => ({
      name: foods.find((f) => f.id === id)?.name,
      count,
    }));
  return {
    status: valid.length === p.days ? "passed" : resolved.length===p.days ? "approximate" : "incomplete",
    generatedAt: new Date().toISOString(),
    days,
    summary: {
      passed: valid.length,
      total: p.days,
      approximate: resolved.filter(d=>d.approximate).length,
      average: avg,
      macroRatio: macroRatio(avg),
      repeatsOverLimit: repeated,
    },
    log,
    constraints: {
      ...rules,
      targetCalories: getTargets(p).calories,
      macroRatio: { protein: p.protein, fat: p.fat, carbs: p.carbs },
    },
    durationMs:Math.round(durationMs),
    nutritionSource: [...new Set(foods.map(f => f.dataSource || 'ai_estimate'))].join('、'),
  };
}

export async function solvePlan(p,t,foods,plan,rules,onProgress=()=>{}) {
  const planStarted=performance.now();
  if(plan?.days?.some(day=>day.meals?.some(meal=>meal.items?.some(item=>item.unresolved))))throw new Error('计划仍有必选槽位没有安全候选，不能计算为可执行方案');
  validatePlan(plan,p,t,foods);
  validateRules(rules);
  const solved=[];
  for(const selected of plan.days){
    const one=await solvePlanDay(p,t,foods,selected,rules,progress=>onProgress({...progress,completed:solved.length,total:plan.days.length}));
    solved.push(one);
    onProgress({completed:solved.length,total:plan.days.length,day:selected.day});
    await new Promise(r=>setTimeout(r,0));
  }
  return summarizeSolvedPlan(p,foods,rules,solved,performance.now()-planStarted);
}
