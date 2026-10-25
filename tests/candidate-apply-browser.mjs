import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { defaultTemplate } from '../src/workbench-model.js';
import { getSlots, SLOT_NAMES } from '../src/engine.js';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
try {
  await page.goto(process.env.WORKBENCH_URL||'http://127.0.0.1:4174/');
  await page.getByRole('tab',{name:'候选食物'}).click();
  const input={status:'OK',goal:'fat_loss',planName:'均衡膳食减脂餐',slotFoods:getSlots(defaultTemplate()).map(slot=>({slot:SLOT_NAMES[slot],foods:Array.from({length:15},(_,i)=>`${slot}食物${i+1}`)}))};
  await page.getByLabel('候选食物JSON',{exact:true}).fill(JSON.stringify(input));
  await page.getByRole('button',{name:'应用候选列表',exact:true}).click();
  const feedback=page.getByTestId('candidate-apply-feedback');
  await feedback.waitFor();
  assert.match(await feedback.innerText(),/已应用 5 个槽位、75 种候选食物/);
  assert.equal(await page.locator('.candidate-groups section').count(),5);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('otter-meal-lab-v2')));
  assert.equal(stored.bundle.candidates.slotFoods[0].slot,'staple');
  await page.getByLabel('候选食物JSON',{exact:true}).fill('{');
  await page.getByRole('button',{name:'应用候选列表',exact:true}).click();
  assert.match(await feedback.innerText(),/应用失败/);
  assert.equal(await page.locator('.candidate-groups section').count(),5);
  console.log('Chinese slots apply and persist; invalid JSON shows inline feedback without clearing candidates.');
} finally {await browser.close();}
