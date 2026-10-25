import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recipeReviewPrompt} from '../src/recipe-review-prompt.js';

test('recipe review scores meal content and explicitly ignores technical meal fields',()=>{
  const prompt=recipeReviewPrompt(
    {目的:'减脂',每日餐数:'一天3顿',饮食策略:'均衡饮食'},
    {name:'均衡饮食减脂7日计划'},
    [],
    {days:[{day:1,meals:[{items:[{name:'燕麦粥',grams:200}]}]}]}
  );

  assert.match(prompt,/只评价食谱内容/);
  assert.match(prompt,/不得因为缺少mealCode、mealName/);
  assert.match(prompt,/没有mealCode或mealName本身不构成问题/);
  assert.match(prompt,/每餐搭配与餐次合理性/);
  assert.doesNotMatch(prompt,/JSON结构与字段完整性/);
});
