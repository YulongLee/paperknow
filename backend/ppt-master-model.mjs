import {readFileSync} from 'node:fs';
import {DOMParser} from '@xmldom/xmldom';
import {validatePptMasterSvg} from './ppt-master-runtime.mjs';
import {thesisError} from './thesis-model.mjs';

// The upstream page contract is adapted under MIT; the complete attribution and
// permission notice travel with this server-owned, bounded authoring prompt.
const instructions=readFileSync(new URL('./skills/ppt-master.md',import.meta.url),'utf8');
const fail=message=>{throw thesisError(502,message,'invalid_ppt_master_output');};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const normalizedText=value=>String(value).replace(/\s/gu,'');
const children=node=>Array.from(node.childNodes||[]).filter(child=>child.nodeType===1);
const fields=['id','title','body','layout','notes'];
const themes=Object.freeze({
 academic:{primary:'#18345B',accent:'#286AFF',background:'#FFFFFF',secondary:'#F3F6FC',text:'#172B4D',muted:'#5E6E88',divider:'#DBE3EF'},
 formal:{primary:'#112F45',accent:'#1C4668',background:'#FFFFFF',secondary:'#F1F5F8',text:'#173244',muted:'#5C7180',divider:'#D9E3E9'},
 focus:{primary:'#173E48',accent:'#168B89',background:'#FFFFFF',secondary:'#EEF8F7',text:'#173E48',muted:'#5D777D',divider:'#D4E9E7'},
 slate:{primary:'#243446',accent:'#51647A',background:'#FFFFFF',secondary:'#F0F3F6',text:'#243446',muted:'#647387',divider:'#DCE3EB'},
 indigo:{primary:'#302A50',accent:'#6554A5',background:'#FFFFFF',secondary:'#F4F1FA',text:'#302A50',muted:'#776B91',divider:'#E2DCEE'},
 sand:{primary:'#493829',accent:'#A5733D',background:'#FFFFFF',secondary:'#FAF5ED',text:'#493829',muted:'#88715B',divider:'#E9DDCD'}
});
const compositions=Object.freeze({
 cover:'大字标题与非对称实色主题场，正文作为清楚的副信息，留出大面积呼吸空间。',
 ending:'留白结尾，标题与简练正文形成收束；延续封面母题但改变比例。',
 editorial:'编辑式构图：标题建立强层级，正文用开放分区、竖向规则线和不同宽度组织。',
 split:'非等宽双栏：按既有文字顺序排布语义组，用留白与一条分界建立关系。',
 spotlight:'强调已有重点：让第一条正文获得较强视觉权重，其余文字形成较轻的支撑区。',
 sequence:'顺序模块：按既有文字顺序排布，使用节点与规则线组织；不添加未提供的阶段名称或数字。'
});

function semanticSlide(slide){
 if(!object(slide)||!/^slide-[1-9]\d?$/.test(slide.id)||!['cover','content','twoColumn','closing'].includes(slide.layout))fail('PPT Master 缺少已校验的页面内容');
 const result={};for(const key of fields){const value=slide[key]??(key==='notes'?'':undefined),max=key==='title'?120:key==='body'?1400:key==='notes'?1600:80;if(typeof value!=='string'||value.length>max||key!=='notes'&&!value.trim())fail('PPT Master 页面内容不完整或超出范围');result[key]=value;}
 return result;
}
function originalSourceIds(value,provided){
 const allowed=new Set((value.snapshot?.materials||[]).map(row=>row.id));
 const ids=provided??[...allowed];if(!Array.isArray(ids)||ids.length>20||allowed.size&&!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!allowed.has(id)))fail('PPT Master 页面来源无效');return [...ids];
}

/** A small, deterministic deck lock reuses the accepted semantic content. The
 * model spends its bounded call composing one page, never inventing a new deck. */
export function pptMasterDesignPlan(value,slides,options={}){
 const s=value?.snapshot;if(value?.operation!=='ppt'||!s||!Array.isArray(slides)||slides.length!==s.context?.pages||slides.length<6||slides.length>30)fail('PPT Master 页数与已确认内容不一致');
 const accepted=slides.map(semanticSlide);if(accepted.some((slide,index)=>slide.id!=='slide-'+(index+1)))fail('PPT Master 页面顺序不一致');
 const sourceIds=originalSourceIds(value,options.sourceIds??options.originalSources);
 const theme=Object.hasOwn(themes,s.context?.theme)?s.context.theme:'academic';
 const fontFamily=/^(?:en|english|英语|英文)/i.test(s.language||'')?'Aptos':'Microsoft YaHei';
 const author=s.context?.author??'';if(typeof author!=='string'||author.length>100||/[\u0000-\u001f\u2028\u2029]/u.test(author))fail('PPT Master 作者署名应为不超过100字符的单行文字');
 return {version:1,engine:'ppt-master',canvas:{width:1280,height:720,viewBox:'0 0 1280 720'},theme,palette:{...themes[theme]},typography:{fontFamily,title:46,body:26,caption:16},sourceIds,metadata:{author:author.trim()},
  motif:'标题区保持稳定左边界与短强调线；每页使用相同字体、色板与右下角页码。封面、内容和结尾用面积与留白改变节奏。',
  slides:accepted.map((slide,index)=>{let composition=index===0?'cover':index===accepted.length-1?'ending':slide.layout==='twoColumn'?'split':['editorial','spotlight','split','sequence'][(index-1)%4];if(composition==='sequence'&&!/(?:步骤|流程|路线|阶段|实施|设计|方法|process|method|step|stage|approach)/i.test(slide.title))composition='editorial';return{id:slide.id,page:index+1,role:index===0?'cover':index===accepted.length-1?'ending':'content',composition,reference:compositions[composition],title:slide.title};})};
}

export function pptMasterVisibleContent(slide,plan){
 const accepted=semanticSlide(slide),row=plan?.slides?.find(value=>value.id===accepted.id);if(!row)fail('PPT Master 缺少当前页面设计计划');
 return [{id:'slide-title',text:accepted.title,role:'title'},...accepted.body.split(/\r?\n/).map(text=>text.trim()).filter(Boolean).map((text,index)=>({id:'content-'+(index+1),text,role:'body'})),...(row.role==='cover'&&plan.metadata?.author?[{id:'presentation-author',text:'作者：'+plan.metadata.author,role:'body'}]:[]),{id:'page-number',text:row.page+' / '+plan.slides.length,role:'footer'}];
}
function slideMaterial(slide,plan){const accepted=semanticSlide(slide);return{id:'ppt-master-'+accepted.id,name:'已校验的不可变页面 '+accepted.id,text:JSON.stringify({slide:accepted,evidenceSourceIds:plan.sourceIds})};}

/** Only one derived, immutable page is an authorized material. Its wording was
 * already checked against the original sources by the semantic content stage. */
export function pptMasterSlideTask(value,slide,plan,previous=[]){
 const accepted=semanticSlide(slide),row=plan?.slides?.find(item=>item.id===accepted.id);if(!row||plan.version!==1||plan.engine!=='ppt-master')fail('PPT Master 设计计划无效');
 const material=slideMaterial(accepted,plan),sourceIds=originalSourceIds(value,plan.sourceIds);
 const prior=(Array.isArray(previous)?previous:[]).slice(-2).map(item=>({id:item.id,composition:item.composition||plan.slides.find(row=>row.id===item.id)?.composition||''}));
 return {skill:'tool-task',materials:[material],instructions,context:{operation:'ppt-master-slide',title:value.snapshot.title,language:value.snapshot.language,mode:value.snapshot.mode,
  design:{version:plan.version,canvas:plan.canvas,theme:plan.theme,palette:plan.palette,typography:plan.typography,metadata:plan.metadata,motif:plan.motif,current:row,previous:prior,roster:plan.slides.map(({id,title,composition})=>({id,title,composition}))},
  visibleContent:pptMasterVisibleContent(accepted,plan),source:{id:material.id,characters:material.text.length,provenance:'已通过原始授权材料阅读及内容校验；只可排版，不可添加新事实。',evidenceSourceIds:sourceIds},
  outputSchema:{complete:true,slide:accepted,svg:'当前一页的完整可编辑 SVG 字符串',sourceIds:[material.id]}}};
}

function inherited(element,name,fallback){for(let node=element;node?.nodeType===1;node=node.parentNode)if(node.hasAttribute(name))return node.getAttribute(name);return fallback;}
function opacity(element){let value=1;for(let node=element;node?.nodeType===1;node=node.parentNode){if(node.hasAttribute('opacity'))value*=Number(node.getAttribute('opacity'));}return value*Number(inherited(element,'fill-opacity','1'));}
const textWidth=(text,size)=>Array.from(text).reduce((sum,char)=>sum+(char===' '?0.3:/[\u2E80-\uFFFF]/u.test(char)?1:/[MW@#%]/.test(char)?0.85:/[ilI.,:;'!|]/.test(char)?0.3:0.56)*size,0);
const rgb=value=>{const hex=value.slice(1),full=hex.length===3?hex.split('').map(c=>c+c).join(''):hex;return[0,2,4].map(index=>parseInt(full.slice(index,index+2),16));};
const luminance=color=>color.map(value=>value/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
function pointInShape(shape,x,y){
 const n=name=>Number(shape.getAttribute(name)||0);
 if(shape.tagName==='rect')return x>=n('x')&&x<=n('x')+n('width')&&y>=n('y')&&y<=n('y')+n('height');
 const rx=shape.tagName==='circle'?n('r'):n('rx'),ry=shape.tagName==='circle'?n('r'):n('ry');return rx>0&&ry>0&&((x-n('cx'))/rx)**2+((y-n('cy'))/ry)**2<=1;
}
function readablePaint(line,box,text,paintShapes,nodeOrder){
 const samples=[box.left+Math.min(4,line.width/2),(box.left+box.right)/2,box.right-Math.min(4,line.width/2)];
 for(const x of samples){let background=[255,255,255];const y=(box.top+box.bottom)/2;
  for(const shape of paintShapes){if(!pointInShape(shape,x,y))continue;const fill=inherited(shape,'fill','#000000'),alpha=opacity(shape);if(fill==='none'||alpha===0)continue;
   if(nodeOrder.get(shape)>nodeOrder.get(text)&&alpha>0.25)fail('PPT Master 页面文字被后绘制的形状遮挡，请把文字放在背景之后');
   if(nodeOrder.get(shape)>nodeOrder.get(text))continue;
   const color=rgb(fill);background=background.map((value,index)=>value*(1-alpha)+color[index]*alpha);
  }
  const b=luminance(background);for(const color of line.colors){const t=luminance(rgb(color));if((Math.max(b,t)+0.05)/(Math.min(b,t)+0.05)<2.8)fail('PPT Master 页面文字与背景对比不足，请更换文字或实色背景');}
 }
}

// This acceptance gate is deliberately independent of the compiler's SVG
// security gate: a safe SVG can still omit text, invent a result, or hide words.
export function validatePptMasterVisibleText(svg,slide,plan){
 const expected=pptMasterVisibleContent(slide,plan),required=new Map(expected.map(row=>[row.id,row]));
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement;
 const elements=Array.from(root.getElementsByTagName('*')),nodeOrder=new Map(elements.map((element,index)=>[element,index])),paintShapes=elements.filter(element=>['rect','circle','ellipse'].includes(element.tagName));
 const page=plan.slides.find(row=>row.id===slide.id);if(root.getAttribute('data-pptx-page-role')!==page.role)fail('PPT Master 页面角色与设计计划不一致');
 const groups=new Map(),rectangles=[];for(const child of children(root)){
  if(child.tagName!=='g'){if(child.tagName==='text'||child.getElementsByTagName('text').length)fail('PPT Master 文字必须放入对应内容组');continue;}
  const id=child.getAttribute('id');if(!required.has(id)){if(child.getElementsByTagName('text').length)fail('PPT Master SVG 包含未授权的新文字');continue;}
  if(groups.has(id))fail('PPT Master 内容组重复');groups.set(id,child);
  const bounds=child.getAttribute('data-pptx-bounds').trim().split(/\s+/).map(Number);
  if(bounds.length!==4||bounds.some(v=>!Number.isFinite(v))||bounds[0]<0||bounds[1]<0||bounds[2]<=0||bounds[3]<=0||bounds[0]+bounds[2]>1280||bounds[1]+bounds[3]>720)fail('PPT Master 内容区域必须完整位于画布内');
  rectangles.push({id,bounds});
 }
 for(let a=0;a<rectangles.length;a++)for(let b=a+1;b<rectangles.length;b++){const x=rectangles[a].bounds,y=rectangles[b].bounds;if(Math.min(x[0]+x[2],y[0]+y[2])-Math.max(x[0],y[0])>1&&Math.min(x[1]+x[3],y[1]+y[3])-Math.max(x[1],y[1])>1)fail('PPT Master 内容区域重叠，请重新排布当前页');}
 for(const row of expected){
  const group=groups.get(row.id);if(!group)fail('PPT Master SVG 遗漏内容组 '+row.id);
  const texts=Array.from(group.getElementsByTagName('text'));if(normalizedText(texts.map(node=>node.textContent).join(''))!==normalizedText(row.text))fail('PPT Master SVG 的 '+row.id+' 文字与已接受页面不一致，不得省略或添加');
  const bounds=rectangles.find(item=>item.id===row.id).bounds,lineBoxes=[];
  for(const text of texts){
   const size=Number(inherited(text,'font-size','0')),min=row.role==='title'?32:row.role==='footer'?14:22;
   if(!Number.isFinite(size)||size<min||size>100)fail('PPT Master 的 '+row.id+' 字号不可读，请重排文字');
   if(!inherited(text,'font-family','')||inherited(text,'fill','#000000')==='none'||opacity(text)<0.85)fail('PPT Master 页面文字不可隐藏或透明');
   let x=Number(text.getAttribute('x')),y=Number(text.getAttribute('y'));if(!text.hasAttribute('x')||!text.hasAttribute('y')||!Number.isFinite(x)||!Number.isFinite(y))fail('PPT Master 页面文字缺少明确坐标');
   let line={x,y,width:0,size,anchor:inherited(text,'text-anchor','start'),colors:new Set()},lines=[];
   const flush=()=>{if(line.width)lines.push(line);line={...line,width:0,colors:new Set()};};
   const visit=node=>{for(const child of Array.from(node.childNodes||[])){
    if(child.nodeType===3||child.nodeType===4){const value=child.nodeValue.replace(/\s+/g,' ');line.width+=textWidth(value,Number(inherited(node,'font-size',String(size))));if(value.trim())line.colors.add(inherited(node,'fill','#000000'));continue;}
    if(child.nodeType!==1)continue;
    const childSize=Number(inherited(child,'font-size',String(size)));if(childSize<min||childSize>100||opacity(child)<0.85||inherited(child,'fill','#000000')==='none')fail('PPT Master 强调文字不可缩小或隐藏');
    if(child.hasAttribute('x')||child.hasAttribute('y')||Number(child.getAttribute('dy')||0)!==0){flush();if(child.hasAttribute('x'))x=Number(child.getAttribute('x'));if(child.hasAttribute('y'))y=Number(child.getAttribute('y'));y+=Number(child.getAttribute('dy')||0);line={x,y,width:0,size:childSize,anchor:inherited(child,'text-anchor','start'),colors:new Set()};}
    if(Number(child.getAttribute('dx')||0)!==0)fail('PPT Master 文字请使用明确行坐标，不使用横向偏移');
    visit(child);
   }};visit(text);flush();
   for(const item of lines){const left=item.x-(item.anchor==='middle'?item.width/2:item.anchor==='end'?item.width:0),right=left+item.width,baseline=inherited(text,'dominant-baseline','auto'),top=item.y-item.size*(baseline==='middle'||baseline==='central'?0.55:baseline==='hanging'?0:0.85),bottom=top+item.size*1.15;
    if(left<bounds[0]-2||right>bounds[0]+bounds[2]+8||top<bounds[1]-3||bottom>bounds[1]+bounds[3]+3)fail('PPT Master 的 '+row.id+' 文字超出可用区域，请换行或重排');
    const box={left,right,top,bottom};readablePaint(item,box,text,paintShapes,nodeOrder);
    for(const previous of lineBoxes)if(Math.min(right,previous.right)-Math.max(left,previous.left)>4&&Math.min(bottom,previous.bottom)-Math.max(top,previous.top)>4)fail('PPT Master 的 '+row.id+' 文字行重叠，请调整行距');
    lineBoxes.push(box);
   }
  }
 }
 return true;
}

export function parsePptMasterSlideOutput(result,value,slide,plan){
 let candidate;try{candidate=JSON.parse(result.text.trim());}catch{fail('PPT Master 未返回完整 JSON 页面');}
 if(!object(candidate)||candidate.complete!==true||Object.keys(candidate).some(key=>!['complete','slide','svg','sourceIds'].includes(key)))fail('PPT Master 页面结果结构不正确');
 const accepted=semanticSlide(slide);if(!object(candidate.slide)||Object.keys(candidate.slide).length!==fields.length||fields.some(key=>candidate.slide[key]!==accepted[key]))fail('PPT Master 不得修改已接受的标题、正文或备注');
 const material=slideMaterial(accepted,plan),ids=candidate.sourceIds;
 if(!Array.isArray(ids)||ids.length!==1||ids[0]!==material.id)fail('PPT Master 页面未关联当前已读取材料');
 const spans=(result.trace||[]).filter(row=>row.tool==='read_material'&&row.status==='completed'&&row.materialId===material.id).map(row=>[row.offset||0,(row.offset||0)+(row.limit||6000)]).sort((a,b)=>a[0]-b[0]);let covered=0;for(const [start,end] of spans)if(start<=covered)covered=Math.max(covered,end);if(covered<material.text.length)fail('PPT Master 必须完整读取当前不可变页面材料');
 const svg=validatePptMasterSvg(candidate.svg);validatePptMasterVisibleText(svg,accepted,plan);
 const sourceIds=originalSourceIds(value,plan.sourceIds),composition=plan.slides.find(row=>row.id===accepted.id).composition;
 return {...accepted,svg,sourceIds,evidenceSourceIds:[...sourceIds],authorSourceIds:[material.id],composition,requiresReview:true};
}

export function validatePptMasterSlideCandidate(result,value,slide,plan){try{parsePptMasterSlideOutput(result,value,slide,plan);return{valid:true};}catch(error){return{valid:false,feedback:{code:'invalid_ppt_master_output',rule:error.message}};}}
