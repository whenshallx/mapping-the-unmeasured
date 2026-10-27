import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {predict,displayZ} from '../site/browser-model.js';
const read=async file=>JSON.parse(await readFile(new URL(file,import.meta.url),'utf8'));
const fixtures=await read('./fixtures.json');
for(const n of [30,60,90,120,150])test(`n=${n}: browser inference matches XGBoost across ${fixtures.rows.length} recipes`,async()=>{
  const model=await read(`../site/data/n${n}/model.json`),expected=fixtures.models[n].predictions;
  let maximum=0;
  for(let i=0;i<fixtures.rows.length;i++) {
    const actual=predict(model,fixtures.rows[i]),difference=Math.abs(actual-expected[i]);maximum=Math.max(maximum,difference);
    assert.ok(difference<=2e-6,`recipe ${i}: ${actual} vs ${expected[i]}`);
  }
  console.log(`n=${n}, maximum numerical difference ${maximum} MPa`);
});
test('nonlinear height mapping matches the original SciPy PCHIP',async()=>{
  const mapping=await read('../site/data/mapping.json');
  fixtures.mapping.values.forEach((v,i)=>assert.ok(Math.abs(displayZ(v,mapping)-fixtures.mapping.expected[i])<1e-12));
});
