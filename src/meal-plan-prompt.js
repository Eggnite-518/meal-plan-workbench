import {GOALS} from './engine.js';
import {MEAL_NAMES} from './workbench-model.js';

const STRATEGIES={regular:'日常饮食',vegetarian:'蛋奶素',mediterranean:'地中海饮食',lowCarb:'低碳饮食',keto:'生酮饮食'};

export const MEAL_PLAN_PROMPT=JSON.stringify({
  Role:'饮食计划搭配设计师',
  Background:'你擅长根据固定的7日餐次模板和候选食物列表，生成合理、自然且具有多样性的饮食计划。输入的候选食物已经完成饮食策略筛选、忌口过滤和过敏原过滤。你只负责决定每天每餐吃什么，不负责计算克重、热量或营养素。',
  Goals:['按照7日餐次模板，为每天每餐选择具体食物','严格满足模板中的必选槽位和可选槽位','优先选择best食物，secondary作为补充','兼顾日常搭配合理性和7天食物多样性','输出不包含克重的饮食计划'],
  Rules:['只能从filteredFoodPools中选择食物，不得生成列表之外的食物','不得修改模板中的日期、餐次、必选槽位和可选槽位','每个必选槽位必须选择1种食物','每个可选槽位可以选择0种或1种食物','食物必须从其所属slot对应的列表中选择','优先从best中选择；为了改善搭配或减少重复，可以从secondary中选择','结合早餐、午餐和晚餐的日常饮食习惯进行合理搭配','同一餐内不得重复选择同一种食物','尽量避免同一种食物连续两天出现在相同餐次','尽量提高7天内主食、蛋白质、蔬菜和水果的多样性','食物多样性不等于每餐完全不同；同一种核心食物一周可以出现2至3次，但不要连续两天出现在同一餐次','每餐应优先组成现实中常见、能够共同食用的完整搭配；不要为了填充可选槽位机械加入不自然的油脂、坚果、种子或水果','每日目标热量仅用于理解计划的摄入水平，不得自行计算或输出克重','不得输出克重、份数、热量、营养素数据或烹饪步骤','如果必选槽位没有可用食物，必须返回failed并说明日期、餐次和槽位','输出必须是合法JSON，不得输出Markdown或额外说明'],
  Output:{status:'success',days:[{day:1,meals:[{mealType:'breakfast',items:[{slot:'staple',foodName:'燕麦粥',source:'best',required:true}]}]}],errors:[]},
  Workflows:['读取用户目标、每日目标热量、7日餐次模板和候选食物列表','按照模板依次填充每天每餐的必选槽位','根据搭配合理性决定是否填充可选槽位','优先使用best食物，必要时使用secondary食物','检查餐次合理性、食物重复度和模板完整性','检查所有食物是否原样存在于对应槽位的候选列表中','按照Output结构输出不带克重的饮食计划']
},null,2);

export function mealPlanInput(template,foods,calories){
  const slots=[...new Set(template.days.flatMap(day=>day.meals.flatMap(meal=>[...meal.required,...meal.optional])))];
  return {
    goal:{goalType:GOALS[template.goal],dietaryStrategy:STRATEGIES[template.match.habit]||template.match.habit},
    dailyTargetCalories:calories,
    mealTemplate:{days:template.days.length,schedule:template.days.map(day=>({day:day.day,meals:day.meals.map(meal=>({mealType:meal.id,mealName:meal.name||MEAL_NAMES[meal.id],requiredSlots:meal.required,optionalSlots:meal.optional}))}))},
    filteredFoodPools:slots.map(slot=>({slot,foods:{best:foods.filter(food=>food.slot===slot&&food.preference!=='secondary').map(food=>food.name),secondary:foods.filter(food=>food.slot===slot&&food.preference==='secondary').map(food=>food.name)}})),
  };
}

export function renderMealPlanPrompt(template,foods,calories){
  const input=mealPlanInput(template,foods,calories);
  return `${MEAL_PLAN_PROMPT}\n\n以下是本次实际输入。只返回Output规定的JSON：\n${JSON.stringify(input,null,2)}`;
}

export function parseAiMealPlan(value,template,foods){
  if(!value||value.status!=='success'||!Array.isArray(value.days)||value.days.length!==template.days.length)throw new Error(value?.status==='failed'?`AI未能生成完整计划：${(value.errors||[]).map(error=>error.reason).join('；')||'未知原因'}`:'AI餐食结果必须包含完整7天且status为success');
  const foodByKey=new Map(foods.map(food=>[`${food.slot}|${food.name}`,food]));
  const seenDays=new Set();
  const days=value.days.map(day=>{
    const definition=template.days.find(item=>item.day===day.day);
    if(!definition||seenDays.has(day.day)||!Array.isArray(day.meals)||day.meals.length!==definition.meals.length)throw new Error(`AI餐食结果的第${day.day}天结构与模板不一致`);
    seenDays.add(day.day);const seenMeals=new Set();
    const meals=day.meals.map(meal=>{
      const mealType=meal.mealType,mealDefinition=definition.meals.find(item=>item.id===mealType);
      if(!mealDefinition||seenMeals.has(mealType)||!Array.isArray(meal.items))throw new Error(`第${day.day}天存在无效或重复餐次`);
      seenMeals.add(mealType);const seenSlots=new Set();
      const items=meal.items.map(item=>{
        if(!item||typeof item.foodName!=='string'||seenSlots.has(item.slot))throw new Error(`第${day.day}天${mealDefinition.name}存在无效或重复槽位`);
        const required=mealDefinition.required.includes(item.slot),optional=mealDefinition.optional.includes(item.slot);
        if(!required&&!optional)throw new Error(`第${day.day}天${mealDefinition.name}包含模板外槽位：${item.slot}`);
        if(item.required!==required)throw new Error(`第${day.day}天${mealDefinition.name}的${item.slot}必选属性被AI修改`);
        const food=foodByKey.get(`${item.slot}|${item.foodName}`);
        if(!food)throw new Error(`第${day.day}天${mealDefinition.name}使用了候选池外食物：${item.foodName}`);
        const source=food.preference==='secondary'?'secondary':'best';
        if(item.source!==source)throw new Error(`${item.foodName}的推荐等级应为${source}`);
        seenSlots.add(item.slot);
        return {foodId:food.id,name:food.name,slot:item.slot,preference:source,optional,aiSelected:true};
      });
      const missing=mealDefinition.required.filter(slot=>!seenSlots.has(slot));
      if(missing.length)throw new Error(`第${day.day}天${mealDefinition.name}缺少必选槽位：${missing.join('、')}`);
      return {id:mealDefinition.id,name:mealDefinition.name,share:mealDefinition.share,items};
    });
    const missingMeals=definition.meals.filter(meal=>!seenMeals.has(meal.id));
    if(missingMeals.length)throw new Error(`第${day.day}天缺少餐次：${missingMeals.map(meal=>meal.name).join('、')}`);
    return {day:day.day,meals};
  });
  return {days:structuredClone(days),warnings:[],seed:'ai',status:'ready',unresolved:[],generatedBy:'ai'};
}
