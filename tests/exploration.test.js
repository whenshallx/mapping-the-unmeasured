import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const memory=new Map();
globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
globalThis.fetch=async url=>{try{return new Response(await readFile(url),{status:200});}catch{return new Response('',{status:404});}};
const {api,targetCSV}=await import('../site/browser-api.js');
let state=await api('/api/sessions',{});
test('all five stages switch real scenes, metrics, and targeting data without a backend',async()=>{
  let previous;
  for(const n of [30,60,90,120,150]) {
    state=await api('/api/model',{session:state.session_id,n_train:n});assert.equal(state.n_train,n);assert.equal(state.metrics.test.n,1200);
    const scene=await api(state.scene_url);assert.equal(scene.points.filter(p=>p.trained).length,n);
    if(previous)assert.notDeepEqual(scene.mesh.prediction_mpa,previous);previous=scene.mesh.prediction_mpa;
    const all=await api('/api/target',{session:state.session_id,target_mpa:5,tolerance_mpa:100});assert.equal(all.count,4800-n);
    const match=await api('/api/target',{session:state.session_id,target_mpa:5,tolerance_mpa:.1});
    assert.ok(match.matches.every(p=>Math.abs(p.prediction_mpa-5)<=.1+1e-12));
    assert.equal(targetCSV(match).split('\r\n').length,match.count+2);
    const p=scene.points[10],features=Object.fromEntries(['State','Seams','Walls','Layer Height mm','Bead mm','Infill Density','Overlap'].map(k=>[k,p[k]]));
    const prediction=await api('/api/predict',{session:state.session_id,features});assert.equal(prediction.sample_id,p['Sample ID']);assert.equal(prediction.prediction_mpa,p.prediction_mpa);
  }
});
test('selection persists locally, reset starts at 120 and old sessions remain',async()=>{
  state=await api('/api/model',{session:state.session_id,n_train:60});
  assert.equal((await api(`/api/state?session=${state.session_id}`)).n_train,60);
  const fresh=await api('/api/reset',{session:state.session_id});assert.equal(fresh.n_train,120);assert.notEqual(fresh.session_id,state.session_id);
  assert.equal((await api('/api/sessions')).sessions.length,2);
  await assert.rejects(api('/api/model',{session:state.session_id,n_train:135}));
  assert.equal((await api(`/api/state?session=${state.session_id}`)).n_train,60);
});
test('exploration still works when the browser blocks persistent storage',async()=>{
  globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('storage unavailable');}};
  const privateState=await api('/api/sessions',{});
  assert.equal((await api(`/api/state?session=${privateState.session_id}`)).n_train,120);
  const changed=await api('/api/model',{session:privateState.session_id,n_train:30});assert.equal(changed.n_train,30);
});
