import {FEATURES,encode,predict,displayZ} from './browser-model.js';
const BASE=new URL('./',import.meta.url);
const SESSION_KEY=`mapping-the-unmeasured.pages.sessions.v1:${BASE.pathname}`;
const cache=new Map();
let memorySessions={};
async function asset(relative,signal) {
  if(!cache.has(relative))cache.set(relative,fetch(new URL(relative,BASE),{signal}).then(async response=>{
    if(!response.ok)throw new Error(`Could not load ${relative}. Check your connection and reload.`);
    return response.json();
  }).catch(error=>{cache.delete(relative);throw error;}));
  return cache.get(relative);
}
function sessions() {try{const raw=localStorage.getItem(SESSION_KEY);if(!raw)return memorySessions;const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:memorySessions;}catch{return memorySessions;}}
function save(state) {
  const all=sessions();state.updated_at=new Date().toISOString();all[state.session_id]=state;
  const entries=Object.values(all).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,30);
  memorySessions=Object.fromEntries(entries.map(s=>[s.session_id,s]));
  try{localStorage.setItem(SESSION_KEY,JSON.stringify(memorySessions));}catch{}
}
function fail(message,status=400) {const error=new Error(message);error.status=status;throw error;}
function stored(id) {const value=sessions()[id];if(!value)fail('This exploration could not be found. Start a new one.',404);return {...value};}
async function catalog() {return asset('data/catalog.json');}
async function metadata(n) {const model=(await catalog()).models.find(m=>m.n_train===n);if(!model||typeof n!=='number')fail('Choose n = 30, 60, 90, 120 or 150.');return model;}
async function publicState(state) {
  const c=await catalog(),m=await metadata(state.n_train),mapping=await asset('data/mapping.json');
  return {...state,round:m.round,version:m.version,phase:'ready',metrics:m.metrics,models:c.models,
    history:c.models.map(model=>({...model,source:'archive',current:model.n_train===state.n_train})),
    feature_bounds:mapping.bounds,scene_url:`/api/scene?session=${state.session_id}&v=${m.version}`};
}
async function create() {
  const now=new Date().toISOString();const state={session_id:crypto.randomUUID().replaceAll('-',''),n_train:120,created_at:now,updated_at:now};
  save(state);return publicState(state);
}
async function delta(n) {await metadata(n);return asset(`data/n${n}/scene_delta.json`);}
async function sceneFor(n) {
  const base=await asset('data/scene.json'),d=await delta(n);
  const result={...base,...d,mesh:{...base.mesh,...d.mesh},points:base.points.map((p,i)=>({...p,...d.point_values[i]}))};
  delete result.point_values;return result;
}
async function validate(values) {
  if(!values||Object.keys(values).length!==7||!FEATURES.every(key=>Object.hasOwn(values,key)))fail('Please provide all seven material and printing variables.');
  if(!['Dried','Fired'].includes(values.State)||!['Random','Aligned'].includes(values.Seams))fail('Choose a valid material state and seam arrangement.');
  const {bounds}=await asset('data/mapping.json'),row={...values};
  for(let i=2;i<7;i++) {const key=FEATURES[i],value=Number(row[key]);if(row[key]===''||row[key]===null||!Number.isFinite(value)||value<bounds.low[i]||value>bounds.high[i])fail(`${key} must be between ${bounds.low[i]} and ${bounds.high[i]}.`);row[key]=value;}
  if(![1,2].includes(row.Walls))fail('Choose one or two walls.');
  if(row['Infill Density']===1&&row.Overlap!==1)fail('Full infill requires overlap = 1.');
  return row;
}
async function prediction(state,values) {
  const features=await validate(values),vector=encode(features);
  const [model,base,mapping]=await Promise.all([asset(`data/n${state.n_train}/model.json`),asset('data/scene.json'),asset('data/mapping.json')]);
  const raw=predict(model,features),{bounds}=mapping;
  const distances=base.points.map((point,index)=>({index,distance:encode(point).reduce((sum,value,i)=>sum+((value-vector[i])/(bounds.high[i]-bounds.low[i]||1))**2,0)}));
  distances.sort((a,b)=>a.distance-b.distance||a.index-b.index);
  const nearest=base.points[distances[0].index],exact=distances[0].distance<1e-18;
  let xx=nearest.UMAP_1,yy=nearest.UMAP_2;
  if(!exact) {
    const nearby=distances.filter(d=>{const p=base.points[d.index];return p.State===features.State&&p.Seams===features.Seams&&Number(p.Walls)===features.Walls;}).slice(0,12);
    let denominator=0;xx=0;yy=0;
    for(const d of nearby) {const weight=1/Math.max(d.distance,1e-16),p=base.points[d.index];xx+=p.UMAP_1*weight;yy+=p.UMAP_2*weight;denominator+=weight;}
    xx/=denominator;yy/=denominator;
  }
  const id=exact?nearest['Sample ID']:null;
  return {sample_id:id,prediction_mpa:raw,in_candidate_space:exact,
    projection_method:exact?'stored UMAP position':'estimated position from nearby combinations',
    point:{'Sample ID':id||'CUSTOM',UMAP_1:xx,UMAP_2:yy,prediction_mpa:raw,prediction_display_z:displayZ(raw,mapping),features}};
}
async function target(state,targetValue,toleranceValue) {
  const value=Number(targetValue),tolerance=Number(toleranceValue);
  if(targetValue===null||!Number.isFinite(value)||value<=0||!Number.isFinite(tolerance)||tolerance<0)fail('Strength must be positive and tolerance cannot be negative.');
  const [base,d]=await Promise.all([asset('data/scene.json'),delta(state.n_train)]);
  const candidates=[];
  base.points.forEach((p,i)=>{if(p.split==='development'&&!d.point_values[i].trained)candidates.push({index:i,distance:Math.abs(d.point_values[i].prediction_mpa-value)});});
  candidates.sort((a,b)=>a.distance-b.distance||a.index-b.index);
  function item({index}) {
    const p=base.points[index],v=d.point_values[index],id=p['Sample ID'];
    return {sample_id:id,prediction_mpa:v.prediction_mpa,features:Object.fromEntries(FEATURES.map(key=>[key,p[key]])),
      point:{'Sample ID':id,UMAP_1:p.UMAP_1,UMAP_2:p.UMAP_2,prediction_mpa:v.prediction_mpa,prediction_display_z:v.prediction_display_z}};
  }
  const matched=candidates.filter(c=>c.distance<=tolerance+1e-12);
  return {target_mpa:value,tolerance_mpa:tolerance,count:matched.length,total_candidates:candidates.length,scope:'unlabelled development candidates',matches:matched.map(item),nearest:candidates.slice(0,5).map(item)};
}
export async function api(path,body,options={}) {
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const url=new URL(path,'https://local.invalid'),session=body?.session||url.searchParams.get('session');
  switch(url.pathname) {
    case '/api/sessions': return body===undefined?{sessions:Object.values(sessions()).sort((a,b)=>b.updated_at.localeCompare(a.updated_at))}:create();
    case '/api/state': return publicState(stored(session));
    case '/api/reset': stored(session);return create();
    case '/api/model': {const m=await metadata(body.n_train),state=stored(session);state.n_train=m.n_train;save(state);return publicState(state);}
    case '/api/model-delta':return delta(Number(url.searchParams.get('n')));
    case '/api/scene':return sceneFor(stored(session).n_train);
    case '/api/predict':return prediction(stored(session),body.features);
    case '/api/target':return target(stored(session),body.target_mpa,body.tolerance_mpa);
    default:fail('Unknown local operation.',404);
  }
}
export function targetCSV(result) {
  const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
  return '\ufeff'+[['Sample ID',...FEATURES,'prediction_mpa','target_mpa','absolute_error_mpa'],...result.matches.map(row=>[row.sample_id,...FEATURES.map(k=>row.features[k]),row.prediction_mpa,result.target_mpa,Math.abs(row.prediction_mpa-result.target_mpa)])].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export function bindDownloads() {
  document.addEventListener('click',async event=>{
    const link=event.target.closest('a[href]');if(!link)return;
    const url=new URL(link.href),isTraining=url.pathname==='/api/download',isTarget=url.pathname==='/api/target-download';
    if(!isTraining&&!isTarget)return;event.preventDefault();
    try {
      const state=stored(url.searchParams.get('session'));let blob,name;
      if(isTraining) {
        const response=await fetch(new URL(`data/n${state.n_train}/training.csv`,BASE));
        if(!response.ok)throw new Error('Could not load the training data.');
        blob=await response.blob();name=`training-n${state.n_train}.csv`;
      }else {
        const result=await target(state,url.searchParams.get('target_mpa'),url.searchParams.get('tolerance_mpa'));
        blob=new Blob([targetCSV(result)],{type:'text/csv;charset=utf-8'});name=`target-recipes-n${state.n_train}.csv`;
      }
      const objectURL=URL.createObjectURL(blob),a=document.createElement('a');a.href=objectURL;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),30000);
    }catch(error){const toast=document.querySelector('#toast');toast.textContent=error.message;toast.hidden=false;}
  });
}
