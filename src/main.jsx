import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clipboard,
  Code2,
  Download,
  FlaskConical,
  Grid2X2,
  Info,
  KeyRound,
  LayoutTemplate,
  ListFilter,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Utensils,
  X,
  AlertTriangle,
  CheckCheck,
  Clock3,
  Ban,
} from "lucide-react";
import {
  DEFAULT_PROFILE,
  DEFAULT_RULES,
  GOALS,
  SLOT_NAMES,
  getTargets,
  getTemplate,
  getSlots,
  buildPrompt,
  validateFoods,
  validateTemplate,
  validateProfile,
  validatePlan,
  compose,
  validateRules,
} from "./engine.js";
import { SAMPLE_FOODS } from "./sample.js";
import "./style.css";
import { chatEndpoint } from './api-config.js';
import {DEFAULT_CANDIDATE_TEMPLATE,DEFAULT_MATCH_TEMPLATE,renderPrompt,candidateValues,matchValues} from './prompt-templates.js';
import {validateCandidates, groupCandidates, matchingPrompt as buildMatchingPrompt, adaptMatches} from './food-library.js';
import {adaptRealMatches, uniqueExact, FOOD_ENDPOINT} from './real-library.js';

const PROVIDERS = {
  companyPersonal: {
    name: '公司网关 · 个人',
    baseUrl: 'https://mediocre-new-api.midway.run',
    model: 'deepseek-flash',
    thinkingMode: 'disabled',
  },
  companyProject: {
    name: '公司网关 · 项目组',
    baseUrl: 'https://new-api.midway.run',
    model: 'deepseek-flash',
    thinkingMode: 'disabled',
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    thinkingMode: 'disabled',
  },
  doubao: {
    name: "豆包 · 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
  },
  qwen: {
    name: "通义千问 · 百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
    thinkingMode: 'qwen-disabled',
  },
  silicon: {
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "" },
  custom: { name: "自定义兼容接口", baseUrl: "", model: "" },
};
const STEPS = [
  { title: "用户与模板", sub: "基础参数 · 模板匹配", icon: LayoutTemplate },
  { title: "候选食物", sub: "AI 调用 · 候选检查", icon: Sparkles },
  { title: "七天搭配", sub: "程序组合 · 重复控制", icon: Grid2X2 },
  { title: "份量与校验", sub: "整数求解 · 营养复算", icon: ShieldCheck },
];
const GOAL_PRESETS = {
  fatLoss: { protein: 25, fat: 30, carbs: 45 },
  muscleGain: { protein: 25, fat: 25, carbs: 50 },
  maintain: { protein: 20, fat: 30, carbs: 50 },
};
const json = (v) => JSON.stringify(v, null, 2);
const fmt = (v) => Math.round(v || 0).toLocaleString();
function readSaved() {
  try {
    return JSON.parse(
      localStorage.getItem("otter-meal-workbench-v1") || "null",
    );
  } catch {
    return null;
  }
}
function Button({ children, icon: Icon, primary, subtle, small, ...props }) {
  return (
    <button
      className={`button ${primary ? "primary" : ""} ${subtle ? "subtle" : ""} ${small ? "small" : ""}`}
      {...props}
    >
      {Icon && <Icon size={small ? 14 : 16} />} {children}
    </button>
  );
}
function Field({ label, note, children, wide }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {React.Children.map(children, child => React.isValidElement(child) && ['input', 'select', 'textarea'].includes(child.type) && typeof label === 'string' ? React.cloneElement(child, { 'aria-label': label }) : child)}
      {note && <small>{note}</small>}
    </label>
  );
}
function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map(([v, name]) => (
        <button
          key={v}
          type="button"
          className={value === v ? "selected" : ""}
          onClick={() => onChange(v)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
function Tag({ children, tone = "", ...props }) {
  return (
    <span className={`tag ${tone}`} {...props}>
      {children}
    </span>
  );
}
function JsonPanel({ title, text, onChange, action, description, rows = 13 }) {
  return (
    <div className="json-panel">
      <div className="panel-heading">
        <div className="heading-icon">
          <Code2 size={15} />
          <span>{title}</span>
        </div>
        <Button
          small
          subtle
          icon={Clipboard}
          onClick={() => navigator.clipboard.writeText(text).catch(() => {})}
        >
          复制
        </Button>
      </div>
      {description && <p className="panel-description">{description}</p>}
      <textarea
        aria-label={title}
        className="code-editor"
        value={text}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={!onChange}
        spellCheck={false}
        rows={rows}
      />
      {action && <div className="panel-footer">{action}</div>}
    </div>
  );
}
function Notice({ children, tone = "" }) {
  return (
    <div className={`notice ${tone}`}>
      {tone === "warning" ? <AlertTriangle size={16} /> : <Info size={16} />}
      <div>{children}</div>
    </div>
  );
}
function Empty({ icon: Icon = Circle, title, children }) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.4} />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
function MacroBar({ ratios }) {
  return (
    <div className="macrobar" aria-label="三大营养素供能比">
      {["protein", "fat", "carbs"].map((k) => (
        <div
          key={k}
          className={k}
          style={{ width: `${Math.max(0, Math.min(100, ratios[k]))}%` }}
        />
      ))}
    </div>
  );
}
function download(name, data) {
  const url = URL.createObjectURL(
    new Blob([json(data)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const [saved] = useState(readSaved);
  const [foodCookie,setFoodCookie]=useState('');
  const [libraryRows,setLibraryRows]=useState([]);
  const [libraryProgress,setLibraryProgress]=useState('');
  const [candidateTemplate,setCandidateTemplate]=useState(saved?.candidateTemplate || DEFAULT_CANDIDATE_TEMPLATE);
  const [matchTemplate,setMatchTemplate]=useState(saved?.matchTemplate || DEFAULT_MATCH_TEMPLATE);
  const [candidateTemplateDraft,setCandidateTemplateDraft]=useState(saved?.candidateTemplateDraft ?? saved?.candidateTemplate ?? DEFAULT_CANDIDATE_TEMPLATE);
  const [matchTemplateDraft,setMatchTemplateDraft]=useState(saved?.matchTemplateDraft ?? saved?.matchTemplate ?? DEFAULT_MATCH_TEMPLATE);
  const renderCandidate=(p,t,n)=>renderPrompt(candidateTemplate,candidateValues(p,t,n));
  const renderMatching=list=>renderPrompt(matchTemplate,matchValues(list));
  const [step, setStep] = useState(0),
    [draft, setDraft] = useState(saved?.profile || DEFAULT_PROFILE),
    [profile, setProfile] = useState(null);
  const [template, setTemplate] = useState(null),
    [templateText, setTemplateText] = useState(""),
    [foods, setFoods] = useState([]),
    [foodText, setFoodText] = useState(""),
    [foodValidation, setFoodValidation] = useState(null),
    [foodSource, setFoodSource] = useState("");
  const [plan, setPlan] = useState(null),
    [planText, setPlanText] = useState(""),
    [result, setResult] = useState(null),
    [rules, setRules] = useState(saved?.rules || DEFAULT_RULES),
    [count, setCount] = useState(10);
  const [rememberKey,setRememberKey]=useState(saved?.rememberKey || false);
  const [config, setConfig] = useState(() => ({
      provider: "companyPersonal",
      ...PROVIDERS.companyPersonal,
      jsonMode: true,
      maxTokens: 8192,
      ...(saved?.config || {}),
      apiKey:saved?.rememberKey ? saved?.config?.apiKey || '' : '',
    })),
    [showApi, setShowApi] = useState(false),
    [testState, setTestState] = useState(""),
    [apiBusy, setApiBusy] = useState(false);
  const [prompt, setPrompt] = useState(saved?.prompt || ""),
    [records, setRecords] = useState([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [progress, setProgress] = useState(null),
    [activeDay, setActiveDay] = useState(1),
    [slotFilter, setSlotFilter] = useState("all"),
    [showFoodJson, setShowFoodJson] = useState(false),
    [showPlanJson, setShowPlanJson] = useState(false),
    [showResultJson, setShowResultJson] = useState(false),
    [selectedRecord, setSelectedRecord] = useState(null);
  const [candidateText,setCandidateText]=useState(''), [candidateList,setCandidateList]=useState(null), [matchPrompt,setMatchPrompt]=useState(''), [matchText,setMatchText]=useState(''), [matchApplyState,setMatchApplyState]=useState(null);
  const controller = useRef(null),
    workerRef = useRef(null),
    watchdog = useRef(null);
  useEffect(() => {
    localStorage.setItem(
      "otter-meal-workbench-v1",
      json({ profile: draft, rules, rememberKey, config:{...config,apiKey:rememberKey ? config.apiKey : ''}, prompt, candidateTemplate,matchTemplate,candidateTemplateDraft,matchTemplateDraft }),
    );
  }, [draft, rules, config, rememberKey, prompt,candidateTemplate,matchTemplate,candidateTemplateDraft,matchTemplateDraft]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(
    () => () => {
      controller.current?.abort();
      workerRef.current?.terminate();
      clearTimeout(watchdog.current);
    },
    [],
  );
  const fail = (e) => setError(e.message || String(e));
  const guard = (fn) => {
    setError("");
    try {
      fn();
    } catch (e) {
      fail(e);
    }
  };
  const resetAfter = (index) => {
    if (index <= 1) {
      setCandidateList(null);setCandidateText('');setMatchText('');setMatchPrompt('');
      setFoods([]);
      setFoodText("");
      setFoodValidation(null);
      setFoodSource("");
      setMatchApplyState(null);
    }
    if (index <= 2) {
      setPlan(null);
      setPlanText("");
    }
    setResult(null);
  };
  const commitProfile = () =>
    guard(() => {
      validateProfile(draft);
      const t = getTemplate(draft);
      setProfile({ ...draft });
      setTemplate(t);
      setTemplateText(json(t));
      setPrompt(renderCandidate(draft, t, count));
      resetAfter(1);
      setToast("用户参数与模板已确认");
    });
  const applyTemplate = () =>
    guard(() => {
      if (!profile) throw new Error("请先确认用户参数");
      const t = JSON.parse(templateText);
      validateTemplate(t);
      setTemplate(t);
      setPrompt(renderCandidate(profile, t, count));
      resetAfter(1);
      setToast("模板已更新，下游输出已清空");
    });
  const applyFoods = (value = null, source = "manual") => {
    if (!profile || !template) throw new Error("请先确认用户参数与模板");
    const parsed = value || JSON.parse(foodText),
      checked = validateFoods(parsed, template, profile);
    if(parsed.unmatched?.length) checked.warnings.push(`未匹配或缺少可执行单位：${parsed.unmatched.join('、')}`);
    setFoods(checked.foods);
    setFoodValidation(checked);
    setFoodText(json({ foods: checked.foods }));
    setFoodSource(source);
    resetAfter(2);
    setSlotFilter("all");
    return checked;
  };
  const applyMatchedLibrary = (rawText = matchText) => {
    setError("");
    setMatchApplyState(null);
    try {
      if (!candidateList) throw new Error("请先应用名称列表");
      const adapted = adaptMatches(JSON.parse(rawText), candidateList);
      const checked = applyFoods(adapted, "simulated_library");
      setMatchApplyState({
        type: "success",
        message: `已应用 ${checked.foods.length} 个模拟库食物，可进入七天搭配。`,
      });
      setStep(2);
      setToast("模拟库数据已应用");
      return checked;
    } catch (e) {
      const message = e.message || String(e);
      setError(message);
      setMatchApplyState({
        type: "error",
        message: `应用失败：${message}`,
      });
      return null;
    }
  };
  const queryLibrary = async () => {
    setError('');
    if (!foodCookie.trim()) {setError('请先填写食物库登录 Cookie，只保留在当前页面内存');return;}
    setBusy('library');setFoods([]);setFoodValidation(null);resetAfter(2);
    const abort=new AbortController();controller.current=abort;
    const rows=[];
    try {
      for (let i=0;i<candidateList.foods.length;i++) {
        const c=candidateList.foods[i];
        setLibraryProgress(`${i+1} / ${candidateList.foods.length} · ${c.name}`);
        let row={slot:c.slot,queryName:c.name,options:[],selectedId:'',page:1,portionText:'',error:''};
        try {
          const response=await fetch('/api/food-search',{method:'POST',headers:{'Content-Type':'application/json'},body:json({query:c.name,cookie:foodCookie}),signal:abort.signal});
          const data=await response.json();if(!response.ok)throw new Error(data.error);
          row={...row,options:data.foods,selectedId:uniqueExact(data.foods,c.name),total:data.total};
        } catch(e) {if(abort.signal.aborted)throw e;row.error=e.message;}
        rows.push(row);setLibraryRows([...rows]);
        if (row.error) break;
      }
      setToast('查询结束，请确认匹配与份量后应用');
    } catch(e) {setError(abort.signal.aborted?'已取消查询，保留已返回结果':e.message);}
    finally {setBusy('');setLibraryProgress('');controller.current=null;}
  };
  const moreLibrary = async index => {
    setBusy('library');setError('');
    const row=libraryRows[index];
    try {
      const response=await fetch('/api/food-search',{method:'POST',headers:{'Content-Type':'application/json'},body:json({query:row.queryName,cookie:foodCookie,page:row.page+1})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      setLibraryRows(prev=>prev.map((r,i)=>i===index?{...r,page:data.page,options:[...new Map([...r.options,...data.foods].map(f=>[f.id||f._id,f])).values()],error:data.foods.length?'':'没有更多结果'}:r));
    }catch(e){setError(e.message);}finally{setBusy('');}
  };
  const generateFoods = async (stage = 'candidates') => {
    setError("");
    setBusy("ai");
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (!config.apiKey) {
        setShowApi(true);
        throw new Error("请先填写 API 密钥");
      }
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json({ config, profile, template, count, stage, candidates:candidateList, prompt:stage === 'matching' ? matchPrompt : prompt }),
        signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRecords((r) => [
        {
          ...data,
          providerName: PROVIDERS[config.provider].name,
          profileSnapshot: profile,
          templateSnapshot: template,
          count,
        },
        ...r,
      ]);
      if(stage === 'matching') setMatchText(data.parsed ? json(data.parsed) : data.content);
      else setCandidateText(data.parsed ? json(data.parsed) : data.content);
      if (data.validationError) {
        throw new Error(
          `模型返回已保留，但候选校验未通过：${data.validationError}`,
        );
      }
      if(stage === 'matching') {
        const checked = applyMatchedLibrary(data.parsed ? json(data.parsed) : data.content);
        if (!checked) return;
        setToast('模拟食物库数据已应用，不是真实匹配');
      }
      else { const list=validateCandidates(data.parsed,template);setCandidateList(list);setCandidateText(json(groupCandidates(list)));setMatchPrompt(renderMatching(list));setMatchText('');setFoods([]);setFoodText('');setFoodValidation(null);setFoodSource('');setMatchApplyState(null);resetAfter(2);setToast('食物名称已生成，下一步运行模拟匹配'); }
    } catch (e) {
      fail(e.name === "AbortError" ? new Error("已取消生成，保留原有候选") : e);
    } finally {
      setBusy("");
      controller.current = null;
    }
  };
  const generatePlan = () =>
    guard(() => {
      const output = compose(profile, template, foods, rules);
      setPlan(output);
      setPlanText(json(output));
      setResult(null);
      setActiveDay(1);
      setToast("七天候选搭配已生成");
    });
  const calculate = () =>
    guard(() => {
      validateRules(rules);
      validatePlan(plan, profile, template, foods);
      setBusy("solve");
      setProgress({ completed: 0, total: profile.days });
      setResult(null);
      const worker = new Worker(
        new URL("./solver.worker.js", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      watchdog.current = setTimeout(() => {
        worker.terminate();
        workerRef.current = null;
        setBusy("");
        setError(
          "计算超过45秒，已中止。请减少候选份量档位、调整约束或重新生成搭配后再试。",
        );
      }, 45000);
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") setProgress(data.progress);
        if (data.type === "result") {
          clearTimeout(watchdog.current);
          setResult(data.result);
          setBusy("");
          setActiveDay(1);
          worker.terminate();
          workerRef.current = null;
        }
        if (data.type === "error") {
          clearTimeout(watchdog.current);
          setError(data.error);
          setBusy("");
          worker.terminate();
          workerRef.current = null;
        }
      };
      worker.onerror = (e) => {
        clearTimeout(watchdog.current);
        setError(`求解失败：${e.message}`);
        setBusy("");
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ profile, template, foods, plan, rules });
    });
  const testApi = async () => {
    setApiBusy(true);
    setTestState("");
    try {
      const r = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json({ config }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setTestState(
        `连接成功 · ${d.model} · ${(d.durationMs / 1000).toFixed(1)}s`,
      );
    } catch (e) {
      setTestState(e.message);
    } finally {
      setApiBusy(false);
    }
  };
  const patchDraft = (key, value) => {
    setDraft((p) => ({ ...p, [key]: value }));
  };
  const updateRules = (key, value) => {
    setRules((r) => ({ ...r, [key]: value }));
    setResult(null);
    if (["maxRepeat", "seed"].includes(key)) {
      setPlan(null);
      setPlanText("");
    }
  };
  let preview;
  try {
    preview = getTargets(draft);
  } catch {
    preview = null;
  }
  const targets = profile ? getTargets(profile) : null;
  const dirty = profile && json(draft) !== json(profile);
  const done = [
    Boolean(profile),
    foods.length > 0,
    Boolean(plan),
    Boolean(result),
  ];
  const locked = [false, !profile, !foods.length, !plan];
  const changeStep = (s) => {
    if (busy) return;
    if (!locked[s]) {
      setStep(s);
      setError("");
      setActiveDay(1);
    }
  };
  const currentDay = result?.days.find((d) => d.day === activeDay);
  const composedDay = plan?.days.find((d) => d.day === activeDay);
  const outputData = {
    candidateList,
    candidatePrompt:prompt,
    matchingPrompt:matchPrompt,
    simulatedLibraryOutput:matchText,
    profile,
    template,
    candidateSource: foodSource,
    foods,
    plan,
    result,
    rules,
    calls: records,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Utensils size={21} />
          </div>
          <div>
            <strong>OtterLife</strong>
            <span>Nutrition Lab</span>
          </div>
        </div>
        <div className="workspace-label">
          饮食计划工作台 <Tag>DEMO</Tag>
        </div>
        <nav aria-label="生成步骤">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              className={`nav-step ${step === i ? "active" : ""} ${locked[i] ? "locked" : ""}`}
              disabled={locked[i] || Boolean(busy)}
              onClick={() => changeStep(i)}
            >
              <span className={`step-icon ${done[i] ? "done" : ""}`}>
                {done[i] && step !== i ? (
                  <Check size={18} />
                ) : (
                  <s.icon size={18} />
                )}
              </span>
              <span className="nav-label">
                <strong>
                  {i + 1}. {s.title}
                </strong>
                <small>{s.sub}</small>
              </span>
              {step === i && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <button className="sidebar-tool" onClick={() => setShowApi(true)}>
          <KeyRound size={17} />
          <span>模型与 API</span>
          <span className={`dot ${config.apiKey ? "on" : ""}`} />
        </button>
        <button
          className="sidebar-tool"
          disabled={!profile || Boolean(busy)}
          onClick={() => download("otterlife-experiment.json", outputData)}
        >
          <Download size={17} />
          <span>导出本次实验</span>
        </button>
        <div className="sidebar-bottom">
          <FlaskConical size={17} />
          <div>
            <strong>方案验证环境</strong>
            <span>AI 候选 × 模板 × 程序求解</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            饮食计划 <ChevronRight size={14} />
            <span>生成实验</span>
          </div>
          <div className="top-actions">
            <Tag tone="green">
              <span className="dot on" />
              本地工作台
            </Tag>
            <Button small icon={Settings2} onClick={() => setShowApi(true)}>
              {config.apiKey ? PROVIDERS[config.provider].name : "配置模型"}
            </Button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">MEAL PLAN / EXPERIMENT 01</div>
              <h1>饮食计划生成实验</h1>
              <p>用户参数、候选食物、搭配与份量</p>
            </div>
            <div className="progress-label">
              <span>
                STEP <b>0{step + 1}</b> / 04
              </span>
              <div className="progress-track">
                {STEPS.map((_, i) => (
                  <i key={i} className={i <= step ? "filled" : ""} />
                ))}
              </div>
            </div>
          </div>
          <div className="mobile-steps">
            {STEPS.map((s, i) => (
              <button
                disabled={locked[i] || Boolean(busy)}
                className={step === i ? "active" : ""}
                onClick={() => changeStep(i)}
                key={i}
              >
                {i + 1}. {s.title}
              </button>
            ))}
          </div>
          <div className="context-strip">
            <div>
              <span>餐食形态</span>
              <strong>
                {profile
                  ? `${profile.style === "chinese" ? "中式" : "轻食"} · ${profile.mealCount} 餐`
                  : "待确认"}
              </strong>
            </div>
            <div>
              <span>每日热量</span>
              <strong>{targets ? `${fmt(targets.calories)} kcal` : "—"}</strong>
            </div>
            <div>
              <span>营养目标</span>
              <strong>
                {profile
                  ? `P ${profile.protein}% · F ${profile.fat}% · C ${profile.carbs}%`
                  : "—"}
              </strong>
            </div>
            <div>
              <span>计划周期</span>
              <strong>{profile ? `${profile.days} 天` : "7 天"}</strong>
            </div>
          </div>
          {error && (
            <div className="error-box" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button aria-label="关闭错误" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}

          {step === 0 && (
            <>
              <div className="section-title">
                <div>
                  <span className="section-number">01</span>
                  <h2>用户参数与模板匹配</h2>
                </div>
                <Tag>程序规则</Tag>
              </div>
              <div className="two-column">
                <section className="form-section">
                  <div className="section-heading">
                    <h3>基础信息</h3>
                    <span>INPUT</span>
                  </div>
                  <div className="form-grid">
                    <Field label="生理性别">
                      <select
                        value={draft.sex}
                        onChange={(e) => patchDraft("sex", e.target.value)}
                      >
                        <option value="female">女</option>
                        <option value="male">男</option>
                      </select>
                    </Field>
                    <Field label="年龄">
                      <div className="unit-input">
                        <input
                          type="number"
                          min="18"
                          max="100"
                          value={draft.age}
                          onChange={(e) => patchDraft("age", +e.target.value)}
                        />
                        <span>岁</span>
                      </div>
                    </Field>
                    <Field label="身高">
                      <div className="unit-input">
                        <input
                          type="number"
                          value={draft.height}
                          onChange={(e) =>
                            patchDraft("height", +e.target.value)
                          }
                        />
                        <span>cm</span>
                      </div>
                    </Field>
                    <Field label="当前体重">
                      <div className="unit-input">
                        <input
                          type="number"
                          value={draft.weight}
                          onChange={(e) =>
                            patchDraft("weight", +e.target.value)
                          }
                        />
                        <span>kg</span>
                      </div>
                    </Field>
                    <Field label="活动水平" wide>
                      <select
                        value={draft.activity}
                        onChange={(e) =>
                          patchDraft("activity", +e.target.value)
                        }
                      >
                        <option value="1.2">久坐 / 很少运动 · 1.2</option>
                        <option value="1.375">
                          轻度活动 / 每周 1–3 次 · 1.375
                        </option>
                        <option value="1.55">
                          中度活动 / 每周 3–5 次 · 1.55
                        </option>
                        <option value="1.725">
                          高活动量 / 每周 6–7 次 · 1.725
                        </option>
                      </select>
                    </Field>
                    <Field
                      label="用户目标"
                      wide
                      note="切换目标会载入一组可编辑的演示营养比例；正式比例仍需产品确认。"
                    >
                      <Segmented
                        value={draft.goal}
                        options={Object.entries(GOALS)}
                        onChange={(v) => {
                          setDraft((p) => ({
                            ...p,
                            goal: v,
                            ...GOAL_PRESETS[v],
                            adjustment:
                              v === "fatLoss"
                                ? -300
                                : v === "muscleGain"
                                  ? 250
                                  : 0,
                          }));
                        }}
                      />
                    </Field>
                  </div>
                  <div className="section-heading separated">
                    <h3>热量与营养目标</h3>
                    <span>可覆盖测试</span>
                  </div>
                  <Segmented
                    value={draft.calorieMode}
                    options={[
                      ["manual", "使用已有目标热量"],
                      ["estimate", "根据基础信息估算"],
                    ]}
                    onChange={(v) => patchDraft("calorieMode", v)}
                  />
                  <div className="form-grid spaced">
                    <Field
                      label={
                        draft.calorieMode === "manual"
                          ? "每日目标热量"
                          : "相对 TDEE 的调整值"
                      }
                    >
                      <div className="unit-input">
                        <input
                          type="number"
                          value={
                            draft.calorieMode === "manual"
                              ? draft.calories
                              : draft.adjustment
                          }
                          onChange={(e) =>
                            patchDraft(
                              draft.calorieMode === "manual"
                                ? "calories"
                                : "adjustment",
                              +e.target.value,
                            )
                          }
                        />
                        <span>kcal</span>
                      </div>
                    </Field>
                    <Field label="计划天数">
                      <div className="unit-input">
                        <input
                          type="number"
                          min="1"
                          max="14"
                          value={draft.days}
                          onChange={(e) => patchDraft("days", +e.target.value)}
                        />
                        <span>天</span>
                      </div>
                    </Field>
                  </div>
                  <div className="macro-inputs">
                    {[
                      ["protein", "蛋白质"],
                      ["fat", "脂肪"],
                      ["carbs", "碳水"],
                    ].map(([key, label]) => (
                      <Field
                        key={key}
                        label={
                          <>
                            <i className={`legend-dot ${key}`} />
                            {label}
                          </>
                        }
                      >
                        <div className="unit-input">
                          <input
                            type="number"
                            value={draft[key]}
                            onChange={(e) => patchDraft(key, +e.target.value)}
                          />
                          <span>%</span>
                        </div>
                      </Field>
                    ))}
                  </div>
                  <MacroBar ratios={draft} />
                  <div
                    className={`small-text ${draft.protein + draft.fat + draft.carbs !== 100 ? "red-text" : ""}`}
                  >
                    合计 {draft.protein + draft.fat + draft.carbs}% ·
                    目标比例可编辑，当前为演示预设
                  </div>
                  {preview && (
                    <div className="calorie-preview">
                      <Activity size={17} />
                      <div>
                        <span>
                          BMR {fmt(preview.bmr)} · TDEE {fmt(preview.tdee)}
                        </span>
                        <strong>
                          {fmt(preview.calories)} <small>kcal / 天</small>
                        </strong>
                      </div>
                    </div>
                  )}
                </section>
                <section className="form-section">
                  <div className="section-heading">
                    <h3>进食习惯与个性化约束</h3>
                    <span>INPUT</span>
                  </div>
                  <div className="form-grid">
                    <Field label="每天吃几餐" wide>
                      <Segmented
                        value={draft.mealCount}
                        options={[
                          [3, "三餐"],
                          [2, "两餐"],
                        ]}
                        onChange={(v) => patchDraft("mealCount", v)}
                      />
                    </Field>
                    {draft.mealCount === 2 && (
                      <Field label="保留的两餐" wide>
                        <Segmented
                          value={draft.twoMeals}
                          options={[
                            ["lunchDinner", "午餐 + 晚餐"],
                            ["breakfastLunch", "早餐 + 午餐"],
                          ]}
                          onChange={(v) => patchDraft("twoMeals", v)}
                        />
                      </Field>
                    )}
                    <Field label="餐食形态" wide>
                      <Segmented
                        value={draft.style}
                        options={[
                          ["chinese", "中式家常"],
                          ["light", "轻食"],
                        ]}
                        onChange={(v) => patchDraft("style", v)}
                      />
                    </Field>
                    <Field label="食物过敏 · 硬约束" wide>
                      <div className="chips">
                        {[
                          "蛋",
                          "奶",
                          "大豆",
                          "小麦",
                          "花生",
                          "坚果",
                          "鱼",
                          "甲壳类",
                          "芝麻",
                        ].map((v) => (
                          <label
                            className={`check-chip ${draft.allergies.includes(v) ? "checked" : ""}`}
                            key={v}
                          >
                            <input
                              type="checkbox"
                              checked={draft.allergies.includes(v)}
                              onChange={(e) =>
                                patchDraft(
                                  "allergies",
                                  e.target.checked
                                    ? [...draft.allergies, v]
                                    : draft.allergies.filter((a) => a !== v),
                                )
                              }
                            />
                            {v}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <Field
                      label="其他忌口 · 硬约束"
                      wide
                      note="填写具体食材，用逗号分隔；复杂饮食限制可写入提示词进一步验证。"
                    >
                      <input
                        placeholder="例如：猪肉、香菜、虾"
                        value={draft.avoids}
                        onChange={(e) => patchDraft("avoids", e.target.value)}
                      />
                    </Field>
                    <Field label="口味 / 偏好 · 软约束" wide>
                      <input
                        placeholder="例如：清淡、偏爱面食、不喜欢生冷"
                        value={draft.preference}
                        onChange={(e) =>
                          patchDraft("preference", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="食物来源" wide>
                      <select
                        value={draft.source}
                        onChange={(e) => patchDraft("source", e.target.value)}
                      >
                        <option value="home">自己做饭</option>
                        <option value="canteen">食堂</option>
                        <option value="takeout">外卖 / 餐厅</option>
                        <option value="convenience">便利店</option>
                        <option value="mixed">不限 / 混合</option>
                      </select>
                    </Field>
                  </div>
                  <Notice>
                    进食餐数与餐食形态决定基础模板。热量、比例影响后续份量计算；忌口、偏好与来源进入候选生成。
                  </Notice>
                  <div className="form-action">
                    <Button primary icon={Check} onClick={commitProfile}>
                      {profile ? "更新参数并重新匹配" : "确认参数并匹配模板"}
                    </Button>
                    {dirty && <Tag tone="amber">有未应用修改</Tag>}
                  </div>
                </section>
              </div>
              {template && (
                <div className="template-section">
                  <div className="section-heading">
                    <h3>匹配结果 · {template.name}</h3>
                    <Tag tone="green">{template.id}</Tag>
                  </div>
                  <div className="template-grid">
                    {template.meals.map((m) => (
                      <div className="meal-template" key={m.id}>
                        <div>
                          <h4>{m.name}</h4>
                          <strong>
                            {Math.round(m.share * 100)}
                            <small>% 热量</small>
                          </strong>
                        </div>
                        <p>必选槽位</p>
                        <div className="chips">
                          {m.required.map((s) => (
                            <Tag key={s} tone="green">
                              {SLOT_NAMES[s]}
                            </Tag>
                          ))}
                        </div>
                        <p>可选槽位</p>
                        <div className="chips">
                          {m.optional.map((s) => (
                            <Tag key={s}>{SLOT_NAMES[s]}</Tag>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Notice>
                    可选槽位先提供食物候选，份量求解时可以取 0
                    份。当前四类模板及热量分配均可修改，属于待验证的产品规则。
                  </Notice>
                  <details>
                    <summary>编辑模板 JSON</summary>
                    <JsonPanel
                      title="模板 JSON"
                      text={templateText}
                      onChange={setTemplateText}
                      action={
                        <Button small icon={Check} onClick={applyTemplate}>
                          应用模板修改
                        </Button>
                      }
                    />
                  </details>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <div className="section-title">
                <div>
                  <span className="section-number">02</span>
                  <h2>生成候选食物</h2>
                </div>
                <Tag tone="blue">真实模型调用</Tag>
              </div>
              <div className="generation-toolbar">
                <div>
                  <strong>{PROVIDERS[config.provider].name}</strong>
                  <span>{config.model || "尚未填写模型名"}</span>
                  <button
                    className="text-button"
                    onClick={() => setShowApi(true)}
                  >
                    更换模型
                  </button>
                </div>
                <div>
                  <label>
                    每槽位{" "}
                    <select
                      aria-label="每槽位候选数量"
                      value={count}
                      disabled={Boolean(busy)}
                      onChange={(e) => {
                        const n = +e.target.value;
                        setCount(n);
                        setPrompt(renderCandidate(profile, template, n));
                      }}
                    >
                      {[3, 5, 10, 15, 20].map((n) => (
                        <option key={n} value={n}>
                          {n} 种
                        </option>
                      ))}
                    </select>
                  </label>
                  {busy === "ai" ? (
                    <Button
                      icon={Ban}
                      onClick={() => controller.current?.abort()}
                    >
                      取消生成
                    </Button>
                  ) : (
                    <Button primary icon={Sparkles} onClick={() => generateFoods('candidates')}>
                      AI 生成候选
                    </Button>
                  )}
                </div>
              </div>
              {busy === "ai" && (
                <Notice>
                  <LoaderCircle className="spin" size={15} />{" "}
                  模型正在处理本次请求，可取消；名称生成与模拟匹配分别记录耗时。
                </Notice>
              )}
              <div className="candidate-tools">
                <div className="chips">
                  <Tag>{getSlots(template).length} 类槽位</Tag>
                  <Tag>{foods.length} 个可用候选</Tag>
                  {foodSource && (
                    <Tag tone={foodSource === "ai" ? "blue" : "amber"}>
                      {foodSource === "ai"
                        ? "AI 返回"
                        : foodSource === "sample"
                          ? "内置演示数据"
                          : foodSource === 'real_library' ? '真实食物库' : foodSource === 'simulated_library' ? '模拟食物库' : "手动输入"}
                    </Tag>
                  )}
                </div>
                <Button
                  small
                  icon={FlaskConical}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    guard(() => {
                      applyFoods(
                        {
                          foods: SAMPLE_FOODS.filter((f) =>
                            getSlots(template).includes(f.slot),
                          ),
                        },
                        "sample",
                      );
                      setToast("已载入演示数据，不代表真实模型返回");
                    })
                  }
                >
                  载入示例测试算法
                </Button>
              </div>
              <section className="prompt-details">
                <JsonPanel title="候选生成 · 自定义提示词模板" text={candidateTemplateDraft} onChange={setCandidateTemplateDraft} rows={14} description="变量：{{count}}、{{region}}、{{style}}、{{allergies}}、{{avoids}}、{{preference}}、{{slots}}。保存后，匹配用户参数和重置均使用此版本。" action={<><Button small disabled={Boolean(busy)} onClick={()=>guard(()=>{const rendered=renderPrompt(candidateTemplateDraft,candidateValues(profile,template,count));if(!candidateTemplateDraft.trim())throw new Error('模板不能为空');setCandidateTemplate(candidateTemplateDraft);setPrompt(rendered);setToast('自定义模板已保存到此浏览器');})} icon={Check}>保存模板并应用</Button> <Button small disabled={Boolean(busy)} onClick={()=>{setCandidateTemplate(DEFAULT_CANDIDATE_TEMPLATE);setCandidateTemplateDraft(DEFAULT_CANDIDATE_TEMPLATE);setPrompt(renderPrompt(DEFAULT_CANDIDATE_TEMPLATE,candidateValues(profile,template,count)));setToast('已恢复系统默认模板');}} icon={RotateCcw}>恢复系统默认模板</Button></>}/>
                <summary>
                  <Code2 size={15} />
                  请求输入 · 提示词与上下文
                  <span>{prompt.length.toLocaleString()} 字符</span>
                </summary>
                <JsonPanel
                  title="实际发送给模型的提示词"
                  text={prompt}
                  onChange={setPrompt}
                  rows={15}
                  action={
                    <Button
                      small
                      icon={RotateCcw}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        guard(()=>setPrompt(renderCandidate(profile, template, count)))
                      }
                    >
                      按已保存模板重置
                    </Button>
                  }
                />
              </section>
                <JsonPanel title="名称列表 JSON · 按槽位分组" text={candidateText} onChange={setCandidateText} rows={8} action={<Button small disabled={Boolean(busy)} icon={Check} onClick={()=>guard(()=>{const list=validateCandidates(JSON.parse(candidateText),template);setCandidateList(list);setCandidateText(json(groupCandidates(list)));setMatchPrompt(renderMatching(list));setMatchText('');setFoods([]);setFoodText('');setFoodValidation(null);setFoodSource('');setMatchApplyState(null);resetAfter(2);setToast('名称列表已更新，需重新模拟匹配');})}>应用名称列表</Button>}/>
              {candidateList && <>
                <div className="section-heading separated"><h3>真实食物库查询</h3><Tag>后端查询 · 不调用 AI</Tag></div>
                <p>{FOOD_ENDPOINT}</p>
                <Field label="食物库登录 Cookie" note="仅保留在当前页面内存，刷新即清除；不写入缓存、导出或模型提示词。请使用重新获取的有效凭证。">
                  <input type="password" autoComplete="off" aria-label="食物库登录 Cookie" value={foodCookie} onChange={e=>setFoodCookie(e.target.value)} placeholder="JIKE-AUTH-JWT=…" />
                </Field>
                <div className="button-row"><Button primary disabled={Boolean(busy)} icon={Play} onClick={queryLibrary}>查询真实食物库</Button><Button disabled={Boolean(busy)} icon={X} onClick={()=>setFoodCookie('')}>清除凭证</Button>{busy==='library' && <Button icon={X} onClick={()=>controller.current?.abort()}>取消查询</Button>}</div>
                {libraryProgress && <p role="status">正在查询 {libraryProgress}</p>}
                <Notice tone="warning">唯一同名结果会预选，近似或多个同名结果需人工确认。真实库未提供完整过敏原和食材核验，不能据此保证过敏安全。没有常用单位时，请人工输入可执行克重，不由 AI 编造。</Notice>
                {libraryRows.map((row,index)=><section key={`${row.slot}-${row.queryName}`} className="separated">
                  <h4>{SLOT_NAMES[row.slot]} · {row.queryName}</h4>
                  {row.error && <p role="alert">{row.error}</p>}
                  <Field label="库中匹配项">
                    <select aria-label={`匹配 ${row.queryName}`} value={row.selectedId} disabled={Boolean(busy)} onChange={e=>setLibraryRows(prev=>prev.map((r,i)=>i===index?{...r,selectedId:e.target.value,portionText:''}:r))}>
                      <option value="">不使用 / 待确认（{row.options.length} 个结果）</option>
                      {row.options.map(f=><option key={f.id||f._id} value={f.id||f._id}>{f.name} · {f.source || '未知来源'} · {f.calorie} kcal / {f.weight}{f.unit} · {f.id||f._id}</option>)}
                    </select>
                  </Field>
                  <Button small disabled={Boolean(busy)} icon={Plus} onClick={()=>moreLibrary(index)}>加载下一页</Button>
                  {row.selectedId && <>
                    <p>库中份量：{(row.options.find(f=>String(f.id||f._id)===row.selectedId)?.showUnits || []).filter(u=>u.type==='custom').map(u=>`${u.name} ${u.weight}克`).join('；') || '未提供，需人工确认'}</p>
                    <Field label="人工确认克重档位（可选，填写后替代库中单位）"><input aria-label={`份量 ${row.queryName}`} value={row.portionText} placeholder="例如 50,100,150" onChange={e=>setLibraryRows(prev=>prev.map((r,i)=>i===index?{...r,portionText:e.target.value}:r))}/></Field>
                  </>}
                </section>)}
                {libraryRows.length>0 && <Button primary disabled={Boolean(busy)} icon={Check} onClick={()=>guard(()=>{if(libraryRows.length!==candidateList.foods.length || libraryRows.some((r,i)=>r.queryName!==candidateList.foods[i].name || r.slot!==candidateList.foods[i].slot))throw new Error('候选列表已变化或查询未完成，请重新查询');const adapted=adaptRealMatches(libraryRows);const checked=applyFoods(adapted,'real_library');setToast(`已应用 ${checked.foods.length} 个真实库食物`);})}>确认并应用真实库数据</Button>}
                <details><summary>旧版模拟匹配（仅用于对照）</summary>
                <JsonPanel title="模拟匹配 · 自定义提示词模板" text={matchTemplateDraft} onChange={setMatchTemplateDraft} rows={10} description="使用 {{candidates}} 插入当前食物列表。模板保存在此浏览器，重置匹配提示词也会使用它。" action={<><Button small disabled={Boolean(busy)} icon={Check} onClick={()=>guard(()=>{if(!matchTemplateDraft.trim())throw new Error('模板不能为空');const rendered=renderPrompt(matchTemplateDraft,matchValues(candidateList));setMatchTemplate(matchTemplateDraft);setMatchPrompt(rendered);setToast('匹配模板已保存并应用');})}>保存匹配模板并应用</Button> <Button small disabled={Boolean(busy)} icon={RotateCcw} onClick={()=>{setMatchTemplate(DEFAULT_MATCH_TEMPLATE);setMatchTemplateDraft(DEFAULT_MATCH_TEMPLATE);setMatchPrompt(renderPrompt(DEFAULT_MATCH_TEMPLATE,matchValues(candidateList)));}}>恢复默认匹配模板</Button></>}/>
                <div className="section-heading separated"><h3>模拟食物库匹配</h3><Tag tone="amber">第二次 AI 调用 · 模拟数据</Tag></div>
                <Notice tone="warning">没有连接真实食物库。模型将按你提供的库结构编造模拟记录，用于验证匹配后的处理链路。库中未提供食材及过敏原字段，这些信息会作为模拟补充字段单独输出。</Notice>
                <JsonPanel title="模拟匹配提示词 · 可编辑" text={matchPrompt} onChange={setMatchPrompt} rows={12} action={<><Button small disabled={Boolean(busy)} onClick={()=>setMatchPrompt(renderMatching(candidateList))} icon={RotateCcw}>按已保存模板重置</Button> <Button primary small disabled={Boolean(busy)} icon={Sparkles} onClick={()=>generateFoods('matching')}>AI 模拟匹配食物库</Button></>}/>
                <JsonPanel title="模拟库原始输出 JSON" text={matchText} onChange={setMatchText} rows={10} action={<Button small primary disabled={Boolean(busy)} icon={Check} onClick={()=>applyMatchedLibrary()}>检查并应用模拟库数据</Button>}/>
                {matchApplyState && <Notice tone={matchApplyState.type === 'error' ? 'warning' : ''}>{matchApplyState.message}</Notice>}
                </details>
              </>}
              {foodValidation?.excluded.length > 0 && (
                <Notice tone="warning">
                  程序额外拦截 {foodValidation.excluded.length} 个含忌口 /
                  过敏词的候选：
                  {foodValidation.excluded.map((f) => f.name).join("、")}
                  。关键词检查仅用于演示，复合食物与交叉接触仍依赖可靠食材数据。
                </Notice>
              )}
              {foodValidation?.warnings.map((w) => (
                <Notice key={w} tone="warning">
                  {w}
                </Notice>
              ))}
              <div className="tabs-row">
                <div className="filter-row">
                  <ListFilter size={15} />
                  <select
                    aria-label="筛选槽位"
                    value={slotFilter}
                    onChange={(e) => setSlotFilter(e.target.value)}
                  >
                    <option value="all">全部槽位</option>
                    {getSlots(template).map((s) => (
                      <option key={s} value={s}>
                        {SLOT_NAMES[s]} ·{" "}
                        {foods.filter((f) => f.slot === s).length}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  small
                  icon={Code2}
                  onClick={() => setShowFoodJson(!showFoodJson)}
                >
                  {showFoodJson ? "收起 JSON" : "编辑 / 粘贴 JSON"}
                </Button>
              </div>
              {showFoodJson && (
                <JsonPanel
                  title="候选食物输出 JSON"
                  text={foodText}
                  onChange={setFoodText}
                  rows={16}
                  action={
                    <Button
                      small
                      primary
                      disabled={Boolean(busy)}
                      icon={Check}
                      onClick={() =>
                        guard(() => {
                          applyFoods();
                          setToast("候选 JSON 已检查并应用");
                        })
                      }
                    >
                      检查并应用候选
                    </Button>
                  }
                />
              )}
              {foods.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>食物 / 菜品</th>
                        <th>槽位</th>
                        <th>热量 / 100g</th>
                        <th>P / F / C · g</th>
                        <th>可执行份量</th>
                        <th>过敏原</th>
                      </tr>
                    </thead>
                    <tbody>
                      {foods
                        .filter(
                          (f) => slotFilter === "all" || f.slot === slotFilter,
                        )
                        .map((f) => (
                          <tr key={f.id}>
                            <td>
                              <strong>{f.name}</strong>
                              <small>{f.ingredients.join("、")}</small>
                            </td>
                            <td>
                              <Tag>{SLOT_NAMES[f.slot]}</Tag>
                            </td>
                            <td>
                              {fmt(f.nutritionPer100g.calories)}{" "}
                              <small className="inline">kcal</small>
                            </td>
                            <td className="numeric">
                              {f.nutritionPer100g.protein} /{" "}
                              {f.nutritionPer100g.fat} /{" "}
                              {f.nutritionPer100g.carbs}
                            </td>
                            <td className="portions-cell">
                              {f.portions.map((o) => o.label).join(" · ")}
                            </td>
                            <td>{f.allergens.join("、") || "未标出"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty icon={Sparkles} title="候选食物尚未生成">
                  {config.apiKey
                    ? "已配置模型，可开始生成候选。"
                    : "填写 API 配置后开始生成，也可载入示例测试后续步骤。"}
                </Empty>
              )}
              <Notice>
                食物库数据按 weight 换算至每100克，保留 calorie 热量；showUnits 或人工确认值提供份量。营养比例按三大营养素供能总和计算。真实库命中不代表过敏安全或生熟状态已核实。
              </Notice>
              <div className="section-heading separated">
                <h3>模型实验记录</h3>
                <Tag>{records.length} 次调用</Tag>
              </div>
              {records.length ? (
                <div className="record-list">
                  {records.map((r, i) => (
                    <button
                      className="record-row"
                      key={i}
                      onClick={() => setSelectedRecord(r)}
                    >
                      <div>
                        <Sparkles size={16} />
                        <strong>{r.providerName}</strong>
                        <span>{r.model}</span>
                      </div>
                      <div>
                        <Tag tone={r.validationError ? "amber" : "green"}>
                          {r.validationError
                            ? "需修正"
                            : `${r.validation?.foods.length || 0} 个通过`}
                        </Tag>
                        <span>{(r.durationMs / 1000).toFixed(1)}s</span>
                        <span>
                          {r.usage?.total_tokens
                            ? `${fmt(r.usage.total_tokens)} tokens`
                            : "用量未返回"}
                        </span>
                        <ChevronRight size={15} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="small-text muted-block">尚无真实调用记录</div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="section-title">
                <div>
                  <span className="section-number">03</span>
                  <h2>生成七天搭配</h2>
                </div>
                <Tag>程序规则</Tag>
              </div>
              <div className="rule-toolbar">
                <Field
                  label="单食物周期内出现上限"
                  note="软约束；候选不足时会记录放宽"
                >
                  <input
                    type="number"
                    min="1"
                    max="21"
                    value={rules.maxRepeat}
                    onChange={(e) => updateRules("maxRepeat", +e.target.value)}
                  />
                </Field>
                <Field label="随机种子" note="相同输入与种子，搭配可复现">
                  <div className="seed-field">
                    <input
                      type="number"
                      value={rules.seed}
                      onChange={(e) => updateRules("seed", +e.target.value)}
                    />
                    <button
                      title="换一个随机种子"
                      aria-label="换一个随机种子"
                      onClick={() =>
                        updateRules("seed", Math.floor(Math.random() * 999999))
                      }
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </Field>
                <Button primary icon={Grid2X2} onClick={generatePlan}>
                  {plan ? "重新生成搭配" : "生成搭配"}
                </Button>
              </div>
              <Notice>
                每个槽位优先选择使用次数较少的食物，并用随机种子打散。同一餐每类槽位最多一个候选；可选槽位暂列为待定，下一步根据全天营养决定份量或不加入。
              </Notice>
              {plan ? (
                <>
                  <div className="tabs-row">
                    <DayTabs
                      days={plan.days}
                      activeDay={activeDay}
                      onChange={setActiveDay}
                    />
                    <Button
                      small
                      icon={Code2}
                      onClick={() => setShowPlanJson(!showPlanJson)}
                    >
                      {showPlanJson ? "收起 JSON" : "编辑 JSON"}
                    </Button>
                  </div>
                  <div className="meal-grid">
                    {composedDay?.meals.map((m) => (
                      <section className="meal-card" key={m.id}>
                        <div className="meal-card-head">
                          <h3>{m.name}</h3>
                          <span>
                            {Math.round(m.share * targets.calories)} kcal 目标
                          </span>
                        </div>
                        {m.items.map((i, idx) => (
                          <div
                            className={`slot-row ${i.optional ? "optional" : ""}`}
                            key={idx}
                          >
                            <div>
                              <span>{SLOT_NAMES[i.slot]}</span>
                              <strong>{i.name}</strong>
                            </div>
                            <Tag tone={i.optional ? "" : "green"}>
                              {i.optional ? "待定" : "必选"}
                            </Tag>
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                  {plan.warnings.length > 0 && (
                    <details className="warnings-details">
                      <summary>
                        <AlertTriangle size={15} />
                        重复限制放宽记录 · {plan.warnings.length} 条
                      </summary>
                      {plan.warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                    </details>
                  )}
                  {showPlanJson && (
                    <JsonPanel
                      title="七天无克重搭配 JSON"
                      text={planText}
                      onChange={setPlanText}
                      rows={18}
                      action={
                        <Button
                          small
                          primary
                          icon={Check}
                          onClick={() =>
                            guard(() => {
                              const value = JSON.parse(planText);
                              validatePlan(value, profile, template, foods);
                              setPlan(value);
                              setResult(null);
                              setToast("搭配修改已应用");
                            })
                          }
                        >
                          检查并应用搭配
                        </Button>
                      }
                    />
                  )}
                </>
              ) : (
                <Empty icon={Grid2X2} title="等待生成七天搭配">
                  {foods.length} 个候选食物 · {template.name} · {profile.days}{" "}
                  天
                </Empty>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="section-title">
                <div>
                  <span className="section-number">04</span>
                  <h2>计算可执行份量</h2>
                </div>
                <Tag tone="green">混合整数规划</Tag>
              </div>
              <div className="solver-config">
                <div className="form-grid three">
                  <Field label="每日热量容差" note="相对于每日目标的百分比">
                    <div className="unit-input">
                      <input
                        type="number"
                        min="1"
                        max="25"
                        disabled={Boolean(busy)}
                        value={rules.calorieTolerance}
                        onChange={(e) =>
                          updateRules("calorieTolerance", +e.target.value)
                        }
                      />
                      <span>± %</span>
                    </div>
                  </Field>
                  <Field
                    label="营养素比例容差"
                    note="供能比的百分点，按整天校验"
                  >
                    <div className="unit-input">
                      <input
                        type="number"
                        min="1"
                        max="15"
                        disabled={Boolean(busy)}
                        value={rules.macroTolerance}
                        onChange={(e) =>
                          updateRules("macroTolerance", +e.target.value)
                        }
                      />
                      <span>± pp</span>
                    </div>
                  </Field>
                  <Field label="单餐热量容差" note="相对于单餐分配的百分比">
                    <div className="unit-input">
                      <input
                        type="number"
                        min="5"
                        max="60"
                        disabled={Boolean(busy)}
                        value={rules.mealTolerance}
                        onChange={(e) =>
                          updateRules("mealTolerance", +e.target.value)
                        }
                      />
                      <span>± %</span>
                    </div>
                  </Field>
                </div>
                <div className="solver-actions">
                  <span>
                    <Clock3 size={15} /> 每天最多 4 组尝试，单组限时 650ms
                  </span>
                  {busy === "solve" ? (
                    <Button
                      icon={Ban}
                      onClick={() => {
                        clearTimeout(watchdog.current);
                        workerRef.current?.terminate();
                        workerRef.current = null;
                        setBusy("");
                        setProgress(null);
                      }}
                    >
                      取消计算
                    </Button>
                  ) : (
                    <Button primary icon={Play} onClick={calculate}>
                      {result ? "重新计算并校验" : "计算份量并校验"}
                    </Button>
                  )}
                </div>
              </div>
              <Notice>
                求解器在候选自带的份量档位中选择，不产生任意小数克数。营养比例按全天计算；初始组合无解时最多替换
                3
                次组合，不自动放宽热量、营养或忌口约束。重复度为软约束，最终结果会单独复查。
              </Notice>
              {busy === "solve" && (
                <div className="solve-progress">
                  <LoaderCircle className="spin" size={18} />
                  <span>
                    正在计算第{" "}
                    {Math.min((progress?.completed || 0) + 1, profile.days)} /{" "}
                    {profile.days} 天
                  </span>
                  <progress
                    value={progress?.completed || 0}
                    max={profile.days}
                  />
                </div>
              )}
              {result ? (
                <>
                  <div
                    className={`result-banner ${result.status === "passed" ? "passed" : "incomplete"}`}
                  >
                    {result.status === "passed" ? (
                      <CheckCircle2 size={25} />
                    ) : (
                      <AlertTriangle size={25} />
                    )}
                    <div>
                      <strong>
                        {result.status === "passed"
                          ? "整份计划通过数值约束校验"
                          : "部分天数未找到可行解"}
                      </strong>
                      <p>
                        {result.summary.passed} / {result.summary.total} 天通过
                        · 营养数据来源：
                        {foodSource === "sample" ? "内置示例估算" : foodSource === 'real_library' ? '真实食物库' : foodSource === 'simulated_library' ? 'AI模拟食物库' : "AI 估算"}
                        ，尚未核实
                      </p>
                    </div>
                    <Button
                      small
                      icon={Download}
                      onClick={() =>
                        download("otterlife-meal-plan.json", outputData)
                      }
                    >
                      导出计划
                    </Button>
                  </div>
                  <div className="result-stats">
                    <div>
                      <span>
                        {result.status === "passed"
                          ? "日均热量"
                          : "已通过天数的日均热量"}
                      </span>
                      <strong>
                        {fmt(result.summary.average.calories)}{" "}
                        <small>kcal</small>
                      </strong>
                      <span>目标 {fmt(targets.calories)} kcal</span>
                    </div>
                    {[
                      ["protein", "蛋白质"],
                      ["fat", "脂肪"],
                      ["carbs", "碳水"],
                    ].map(([k, label]) => (
                      <div key={k}>
                        <span>
                          <i className={`legend-dot ${k}`} />
                          {label}
                        </span>
                        <strong>
                          {result.summary.average[k]} <small>g / 天</small>
                        </strong>
                        <span>
                          供能 {result.summary.macroRatio[k].toFixed(1)}% · 目标{" "}
                          {profile[k]}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="chart-section">
                    <div className="section-heading">
                      <h3>每日热量与目标区间</h3>
                      <div className="chart-legend">
                        <i />
                        目标 ±{rules.calorieTolerance}%
                      </div>
                    </div>
                    <CalorieChart
                      result={result}
                      target={targets.calories}
                      tolerance={rules.calorieTolerance}
                    />
                  </div>
                  <div className="tabs-row">
                    <DayTabs
                      days={result.days}
                      activeDay={activeDay}
                      onChange={setActiveDay}
                      result
                    />
                    <Button
                      small
                      icon={Code2}
                      onClick={() => setShowResultJson(!showResultJson)}
                    >
                      {showResultJson ? "收起 JSON" : "输出 JSON"}
                    </Button>
                  </div>
                  {currentDay?.pass ? (
                    <>
                      <div className="day-summary">
                        <strong>第 {activeDay} 天</strong>
                        <Tag tone="green">
                          <Check size={12} />
                          通过
                        </Tag>
                        <span>{fmt(currentDay.nutrition.calories)} kcal</span>
                        <span>
                          P {currentDay.macroRatio.protein}% / F{" "}
                          {currentDay.macroRatio.fat}% / C{" "}
                          {currentDay.macroRatio.carbs}%
                        </span>
                        {currentDay.changedCombination && (
                          <Tag tone="blue">已替换初始组合</Tag>
                        )}
                      </div>
                      <div className="meal-grid">
                        {currentDay.meals.map((m) => (
                          <section className="meal-card" key={m.id}>
                            <div className="meal-card-head">
                              <h3>{m.name}</h3>
                              <strong>
                                {fmt(
                                  m.items.reduce((s, i) => s + i.calories, 0),
                                )}{" "}
                                <small>kcal</small>
                              </strong>
                            </div>
                            {m.items.map((i) => (
                              <div className="portion-row" key={i.foodId}>
                                <div>
                                  <strong>{i.name}</strong>
                                  <span>{SLOT_NAMES[i.slot]}</span>
                                </div>
                                <div>
                                  <strong>{i.portion}</strong>
                                  <span>
                                    {i.grams} g · {fmt(i.calories)} kcal
                                  </span>
                                </div>
                              </div>
                            ))}
                          </section>
                        ))}
                      </div>
                      <div className="table-wrap validation-table">
                        <table>
                          <thead>
                            <tr>
                              <th>校验项</th>
                              <th>实际值</th>
                              <th>允许范围</th>
                              <th>结果</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentDay.checks.map((c) => (
                              <tr key={c.name}>
                                <td>{c.name}</td>
                                <td>
                                  {c.value} {c.unit}
                                </td>
                                <td>
                                  {c.min}–{c.max} {c.unit}
                                </td>
                                <td>
                                  <Tag tone={c.pass ? "green" : "amber"}>
                                    {c.pass ? "通过" : "未通过"}
                                  </Tag>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <Notice tone="warning">
                      第 {activeDay} 天：{currentDay?.reason}
                      。可增加同槽位候选与份量档位，或手动修改约束后重新计算；目前没有输出不合格计划。
                    </Notice>
                  )}
                  {result.summary.repeatsOverLimit.length > 0 && (
                    <Notice tone="warning">
                      最终重复度超出软上限：
                      {result.summary.repeatsOverLimit
                        .map((r) => `${r.name} ${r.count}次`)
                        .join("、")}
                      。自动替换组合可能增加重复，可补充候选后重新生成。
                    </Notice>
                  )}
                  <details>
                    <summary>查看求解尝试记录</summary>
                    <JsonPanel
                      title="每一天的求解记录"
                      text={json(result.log)}
                      rows={12}
                    />
                  </details>
                  {showResultJson && (
                    <JsonPanel
                      title="带份量的完整输出 JSON"
                      text={json(result)}
                      rows={18}
                    />
                  )}
                </>
              ) : (
                !busy && (
                  <Empty icon={SlidersHorizontal} title="等待计算份量">
                    {profile.days}{" "}
                    天搭配已准备，按实际份量选项求解每日热量与营养约束。
                  </Empty>
                )
              )}
            </>
          )}
          <footer className="step-footer">
            <Button
              subtle
              icon={ArrowLeft}
              disabled={step === 0 || Boolean(busy)}
              onClick={() => changeStep(step - 1)}
            >
              上一步
            </Button>
            <span>
              {done[step] ? (
                <>
                  <CheckCheck size={15} />
                  本步已有输出
                </>
              ) : (
                "完成本步后可继续"
              )}
            </span>
            {step < 3 ? (
              <Button
                primary
                icon={ArrowRight}
                disabled={!done[step] || Boolean(busy) || (step === 0 && dirty)}
                onClick={() => changeStep(step + 1)}
              >
                下一步：{STEPS[step + 1].title}
              </Button>
            ) : (
              <Button
                icon={Download}
                disabled={!result || Boolean(busy)}
                onClick={() =>
                  download("otterlife-experiment.json", outputData)
                }
              >
                导出完整实验
              </Button>
            )}
          </footer>
        </main>
      </div>
      {showApi && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !apiBusy) setShowApi(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="模型与 API 配置"
          >
            <div className="modal-header">
              <div>
                <h2>模型与 API 配置</h2>
                <p>OpenAI Chat Completions 兼容接口</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭配置"
                onClick={() => setShowApi(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              <Field label="服务商">
                <select
                  value={config.provider}
                  disabled={apiBusy || Boolean(busy)}
                  onChange={(e) => {
                    const provider = e.target.value;
                    setConfig({
                      provider,
                      ...PROVIDERS[provider],
                      apiKey: "",
                      jsonMode: true,
                      maxTokens: 8192,
                    });
                    setTestState("");
                  }}
                >
                  {Object.entries(PROVIDERS).map(([k, p]) => (
                    <option key={k} value={k}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Base URL"
                note="公司网关可填根域名，自动补 /v1/chat/completions；其他接口保留 /v1 或 /api/v3 路径。"
              >
                <input
                  value={config.baseUrl}
                  onChange={(e) => {
                    setConfig((c) => ({ ...c, baseUrl: e.target.value }));
                    setTestState("");
                  }}
                />
              </Field>
              <Field
                label="模型名 / 推理接入点 ID"
                note={
                  config.provider === "doubao"
                    ? "填写火山方舟控制台的模型 ID 或 ep-… 推理接入点 ID。"
                    : config.provider.startsWith('company') ? '填写公司模型广场 API 示例里的 model，切换模型时网关地址与密钥无需改变。' : "请以服务商控制台当前可用的模型名为准。"
                }
              >
                <input
                  placeholder={
                    config.provider === "doubao"
                      ? "ep-… 或可用模型 ID"
                      : "输入模型名"
                  }
                  value={config.model}
                  onChange={(e) => {
                    setConfig((c) => ({ ...c, model: e.target.value }));
                    setTestState("");
                  }}
                />
              </Field>
              <p className="small-text" style={{overflowWrap:'anywhere'}}>请求地址：{(() => {try {return chatEndpoint(config.baseUrl);} catch {return '待填写有效 HTTPS 地址';}})()}</p>
              <Field
                label="API Key"
                note={rememberKey ? '已启用本机浏览器保存；刷新后自动恢复。密钥不会加入导出文件。' : '未勾选记住时，密钥仅在本页内存，刷新后清除。'}
              >
                <input
                  autoComplete="off"
                  type="password"
                  placeholder="填写你的 API 密钥"
                  value={config.apiKey}
                  onChange={(e) => {
                    setConfig((c) => ({ ...c, apiKey: e.target.value }));
                    setTestState("");
                  }}
                />
              </Field>
              <label className="checkbox-line"><input type="checkbox" checked={rememberKey} onChange={e=>setRememberKey(e.target.checked)}/>在此浏览器记住 API Key</label>
              <p className="small-text">勾选后密钥以明文保存在此站点的浏览器本地存储中。</p>
              <Button small icon={X} onClick={()=>{setRememberKey(false);setConfig(c=>({...c,apiKey:''}));setTestState('');setToast('已清除当前及本地保存的密钥');}}>清除已保存的密钥</Button>
              <Field label="最大输出 Token" note="按模型支持的上限填写；候选数量多时可提高，避免 JSON 截断。">
                <input type="number" min="512" max="65536" value={config.maxTokens || 8192} onChange={e => setConfig(c => ({ ...c, maxTokens: +e.target.value }))}/>
              </Field>
              <Field label="思考模式参数" note="网关是否透传取决于渠道；若报不支持此参数，选择跟随模型默认。JSON 模式与思考模式是两个独立设置。">
                <select value={config.thinkingMode || 'default'} onChange={e => setConfig(c => ({...c, thinkingMode:e.target.value}))}>
                  <option value="default">跟随模型默认（不传参数）</option>
                  <option value="disabled">关闭思考 · DeepSeek / 豆包</option>
                  <option value="qwen-disabled">关闭思考 · 千问</option>
                </select>
              </Field>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={config.jsonMode}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, jsonMode: e.target.checked }))
                  }
                />
                启用 JSON 输出模式
              </label>
              <p className="small-text">
                若模型提示不支持
                response_format，可关闭后重试。连接测试也会发起一次短请求，按服务商规则计费。
              </p>
              {testState && (
                <Notice
                  tone={testState.startsWith("连接成功") ? "" : "warning"}
                >
                  {testState}
                </Notice>
              )}
            </div>
            <div className="modal-footer">
              <Button
                icon={apiBusy ? LoaderCircle : Activity}
                disabled={apiBusy || !config.apiKey || Boolean(busy)}
                onClick={testApi}
              >
                {apiBusy ? "正在测试…" : "测试连接"}
              </Button>
              <Button primary icon={Check} onClick={() => setShowApi(false)}>
                完成配置
              </Button>
            </div>
          </section>
        </div>
      )}
      {selectedRecord && (
        <div className="modal-backdrop">
          <section
            className="modal large"
            role="dialog"
            aria-modal="true"
            aria-label="模型调用记录"
          >
            <div className="modal-header">
              <div>
                <h2>{selectedRecord.providerName} · 调用记录</h2>
                <p>
                  {selectedRecord.model} ·{" "}
                  {(selectedRecord.durationMs / 1000).toFixed(1)}s ·{" "}
                  {new Date(selectedRecord.timestamp).toLocaleString()}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭记录"
                onClick={() => setSelectedRecord(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              <div className="chips">
                <Tag>结束原因：{selectedRecord.finishReason || "未返回"}</Tag>
                <Tag>
                  Token：{selectedRecord.usage?.total_tokens || "未返回"}
                </Tag>
              </div>
              {selectedRecord.validationError && (
                <Notice tone="warning">{selectedRecord.validationError}</Notice>
              )}
              <details>
                <summary>调用时的用户参数与模板</summary>
                <JsonPanel
                  title="输入快照"
                  text={json({
                    profile: selectedRecord.profileSnapshot,
                    template: selectedRecord.templateSnapshot,
                  })}
                  rows={12}
                />
              </details>
              <JsonPanel
                title="实际提示词"
                text={selectedRecord.prompt}
                rows={8}
              />
              <JsonPanel
                title="原始模型输出"
                text={selectedRecord.content}
                rows={15}
              />
            </div>
            <div className="modal-footer">
              <Button
                icon={Download}
                onClick={() => download("model-call.json", selectedRecord)}
              >
                导出调用记录
              </Button>
              <Button primary onClick={() => setSelectedRecord(null)}>
                关闭
              </Button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function DayTabs({ days, activeDay, onChange, result }) {
  return (
    <div className="day-tabs">
      {days.map((d) => (
        <button
          key={d.day}
          className={activeDay === d.day ? "active" : ""}
          onClick={() => onChange(d.day)}
        >
          {result && <span className={`dot ${d.pass ? "on" : "bad"}`} />}第{" "}
          {d.day} 天
        </button>
      ))}
    </div>
  );
}
function CalorieChart({ result, target, tolerance }) {
  const width = 760,
    height = 155,
    bottom = 126,
    max = Math.max(
      target * 1.35,
      ...result.days.map((d) => d.nutrition?.calories || 0),
    ),
    y = (v) => bottom - (v / max) * 110,
    bw = Math.min(45, 510 / result.days.length),
    gap = 650 / result.days.length;
  return (
    <svg
      className="calorie-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="每日热量柱状图"
    >
      <rect
        x="54"
        y={y(target * (1 + tolerance / 100))}
        width="676"
        height={
          y(target * (1 - tolerance / 100)) - y(target * (1 + tolerance / 100))
        }
        fill="#edf4ef"
      />
      {[0, target, max].map((v, i) => (
        <g key={i}>
          <line
            x1="54"
            x2="730"
            y1={y(v)}
            y2={y(v)}
            stroke="#e5eae7"
            strokeDasharray={v === target ? "4 4" : ""}
          />
          <text
            x="45"
            y={y(v) + 4}
            textAnchor="end"
            fill="#87928d"
            fontSize="10"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}
      {result.days.map((d, i) => (
        <g key={d.day}>
          <rect
            x={72 + i * gap}
            y={y(d.nutrition?.calories || 0)}
            width={bw}
            height={((d.nutrition?.calories || 0) / max) * 110 || 3}
            rx="3"
            fill={d.pass ? "#348866" : "#d79445"}
          />
          <text
            x={72 + i * gap + bw / 2}
            y="146"
            textAnchor="middle"
            fontSize="10"
            fill="#738078"
          >
            D{d.day}
          </text>
          <title>
            第{d.day}天：
            {d.pass ? `${fmt(d.nutrition.calories)} kcal` : "未找到可行解"}
          </title>
        </g>
      ))}
    </svg>
  );
}
createRoot(document.getElementById("root")).render(<App />);
