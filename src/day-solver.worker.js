import {solvePlanDay} from './engine.js';

self.onmessage=async({data})=>{
  try{
    const solved=await solvePlanDay(data.profile,data.template,data.foods,data.day,data.rules,progress=>self.postMessage({type:'progress',progress}));
    self.postMessage({type:'result',solved});
  }catch(error){self.postMessage({type:'error',error:error.message});}
};
