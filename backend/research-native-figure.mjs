import * as echarts from 'echarts';
import {instance as graphvizInstance} from '@viz-js/viz';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
process.env.FONTCONFIG_FILE ||= fileURLToPath(new URL('./research-fonts.conf',import.meta.url));
import {publicationProfile} from './research-publication-policy.mjs';
import {numericLineCoordinates} from './research-figure-plan.mjs';
const invalid=message=>{throw Object.assign(Error(message),{status:422,code:'figure_render_invalid'});};
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const colors=['#0072B2','#D55E00','#009E73','#CC79A7','#E69F00','#56B4E9','#333333'];
const palette=s=>({academic:colors,blue:['#0072B2','#0096a8','#425c9b','#677795','#56B4E9','#243c55'],nature:['#007f64','#336b9b','#729a44','#596d80','#56b4b0','#364e46'],warm:['#bd5d16','#a44a64','#807043','#ca8c31','#76618a','#6d5148']}[s.context?.palette]||colors);
const nodeFill=s=>({academic:'#f2f7fc',blue:'#eaf4fb',nature:'#edf7f2',warm:'#fff4e8'}[s.context?.palette]||'#f2f7fc');
const fontFamily='Noto Sans SC,Noto Sans CJK SC,sans-serif';
let graphviz;
const quantile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b),n=(sorted.length-1)*p,i=Math.floor(n);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(n-i);};
export function figureCanvas(snapshot){const profile=publicationProfile(snapshot.context?.journalProfile||'general'),ratio={'16:9':16/9,'4:3':4/3,'1:1':1,'3:4':3/4}[snapshot.context?.aspectRatio]||16/9,width=1200,height=Math.round(width/ratio),fontPx=profile.fontPt*25.4/72*width/profile.widthMm;return {width,height,profile,fontPx,fontFamily};}
function cartesian(plan,c){const f=c.fontPx,bottom=plan.xLabel?f*4.2:f*3.2;return {grid:{left:Math.max(75,f*5.2),right:Math.max(45,f*3),top:Math.max(54,f*3.5),bottom,containLabel:false},xAxis:{type:'category',data:plan.data.categories||[],name:plan.xLabel,nameLocation:'middle',nameGap:f*2.5,nameTextStyle:{fontSize:f,color:'#1f2937'},axisLabel:{fontSize:f,color:'#1f2937',hideOverlap:false,margin:10},axisLine:{lineStyle:{color:'#475569',width:1.2}},axisTick:{alignWithLabel:true},splitLine:{show:false}},yAxis:{type:'value',name:plan.yLabel+(plan.unit?' ('+plan.unit+')':''),nameLocation:'middle',nameGap:f*3.9,nameTextStyle:{fontSize:f,color:'#1f2937'},axisLabel:{fontSize:f,color:'#1f2937'},axisLine:{show:true,lineStyle:{color:'#475569',width:1.2}},axisTick:{show:true},splitLine:{show:true,lineStyle:{color:'#e2e8f0',width:1,type:'dashed'}}}};}
export function publicationChartOption(plan,snapshot){
 const c=figureCanvas(snapshot),f=c.fontPx,d=plan.data,type=plan.chartType,colors=palette(snapshot);
 const option={animation:false,color:colors,backgroundColor:'#ffffff',textStyle:{fontFamily,fontSize:f,color:'#1f2937'},tooltip:{show:false},legend:{show:(d.series?.length||0)>1,top:8,textStyle:{fontFamily,fontSize:f,color:'#1f2937'},itemWidth:f*1.3,itemHeight:f*.7,itemGap:f},aria:{enabled:true,decal:{show:false}},series:[]};
 const series=d.series||[];const categories=d.categories||[];
 const categorical=()=>{if(!categories.length||!series.length||series.some(s=>s.values.length!==categories.length||s.values.some(Array.isArray)))invalid('分类与数据系列的数量不一致');};
 if(['bar','horizontal-bar','pictorial-bar','line','area'].includes(type)){
  categorical();Object.assign(option,cartesian(plan,c));const horizontal=type==='horizontal-bar';if(horizontal){const x=option.xAxis;option.xAxis={...option.yAxis,name:plan.xLabel||plan.unit||'',nameGap:f*2.5};option.yAxis={...x,name:plan.yLabel,nameGap:f*4.3};}
  if(type==='bar'||horizontal||type==='pictorial-bar'){const axis=horizontal?option.xAxis:option.yAxis;axis.min=Math.min(0,...series.flatMap(s=>s.values));}
  option.series=series.map((s,i)=>({type:type==='line'||type==='area'?'line':type==='pictorial-bar'?'pictorialBar':'bar',...(type==='pictorial-bar'?{symbol:'rect',symbolRepeat:true,symbolMargin:2,symbolSize:['80%',8],symbolClip:true}:{}),name:s.name,data:s.values,barMaxWidth:Math.max(22,85/series.length),symbol:['circle','rect','triangle','diamond'][i%4],symbolSize:Math.max(7,f*.42),showSymbol:true,smooth:false,lineStyle:{width:Math.max(2,f*.12),type:i%2?'dashed':'solid',...(s.color?{color:s.color}:{})},itemStyle:{borderColor:'#ffffff',borderWidth:1},...(type==='area'?{areaStyle:{opacity:.16}}:{}),...(false?{label:{show:true,position:horizontal?'right':'top',fontSize:f,color:'#1f2937'}}:{})}));
  // Numerical coordinates (e.g. ROC or frequency samples) must retain their
  // actual spacing, rather than becoming equally spaced categorical labels.
  const x=['line','area'].includes(type)&&numericLineCoordinates(categories);
  if(x){
   option.xAxis={...option.xAxis,type:'value',data:undefined,min:x[0],max:x.at(-1),boundaryGap:false,...(x.every(Number.isInteger)?{minInterval:1}:{})};
   option.series.forEach((s,i)=>s.data=series[i].values.map((value,j)=>[x[j],value]));
  }
 }else if(type==='scatter'){
  if(!d.points?.length)invalid('散点图需要明确的数据点');Object.assign(option,cartesian(plan,c));option.xAxis={...option.xAxis,type:'value',data:undefined};option.series=[{type:'scatter',symbolSize:Math.max(8,f*.5),itemStyle:{color:colors[0],opacity:.9},data:d.points.map(p=>[p.x,p.y])}];
 }else if(type==='pie'){
  categorical();if(series.length!==1||series[0].values.some(v=>v<0)||series[0].values.every(v=>v===0))invalid('组成图需要一组非负且总和大于0的数据');const total=series[0].values.reduce((sum,v)=>sum+v,0),samePercent=plan.unit==='%'&&Math.abs(total-100)<1e-9;option.legend={...option.legend,show:true,orient:'vertical',right:8,top:'middle'};option.series=[{type:'pie',radius:['0%','66%'],center:['40%','50%'],startAngle:90,minAngle:0,avoidLabelOverlap:true,label:{show:true,position:'outside',fontSize:f,color:'#1f2937',formatter:'{b}: {c}'+(plan.unit||'')+(plan.showPercentage&&!samePercent?' ({d}%)':'')},labelLine:{length:16,length2:14,lineStyle:{width:1.5,color:'#64748b'}},itemStyle:{borderWidth:2,borderColor:'#ffffff'},data:categories.map((name,i)=>({name,value:series[0].values[i]}))}];
 }else if(type==='radar'){
  categorical();if(categories.length<3)invalid('雷达图至少需要三个维度');const max=Math.max(...series.flatMap(s=>s.values));if(max<=0||series.some(s=>s.values.some(v=>v<0)))invalid('雷达图需要非负指标值');option.radar={radius:'66%',center:['50%','54%'],indicator:categories.map(name=>({name,max:Math.ceil(max)})),axisName:{fontSize:f,color:'#1f2937'},splitNumber:5,axisLine:{lineStyle:{color:'#a8b3c2'}},splitLine:{lineStyle:{color:'#d9e1ec'}},splitArea:{show:false}};option.series=[{type:'radar',data:series.map((s,i)=>({name:s.name,value:s.values,symbol:['circle','rect','triangle'][i%3],symbolSize:7,lineStyle:{width:2,type:i%2?'dashed':'solid'},areaStyle:{opacity:.07}}))}];
 }else if(type==='heatmap'){
  if(!d.rows?.length||!d.columns?.length||d.matrix?.length!==d.rows.length||d.matrix.some(row=>row.length!==d.columns.length))invalid('热力图矩阵必须与行列标签一致');const values=d.matrix.flat();Object.assign(option,cartesian(plan,c));option.grid.right=f*5;option.xAxis.data=d.columns;option.yAxis={...option.xAxis,type:'category',data:[...d.rows].reverse(),name:plan.yLabel,nameGap:f*3.9};option.visualMap={min:Math.min(...values),max:Math.max(...values),calculable:false,orient:'vertical',right:0,top:'middle',itemHeight:c.height*.5,itemWidth:14,textStyle:{fontSize:f*.9,color:'#1f2937'},inRange:{color:['#f7fbff','#c6dbef','#6baed6','#2171b5','#08306b']}};option.series=[{type:'heatmap',data:d.matrix.flatMap((row,y)=>row.map((value,x)=>[x,d.rows.length-1-y,value])),label:{show:true,fontSize:f,color:'#111827'},itemStyle:{borderWidth:2,borderColor:'#ffffff'}}];
 }else if(type==='boxplot'){
  if(!series.length||series.some(s=>s.values.length<4||s.values.some(Array.isArray)))invalid('盒须图每组至少需要四个原始观测值');Object.assign(option,cartesian(plan,c));option.xAxis.data=series.map(s=>s.name);const outliers=[];option.series=[{type:'boxplot',boxWidth:['25%','55%'],itemStyle:{color:'#e9f1fb',borderColor:colors[0],borderWidth:2},data:series.map((s,i)=>{const v=[...s.values].sort((a,b)=>a-b),q1=quantile(v,.25),median=quantile(v,.5),q3=quantile(v,.75),iqr=q3-q1,inside=v.filter(x=>x>=q1-1.5*iqr&&x<=q3+1.5*iqr);for(const value of v)if(!inside.includes(value))outliers.push([i,value]);return [inside[0],q1,median,q3,inside.at(-1)];})},{type:'scatter',symbolSize:6,itemStyle:{color:colors[1]},data:outliers}];
 }else if(type==='candlestick'){
  if(!d.ohlc?.length)invalid('K线图需要开盘、收盘、最低和最高值');Object.assign(option,cartesian(plan,c));option.xAxis.data=d.ohlc.map(p=>p.name);option.series=[{type:'candlestick',data:d.ohlc.map(p=>[p.open,p.close,p.low,p.high]),itemStyle:{color:colors[1],color0:'#ffffff',borderColor:colors[1],borderColor0:colors[0],borderWidth:2}}];
 }else if(type==='gauge'){
  if(d.value===undefined||!Number.isFinite(d.minimum)||!Number.isFinite(d.maximum)||d.minimum>=d.maximum||d.value<d.minimum||d.value>d.maximum)invalid('仪表数值必须在作者给定的量程内');option.series=[{type:'gauge',startAngle:180,endAngle:0,min:d.minimum,max:d.maximum,center:['50%','68%'],radius:'83%',progress:{show:true,width:20,itemStyle:{color:colors[0]}},axisLine:{lineStyle:{width:20,color:[[1,'#e6edf5']]}},axisTick:{show:false},splitLine:{distance:0,length:12,lineStyle:{width:1,color:'#64748b'}},axisLabel:{distance:28,fontSize:f,color:'#475569'},pointer:{show:false},detail:{fontSize:f*2.3,offsetCenter:[0,-f/2],formatter:'{value}'+plan.unit,color:'#1f2937'},data:[{value:d.value}]}];
 }else if(type==='treemap'||type==='sunburst'){
  if(!d.hierarchy)invalid('层级图需要明确的层级与数值');const shades=colors.map(hex=>'#'+[1,3,5].map(at=>Math.round(parseInt(hex.slice(at,at+2),16)*.35+255*.65).toString(16).padStart(2,'0')).join(''));
  const weighted=(n,depth=0,color='#eef2f6')=>({...n,itemStyle:{color,borderColor:'#ffffff',borderWidth:3},...(plan.qualitative?{value:n.children?.length?undefined:1}:{}),...(n.children?{children:n.children.map((child,i)=>weighted(child,depth+1,depth===0?shades[i%shades.length]:color))}:{})});const tree=[weighted(d.hierarchy)];option.series=[{type,data:tree,...(type==='treemap'?{top:14,bottom:14,left:14,right:14,roam:false,nodeClick:false,breadcrumb:{show:false},upperLabel:{show:true,fontSize:f},label:{show:true,fontSize:f,color:'#111827'},itemStyle:{borderColor:'#ffffff',borderWidth:3,gapWidth:3}}:{radius:['0%','86%'],label:{fontSize:f,rotate:0,color:'#111827'},itemStyle:{borderColor:'#ffffff',borderWidth:2},sort:null})}];
 }else if(type==='sankey'||type==='chord'){
  if(!d.nodes?.length||!d.links?.length||d.links.some(l=>!plan.qualitative&&(l.value===undefined||l.value<0)))invalid('流向或关联强度图需要明确的非负连接数值');option.series=[{type:'sankey',left:f*6,right:f*8,top:30,bottom:30,nodeWidth:18,nodeGap:30,draggable:false,emphasis:{disabled:true},label:{fontSize:f,color:'#1f2937'},lineStyle:{color:'source',opacity:.35,curveness:.45},data:d.nodes.map(n=>({name:n.id,label:{formatter:n.label}})),links:d.links.map(l=>({source:l.from,target:l.to,value:l.value}))}];if(type==='sankey'){
   const state=new Map(),adj=new Map(d.nodes.map(n=>[n.id,[]]));for(const e of d.links)adj.get(e.from).push(e.to);const visit=id=>{if(state.get(id)===1)invalid('桑基图中存在循环，请改用关系图');if(state.get(id)===2)return;state.set(id,1);for(const to of adj.get(id))visit(to);state.set(id,2);};for(const n of d.nodes)visit(n.id);
  }
  if(type==='chord')option.series=[{type:'chord',radius:['62%','66%'],center:['50%','50%'],padAngle:5,startAngle:90,label:{show:true,fontSize:f,color:'#1f2937',distance:f*.65,rotate:false},lineStyle:{opacity:.45},itemStyle:{borderWidth:1,borderColor:'#ffffff'},data:d.nodes.map(n=>({name:n.label})),links:d.links.map(l=>({source:d.nodes.find(n=>n.id===l.from).label,target:d.nodes.find(n=>n.id===l.to).label,value:plan.qualitative?1:l.value,...(l.color?{lineStyle:{color:l.color,opacity:.85}}:{})}))}];
 }else if(type==='funnel'){
  categorical();if(series.length!==1||series[0].values.some(v=>v<0))invalid('漏斗图需要一组非负阶段值');option.series=[{type:'funnel',sort:'none',left:'20%',width:'60%',top:24,bottom:24,gap:3,label:{show:true,position:'inside',fontSize:f,color:'#111827',formatter:'{b}: {c}'},data:categories.map((name,i)=>({name,value:series[0].values[i]}))}];
 }else if(type==='parallel'){
  if(!d.dimensions?.length||!series.length||series.some(s=>s.values.some(v=>!Array.isArray(v)||v.length!==d.dimensions.length)))invalid('平行坐标的数据列须与维度一致');option.parallel={left:85,right:85,top:70,bottom:65,parallelAxisDefault:{nameTextStyle:{fontSize:f,color:'#1f2937'},axisLabel:{fontSize:f*.9},axisLine:{lineStyle:{color:'#94a3b8'}}}};option.parallelAxis=d.dimensions.map((name,dim)=>({dim,name,type:'value'}));option.series=series.map((s,i)=>({type:'parallel',name:s.name,lineStyle:{width:2,opacity:.8,type:i%2?'dashed':'solid'},data:s.values}));
 }else if(type==='calendar'){
  if(!d.calendar?.length||d.calendar.some(p=>!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||Number.isNaN(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date))invalid('日历图需要有效日期与对应数值');const values=d.calendar.map(p=>p.value),dates=d.calendar.map(p=>p.date).sort();option.calendar={top:70,left:85,right:85,bottom:70,range:[dates[0],dates.at(-1)],cellSize:['auto','auto'],yearLabel:{show:false},dayLabel:{fontSize:f*.8,color:'#1f2937',firstDay:1},monthLabel:{fontSize:f,color:'#1f2937'},itemStyle:{color:'#f1f5f9',borderColor:'#ffffff',borderWidth:2}};option.visualMap={min:Math.min(...values),max:Math.max(...values),orient:'horizontal',left:'center',bottom:5,inRange:{color:['#e8f2fc','#73b5d7','#0072B2']},textStyle:{fontSize:f*.8}};option.series=[{type:'heatmap',coordinateSystem:'calendar',data:d.calendar.map(p=>[p.date,p.value])}];
 }else if(type==='river'){
  if(!d.river?.length)invalid('主题河流图需要每个日期对应的主题数值');option.singleAxis={type:'time',left:75,right:40,bottom:60,axisLabel:{fontSize:f,color:'#1f2937'},splitLine:{show:false}};option.legend={...option.legend,show:true,data:[...new Set(d.river.map(p=>p.name))]};option.series=[{type:'themeRiver',data:d.river.map(p=>[p.date,p.value,p.name]),label:{show:false},itemStyle:{borderWidth:1,borderColor:'#ffffff'}}];
 }else if(type==='histogram'){
  if(series.length!==1||series[0].values.some(Array.isArray))invalid('直方图需要一组原始数值');const v=series[0].values,min=Math.min(...v),max=Math.max(...v),bins=Math.max(1,Math.ceil(Math.sqrt(v.length))),width=(max-min||1)/bins,counts=Array(bins).fill(0);for(const x of v)counts[Math.min(bins-1,Math.floor((x-min)/width))]++;const derived={...plan,data:{categories:counts.map((_,i)=>(min+i*width).toPrecision(3)+'–'+(min+(i+1)*width).toPrecision(3)),series:[{name:series[0].name,values:counts}]},chartType:'bar'};return publicationChartOption(derived,snapshot);
 }else invalid('图表类型没有可复现的渲染方法');
 if(plan.yRange){const axis=type==='horizontal-bar'?option.xAxis:option.yAxis;if(axis?.type==='value')Object.assign(axis,plan.yRange);}
 if(plan.referenceLines?.length){if(option.grid)option.grid.right=f*5.5;if(!option.series[0])invalid('参考线缺少主图');option.series[0].markLine={silent:true,symbol:'none',lineStyle:{width:2,type:'dashed',color:'#5f6b7a'},label:{show:true,fontSize:f,color:'#243c55',formatter:p=>p.name,position:'end'},data:plan.referenceLines.map(r=>({name:r.label,yAxis:r.value,...(r.color?{lineStyle:{color:r.color}}:{})}))};}
 return option;
}
function wrapLabel(value,max=18){return String(value).split('\n').flatMap(line=>{
 const tokens=line.match(/[A-Za-z0-9][A-Za-z0-9_.+/-]*|\s+|[^\x00-\x7f]|./gu)||[],rows=[];let row='';
 for(const token of tokens){if(/^\s+$/.test(token)){if(row&&!row.endsWith(' '))row+=' ';continue;}
  if(row.trim()&&Array.from(row+token).length>max){rows.push(row.trim());row='';}row+=token;
 }if(row.trim())rows.push(row.trim());return rows.length?rows:[''];
}).join('\n');}
function graphSource(plan,snapshot){const c=figureCanvas(snapshot),pt=c.fontPx,quote=v=>JSON.stringify(String(v)),ids=new Map(plan.nodes.map((n,i)=>[n.id,'n'+i]));const lines=[`digraph figure { graph [bgcolor="white",fontname="Arial",rankdir=${plan.layout==='TB'?'TB':'LR'},nodesep=0.25,ranksep=0.35,pad=0.18,splines=polyline]; node [shape=box,style="rounded,filled",fillcolor="${nodeFill(snapshot)}",color="#52667d",fontcolor="#172b42",fontname="Arial",fontsize=${pt},penwidth=0.8,margin="0.08,0.04"]; edge [color="#536981",fontcolor="#243c55",fontname="Arial",fontsize=${pt},penwidth=0.8,arrowsize=0.65];`];
 for(const n of plan.nodes){const shape=n.role==='decision'?'diamond':n.role==='start'?'circle':n.role==='end'?'doublecircle':'box',label=wrapLabel([n.label,...n.attributes].join('\n'),snapshot.language==='English'?12:18);const table=snapshot.context?.figureType==='class'||snapshot.context?.figureType==='er',attributes=n.attributes.filter(v=>!/[()]/.test(v)),methods=n.attributes.filter(v=>/[()]/.test(v)),html=`<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="6"><TR><TD>${esc(n.label)}</TD></TR>${(snapshot.context?.figureType==='class'?[attributes,methods]:[n.attributes]).map(group=>`<TR><TD ALIGN="LEFT">${group.length?group.map(esc).join('<BR ALIGN="LEFT"/>'):' '}</TD></TR>`).join('')}</TABLE>>`;
  const rows=label.split('\n'),glyphWidth=t=>Array.from(t).reduce((w,ch)=>w+(/[^\x00-\xff]/.test(ch)?1:/[MW@]/.test(ch)?.95:.62),0)*pt,minWidth=(Math.max(...rows.map(glyphWidth))+pt*1.1)*(n.role==='decision'?1.5:1),minHeight=(rows.length*pt*1.4+pt*.8)*(n.role==='decision'?1.3:1);
  lines.push(`${ids.get(n.id)} [width=${minWidth/72},height=${minHeight/72},shape=${table?'plain':shape},label=${table?html:quote(n.role==='start'||n.role==='end'?'':label)}${(n.role==='start'||n.role==='end')&&n.label?',xlabel='+quote(n.label):''}${n.role==='start'?',width=0.16,height=0.16,fixedsize=true,fillcolor="#172b42"':''}${n.role==='end'?',width=0.20,height=0.20,fixedsize=true,fillcolor="white"':''}];`);}
 for(const e of plan.edges){const attrs=[`label=${quote(wrapLabel(e.label,14))}`];if(e.kind==='undirected'||e.kind==='association')attrs.push('dir=none');if(e.kind==='feedback'||e.kind==='dependency'||e.kind==='return')attrs.push('style=dashed');if(e.kind==='inheritance')attrs.push('arrowhead=empty');if(e.kind==='composition')attrs.push('dir=both,arrowtail=diamond,arrowhead=none');if(e.kind==='aggregation')attrs.push('dir=both,arrowtail=odiamond,arrowhead=none');lines.push(`${ids.get(e.from)} -> ${ids.get(e.to)} [${attrs.join(',')}];`);}lines.push('}');return lines.join('\n');}
function gridDiagram(plan,snapshot){const c=figureCanvas(snapshot),{width,height,fontPx:f}=c,n=plan.nodes.length,cols=Math.min(n,n<=4?n:3),rows=Math.ceil(n/cols),pad=45,gapX=60,gapY=70,w=(width-pad*2-gapX*(cols-1))/cols,h=Math.min(110,(height-pad*2-gapY*(rows-1))/rows);if(h<f*2.2)invalid('单张图中的元素过多，无法保证投稿字号');const positions=new Map(),lines=[];
 for(const [i,node]of plan.nodes.entries()){const row=Math.floor(i/cols),column=i%cols,x=pad+column*(w+gapX),y=pad+row*(h+gapY);positions.set(node.id,{x,y,w,h});const labels=wrapLabel(node.label,Math.max(8,Math.floor(w/f*.9))).split('\n');if(labels.length*f*1.3>h-14)invalid('元素标注过长，请使用简洁术语');lines.push(`<g data-node="${esc(node.id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${nodeFill(snapshot)}" stroke="#536981" stroke-width="1.5"/>${labels.map((v,j)=>`<text x="${x+w/2}" y="${y+h/2+(j-(labels.length-1)/2)*f*1.3}" text-anchor="middle" dominant-baseline="middle" font-size="${f}">${esc(v)}</text>`).join('')}</g>`);}
 const connectors=plan.edges.map(e=>{const a=positions.get(e.from),b=positions.get(e.to),same=Math.abs(a.y-b.y)<1,x1=same?a.x+a.w:a.x+a.w/2,y1=same?a.y+a.h/2:a.y+a.h,x2=same?b.x:b.x+b.w/2,y2=same?b.y+b.h/2:b.y;return `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="#536981" stroke-width="1.8" marker-end="url(#arrow)"/>${e.label?`<text x="${(x1+x2)/2}" y="${(y1+y2)/2-f*.4}" text-anchor="middle" font-size="${f*.95}">${esc(e.label)}</text>`:''}`;});return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#536981"/></marker></defs><g font-family="${fontFamily}" fill="#172b42">${connectors.join('')}${lines.join('')}</g></svg>`;}
function quadrantDiagram(plan,snapshot){
 const {width,height,fontPx:f}=figureCanvas(snapshot),slots=['top-left','top-right','bottom-left','bottom-right'];
 const xAxis=plan.nodes.find(n=>n.position==='x-axis'),yAxis=plan.nodes.find(n=>n.position==='y-axis');
 const quadrants=plan.nodes.filter(n=>slots.includes(n.position));
 if(!xAxis||!yAxis||quadrants.length!==4||new Set(quadrants.map(n=>n.position)).size!==4||plan.nodes.length!==6||plan.edges.length)invalid('四象限图需要四个明确区域和横纵轴名称，请用position标明各区域');
 const left=90,top=35,w=width-left-35,h=height-top-85,cx=left+w/2,cy=top+h/2;
 const parts=[`<rect width="100%" height="100%" fill="white"/>`,`<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="${nodeFill(snapshot)}" stroke="#536981" stroke-width="1.5"/>`,`<path d="M${cx},${top} V${top+h} M${left},${cy} H${left+w}" fill="none" stroke="#536981" stroke-width="1.5"/>`];
 for(const n of quadrants){const i=slots.indexOf(n.position),x=left+w*(i%2?.75:.25),y=top+h*(i<2?.25:.75),rows=wrapLabel([n.label,...n.attributes].join('\n'),snapshot.language==='English'?32:16).split('\n');
  if(rows.length*f*1.4>h/2-30)invalid('四象限文字过密，请缩短区域说明');
  parts.push(`<g data-quadrant="${n.position}">${rows.map((row,j)=>`<text x="${x}" y="${y+(j-(rows.length-1)/2)*f*1.4}" text-anchor="middle" dominant-baseline="middle" font-size="${f}">${esc(row)}</text>`).join('')}</g>`);
 }
 parts.push(`<text x="${cx}" y="${height-25}" text-anchor="middle" font-size="${f}">${esc(xAxis.label)}</text>`,`<text x="28" y="${cy}" text-anchor="middle" font-size="${f}" transform="rotate(-90 28 ${cy})">${esc(yAxis.label)}</text>`);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="${fontFamily}" fill="#172b42">${parts.join('')}</g></svg>`;
}
function sequenceDiagram(plan,snapshot){
 const c=figureCanvas(snapshot),{width,height,fontPx:f}=c,pad=150,col=(width-pad*2)/(plan.nodes.length-1),top=125,rowH=(height-top-55)/(plan.edges.length+1),positions=new Map(plan.nodes.map((n,i)=>[n.id,pad+i*col]));
 if(rowH<f*2.3||col<f*4)invalid('当前时序图内容过密，请减少单图参与者或消息');
 const parts=[`<rect width="100%" height="100%" fill="white"/>`];
 for(const g of plan.fragments||[]){
  if(!g.branches.length)continue;const start=Math.min(...g.branches.map(b=>b.start)),end=Math.max(...g.branches.map(b=>b.end)),y=top+(start+.3)*rowH,bottom=top+(end+1.45)*rowH;
  parts.push(`<rect x="18" y="${y}" width="${width-36}" height="${bottom-y}" fill="none" stroke="#56677b" stroke-width="1.5"/><text x="26" y="${y+f}" font-size="${f}">${esc(g.label)}</text>`);
  for(const [i,b]of g.branches.entries()){const yy=top+(b.start+.3)*rowH;if(i)parts.push(`<path d="M18,${yy} H${width-18}" stroke="#8897a8" stroke-dasharray="5 4"/>`);parts.push(`<text x="${width-30}" y="${yy+f}" text-anchor="end" font-size="${f*.9}">[${esc(b.label)}]</text>`);}
 }
 for(const n of plan.nodes){const x=positions.get(n.id),w=Math.min(260,col*.88),labels=wrapLabel(n.label,Math.max(8,Math.floor((w-20)/(f*(snapshot.language==='English'?.62:1))))).split('\n');if(labels.length>2)invalid('参与者名称过长，请使用简洁名称');parts.push(`<rect x="${x-w/2}" y="26" width="${w}" height="52" rx="4" fill="${nodeFill(snapshot)}" stroke="#536981"/>${labels.map((line,j)=>`<text x="${x}" y="${58+(j-(labels.length-1)/2)*f*1.15}" text-anchor="middle" font-size="${f}">${esc(line)}</text>`).join('')}<path d="M${x},78 V${height-25}" fill="none" stroke="#94a3b8" stroke-dasharray="6 5" stroke-width="1.5"/>`);}
 for(const [i,e]of plan.edges.entries()){const x=positions.get(e.from),to=positions.get(e.to),y=top+(i+1)*rowH,label=wrapLabel(e.label,Math.max(8,Math.floor(((Math.abs(to-x)||140)-24)/(f*(snapshot.language==='English'?.62:1))))).split('\n');if(label.length>2)invalid('时序消息过长，请缩短标注');parts.push(`<path data-edge="${esc(e.from)}:${esc(e.to)}" d="${x===to?`M${x},${y} h60 v20 h-60`:`M${x},${y} H${to}`}" fill="none" stroke="#354f70" stroke-width="1.6" ${e.kind==='return'?'stroke-dasharray="5 4"':''} marker-end="url(#arrow)"/>${label.map((t,j)=>`<text x="${x===to?x+40:(x+to)/2}" y="${y-8-(label.length-1-j)*f*1.15}" text-anchor="middle" font-size="${f}">${esc(t)}</text>`).join('')}`);}
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#354f70"/></marker></defs><g font-family="${fontFamily}" fill="#172b42">${parts.join('')}</g></svg>`;
}
export async function renderPublicationVector(plan,snapshot){
 const c=figureCanvas(snapshot);let svg,source;
 if(plan.kind==='chart'){source=publicationChartOption(plan,snapshot);const chart=echarts.init(null,null,{renderer:'svg',ssr:true,width:c.width,height:c.height});try{chart.setOption(source);
  if(plan.chartType==='chord'){
   const series=chart.getModel().getSeriesByIndex(0),edgeData=series.getEdgeData();
   if(edgeData.count()!==plan.data.links.length)invalid('和弦连接数量与原始关系不一致');
   for(let i=0;i<edgeData.count();i++){
    const edge=series.getGraph().getEdgeByIndex(i),link=plan.data.links[i],element=edgeData.getItemGraphicEl(i),fill=link.color||palette(snapshot)[i%palette(snapshot).length];
    const from=plan.data.nodes.find(n=>n.id===link.from).label,to=plan.data.nodes.find(n=>n.id===link.to).label;
    if(series.getData().getName(edge.node1.dataIndex)!==from||series.getData().getName(edge.node2.dataIndex)!==to)invalid('和弦端点与原始关系不一致');
    if(element){element.setStyle({fill,stroke:'none',opacity:.72});if(element.style.fill!==fill)invalid('和弦配色未能应用');}
    else if(plan.qualitative||link.value>0)invalid('和弦缺少必要连接');
   }
  }
  svg=chart.renderToSVGString();
  if(['sunburst','treemap'].includes(plan.chartType)){
   const tree=chart.getModel().getSeriesByIndex(0).getData().tree;
   tree.eachNode(node=>{const a=node.getLayout(),b=node.parentNode?.getLayout();if(!a||!b)return;
    if(plan.chartType==='sunburst'&&Number.isFinite(a.startAngle)&&Number.isFinite(b.startAngle)&&(a.startAngle<b.startAngle-1e-5||a.endAngle>b.endAngle+1e-5))invalid('层级扇区超出了父级范围');
    if(plan.chartType==='treemap'&&[a.x,a.y,a.width,a.height].some(v=>!Number.isFinite(v)||v<0))invalid('层级矩形位置无效');
   });
  }
 }finally{chart.dispose();}}
 else if(plan.kind==='sequence')svg=sequenceDiagram(plan,snapshot);
 else if(plan.kind==='diagram'&&snapshot.context?.figureType==='matrix')svg=quadrantDiagram(plan,snapshot);
 else if(plan.kind==='diagram'){source=graphSource(plan,snapshot);graphviz ||= await graphvizInstance();svg=graphviz.renderString(source,{format:'svg',engine:plan.layout==='radial'?'twopi':'dot'});svg=svg.replace(/<\?xml[^>]*\?>/g,'').replace(/<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?>/g,'').replace(/<!--[^]*?-->/g,'');}
 else invalid('当前内容不是可编辑的结构图或数据图');
 if(plan.kind==='diagram'&&source){
  const box=svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);if(!box)invalid('结构图画布无效');
  const w=Number(box[3]),h=Number(box[4]),scale=Math.min((c.width-60)/w,(c.height-60)/h,c.profile.maxFontPt/c.profile.fontPt);
  if(scale*c.profile.fontPt<c.profile.minFontPt)invalid('单图标注过密，无法保持清晰字号，请分组或缩短标注');
  const inner=svg.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').replace(/font-family="[^"]*"/g,`font-family="${fontFamily}"`);
  svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><rect width="100%" height="100%" fill="white"/><g transform="translate(${(c.width-w*scale)/2},${(c.height-h*scale)/2}) scale(${scale})">${inner}</g></svg>`;
 }
 if(plan.kind==='diagram'||plan.kind==='sequence'){
  const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&amp;/g,'&');
  const visible=(svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g)||[]).map(v=>decode(v.replace(/<[^>]*>/g,''))).join('').replace(/\s/g,'');
  for(const label of [...plan.nodes.flatMap(n=>[n.label,...n.attributes]),...plan.edges.map(e=>e.label)])if(label&&!visible.includes(label.replace(/\s/g,'')))invalid('成图缺少必要标注：'+label.slice(0,80));
 }
 if(!svg||svg.length>5*1024*1024||/<(?:script|foreignObject|image)\b/i.test(svg)||/\bon\w+\s*=|javascript:|@import/i.test(svg))invalid('矢量输出未通过完整性检查');
 svg=svg.replace(/(<svg\b[^>]*>)/,`$1<metadata>${esc(JSON.stringify({version:1,renderer:plan.kind==='chart'?'echarts-6.1.0':'native-diagram',plan}))}</metadata>`);
 return {svg,source,canvas:c,grammarVerified:true,renderer:plan.kind==='chart'?'echarts-6.1.0':source?'graphviz-wasm':'paperknow-native-1',kind:plan.kind==='chart'?'data':'diagram',vector:true};
}

export async function rasterPublicationVector(result){
 const buffer=await sharp(Buffer.from(result.svg),{density:144,limitInputPixels:12000000}).flatten({background:'#ffffff'}).withMetadata({density:Math.round(result.canvas.width*2/(result.canvas.profile.widthMm/25.4))}).png({compressionLevel:9,adaptiveFiltering:false}).toBuffer();
 return{buffer,imageCount:1};
}
