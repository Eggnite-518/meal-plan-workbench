import express from 'express';
import {createServer} from 'vite';

// Local-only fixtures; no upstream services or credentials are used.
const app=express();app.use(express.json({limit:'2mb'}));
app.post('/api/food-search',async(req,res)=>{
  await new Promise(resolve=>setTimeout(resolve,3000));
  res.json({foods:[{id:`fixture-${req.body.query}`,name:req.body.query,unit:'gram',weight:100,calorie:130,nutrition:{protein:3,fat:2,carbohydrate:25},showUnits:[]}],total:1});
});
app.post('/api/preprocess',async(req,res)=>{
  const match=req.body.prompt.match(/待处理记录：(.*)\n/);
  const scope=req.body.prompt.includes('本次任务仅为补充标签')?'tags':req.body.prompt.includes('本次任务仅为补充可执行份量')?'portions':req.body.prompt.includes('本次任务仅为补充缺失营养')?'nutrition':'all';
  const foods=JSON.parse(match[1]).map(f=>({...f,...(scope==='tags'?{ingredients:[f.name],allergens:[],tags:[]}:scope==='portions'?{portions:[{grams:100,label:'测试100克'}]}:scope==='nutrition'?{
    nutritionPer100g:{calories:120,protein:3,fat:1,carbs:24},nutritionReference:'仅用于测试的虚拟数据',
  }:{
    nutritionPer100g:{calories:120,protein:3,fat:1,carbs:24},nutritionReference:'仅用于并行验证的虚拟数据',
    ingredients:[f.name],allergens:[],tags:[],portions:[{grams:100,label:'测试100克'}],
  })}));
  await new Promise(resolve=>setTimeout(resolve,12000));
  res.json({parsed:{foods},content:JSON.stringify({foods}),timestamp:new Date().toISOString(),model:'local-test-fixture'});
});
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'spa'});
app.use(vite.middlewares);app.listen(4175,'127.0.0.1',()=>console.log('Local parallel test fixture: http://127.0.0.1:4175'));
