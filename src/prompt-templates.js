import {getSlots,SLOT_NAMES} from './engine.js';
import {matchingPrompt,groupCandidates} from './food-library.js';

export const DEFAULT_CANDIDATE_TEMPLATE = `# 角色
你是一名专业的营养搭配师，负责根据用户的个性化需求推荐食物。只输出合法JSON，不输出解释。

# 任务
为每个指定槽位推荐{{count}}种常见、名称明确且互不重复的食物或具体菜品。

# 用户信息
用户地区：{{region}}
餐食形态：{{style}}
过敏：{{allergies}}
忌口：{{avoids}}
偏好：{{preference}}

# 槽位
{{slots}}

# 推荐规则
严格排除过敏、忌口及通常含这些食材的复合菜。粥归主食。不要跨槽位重复名称或同义名称。蛋白类指适合早餐的非饮品食物；豆浆、牛奶、酸奶统一归饮品。

# 输出格式
只输出以槽位ID为键、食物名称数组为值的JSON对象。
格式示例：{"staple":["馒头","花卷","白粥","小米粥"],"fruit":["苹果","橙子"]}。
示例不代表完整输出，实际需覆盖所有指定槽位，每个数组包含{{count}}个名称。

# 最终检查
槽位齐全，分类正确，符合过敏与忌口限制，同槽位与跨槽位不能存在重复食物。`;

export const DEFAULT_MATCH_TEMPLATE = matchingPrompt({foods:[]}).replace('输入候选（键为槽位，数组为食物名称）：{}','输入候选（键为槽位，数组为食物名称）：{{candidates}}');

export function renderPrompt(template, values) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g,(_,key)=>{
    if (!Object.hasOwn(values,key)) throw new Error(`未知提示词变量：${key}`);
    return String(values[key]);
  });
}
export function candidateValues(p,t,count) {
  return {count,region:p.region || '中国',style:p.style==='chinese'?'中式家常':'轻食',allergies:JSON.stringify(p.allergies),avoids:p.avoids || '无',preference:p.preference || '无特殊偏好',slots:JSON.stringify(Object.fromEntries(getSlots(t).map(s=>[s,SLOT_NAMES[s]])))};
}
export function matchValues(candidates) {return {candidates:JSON.stringify(groupCandidates(candidates))};}
