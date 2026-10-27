// Exact numeric-tree evaluator for the exported XGBoost square-error regressors.
// XGBoost uses float32 inputs, thresholds, leaf values and sequential accumulation.
export const FEATURES = ['State','Seams','Walls','Layer Height mm','Bead mm','Infill Density','Overlap'];
export function encode(values) {
  return FEATURES.map((key,i)=>i===0?({Dried:0,Fired:1})[values[key]]:i===1?({Random:0,Aligned:1})[values[key]]:Number(values[key]));
}
export function predict(model, values) {
  const input=encode(values).map(Math.fround);
  let result=Math.fround(model.base_score);
  for(const tree of model.trees) {
    let node=0;
    while(tree.left[node]!==-1) {
      const value=input[tree.feature[node]];
      node=Number.isNaN(value)?(tree.default_left[node]?tree.left[node]:tree.right[node]):value<Math.fround(tree.condition[node])?tree.left[node]:tree.right[node];
    }
    result=Math.fround(result+Math.fround(tree.condition[node]));
  }
  return result;
}
export function displayZ(value, mapping) {
  const {x,y,c}=mapping;
  if(value<x[0])return y[0]+(value-x[0])*(y[1]-y[0])/(x[1]-x[0]);
  const last=x.length-1;
  if(value>x[last])return y[last]+(value-x[last])*(y[last]-y[last-1])/(x[last]-x[last-1]);
  let i=0;while(i<last-1&&value>=x[i+1])i++;
  const t=value-x[i];return ((c[0][i]*t+c[1][i])*t+c[2][i])*t+c[3][i];
}
