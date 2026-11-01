export const simulationDisclosure='本数据集由计算机按照声明的假设、参数和固定随机种子生成，仅用于仿真分析；不属于真实参与者调查、现场采集记录或已运行模型的性能测量。';
const fail=message=>{throw Object.assign(new Error('模拟方案无效：'+message),{status:502,code:'invalid_simulation'});};
const object=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('字段不完整或包含不支持的内容');};
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f<>]/.test(value)||/\[(?:source|figure):|https?:\/\//i.test(value))fail('请使用规定长度内的纯文本');return value.trim();};
const num=value=>{if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e6)fail('参数须为绝对值不超过一百万的有限数字');return value;};
export function normalizeSimulationRecipe(value){
 object(value,['title','purpose','sampleSize','assumptions','variables','limitations']);
 const list=(rows,min,max)=>{if(!Array.isArray(rows)||rows.length<min||rows.length>max)fail('假设和局限列表不完整');return rows.map(row=>text(row,400));};
 const sampleSize=value.sampleSize;if(!Number.isSafeInteger(sampleSize)||sampleSize<20||sampleSize>200)fail('模拟样本量须为 20～200');
 if(!Array.isArray(value.variables)||value.variables.length<2||value.variables.length>6)fail('须有 2～6 个模拟变量');
 const keys=new Set(),labels=new Set(),variables=value.variables.map(row=>{
  object(row,['key','label','unit','distribution','min','max','mean','sd','probability','intercept','noiseSd','terms']);
  if(typeof row.key!=='string'||!/^[a-z][a-z0-9_]{0,19}$/.test(row.key)||keys.has(row.key))fail('变量编号无效或重复');
  const label=text(row.label,40);if(labels.has(label))fail('变量名称不能重复');labels.add(label);
  if(!['uniform','normal','binary','linear'].includes(row.distribution))fail('分布仅支持 uniform、normal、binary、linear');
  const min=num(row.min),max=num(row.max);if(min>=max)fail('变量下界须小于上界');
  const out={key:row.key,label,unit:row.unit?text(row.unit,20):'',distribution:row.distribution,min,max};
  const required={uniform:[],normal:['mean','sd'],binary:['probability'],linear:['intercept','noiseSd','terms']}[row.distribution];
  if(Object.keys(row).some(key=>!['key','label','unit','distribution','min','max',...required].includes(key)))fail('变量包含不适用的参数');
  if(row.distribution==='normal'){out.mean=num(row.mean);out.sd=num(row.sd);if(out.sd<=0||out.mean<min||out.mean>max)fail('正态分布参数超出范围');}
  if(row.distribution==='binary'){out.probability=num(row.probability);if(min!==0||max!==1||out.probability<=0||out.probability>=1)fail('二元分布须为 0/1，概率在 0 与 1 之间');}
  if(row.distribution==='linear'){
   out.intercept=num(row.intercept);out.noiseSd=num(row.noiseSd);if(out.noiseSd<0||!Array.isArray(row.terms)||!row.terms.length||row.terms.length>5)fail('线性模型的噪声或系数无效');
   const seen=new Set();out.terms=row.terms.map(term=>{object(term,['key','weight']);if(!keys.has(term.key)||seen.has(term.key))fail('线性模型只能引用前面的变量且不能重复');seen.add(term.key);return {key:term.key,weight:num(term.weight)};});
  }
  keys.add(row.key);return out;
 });
 return {title:text(value.title,120),purpose:text(value.purpose,500),sampleSize,assumptions:list(value.assumptions,1,6),variables,limitations:list(value.limitations,1,6)};
}
export function generateSimulationData(input,seed){
 const recipe=normalizeSimulationRecipe(input);if(!Number.isSafeInteger(seed)||seed<1||seed>0xffffffff)fail('随机种子无效');
 let state=seed;const random=()=>{let t=state+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;},normal=()=>Math.sqrt(-2*Math.log(Math.max(Number.EPSILON,random())))*Math.cos(2*Math.PI*random()),round=x=>Number(x.toFixed(4));
 const rows=Array.from({length:recipe.sampleSize},()=>{const row={};for(const variable of recipe.variables){let value;if(variable.distribution==='uniform')value=variable.min+random()*(variable.max-variable.min);else if(variable.distribution==='normal')value=variable.mean+normal()*variable.sd;else if(variable.distribution==='binary')value=random()<variable.probability?1:0;else value=variable.intercept+variable.terms.reduce((sum,term)=>sum+row[term.key]*term.weight,0)+normal()*variable.noiseSd;row[variable.key]=round(Math.max(variable.min,Math.min(variable.max,value)));}return row;});
 const statistics=recipe.variables.map(variable=>{const values=rows.map(row=>row[variable.key]),mean=values.reduce((a,b)=>a+b,0)/values.length;return {key:variable.key,label:variable.label,unit:variable.unit,count:values.length,min:Math.min(...values),max:Math.max(...values),mean:round(mean),sd:round(Math.sqrt(values.reduce((sum,x)=>sum+(x-mean)**2,0)/(values.length-1)))};});
 const cell=value=>'"'+(typeof value==='string'&&/^[=+@-]/.test(value.trimStart())?"'":'')+String(value).replace(/"/g,'""')+'"',csv=[['模拟序号',...recipe.variables.map(row=>row.label+(row.unit?'（'+row.unit+'）':''))],...rows.map((row,index)=>[index+1,...recipe.variables.map(variable=>row[variable.key])])].map(row=>row.map(cell).join(',')).join('\n');
 const body=[`AI模拟数据补充：${recipe.title}（非实测）`,simulationDisclosure,'用途：'+recipe.purpose,'样本量：'+rows.length+'；随机种子：'+seed+'；生成算法：mulberry32-boxmuller-v1（超出声明上下界的数值裁剪至边界，保留四位小数）。','假设：'+recipe.assumptions.join('；'),'参数（用于复现，不代表拟合或实测参数）：'+JSON.stringify(recipe.variables),'计算汇总：',...statistics.map(row=>`${row.label}：n=${row.count}，均值=${row.mean}，样本标准差=${row.sd}，最小值=${row.min}，最大值=${row.max}${row.unit?'，单位='+row.unit:''}`),'模拟记录：',...rows.map((row,index)=>`模拟序号 ${index+1}；`+recipe.variables.map(variable=>variable.label+' '+row[variable.key]+(variable.unit?' '+variable.unit:'')).join('；')),'适用局限：'+recipe.limitations.join('；')].join('\n');
 if(body.length>40000)fail('模拟记录过长，请减少样本量或精简变量名称');
 return {operation:'simulation',origin:'ai_simulation',evidenceStatus:'simulation',generatorVersion:1,seed,recipe,rows,statistics,csv,text:body,disclosure:simulationDisclosure,requiresReview:true};
}
export const isSimulationMaterial=row=>row?.dataKind==='simulation'||String(row?.id||'').startsWith('simulation:');
export const simulationInUse=(snapshot={},chapters=[])=>{const ids=new Set(chapters.flatMap(chapter=>[...(chapter.sourceIds||[]),...[...String(chapter.text||'').matchAll(/\[source:([^\]]+)\]/g)].map(match=>match[1]),...(chapter.figures||[]).flatMap(figure=>figure.data?.series?.flatMap(series=>series.points.map(point=>point.sourceId))||[])]));return(snapshot.materials||[]).filter(row=>isSimulationMaterial(row)&&ids.has(row.id));};

export function simulationResearchDisclosure(snapshot={},chapters=[]){
 const used=simulationInUse(snapshot,chapters);if(!used.length)return [];
 const english=/english|英文|英语/i.test(snapshot.profile?.language||''),notice=english?'The datasets identified as simulated were generated computationally under declared assumptions with a fixed random seed. They are not observations from real participants, field measurements, or measured performance of a trained model.':simulationDisclosure;
 return [english?'Simulation data and reproducibility':'模拟数据与复现说明',notice,...used.flatMap(row=>{const meta=row.simulation,recipe=meta?.recipe;if(!recipe)return [row.name];return [recipe.title+'：'+recipe.purpose,(english?'Random seed: ':'随机种子：')+meta.seed+'；mulberry32-boxmuller-v1；'+recipe.sampleSize+(english?' simulated records. Values outside declared bounds are clipped; values are rounded to four decimal places.':' 条模拟记录；超出声明上下界的数值裁剪至边界，保留四位小数。'),(english?'Assumptions: ':'模拟假设：')+recipe.assumptions.join('；'),...recipe.variables.map(variable=>{const label=variable.label+'（'+variable.key+'）'+(variable.unit?(english?', unit: ':'，单位：')+variable.unit:'')+(english?'; range: ':'；范围：')+'['+variable.min+', '+variable.max+']；';if(variable.distribution==='uniform')return label+(english?'uniform generation':'均匀分布生成');if(variable.distribution==='normal')return label+(english?'normal generation; mean: ':'正态分布生成；均值：')+variable.mean+(english?'; standard deviation: ':'；标准差：')+variable.sd;if(variable.distribution==='binary')return label+(english?'binary generation; probability of 1: ':'二元分布生成；取 1 的概率：')+variable.probability;return label+(english?'linear generation; intercept: ':'线性关系生成；截距：')+variable.intercept+(english?'; coefficients: ':'；系数：')+variable.terms.map(term=>term.key+' = '+term.weight).join('，')+(english?'; noise standard deviation: ':'；噪声标准差：')+variable.noiseSd;}),(english?'Limitations: ':'适用局限：')+recipe.limitations.join('；')];})];
}
