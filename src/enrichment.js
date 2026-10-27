import {clone,confirmLibraryMatches,mergeFoodSupplements,isTagDataConfirmed} from './workbench-model.js';
import {validMealTags} from './food-tags.js';

const key=f=>`${f.slot}|${f.name}`;
export const needsNutrition=f=>!['calories','protein','fat','carbs'].every(field=>Number.isFinite(f.nutritionPer100g?.[field]));
export const needsIngredients=f=>!f.ingredients?.length&&f.tagSchemaVersion!==2;
export const needsTags=f=>!isTagDataConfirmed(f);
export const needsPortions=f=>!f.portions?.length;
export const missingFoodFields=f=>[
  ...(needsNutrition(f)?['营养数据']:[]),
  ...(needsIngredients(f)?['配料']:[]),
  ...(!validMealTags(f.mealTags)?['餐次标签']:[]),
  ...(needsPortions(f)?['可执行份量']:[]),
  ...(needsTags(f)?['标签']:[]),
  ...(!Array.isArray(f.allergens)?['过敏原字段']:[]),
];
export const enrichmentQueue=(foods,scope='nutrition')=>foods.filter(f=>scope==='nutrition'?needsNutrition(f):scope==='tags'?needsTags(f):scope==='portions'?needsPortions(f):!needsNutrition(f)&&needsEnrichment(f));
export const needsEnrichment=f=>
  !['calories','protein','fat','carbs'].every(field=>Number.isFinite(f.nutritionPer100g?.[field]))||
  needsTags(f)||needsIngredients(f)||needsPortions(f);

export const autoConfirmFoods=foods=>foods.map(f=>({...f,tagsReviewed:!needsEnrichment(f)}));

export function mergeLibraryFoods(current,rows) {
  const {foods,issues}=confirmLibraryMatches(rows,true);
  return {issues,foods:autoConfirmFoods(foods.map(f=>{
    const old=current.find(p=>key(p)===key(f));
    if(!old)return f;
    if(f.dataSource==='pending')return {...old,id:f.id,preference:f.preference};
    const same=old.dataSource==='real_library'&&String(old.libraryRecord?.id||old.libraryRecord?._id)===String(f.libraryRecord?.id||f.libraryRecord?._id)&&JSON.stringify(old.nutritionPer100g)===JSON.stringify(f.nutritionPer100g);
    return {...old,...f,
      nutritionReference:undefined,
      ingredients:f.ingredients.length?f.ingredients:old.ingredients,
      allergens:f.ingredients.length?f.allergens:old.allergens,
      portions:f.portions.length?f.portions:old.portions,
      tags:old.tags,tagsComplete:old.tagsComplete,tagsConfirmed:same?old.tagsConfirmed:false,mealTags:old.mealTags,allergenTags:old.allergenTags,avoidanceTags:old.avoidanceTags,tagSchemaVersion:old.tagSchemaVersion,supplementSource:old.supplementSource,
      tagsReviewed:same?old.tagsReviewed:false,
    };
  }))};
}

// Rebase each result onto current data, not the snapshot sent to the model.
export function mergeEnrichmentBatch(current,snapshot,payload,scope='all') {
  const completed=mergeFoodSupplements(snapshot,payload,scope);
  return autoConfirmFoods(current.map(f=>{
    const base=snapshot.find(s=>key(s)===key(f));
    const enriched=completed.find(s=>key(s)===key(f));
    if(!base||!enriched||enriched.supplementSource!=='ai_supplement')return f;
    const unchanged=field=>JSON.stringify(f[field])===JSON.stringify(base[field]);
    const nutrition=['all','nutrition'].includes(scope)&&f.dataSource==='pending'&&unchanged('nutritionPer100g')&&enriched.nutritionPer100g?{
      nutritionPer100g:enriched.nutritionPer100g,nutritionReference:enriched.nutritionReference,dataSource:enriched.dataSource,
    }:{};
    const fields=scope==='tags'?['allergens','tags','tagsComplete','tagsConfirmed','mealTags','allergenTags','avoidanceTags','tagSchemaVersion']:scope==='portions'?['portions']:scope==='nutrition'?[]:['ingredients','allergens','portions','tags','tagsComplete','tagsConfirmed','mealTags'];
    const metadata=Object.fromEntries(fields.filter(field=>unchanged(field)&&enriched[field]!==undefined).map(field=>[field,clone(enriched[field])]));
    return {...f,...nutrition,...metadata,supplementSource:'ai_supplement',tagsReviewed:false};
  }));
}

function enrichmentBatches(foods,batchSize,scope) {
  if(scope==='tags')return foods.length?[foods]:[];
  if(scope!=='tags') {
    const batches=[];
    for(let start=0;start<foods.length;start+=batchSize)batches.push(foods.slice(start,start+batchSize));
    return batches;
  }
}

export async function runEnrichmentBatches(foods,{batchSize=20,scope='all',signal,request,onProgress=()=>{},onBatch=()=>{}}) {
  foods=scope==='all'?foods.filter(needsEnrichment):enrichmentQueue(foods,scope);
  const batches=enrichmentBatches(foods,batchSize,scope);
  const total=foods.length,totalBatches=batches.length;
  let completed=0;
  for(let index=0;index<batches.length;index++) {
    if(signal?.aborted)break;
    const batch=clone(batches[index]),batchNumber=index+1;
    onProgress({completed,total,batchNumber,totalBatches,currentNames:batch.map(f=>f.name),status:'running'});
    const payload=await request(batch,batchNumber);
    mergeFoodSupplements(batch,payload,scope);
    await onBatch(batch,payload);
    completed+=batch.length;
    onProgress({completed,total,batchNumber,totalBatches,currentNames:[],status:completed===total?'completed':'running'});
  }
  return {completed,total,totalBatches};
}
