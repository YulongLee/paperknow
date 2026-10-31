const fail=message=>{throw Object.assign(Error(message),{status:422,code:'figure_plan_invalid'});};
const compact=s=>String(s).replace(/[\s“”"'「」]/g,'').replace(/--?>/g,'→');
// An explicitly enumerated state machine is a closed graph. Do not infer extra
// transitions or final states from general UML habits. Translation and open
// brainstorming briefs still use the separate semantic review.
export function assertResearchStateEvidence(plan,snapshot){
 if(snapshot.context?.figureType!=='state')return{applied:false};
 const source=snapshot.text,header=source.match(/(?:状态为|状态是|states?\s+(?:are|include))\s*[:：]?([^。.;\n]+)/i)?.[1]||'';
 if(snapshot.language!=='中文'&&/[\u3400-\u9fff]/.test(header))return{applied:false};
 const required=[...header.matchAll(/[“"「]([^”"」]+)[”"」]/g)].map(m=>m[1].trim());
 if(required.length>1){
  for(const label of required)if(!plan.nodes.some(n=>n.label===label))fail('状态图遗漏作者指定的状态“'+label+'”，请保持完整状态列表');
  for(const n of plan.nodes)if(n.label&&!required.includes(n.label)&&!['start','end'].includes(n.role))fail('状态图添加了作者未指定的状态“'+n.label+'”');
 }
 if(/补全|设计其余|自行推断|infer|remaining transitions/i.test(source))return{applied:false};
 const normalized=compact(source),aliases=n=>n.label?[compact(n.label)]:n.role==='start'?['起始黑点','初始黑点','起点','起始','初始','start','initial','initial black dot','initial dot'].flatMap(v=>[v,v[0].toUpperCase()+v.slice(1),v.toUpperCase()]).map(compact):n.role==='end'?['终点同心圆','终点','终止','end','final','final state','final double circle'].flatMap(v=>[v,v[0].toUpperCase()+v.slice(1),v.toUpperCase()]).map(compact):[];
 const positive=(a,b)=>{const phrase=a+'→'+b;let at=-1;while((at=normalized.indexOf(phrase,at+1))>=0){const prefix=normalized.slice(Math.max(0,at-14),at);if(!/(?:不要|不得|禁止|不允许|donot(?:add)?|never|not)[:：]?$/i.test(prefix))return true;}return false;};
 const expected=new Set();
 for(const from of plan.nodes)for(const to of plan.nodes)if(aliases(from).some(a=>aliases(to).some(b=>positive(a,b))))expected.add(JSON.stringify([from.id,to.id]));
 if(expected.size<2)return{applied:false};
 const actual=new Set(plan.edges.map(e=>JSON.stringify([e.from,e.to]))),label=id=>plan.nodes.find(n=>n.id===id)?.label||'起点/终点';
 for(const e of plan.edges){
  if(!expected.has(JSON.stringify([e.from,e.to])))fail('连接“'+label(e.from)+'→'+label(e.to)+'”没有作者提供的转换依据，请删除该连接，保留作者指定的转换');
  for(const a of aliases(plan.nodes.find(n=>n.id===e.from)))for(const b of aliases(plan.nodes.find(n=>n.id===e.to))){const phrase=a+'→'+b,at=normalized.indexOf(phrase);if(at<0)continue;const event=normalized.slice(at+phrase.length).match(/^[,，]?(?:事件|event)[:：]?([^；;。,.，]+)/i)?.[1];if(event&&compact(e.label)!==event)fail('转换“'+label(e.from)+'→'+label(e.to)+'”应标注作者给出的事件“'+event+'”');}
 }
 for(const key of expected)if(!actual.has(key)){const[a,b]=JSON.parse(key);fail('状态图缺少作者指定的连接“'+label(a)+'→'+label(b)+'”');}
 return{applied:true,requiredStates:required.length,requiredTransitions:expected.size};
}
