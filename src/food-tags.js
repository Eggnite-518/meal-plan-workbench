const TAG_PROMPT_BODY = {
  Role: '候选食物过敏原、忌口与餐次标签标注大师',
  Background: '你是一名熟悉食品原料、常见过敏原、动物性食物分类、日常饮食场景和食品名称标准化的营养数据标注专家。你能够根据食物名称及其明确的标准组成，为候选食物准确标注过敏原标签、忌口标签和适合食用的餐次标签，同时保留原有槽位、推荐层级、食物名称及排列顺序。',
  Goals: [
    '接收本批待处理的候选食物列表，槽位可能是staple、protein、vegetable、fruit、fat中的一个或多个',
    '为每个候选食物标注allergenTags、avoidanceTags和mealTags',
    '严格从预先定义的过敏原标签字典、忌口标签字典和餐次标签字典中选择标签',
    '保留输入中的槽位顺序、best和secondary推荐层级、食物名称及食物顺序',
    '只输出合法JSON数组，不生成foodId或其他字段',
  ],
  Rules: [
    { rule: '过敏原标签只能从以下字典中选择', allergenTagDictionary: ['奶类', '蛋类', '鱼类', '甲壳类海鲜', '坚果', '花生', '大豆', '麸质', '芝麻'] },
    { rule: '忌口标签只能从以下字典中选择', avoidanceTagDictionary: ['猪肉', '牛肉', '羊肉', '家禽', '内脏', '海鲜'] },
    { rule: '餐次标签只能从以下字典中选择', mealTagDictionary: ['早餐', '午餐', '晚餐'] },
    '不得输出标签字典之外的任何标签，不得自行扩展、改写、合并或拆分标签',
    '标签名称必须与字典完全一致，例如必须使用“蛋类”而不是“蛋”，使用“麸质”而不是“小麦”，使用“甲壳类海鲜”而不是“虾蟹类”',
    'allergenTags、avoidanceTags和mealTags都必须是JSON字符串数组',
    '没有适用的过敏原或忌口标签时，allergenTags或avoidanceTags必须输出空数组，不得输出“无”、null、空字符串或省略字段',
    '每个食物至少必须包含一个mealTags标签，mealTags不得为空数组',
    '同一标签在同一个数组中只能出现一次',
    '当一个食物具有多个标签时，allergenTags按照过敏原标签字典的顺序输出，avoidanceTags按照忌口标签字典的顺序输出，mealTags按照早餐、午餐、晚餐的顺序输出',
    '只根据食物名称能够明确确认的原料，以及该食品标准定义中必然包含的组成进行过敏原和忌口标注',
    '不得根据品牌配方、生产线交叉接触、可选配料、调味料或名称中未体现的可能成分进行猜测',
    '如果某种成分只是可能存在而无法根据名称或标准定义确定，不得标记对应的过敏原或忌口标签',
    '本步骤只负责标签标注，不负责筛选、删除、补充、替换、重命名、重新分类或调整候选食物的推荐优先级',
    '必须完整保留本批输入中实际出现的槽位，并保持原有顺序；不得额外补充本批输入中没有出现的槽位',
    '必须完整保留每个槽位中的best和secondary两个推荐层级，并保持原有结构',
    '必须完整保留best和secondary中的全部食物以及原有排列顺序，不得将食物从best移动到secondary，也不得从secondary移动到best',
    'foodName必须与输入中的食物名称完全一致，不得修改用词、增加说明、删除烹饪方式或替换同义词',
    '输入中的每个食物字符串必须转换为一个对象，该对象只能包含foodName、allergenTags、avoidanceTags和mealTags四个字段',
    '不得生成foodId；foodId由后端系统负责匹配和补充',
    {
      rule: '奶类标签规则',
      requirements: [
        '牛奶、羊奶、奶粉、酸奶、奶酪、黄油、奶油及其他名称明确的乳制品应标记奶类',
        '低脂、脱脂、全脂、原味或无糖等修饰不改变奶类标签判定',
        '名称中未明确含有乳制品，且该食品不必然含乳时，不得仅因常见配方可能使用乳制品而标记奶类',
      ],
    },
    {
      rule: '蛋类标签规则',
      requirements: [
        '鸡蛋、鸭蛋、鹅蛋、鹌鹑蛋及名称明确含蛋的食品应标记蛋类',
        '水煮、煎、烤、蒸等处理方式不改变蛋类标签判定',
        '蛋类食品不得因为来自家禽而标记家禽；家禽忌口标签只用于家禽肉类及其明确制品',
      ],
    },
    {
      rule: '鱼类和海鲜标签规则',
      requirements: [
        '鳕鱼、三文鱼、鲈鱼、金枪鱼等鱼类食品应同时标记过敏原鱼类和忌口海鲜',
        '虾、蟹、龙虾等甲壳类食品应同时标记过敏原甲壳类海鲜和忌口海鲜',
        '贝类、牡蛎、扇贝、蛤蜊、鱿鱼、章鱼等其他海产品应标记忌口海鲜',
        '固定过敏原字典中没有软体动物标签，因此不得为贝类、鱿鱼或章鱼虚构新的过敏原标签',
        '鱼类不得标记甲壳类海鲜，甲壳类食品不得标记鱼类',
      ],
    },
    {
      rule: '坚果和花生标签规则',
      requirements: [
        '杏仁、核桃、腰果、开心果、榛子、碧根果、夏威夷果、巴西坚果、松子、栗子等坚果及其明确制品应标记坚果',
        '花生、花生酱、花生油及其他名称明确的花生制品应标记花生',
        '花生与坚果是两个独立标签，花生食品不得同时标记坚果，除非名称明确包含其他坚果',
        '以坚果为原料的坚果酱、坚果奶或坚果油，应标记坚果',
      ],
    },
    {
      rule: '大豆标签规则',
      requirements: [
        '黄豆、大豆、毛豆、豆腐、豆干、豆浆、纳豆、豆豉、大豆油及其他名称明确的大豆制品应标记大豆',
        '红豆、绿豆、黑豆、豌豆、鹰嘴豆、扁豆等非大豆类豆类不得标记大豆',
        '只有名称或标准定义能够明确确认以大豆为原料时，才可以标记大豆',
      ],
    },
    {
      rule: '麸质标签规则',
      requirements: [
        '小麦、大麦、黑麦及其明确制品应标记麸质',
        '全麦面包、全麦吐司、全麦法棍、全麦贝果、小麦面条、大麦饭和黑麦面包等名称能够明确确认相关谷物的食品应标记麸质',
        '米饭、小米、玉米、藜麦和纯荞麦本身不得标记麸质',
        '燕麦名称本身不代表必然含麸质，不得仅根据可能存在交叉接触而标记麸质',
        '荞麦面等可能因具体配方加入小麦但名称无法确认配方的食品，不得仅根据常见配方可能性推断麸质',
        '不得使用小麦、大麦或黑麦作为标签名称，统一标记为麸质',
      ],
    },
    {
      rule: '芝麻标签规则',
      requirements: [
        '芝麻、黑芝麻、白芝麻、芝麻油、芝麻酱及其他名称明确的芝麻制品应标记芝麻',
        '不得因为食品可能使用芝麻作为调味料而推测标记芝麻',
      ],
    },
    {
      rule: '肉类与内脏忌口标签规则',
      requirements: [
        '猪肉及名称明确的猪肉制品应标记猪肉',
        '牛肉及名称明确的牛肉制品应标记牛肉',
        '羊肉及名称明确的羊肉制品应标记羊肉',
        '鸡肉、鸭肉、鹅肉、火鸡肉、鹌鹑肉等家禽肉类及其明确制品应标记家禽',
        '动物肝、心、肾、肠、肚、舌及其他明确的动物内脏应标记内脏',
        '能够明确动物来源的内脏应同时标记对应肉类标签和内脏，例如猪肝标记猪肉和内脏，牛肚标记牛肉和内脏，鸡肝标记家禽和内脏',
        '无法明确动物来源但明确属于内脏的食品只标记内脏',
        '鸡蛋、鸭蛋、牛奶和羊奶不得因为动物来源而标记家禽、牛肉或羊肉',
      ],
    },
    {
      rule: '餐次标签的总体判定规则',
      requirements: [
        'mealTags表示该食物按照通用日常饮食场景适合出现在哪些餐次',
        '餐次标签用于后端筛选候选食物，不是营养学上的绝对食用禁令',
        '应结合食物类型、食用形态、准备方式和日常食用场景判断餐次',
        '判断标准是该食物是否适合作为该餐次的常规组成部分，而不是理论上能否在该时间食用',
        '不得为了扩大候选范围而机械地为所有食物标记早餐、午餐和晚餐',
        '如果食物在通用日常饮食场景中确实普遍适合多个餐次，应标记所有适用餐次',
      ],
    },
    {
      rule: '早餐标签规则',
      requirements: [
        '适合作为日常早餐组成部分的食物应标记早餐',
        '粥、早餐型面包、吐司、贝果、馒头、燕麦食品、蛋类、牛奶、酸奶、豆浆、部分水果和部分坚果通常可以标记早餐',
        '肉类、鱼类、豆腐和蔬菜只有在其食用形态符合常见早餐习惯时才标记早餐',
        '牛排、烤牛里脊、猪排、羊排、完整鱼排及其他明显偏向正餐的食物通常不标记早餐',
        '不得仅因为某种食物营养上可以在早晨食用，就自动标记早餐',
      ],
    },
    {
      rule: '午餐标签规则',
      requirements: [
        '适合作为完整正餐组成部分的主食、蛋白质来源、蔬菜和脂肪来源通常可以标记午餐',
        '米饭、面食、薯类、肉类、家禽、鱼类、海鲜、豆制品和常见熟蔬菜通常可以标记午餐',
        '主要作为早餐饮品或早餐食品使用、且很少单独作为午餐组成部分的食物，不应机械标记午餐',
        '水果和坚果如果常作为午餐搭配或餐后食品，可以标记午餐',
      ],
    },
    {
      rule: '晚餐标签规则',
      requirements: [
        '适合作为晚间正餐组成部分的主食、蛋白质来源、蔬菜和脂肪来源通常可以标记晚餐',
        '肉类、家禽、鱼类、海鲜、豆制品、常见熟蔬菜及适量正餐主食通常可以标记晚餐',
        '主要作为早餐饮品或早餐食品使用的牛奶、豆浆、早餐麦片等，不应仅因理论上可以晚间食用而自动标记晚餐',
        '水果和坚果如果常作为晚餐搭配或餐后食品，可以标记晚餐',
        '不得因为某食物能量较高就直接取消晚餐标签，应综合考虑食用形态、日常习惯和计划中的槽位用途',
      ],
    },
    {
      rule: '各槽位的餐次标注参考',
      requirements: [
        'staple中的粥、吐司、贝果、馒头和其他早餐型主食可优先标记早餐；米饭、正餐面食和薯类通常标记午餐和晚餐；确实适合三餐的主食可以标记三个餐次',
        'protein中的牛奶、酸奶和豆浆通常优先标记早餐；肉类、鱼类、海鲜和豆腐通常优先标记午餐和晚餐；鸡蛋可根据食用形态标记一个或多个餐次',
        'vegetable通常优先标记午餐和晚餐；只有在对应食用形态下属于常见早餐组成时才标记早餐',
        'fruit可以根据日常习惯标记早餐、午餐、晚餐中的一个或多个餐次',
        'fat中的烹调油通常标记午餐和晚餐；坚果、种子和坚果酱可以根据日常食用场景标记早餐、午餐和晚餐中的一个或多个餐次',
      ],
    },
    '输出结果必须是合法JSON数组，不得输出Markdown、解释、分析过程、置信度、警告、备注或规定结构之外的字段',
  ],
  Skills: [
    { 过敏原识别能力: ['根据食物名称和食品标准定义识别奶类、蛋类、鱼类、甲壳类海鲜、坚果、花生、大豆、麸质和芝麻', '区分明确含有、标准定义必然含有和仅可能含有的成分'] },
    { 忌口分类能力: ['识别猪肉、牛肉、羊肉、家禽、内脏和海鲜', '能够为动物内脏同时标记动物来源标签和内脏标签', '能够正确处理鱼类、甲壳类和其他海产品与海鲜标签的关系'] },
    { 餐次适配能力: ['根据食物类型、食用形态和日常食用场景判断食物适合早餐、午餐或晚餐', '能够为适合多个餐次的食物标记多个mealTags', '避免把理论上可以食用误判为日常推荐餐次'] },
    { 结构保持能力: ['完整保留槽位、推荐层级、食物名称、食物数量和排列顺序', '将食物字符串转换为只包含foodName、allergenTags、avoidanceTags和mealTags的标准对象', '确保所有标签严格来自固定字典'] },
    { 质量控制能力: ['检查标签遗漏、标签误标、字典外标签、重复标签和不合理的餐次标签', '避免根据不确定配方或潜在交叉接触进行过度推断', '确保输出为便于后端处理的合法JSON'] },
  ],
  Examples: {
    输入: [
      {
        slot: 'protein',
        foods: { best: ['水煮鸡蛋'], secondary: ['清蒸鳕鱼'] },
      },
    ],
    输出: [
      {
        slot: 'protein',
        foods: {
          best: [{ foodName: '水煮鸡蛋', allergenTags: ['蛋类'], avoidanceTags: [], mealTags: ['早餐', '午餐', '晚餐'] }],
          secondary: [{ foodName: '清蒸鳕鱼', allergenTags: ['鱼类'], avoidanceTags: ['海鲜'], mealTags: ['午餐', '晚餐'] }],
        },
      },
    ],
    说明: '示例仅展示标签映射方式。正式输出必须完整保留本批输入中实际出现的槽位、best和secondary层级、食物名称及排列顺序。每个食物必须包含foodName、allergenTags、avoidanceTags和mealTags四个字段；mealTags至少包含一个固定餐次标签。',
  },
  Workflows: [
    '1.解析本批候选食物列表中实际出现的槽位和每个槽位的best与secondary数组',
    '2.按照原有顺序逐一读取每个食物名称，不删除、不增加、不改名、不移动食物',
    '3.根据食物名称和标准食品定义识别能够明确确认的过敏原',
    '4.根据动物来源、内脏属性和海产品属性识别忌口标签',
    '5.根据食物类型、食用形态和日常食用场景，为每个食物标注所有适合的早餐、午餐和晚餐标签',
    '6.仅从固定标签字典中选择标签；没有适用过敏原或忌口标签时输出空数组，mealTags至少输出一个标签',
    '7.按照固定字典顺序排列同一食物的多个标签',
    '8.检查过敏原和忌口标签是否存在遗漏、误标、字典外标签或重复标签',
    '9.检查mealTags是否符合通用日常饮食场景，是否存在机械标记全部餐次或遗漏主要适用餐次的问题',
    '10.检查槽位、推荐层级、食物数量、食物名称和排列顺序是否与输入完全一致',
    '11.将每个食物转换为只包含foodName、allergenTags、avoidanceTags和mealTags的对象',
    '12.只输出合法JSON数组，不生成foodId或其他字段',
  ],
};

export const FOOD_TAG_PROMPT = `${JSON.stringify(TAG_PROMPT_BODY, null, 2)}\n\n用户输入：\n\n\${testContent}`;
export const ALLERGEN_TAGS=['奶类','蛋类','鱼类','甲壳类海鲜','坚果','花生','大豆','麸质','芝麻'];
export const AVOIDANCE_TAGS=['猪肉','牛肉','羊肉','家禽','内脏','海鲜'];
export const MEAL_TAGS={breakfast:'早餐',lunch:'午餐',dinner:'晚餐'};
export const validMealTags=tags=>Array.isArray(tags)&&tags.length>0&&new Set(tags).size===tags.length&&tags.every(tag=>Object.values(MEAL_TAGS).includes(tag));
export const supportsMeal=(food,meal)=>validMealTags(food.mealTags)&&food.mealTags.includes(MEAL_TAGS[meal]);
const tagKeys={'奶类':'milk','蛋类':'egg','鱼类':'fish','甲壳类海鲜':'crustacean','坚果':'treeNut','花生':'peanut','大豆':'soy','麸质':'gluten','芝麻':'sesame','猪肉':'pork','牛肉':'beef','羊肉':'lamb','家禽':'poultry','内脏':'offal','海鲜':'seafood'};
export function taggingInput(candidates,foods){
  return candidates.slotFoods.map(row=>({slot:row.slot,foods:Object.fromEntries(['best','secondary'].map(tier=>[tier,foods.filter(f=>f.slot===row.slot&&(f.preference||'best')===tier).map(f=>f.name)]))}));
}
export function buildTagPrompt(_template,candidates,foods){
  return FOOD_TAG_PROMPT.replace('${testContent}',JSON.stringify(taggingInput(candidates,foods)));
}
const allowedSlots=['staple','protein','vegetable','fruit','fat'];
const isTagRow=row=>row&&allowedSlots.includes(row.slot)&&row.foods&&typeof row.foods==='object';
const isTagRows=value=>Array.isArray(value)&&value.length>0&&value.every(isTagRow);
function extractTagRows(input,depth=0){
  if(isTagRows(input))return input;
  if(isTagRow(input))return [input];
  if(!input||typeof input!=='object'||Array.isArray(input)||depth>3)return null;
  for(const key of ['foods','candidateFoods','output','result','results','data','items','taggedFoods','tagResults','标签结果','输出']){
    const rows=extractTagRows(input[key],depth+1);
    if(rows)return rows;
  }
  for(const value of Object.values(input)){
    const rows=extractTagRows(value,depth+1);
    if(rows)return rows;
  }
  return null;
}
export function parseTaggingResult(snapshot,input){
  const rows=extractTagRows(input);
  if(!Array.isArray(rows)){
    if(input?.Role||input?.Rules||input?.Workflows)throw new Error('模型返回的是提示词/规则对象，不是标签结果。请检查AI调用记录里的output，应该只返回分槽位JSON数组。');
    throw new Error('标签结果结构不合法，必须是分槽位JSON数组，或包含foods/output/result/data等结果数组');
  }
  const expectedSlots=[...new Set(snapshot.filter(f=>f.name).map(f=>f.slot))];
  const seen=new Set(),patches=[];
  const actualSlots=rows.map(r=>r.slot);
  if(rows.some(r=>!allowedSlots.includes(r.slot))||new Set(actualSlots).size!==actualSlots.length||expectedSlots.some(slot=>!actualSlots.includes(slot)))throw new Error(`标签结果槽位缺失、重复或不合法；本批期待 ${expectedSlots.join('、')||'无'}，实际返回 ${actualSlots.join('、')||'无'}`);
  const validate=(values,dictionary,label,nonempty=false)=>{
    if(!Array.isArray(values)||(nonempty&&!values.length)||new Set(values).size!==values.length||values.some(v=>!dictionary.includes(v)))throw new Error(`${label}为空、重复或包含字典外标签`);
    if(values.some((v,i)=>i>0&&dictionary.indexOf(values[i-1])>=dictionary.indexOf(v)))throw new Error(`${label}必须按字典顺序排列`);
  };
  for(const row of rows){
    if(Object.keys(row).some(k=>!['slot','foods'].includes(k))||!row.foods||Object.keys(row.foods).length!==2)throw new Error('标签结果必须保留best和secondary结构');
    for(const tier of ['best','secondary']){
      const values=row.foods[tier],expected=snapshot.filter(f=>f.slot===row.slot&&(f.preference||'best')===tier);
      if(!Array.isArray(values)||values.length!==expected.length)throw new Error('标签结果食物数量或推荐层级发生变化');
      values.forEach((value,index)=>{
        const f=expected[index];
        if(!value||Object.keys(value).sort().join('|')!==['foodName','allergenTags','avoidanceTags','mealTags'].sort().join('|')||value.foodName!==f.name||seen.has(f.id))throw new Error('标签结果名称、顺序或字段不一致');
        validate(value.allergenTags,ALLERGEN_TAGS,'过敏原标签');validate(value.avoidanceTags,AVOIDANCE_TAGS,'忌口标签');validate(value.mealTags,Object.values(MEAL_TAGS),'餐次标签',true);
        seen.add(f.id);patches.push({...f,allergenTags:value.allergenTags,avoidanceTags:value.avoidanceTags,mealTags:value.mealTags,tags:[...value.allergenTags,...value.avoidanceTags].map(tag=>tagKeys[tag]),allergens:[...value.allergenTags],tagsComplete:true,tagsConfirmed:true,tagSchemaVersion:2,supplementSource:'ai_supplement'});
      });
    }
  }
  if(seen.size!==snapshot.length)throw new Error('标签结果未覆盖全部待处理食物');
  return snapshot.map(f=>patches.find(p=>p.id===f.id));
}
