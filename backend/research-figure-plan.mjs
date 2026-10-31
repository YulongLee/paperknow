import {publicationFigureKind,publicationProfile} from './research-publication-policy.mjs';
import {assertResearchStateEvidence} from './research-state-evidence.mjs';
import {scientificFigureStyle} from './research-image-scientific-style.mjs';
import {researchFigureSelection} from './research-figure-selection.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:422,code:'figure_plan_invalid'});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail(label+'无效');return v.trim();};
const optional=(v,max,label)=>v==null||v===''?'':text(v,max,label);
const color=v=>{const named={orange:'#D55E00',blue:'#0072B2',green:'#009E73',gray:'#64748b',grey:'#64748b',red:'#b91c1c',橙色:'#D55E00',蓝色:'#0072B2',绿色:'#009E73',灰色:'#64748b'};return typeof v==='string'?(named[v.toLowerCase()]||(/^#[a-fA-F0-9]{6}$/.test(v)?v:undefined)):undefined;};
const number=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12)fail(label+'必须是有限数值');return v;};
const arrays=(v,max,label)=>{if(!Array.isArray(v)||v.length>max)fail(label+'格式无效或数量过多');return v;};
export function numericLineCoordinates(categories){
 if(!Array.isArray(categories)||categories.length<2||!categories.every(v=>typeof v==='string'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)))return null;
 const x=categories.map(Number);return x.every((value,i)=>Number.isFinite(value)&&Math.abs(value)<=1e12&&(!i||value>x[i-1]))?x:null;
}
export const publicationChartTypes=Object.freeze(['bar','horizontal-bar','pictorial-bar','line','area','scatter','pie','radar','heatmap','boxplot','candlestick','gauge','treemap','sunburst','sankey','chord','funnel','parallel','calendar','river','histogram']);
const chartDataSchemas={
 categorical:'data:{categories:["类别A","类别B"],series:[{name:"系列名称",values:[1,2]}]}。categories每项必须是字符串，数值型周次/年份也必须写成字符串。每个系列的values长度与categories一致。',
 scatter:'data:{points:[{x:1,y:2},{x:2,y:3}]}。x和y为原文坐标数值。',
 heatmap:'data:{rows:["行A","行B"],columns:["列A","列B"],matrix:[[1,2],[3,4]]}。行列标签与矩阵尺寸必须对应。',
 boxplot:'data:{series:[{name:"组名",values:[1,2,3,4]}]}。values必须是每组原始观测值，不是五数概括；不由模型计算四分位数。',
 candlestick:'data:{ohlc:[{name:"第1日",open:1,close:2,low:0,high:3}]}。时间标签字段必须为name，不使用date。所有开高低收值取自原文。',
 gauge:'data:{value:1,minimum:0,maximum:5}。unit在figure顶层。仅明确百分比时可以使用0～100。',
 hierarchy:'data:{hierarchy:{name:"根节点",children:[{name:"子节点",value:1}]}}。仅分类且无权重时qualitative:true，省略所有value。',
 links:'data:{nodes:[{id:"a",label:"A"},{id:"b",label:"B"}],links:[{from:"a",to:"b",value:1}]}。不要用diagram冒充流量图，连接数值不能仅写在edges.label中。',
 parallel:'data:{dimensions:["维度A","维度B"],series:[{name:"方法A",values:[[1,2]]},{name:"方法B",values:[[3,4]]}]}。每条数据行是数组；即使一个方法只有一行，也必须有values的外层数组，维度名称使用dimensions。',
 calendar:'data:{calendar:[{date:"2026-10-01",value:1},{date:"2026-10-02",value:2}]}。日期仅使用原文给定日期。',
 river:'data:{river:[{date:"2026-01-01",name:"主题A",value:1},{date:"2026-01-01",name:"主题B",value:2}]}。逐个日期和主题展开为记录，不使用categories/series替代。',
 histogram:'data:{series:[{name:"组名",values:[1,2,3,4]}]}。传入原始观测值，分箱由程序计算。'
};
function planSchemaInstructions(choice){
 const selected=choice.categoryId==='basic'&&publicationFigureKind(choice)==='data'?choice.id:null;
 const key=selected&&(['bar','horizontal-bar','pictorial-bar','line','area','pie','radar','funnel'].includes(selected)?'categorical':['treemap','sunburst'].includes(selected)?'hierarchy':['sankey','chord'].includes(selected)?'links':selected);
 const schemas=(key?[[key,chartDataSchemas[key]]]:Object.entries(chartDataSchemas)).map(([key,schema])=>key+'：'+schema).join('\n');
 return [
  selected?`所选基础图种强制绑定kind:"chart",chartType:"${selected}"；不得改成diagram、其他图种或空数据。`:'专业图种按明确对象选择绘制方法；如果是电路原理图/电路图，必须使用illustration和标准器件图形，不能用diagram方框代替。',
  '根结构为{complete:true,figure:{kind:"chart|diagram|sequence|illustration",title:"保存名称",caption:"图注",layout:"LR|TB|radial|grid",qualitative:false,...当前图种实际字段}}。禁止把无关字段写成空对象。以下数据格式中的数字仅演示结构，实际数值必须逐项来自作者原文，不能照抄格式示范数值。',
  'chart只写chartType、data和所需xLabel/yLabel/unit；图种数据结构如下。bar、horizontal-bar、pictorial-bar、line、area、pie、radar、funnel使用categorical格式；treemap、sunburst使用hierarchy格式；sankey、chord使用links格式。',
  schemas,
  'referenceLines和yRange只能放在figure顶层。没有要求参考线则不传referenceLines。没有明确给出坐标范围则完全省略yRange。明确要求时min、max来自原文；interval是排版刻度，必须为正数，优先遵守作者给定间隔。非直角坐标图不提交yRange。',
  'diagram/sequence：nodes:[{id:"n1",label:"短标注",role:"process|decision|entity|state|component|actor",attributes:["可选属性"]}],edges:[{from:"n1",to:"n2",label:"关系",kind:"directed|undirected|feedback|inheritance|composition|aggregation|dependency|association|return"}]。至少两个节点。',
  'illustration：description:"完整语义与专业关系说明",artworkDescription:"English visual composition only: geometry, colors, positions and arrows; no lettering instructions",requiredObjects:["必要对象"],labels:["需出现在图中的短标签"]。不提交nodes/edges，不把它变成普通框图。'
 ].join('\n');
}
function nodes(raw){const ids=new Set();return arrays(raw,40,'图中元素').map(row=>{if(!object(row))fail('图中元素无效');const id=text(row.id??row.name??row.label,80,'元素编号');if(ids.has(id))fail('元素编号重复或无效');ids.add(id);return {id,label:row.role==='start'||row.role==='end'||Array.isArray(row.attributes)&&row.attributes.includes('initial')||Array.isArray(row.attributes)&&row.attributes.includes('final')?optional(row.label,120,'元素标注'):text(row.label,120,'元素标注'),group:optional(row.group,80,'元素分组'),role:Array.isArray(row.attributes)&&row.attributes.includes('initial')?'start':Array.isArray(row.attributes)&&row.attributes.includes('final')?'end':['process','decision','start','end','entity','state','component','actor'].includes(row.role)?row.role:'process',attributes:row.attributes===undefined?[]:arrays(row.attributes,12,'元素属性').map(v=>text(v,100,'属性标注'))};});}
function edges(raw,items,ignoreWeights=false){const ids=new Set(items.map(n=>n.id));return arrays(raw||[],80,'连接').map(value=>{const row=object(value)?{...value,from:value.from??value.source,to:value.to??value.target,kind:value.kind??value.type}:value;if(!object(row)||!ids.has(row.from)||!ids.has(row.to))fail('连接引用了不存在的元素');return {from:row.from,to:row.to,label:optional(row.label,100,'连接标注'),kind:['directed','undirected','feedback','inheritance','composition','aggregation','dependency','association','return'].includes(row.kind)?row.kind:'directed',...(ignoreWeights||row.value===undefined?{}:{value:number(row.value,'连接数值')}),...(color(row.color)?{color:color(row.color)}:{})};});}
function hierarchy(raw,depth=0,count={n:0},ignoreWeights=false){if(!object(raw)||depth>5||++count.n>120)fail('层级数据过深或过多');const node={name:text(raw.name,80,'层级名称'),...(ignoreWeights||raw.value===undefined?{}:{value:number(raw.value,'层级数值')}),...(raw.children===undefined?{}:{children:arrays(raw.children,40,'子层级').map(v=>hierarchy(v,depth+1,count,ignoreWeights))})};if(node.value!==undefined&&node.value<0)fail('层级图的面积权重不能为负数');if(node.value!==undefined&&node.children?.every(n=>n.value!==undefined)&&node.children.reduce((sum,n)=>sum+n.value,0)>node.value+Math.max(1,Math.abs(node.value))*1e-9)fail('子层级权重之和超过父层级，请核对原始数据');return node;}
function numericValues(data){const values=[];for(const s of data.series||[])values.push(...s.values.flat());for(const p of data.points||[])values.push(p.x,p.y);for(const row of data.matrix||[])values.push(...row);for(const row of data.ohlc||[])values.push(row.open,row.close,row.low,row.high);for(const row of data.calendar||[])values.push(row.value);for(const row of data.river||[])values.push(row.value);for(const row of data.links||[])if(row.value!==undefined)values.push(row.value);if(data.value!==undefined)values.push(data.value);if(data.minimum!==undefined)values.push(data.minimum);if(data.maximum!==undefined)values.push(data.maximum);function walk(n){if(n.value!==undefined)values.push(n.value);for(const c of n.children||[])walk(c);}if(data.hierarchy)walk(data.hierarchy);return values;}
function sourceHasNumber(source,value){const normalized=source.replace(/[−–]/g,'-').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'');return (normalized.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[]).some(v=>Number(v)===value);}
export function normalizePublicationFigurePlan(raw,snapshot,{verifyEvidence=true}={}){
 if(raw?.complete===false)fail('请补充'+(typeof raw.needs==='string'?raw.needs.slice(0,300):'本图需要的具体数据或关系')+'后再生成');
 if(!object(raw)||raw.complete!==true||!object(raw.figure))fail('绘图计划未完整提交');const f=raw.figure,choice=researchFigureSelection(snapshot);if(!choice)fail('所选绘图类型无效');
 const kind=f.kind;
 if(/原理图|电路图/.test(choice.sceneLabel||choice.label)&&kind!=='illustration')fail('电路原理图必须使用标准器件符号与电路连接，不能用方框流程替代。请使用illustration并明确每个器件与接点。');if(choice.categoryId==='basic'&&publicationFigureKind(choice)==='data'&&kind!=='chart')fail('所选数据图必须按对应图种绘制，不能用普通流程图代替');
 if(choice.categoryId==='basic'&&['sequence','zenuml'].includes(choice.id)&&kind!=='sequence')fail('所选时序图必须使用参与者、消息和分支绘制');
 if(choice.categoryId==='basic'&&['journey','timeline'].includes(choice.id)&&kind!=='diagram')fail('旅程和时间线需要按阶段展开的结构图，不能用参与者调用时序图替代');
 if(choice.categoryId==='basic'&&choice.id!=='auto'&&kind==='illustration')fail('基础数据与结构图必须采用可复现的绘制方式');
 if(!['chart','diagram','sequence','illustration'].includes(kind))fail('绘图方法无效');
 const out={version:1,kind,title:optional(f.title,200,'作品名称')||snapshot.title,caption:optional(f.caption,1500,'图注'),layout:['LR','TB','radial','grid'].includes(f.layout)?f.layout:'LR',qualitative:f.qualitative===true};
 let rawNodes=f.nodes||(kind==='sequence'?(f.actors||f.participants):null)||[],rawEdges=f.edges||(kind==='sequence'?f.messages:null)||[];
 if(choice.id==='matrix'){
  const origins=new Set(arrays(rawNodes,40,'图中元素').filter(n=>n?.position==='center'&&n.label===''&&typeof n.id==='string').map(n=>n.id));
  rawNodes=rawNodes.filter(n=>!origins.has(n.id));rawEdges=arrays(rawEdges,80,'连接').filter(e=>!((origins.has(e.from??e.source)||origins.has(e.to??e.target))&&!e.label));
 }
 out.nodes=nodes(rawNodes);out.edges=edges(rawEdges,out.nodes);
 if(choice.id==='matrix'){
  const slots={'top-left':'top-left','top-right':'top-right','bottom-left':'bottom-left','bottom-right':'bottom-right','axis-label-bottom':'x-axis','axis-label-left':'y-axis','x-axis':'x-axis','y-axis':'y-axis'};
  const quadrants=arrays(f.quadrants||[],4,'象限位置');
  for(const node of out.nodes){const source=(f.nodes||[]).find(n=>(n.id??n.name??n.label)===node.id);node.position=slots[source?.position]||slots[node.group]||node.attributes.map(v=>slots[v]).find(Boolean)||slots[quadrants.find(q=>q.nodeId===node.id)?.position]||null;node.attributes=node.attributes.filter(v=>!slots[v]);}
  for(const [key,position]of [['xAxis','x-axis'],['yAxis','y-axis']])if(!out.nodes.some(n=>n.position===position)&&f.axes?.[key]?.label){const id='matrix-'+position;if(out.nodes.some(n=>n.id===id))fail('坐标轴编号冲突');out.nodes.push({id,label:text(f.axes[key].label,100,'坐标轴名称'),role:'component',group:'',attributes:[],position});}
 }
 if(snapshot.language==='中文')for(const n of out.nodes)n.attributes=n.attributes.filter(v=>!(/^(?:input|output|pre-processing|registration|difference|classification|process|state|component|actor|entity|initial|final)$/i.test(v)&&!snapshot.text.toLowerCase().includes(v.toLowerCase())));
 if(choice.id==='state')for(const node of out.nodes)if(node.role==='end'&&node.label&&out.edges.some(e=>e.from===node.id))node.role='state';
 if(choice.id==='state')out.stateEvidence=assertResearchStateEvidence(out,snapshot);
 if(kind==='diagram'&&out.nodes.length<2)fail('结构图至少需要两个明确元素');
 if(kind==='sequence'&&(out.nodes.length<2||out.nodes.length>10||!out.edges.length))fail('时序图需要2～10个参与者及明确的消息或步骤');
 if(kind==='sequence')out.fragments=arrays(f.fragments||[],8,'分支框').map(g=>({label:text(g.label,80,'分支名称'),branches:arrays(g.branches,8,'分支').map(b=>{
  let start=b.start,end=b.end;
  if(b.edges!==undefined){const branch=edges(b.edges,out.nodes);if(start===out.edges.length){end=start+branch.length-1;out.edges.push(...branch);}else if(JSON.stringify(out.edges.slice(start,end+1))!==JSON.stringify(branch))fail('时序分支与消息列表不一致');}
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>=out.edges.length||out.edges.length>80)fail('时序分支范围无效');return{label:text(b.label,80,'分支条件'),start,end};})}));
 if(kind==='chart'){
  if(!publicationChartTypes.includes(f.chartType))fail('请选择可复现的图表类型');if(!object(f.data))fail('数据图需要实际提供的数据');out.chartType=f.chartType;const d=f.data,data={};
  const topologyOnly=['chord','sunburst','treemap'].includes(out.chartType)&&/无权重|不添加权重|仅.{0,5}分类|不表达强弱|no weights|classification only|equal.width/i.test(snapshot.text);if(topologyOnly)out.qualitative=true;
  for(const key of ['categories','rows','columns','dimensions'])if(d[key]!==undefined)data[key]=arrays(d[key],200,'分类标签').map(v=>text(v,80,'分类标签'));
  if(d.series!==undefined)data.series=arrays(d.series,8,'数据系列').map(s=>({name:text(s.name,100,'系列名称'),...(color(s.color||s.lineColor)?{color:color(s.color||s.lineColor)}:{}),values:arrays(s.values,1000,'系列数据').map(v=>Array.isArray(v)?arrays(v,20,'数值行').map(n=>number(n,'数值')):number(v,'数值'))}));
  if(d.points!==undefined)data.points=arrays(d.points,1000,'数据点').map(p=>({x:number(p.x,'横坐标'),y:number(p.y,'纵坐标'),name:optional(p.name,80,'数据点名称')}));
  if(d.matrix!==undefined)data.matrix=arrays(d.matrix,100,'矩阵').map(row=>arrays(row,100,'矩阵行').map(v=>number(v,'矩阵数值')));
  if(d.ohlc!==undefined)data.ohlc=arrays(d.ohlc,200,'开高低收数据').map(p=>{const row={name:text(p.name,80,'时间标签'),open:number(p.open,'开盘值'),close:number(p.close,'收盘值'),low:number(p.low,'最低值'),high:number(p.high,'最高值')};if(row.low>Math.min(row.open,row.close)||row.high<Math.max(row.open,row.close))fail('开高低收数据的范围不一致');return row;});
  if(d.hierarchy!==undefined)data.hierarchy=hierarchy(d.hierarchy,0,{n:0},topologyOnly);
  if(d.nodes!==undefined)data.nodes=nodes(d.nodes);else if(d.links!==undefined&&out.nodes.length)data.nodes=out.nodes;if(d.links!==undefined)data.links=edges(d.links,data.nodes||[],topologyOnly);
  if(d.calendar!==undefined)data.calendar=arrays(d.calendar,400,'日期数据').map(p=>({date:text(p.date,10,'日期'),value:number(p.value,'日期数值')}));
  if(d.river!==undefined)data.river=arrays(d.river,1000,'主题数据').map(p=>({date:text(p.date,10,'日期'),name:text(p.name,80,'主题'),value:number(p.value,'主题数值')}));
  if(d.value!==undefined)data.value=number(d.value,'指标值');for(const key of ['minimum','maximum'])if(d[key]!==undefined)data[key]=number(d[key],'仪表范围');
  if(out.chartType==='gauge'&&(data.minimum===undefined||data.maximum===undefined)){if(!/%|百分/.test(snapshot.text))fail('仪表盘需要给出最小值、最大值与计量单位');data.minimum=0;data.maximum=100;}

  if(['sunburst','treemap'].includes(out.chartType)&&!data.hierarchy)fail('层级图缺少分类关系');
  out.referenceLines=arrays(f.referenceLines||[],8,'参考线').map(r=>({label:text(r.label,80,'参考线名称'),value:number(r.value,'参考线数值'),...(color(r.color)?{color:color(r.color)}:{})}));
  // An empty optional range contains no author instruction. Keep the native
  // automatic scale, while still rejecting partial or fabricated numeric ranges.
  out.yRange=!['bar','horizontal-bar','pictorial-bar','line','area','scatter','histogram'].includes(out.chartType)||f.yRange==null||object(f.yRange)&&!Object.keys(f.yRange).length?null:{min:number(f.yRange.min,'坐标最小值'),max:number(f.yRange.max,'坐标最大值'),interval:number(f.yRange.interval,'坐标间隔')};
  if(out.yRange&&(out.yRange.max<=out.yRange.min||out.yRange.interval<=0||(out.yRange.max-out.yRange.min)/out.yRange.interval>30))fail('坐标范围或间隔无效');
  if(out.referenceLines.length&&!['line','bar','scatter'].includes(out.chartType))fail('此图种不支持参考线');
  out.data=data;if(!topologyOnly&&['chord','sunburst','treemap'].includes(out.chartType)&&numericValues(data).length)out.qualitative=false;out.xLabel=optional(f.xLabel,100,'横轴名称');out.yLabel=optional(f.yLabel,100,'纵轴名称');out.unit=optional(f.unit,40,'计量单位');
  if(!out.qualitative&&!numericValues(data).length)fail('数据图没有可绘制的数值；概念图请使用结构示意方式');
  if(verifyEvidence)for(const value of [...numericValues(data),...(['line','area'].includes(out.chartType)?numericLineCoordinates(data.categories)||[]:[]),...out.referenceLines.map(r=>r.value),...(out.yRange?[out.yRange.min,out.yRange.max]:[])])if(!(out.chartType==='gauge'&&/%|百分/.test(snapshot.text)&&[0,100].includes(value))&&!sourceHasNumber(snapshot.text,value))fail('发现原始描述中没有的数据 '+value+'，请仅按用户提供的数据绘制');
  if(out.qualitative&&!['sunburst','treemap','chord'].includes(out.chartType))fail('这个数据图需要作者给出明确数值');
  if(out.chartType==='chord'&&(!data.nodes?.length||!data.links?.length))fail('和弦图缺少节点或连接');
  if(out.yRange){const vals=out.chartType==='scatter'&&data.points?data.points.map(p=>p.y):numericValues(data);if(vals.some(v=>v<out.yRange.min||v>out.yRange.max))fail('坐标范围会截断原始数据');}
  out.dataVerified=verifyEvidence;
 }
 if(kind==='illustration'){
  out.description=text(f.description,4000,'插图说明');out.artworkDescription=text(f.artworkDescription,4000,'artworkDescription（独立无字画面说明）');out.requiredObjects=arrays(f.requiredObjects||[],20,'必要对象').map(v=>text(v,120,'必要对象'));out.labels=arrays(f.labels||[],20,'插图标注').map(v=>text(v,80,'插图标注'));
  if(!out.requiredObjects.length)fail('科研插图需要明确的必要对象');
  const profile=publicationProfile(snapshot.context?.journalProfile||'general');if(profile.aiIllustration==='not-permitted')fail('当前规范不接受通用生成式 AI 插图，请改用可复现的数据图或文本结构图。');
 }
 if(JSON.stringify(out).length>80000)fail('绘图结构过大，请减少单图内容');return out;
}
export function publicationFigurePlanTask(snapshot){
 const choice=researchFigureSelection(snapshot);if(!choice)fail('所选绘图类型无效');const preferred=publicationFigureKind(choice),profile=publicationProfile(snapshot.context?.journalProfile||'general');
 return {skill:'tool-task',title:'科研图内容与版式规划',instructions:[
  '将作者提供的内容转成一张科学准确、可核验、便于投稿的图。这里只提交JSON绘图计划，不生成代码，不运行软件。',
  `用户选择：${choice.categoryLabel} / ${choice.label}。具体要求：${choice.description}。${choice.guidance||''}。优先判断的图类：${preferred}。`,
  scientificFigureStyle(choice),
  '数值图必须用chart，全部数值必须逐项来自原文；不得补造实验结果、系数、准确率、误差线、显著性、样本量或未提供的数据。标题、坐标和单位也不能假称实测。',
  '流程、实体、网络、控制框图、概念路径及图表教学结构，使用diagram；时序或用户旅程使用sequence。概念结构不需要伪造数值。每个元素都要与主题、场景相符，不套通用研究流程。',
  '需要空间、材料、器官、装置或机理画面时用illustration；仅表达作者提供的概念，不生成伪实验照片或未经提供的结构测定结果。说明必要对象、方位、箭头和科学关系。illustration必须另给artworkDescription，无论用户语言都必须使用英文，只描述视觉对象与运动，不写标签、文字、标题、分镜名称或软件名称，也不要引用labels中的词。需要显示的短标注仅放在labels数组，必须使用用户选择的语言（中文时禁止使用英文阶段名称），由程序排字，不能要求图像模型绘制任何字符。artworkDescription中禁止写label、text、caption、标注和标签等绘字指令，只描述对象外形、颜色、空间位置和运动。',
  `输出语言：${snapshot.language}。规范：${profile.label}。文字只保留必要的短标注；作品名称不放在画面顶端，不加宣传语、UI、水印或长说明。`,
  '图中关系必须正确，反馈方向、主外键、继承关系、时序先后、电流和光路按实际语义表达。元素一般控制在12个以内。requiredObjects只用于插图，nodes/edges用于结构与时序。',
  planSchemaInstructions(choice),
  '重要：sunburst、treemap没有权重而只有分类时，仍用chart和hierarchy，qualitative:true，不要提供value，不用diagram冒充。chord没有权重时使用chart，qualitative:true，nodes和links不填value。数值坐标控制图用line并在referenceLines:[{label,value}]写入每条给定控制限，在yRange:{min,max,interval}写入作者明确要求的范围和刻度。',
  'sequence必须用nodes和edges，返回消息的kind为return，不能用async代替return；四象限matrix图用diagram，四个区域节点position为top-left、top-right、bottom-left、bottom-right，另两个坐标轴节点position为x-axis、y-axis。position仅用于定位，不绘成标签；四象限只提交六个带名称的节点，不另加原点，不提交几何轴线edges，坐标轴由程序绘制。',
  'sequence的alt/loop条件放在fragments:[{label:"alt",branches:[{label:"成功",start:3,end:6},{label:"失败",start:7,end:8}]}]，start/end是edges中从0开始的索引，每条消息必须精确反映方向、调用/返回。timeline与journey不要误画成多个参与者相互调用，应使用diagram，以节点顺序与属性表示时间或阶段。',
  'gauge在data.minimum和data.maximum中给出作者指定量程，unit写明单位；只有明确百分比时才使用0到100及%。series中color可指定序列颜色。',
  '所有需要颜色的连接在edges或data.links中用color:"#RRGGBB"精确标识，referenceLines也可用color字段；标签若作者要求显示数值，应把数值一起写入label。不要忽略作者明确要求的配色。state的初始/终止节点用role:start/end，不在属性中写initial/final，允许空标签。',
  '电路符号、空间、部件与反应机理的专业示意可用illustration，描述必需对象、数量、位置、阶段一致性、标签与连接。描述为待生成的绘图指令，不是声称已生成成功。图种真实特征不能用方框流程代替。',
  'chartType可选：'+publicationChartTypes.join('、')+'。links使用from/to/value，nodes使用id/label。boxplot输入每组原始观测值，由程序计算四分位数和异常点。parallel的series.values是二维数据行。heatmap的matrix是行列数一致的数值矩阵。',
  '如果描述缺少绘制目标所必需的数据，返回{complete:false,needs:"需要作者补充的具体字段"}，不能用虚构数据绕过检查。概念和教学图可用qualitative:true的结构图，不宣称是测量结果。'
 ].join('\n'),context:{operation:'publication_figure_plan',title:snapshot.title,figureType:choice.label,outputSchema:'complete:true and figure as described'},materials:[{id:'figure-brief',name:'作者提供的绘图说明',text:snapshot.text}]};
}
