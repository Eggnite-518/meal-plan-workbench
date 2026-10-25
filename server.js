import express from "express";
import { createServer as createViteServer } from "vite";
import { chatEndpoint, thinkingParameters } from './src/api-config.js';
import {validateCandidates, matchingPrompt, adaptMatches} from './src/food-library.js';
import {searchFoods} from './src/real-library.js';
import { validateBundleTemplate, normalizeCandidates, parsePlanTemplates } from './src/workbench-model.js';
import {
  buildPrompt,
  getTargets,
  validateFoods,
  validateTemplate,
  validateProfile,
} from "./src/engine.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
    return res.status(403).json({ error: "仅允许本地工作台调用" });
  res.set("Cache-Control", "no-store");
  next();
});
function apiSettings(config) {
  if (!config || typeof config.apiKey !== "string" || !config.apiKey.trim())
    throw new Error("请先在 API 设置中填写密钥");
  if (!config.model || typeof config.model !== "string")
    throw new Error("请填写模型名 / 豆包推理接入点 ID");
  const base = new URL(config.baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Base URL 需要是不含账号密码、查询参数的 HTTPS 地址");
  if (
    /^(localhost|127\.|10\.|192\.168\.|0\.|169\.254\.|\[)/.test(base.hostname)
  )
    throw new Error("请输入模型供应商的公网 HTTPS 地址");
  return {
    url: chatEndpoint(config.baseUrl),
    key: config.apiKey.trim(),
    model: config.model.trim(),
  };
}
async function completion(config, prompt, isTest, signal) {
  const settings = apiSettings(config);
  const start = performance.now();
  const maxTokens = Number(config.maxTokens || 8192);
  if (!Number.isInteger(maxTokens) || maxTokens < 512 || maxTokens > 65536)
    throw new Error("最大输出 Token 需要在 512–65536 之间");
  const thinking = /^https:\/\/(mediocre-new-api|new-api)\.midway\.run\/?/.test(config.baseUrl)
    ? {}
    : thinkingParameters(config.thinkingMode);
  const body = {
    model: settings.model,
    messages: [
      {
        role: "system",
        content: isTest
          ? "Respond briefly."
          : "只输出合法 JSON，遵循用户的任务和输出格式。",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: isTest ? 128 : maxTokens,
    ...thinking,
  };
  if (config.jsonMode && !isTest)
    body.response_format = { type: "json_object" };
  const response = await fetch(settings.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
    redirect: "error",
  });
  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `接口返回了非 JSON 内容（HTTP ${response.status}），请检查 Base URL`,
    );
  }
  if (!response.ok)
    throw new Error(
      `模型接口 HTTP ${response.status}：${String(
        data.error?.message || data.message || "调用失败",
      )
        .slice(0, 700)
        .replaceAll(settings.key, "[已隐藏]")}`,
    );
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new Error(
      "模型未返回文本内容，请确认模型支持 Chat Completions 文本输出",
    );
  return {
    content,
    model: data.model || settings.model,
    usage: data.usage || null,
    durationMs: Math.round(performance.now() - start),
    finishReason: data.choices[0].finish_reason,
  };
}
app.post('/api/food-search', async (req,res)=>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),35000);
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try {
    const {query,cookie,page=1}=req.body;
    res.json(await searchFoods(query,cookie,page,fetch,controller.signal));
  } catch(error) {
    // Only fixed local error messages are returned, never upstream response text.
    const message=error.name==='AbortError' ? '食物库查询超过35秒或已取消，请重试' : error.message;
    res.status(400).json({error:message.startsWith('食物库') || message.startsWith('请输入') || message.startsWith('请填写') || message==='无效页码' ? message : '食物库连接失败，请检查公司网络或 VPN'});
  } finally {clearTimeout(timeout);}
});
app.post("/api/test", async (req, res) => {
  try {
    const result = await completion(
      req.body.config,
      "Reply with OK.",
      true,
      AbortSignal.timeout(30000),
    );
    res.json(result);
  } catch (error) {
    res
      .status(400)
      .json({
        error:
          error.name === "TimeoutError"
            ? "连接测试超过30秒，请检查网络和模型信息"
            : error.message,
      });
  }
});
app.post('/api/preprocess', async (req,res) => {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),240000);
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try {
    const {config,template,count=15,prompt,stage}=req.body;
    if (!['plan','candidates','enrichment'].includes(stage)) throw new Error('无效的预处理阶段');
    if(stage!=='plan')validateBundleTemplate(template);
    if(stage==='enrichment'&&(!Number.isInteger(count) || count<3 || count>20)) throw new Error('候选数量需要为3–20的整数');
    if (typeof prompt!=='string' || !prompt.trim() || prompt.length>60000) throw new Error('提示词不能为空或超过60000字符');
    const result=await completion(config,prompt,false,controller.signal);
    let parsed=null,validationError='';
    try {
      parsed=JSON.parse(result.content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim());
      if(stage==='plan')parsed=parsePlanTemplates(parsed);
      if(stage==='candidates') parsed=normalizeCandidates(parsed,template);
    } catch(error) {validationError=(result.finishReason==='length'?'输出被Token上限截断；':'')+error.message;}
    res.json({...result,parsed,validationError,stage,timestamp:new Date().toISOString()});
  } catch(error) {
    res.status(400).json({error:error.name==='AbortError'?'调用已取消或超过4分钟':error.message});
  } finally {clearTimeout(timer);}
});
app.post('/api/review-recipe', async (req,res)=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),240000);
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try {
    const {config,prompt}=req.body;
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>500000)throw new Error('测评提示词为空或过长');
    const result=await completion(config,prompt,false,controller.signal);
    let parsed;
    try{parsed=JSON.parse(result.content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim());}
    catch{throw new Error('模型返回的测评结果不是合法JSON');}
    if(!parsed||!Number.isInteger(parsed.score)||parsed.score<0||parsed.score>100||typeof parsed.conclusion!=='string'||!parsed.conclusion.trim()||Object.keys(parsed).some(k=>!['score','conclusion'].includes(k)))throw new Error('测评结果必须只包含0至100整数score和非空conclusion');
    res.json({...result,parsed,timestamp:new Date().toISOString()});
  } catch(error){res.status(400).json({error:error.name==='AbortError'?'测评调用已取消或超过4分钟':error.message});}
  finally{clearTimeout(timer);}
});
app.post("/api/generate", async (req, res) => {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 240000);
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const { config, profile, template, count, prompt: customPrompt, stage = 'candidates', candidates } = req.body;
    validateProfile(profile);
    validateTemplate(template);
    getTargets(profile);
    if (!Number.isInteger(count) || count < 3 || count > 20)
      throw new Error("每槽位候选数量需要为 3–20 的整数");
    if (!['candidates','matching'].includes(stage)) throw new Error('无效的调用阶段');
    if(stage === 'matching') validateCandidates(candidates,template);
    const prompt = customPrompt || (stage === 'matching' ? matchingPrompt(candidates) : buildPrompt(profile, template, count));
    if (typeof prompt !== "string" || prompt.length > 60000)
      throw new Error("提示词过长或格式错误");
    const result = await completion(config, prompt, false, controller.signal);
    let parsed,
      validation = null,
      validationError = "";
    try {
      parsed = JSON.parse(
        result.content
          .replace(/^\s*```(?:json)?\s*/i, "")
          .replace(/\s*```\s*$/, "")
          .trim(),
      );
      validation = stage === 'matching' ? {...validateFoods(adaptMatches(parsed,candidates),template,profile), unmatched:adaptMatches(parsed,candidates).unmatched} : validateCandidates(parsed,template);
    } catch (error) {
      validationError =
        result.finishReason === "length"
          ? `输出达到 Token 上限，JSON 可能被截断。请在 API 配置中提高最大输出 Token，或减少每槽位数量。原始错误：${error.message}`
          : error.message;
    }
    res.json({
      ...result,
      parsed: parsed || null,
      validation,
      validationError,
      prompt,
      stage,
      provider: config.provider,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res
      .status(400)
      .json({
        error:
          error.name === "AbortError"
            ? "调用中止或超过4分钟。可减少每槽位候选数量，或更换模型。"
            : error.message,
      });
  } finally {
    clearTimeout(timeout);
  }
});
app.use("/api", (req, res) => res.status(404).json({ error: "API 不存在" }));
const vite = await createViteServer({
  server: { middlewareMode: true, hmr: { port: Number(process.env.HMR_PORT || 24679) } },
  appType: "spa",
});
app.use(vite.middlewares);
const preferred = Number(process.env.PORT || 4173);
function listen(port) {
  const server = app.listen(port, "127.0.0.1");
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") listen(port + 1);
    else throw error;
  });
  server.on("listening", () =>
    console.log(`Meal plan workbench ready: http://127.0.0.1:${port}`),
  );
}
listen(preferred);
