import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {Inflate} from 'fflate';
import {staticizeCachedPictureFields} from './thesis-template-static-fields.js';
import {inspectThesisTemplatePlacement} from './thesis-template-placement.js';

const mm=value=>Math.round(value*1440/25.4);
const style=(overrides={})=>({eastAsia:'宋体',ascii:'Times New Roman',size:24,bold:false,alignment:'both',line:360,lineRule:'auto',firstLineChars:200,firstLine:0,hanging:0,before:0,after:0,pageBreakBefore:false,...overrides});

export function defaultThesisTemplateProfile(){
 return {version:1,rules:{page:{width:11906,height:16838,top:mm(30),bottom:mm(25),left:mm(30),right:mm(25),header:mm(15),footer:mm(15),gutter:0},styles:{Normal:style(),Title:style({eastAsia:'黑体',size:44,bold:true,alignment:'center',firstLineChars:0,line:360,before:240,after:240}),Heading1:style({eastAsia:'黑体',size:32,bold:true,alignment:'center',firstLineChars:0,line:360,before:480,after:360,pageBreakBefore:true}),Heading2:style({eastAsia:'黑体',size:28,bold:true,alignment:'left',firstLineChars:0,line:360,before:240,after:120}),Heading3:style({eastAsia:'黑体',size:24,bold:true,alignment:'left',firstLineChars:0,line:360,before:120,after:120}),Abstract:style(),References:style({firstLineChars:0,hanging:480}),TableText:style({size:21,alignment:'left',line:240,firstLineChars:0})}},recognized:[],unresolved:[],warnings:[],summary:['通用学位论文模板；最终格式请按学位授予单位要求核对。']};
}

export async function inspectThesisDocxTemplate(bytes){return inspectTemplate(bytes);}
export async function prepareThesisDocxTemplate(bytes){
 const prepared=await inspectTemplate(bytes,{includeBytes:true});
 // Export only a fully revalidated copy; the account's original is immutable.
 await inspectTemplate(prepared.bytes,{requireStatic:true});
 return {bytes:prepared.bytes,profile:prepared.profile};
}
async function inspectTemplate(bytes,{includeBytes=false,requireStatic=false}={}){
 const data=bytes instanceof Uint8Array?bytes:bytes instanceof ArrayBuffer?new Uint8Array(bytes):null;
 if(!data||!data.length)throw Error('请上传有效的 DOCX 模板。');
 const records=inspectZipDirectory(data);
 let zip;try{zip=await JSZip.loadAsync(data,{createFolders:false});}catch{throw Error('DOCX 模板损坏、加密或不是支持的 ZIP 文件。');}
 const entries=Object.values(zip.files);if(entries.length>200)throw Error('模板最多包含 200 个 ZIP 项。');
 const docs=new Map();let actual=0;
 for(const entry of entries){
  if(entry.dir)continue;
  if(dangerousPath(entry.name))throw Error('模板包含宏、嵌入对象或不支持的活动内容。');
  const content=unpackBounded(data,records.get(entry.name));actual+=content.length;if(actual>MAX_UNPACKED)throw Error('模板解压后不能超过 25 MB。');
  if(/(?:\.xml|\.rels)$/i.test(entry.name)){if(content.length>MAX_XML)throw Error('模板 XML 内容过大。');docs.set(entry.name,parseXml(content));}
 }
 const document=docs.get('word/document.xml'),types=docs.get('[Content_Types].xml');
 if(!document||!types||!zip.file('_rels/.rels'))throw Error('不是有效的 Word DOCX 模板。');
 for(const node of all(types,'*')){const contentType=node.getAttribute('ContentType')||'';if(/macroEnabled|vbaProject|oleObject|activeX|encrypted/i.test(contentType))throw Error('模板包含宏、加密或不支持的嵌入内容。');}
 if(!all(types,'Override').some(node=>node.getAttribute('PartName')==='/word/document.xml'&&node.getAttribute('ContentType')==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'))throw Error('只支持无宏的 DOCX 模板，不支持 DOCM 或其他文档类型。');
 let hyperlinks=inspectRelationships(docs,zip);
 const staticPictures=staticizeCachedPictureFields(docs,zip);
 if(requireStatic&&staticPictures)throw Error('模板图片字段尚未转换完成，请重新选择模板。');
 for(const doc of docs.values())hyperlinks+=inspectActiveContent(doc);
 if(!document.getElementsByTagNameNS(W,'body').length)throw Error('模板缺少 Word 正文。');
 const result=defaultThesisTemplateProfile(),{rules,recognized,unresolved,warnings}=result;
 if(staticPictures)warnings.push('模板中的旧图片引用将使用文档内已保存的图片，导出时不读取原电脑或网络路径；上传原件保持不变。');
 if(hyperlinks)warnings.push('模板包含普通网页或邮件超链接；不会抓取链接内容，导出后请核对链接是否仍适用。');
 const stylesDoc=docs.get(relatedPart(docs,'styles','word/styles.xml')),styles=new Map();
 if(stylesDoc)for(const node of stylesDoc.getElementsByTagNameNS(W,'style')){const id=attr(node,'styleId');if(id)styles.set(id,node);}
 const defaults=stylesDoc?.getElementsByTagNameNS(W,'docDefaults')[0],defaultP=one(one(defaults,'pPrDefault'),'pPr'),defaultR=one(one(defaults,'rPrDefault'),'rPr');
 const defaultStyle=[...styles.values()].find(node=>attr(node,'type')==='paragraph'&&attr(node,'default')==='1');
 const theme=themeFonts(docs.get(relatedPart(docs,'theme','word/theme/theme1.xml')));
 const styleGroups=id=>{const p=[],r=[],seen=new Set();let current=styles.get(id);for(let depth=0;current&&depth<32;depth++){
   const key=attr(current,'styleId');if(seen.has(key)){warnings.push('样式继承存在循环，循环以外未读取的属性使用默认值。');break;}seen.add(key);p.push(one(current,'pPr'));r.push(one(current,'rPr'));current=styles.get(attr(one(current,'basedOn'),'val'));
  }p.push(defaultP);r.push(defaultR);return{p,r};};
 const byRole=new Map();for(const [id,node]of styles){if(attr(node,'type')!=='paragraph')continue;const role=roleForStyle(node,styleGroups(id).p);if(role&&!byRole.has(role))byRole.set(role,id);}
 if(defaultStyle)byRole.set('Normal',attr(defaultStyle,'styleId'));
 const candidates=new Map(ROLES.map(role=>[role,[]])),coverTables=new Map();let sectionRole='Normal',frontMatterSeen=false;
 const paragraphs=[...document.getElementsByTagNameNS(W,'p')];if(paragraphs.length>20000)throw Error('模板段落过多。');
 for(const paragraph of paragraphs){
  if(hasAncestor(paragraph,'txbxContent')||hasAncestor(paragraph,'drawing'))continue;
  const text=paragraphText(paragraph);if(!text.trim())continue;
  const own=one(paragraph,'pPr'),id=attr(one(own,'pStyle'),'val')||attr(defaultStyle,'styleId'),inherited=styleGroups(id),p=[own,...inherited.p],roleNode=styles.get(id);let role=roleNode?roleForStyle(roleNode,p):null;
  const level=readNumber(first(p,'outlineLvl'),'val',0,2);if(level!==undefined)role='Heading'+(level+1);
  if(/^(?:摘\s*要|abstract)$/i.test(text.trim())){sectionRole='Abstract';role='Heading1';frontMatterSeen=true;}
  else if(/^(?:参考文献|references|bibliography)$/i.test(text.trim())){sectionRole='References';role='Heading1';frontMatterSeen=true;}
  else if(/^(?:目\s*录|contents|table of contents)$/i.test(text.trim())){sectionRole='Normal';role='Heading1';frontMatterSeen=true;}
  else if(role?.startsWith('Heading'))sectionRole='Normal';
  else if(!role||role==='Normal')role=sectionRole;
  // Front headings and cached TOC entries have their own display roles. They
  // must not become a sample of Normal when a mostly-empty template is read.
  const displayName=attr(one(roleNode,'name'),'val')||'';
  if(id==='PKFrontHeading'||/^PaperKnow Front Heading$/i.test(displayName)||/^(?:PKTOC|TOC)[1-9]$/i.test(id||'')||/^(?:toc|目录)\s*[1-9]$/i.test(displayName))continue;
  if(hasAncestor(paragraph,'tc')){
   let table=paragraph.parentNode;while(table&&!(table.namespaceURI===W&&table.localName==='tbl'))table=table.parentNode;
   if(!frontMatterSeen&&table){if(!coverTables.has(table)){const text=[...table.getElementsByTagNameNS(W,'t')].map(node=>node.textContent).join('').replace(/\s/g,'');coverTables.set(table,['学号','姓名','专业','学院','指导教师','完成日期'].filter(label=>text.includes(label)).length>=3);}if(coverTables.get(table))continue;}
   role='TableText';
  }
  if(!role)role='Normal';
  const directRuns=[...paragraph.getElementsByTagNameNS(W,'r')].filter(node=>!hasAncestorBetween(node,paragraph,['p','txbxContent','drawing']));
  const rankedRuns=directRuns.map(node=>({node,weight:[...node.getElementsByTagNameNS(W,'t')].reduce((sum,part)=>sum+part.textContent.length,0)})).filter(row=>row.weight).sort((a,b)=>b.weight-a.weight);
  const run=rankedRuns[0]?.node,rpr=one(run,'rPr'),character=styleGroups(attr(one(rpr,'rStyle'),'val'));
  // Paragraph properties never come from a character style. A direct run's
  // dominant formatting precedes its character/paragraph style inheritance.
  const directR=[rpr,...character.r.slice(0,-1)];
  candidates.get(role).push({weight:Math.min(text.length,10000),p,r:[...directR,...inherited.r],sourceStyle:id,explicitStyle:Boolean(attr(one(own,'pStyle'),'val')),directAlignment:property([own],'jc','val'),directSize:numeric(directR,'sz','val',2,400),directBold:toggle(directR,'b'),standalone:text.trim().length<=120&&!/[。！？.!?；;]/u.test(text)});
 }
 for(const role of ROLES){
  const id=byRole.get(role),groups=id?styleGroups(id):null,declared=groups?readStyle(groups.p,groups.r,theme,warnings):{};
  // A cover title often has no pStyle and therefore inherits Normal. Its
  // direct large, bold or centered formatting must not redefine all body text.
  const rows=candidates.get(role).filter(row=>{
   if(role==='Normal')return !(['center','right'].includes(row.directAlignment)||(row.standalone&&(row.directBold===true||row.directSize>(declared.size||24)*1.2)));
   if(role==='TableText'&&row.standalone&&row.weight<=20)return (row.directSize??readStyle(row.p,row.r,theme,warnings).size??0)<=rules.styles.Normal.size*1.2;
   return true;
  }).sort((a,b)=>b.weight-a.weight),candidate=rows[0];
  let selected=candidate,bodySample=false;
  if(role==='Normal'){
   // A real school body style takes precedence over an unrelated default
   // Normal. Repeated directly formatted body samples also count, whereas a
   // single cover/example run cannot redefine the document contract.
   const named=rows.find(row=>row.sourceStyle!==id&&row.weight>=20&&styles.has(row.sourceStyle)&&roleForStyle(styles.get(row.sourceStyle),row.p)==='Normal');
   const groups=new Map();for(const row of rows.filter(row=>!row.explicitStyle&&row.weight>=40)){
    const values=readStyle(row.p,row.r,theme,warnings),key=JSON.stringify(values),group=groups.get(key)||{row,count:0,weight:0};group.count++;group.weight+=row.weight;groups.set(key,group);
   }
   const repeated=[...groups.values()].filter(group=>group.count>=2).sort((a,b)=>b.weight-a.weight)[0]?.row;
   if(named||repeated){selected=named||repeated;bodySample=true;}
  }
  const sample=selected?readStyle(selected.p,selected.r,theme,warnings):{};
  // Named Normal plus its explicit inheritance is the body-format contract.
  // A credible body paragraph may fill missing attributes; direct outline
  // headings and other explicit roles still retain their actual formatting.
  const values=role==='Normal'?!bodySample?{...sample,...declared}:{...declared,...sample}:candidate?sample:declared;
  for(const field of STYLE_FIELDS){const key='styles.'+role+'.'+field;if(values[field]!==undefined){rules.styles[role][field]=values[field];recognized.push(key);}else unresolved.push(key);}
 }
 const sections=[...document.getElementsByTagNameNS(W,'sectPr')],section=sections.at(-1),pages=sections.map(readPage);
 const page=section?readPage(section):{};
 for(const field of PAGE_FIELDS){const key='page.'+field;if(page[field]!==undefined){rules.page[field]=page[field];recognized.push(key);}else unresolved.push(key);}
 if(rules.page.left+rules.page.right>=rules.page.width-720||rules.page.top+rules.page.bottom>=rules.page.height-720)throw Error('模板页边距没有保留足够正文区域，请调整后重试。');
 result.placement=await inspectThesisTemplatePlacement(data);const preserve=result.placement.preservesTemplate;
 // Read only narrow, explicit requirements. These are document formatting
 // facts, not executable instructions and never authorize external actions.
 const specification=paragraphs.map(paragraphText).join('\n');
 const referenceMinimum=specification.match(/(?:文献|资料)[^\n。]{0,45}?(\d{1,2})\s*种以上/),foreignMinimum=specification.match(/至少(?:有)?\s*(\d{1,2})\s*篇外文/);
 result.submission={...(referenceMinimum?{minimumReferences:Number(referenceMinimum[1])}:{}),...(foreignMinimum?{minimumForeignReferences:Number(foreignMinimum[1])}:{})};
 if(/(?:采用|使用|编排)[^\n。]{0,20}三线表/.test(specification))rules.tableFormat='threeLine';
 if(/页码从正文开始编排/.test(specification)&&/页码内容为[^\n。]{0,30}第\s*X\s*页/.test(specification))rules.bodyPageNumbers=true;
 result.submission.requiredCoverFields=[...(/学\s*号[:：]/.test(specification)?['studentId']:[]),...(/学\s*院/.test(specification)?['college']:[]),...(/××××[^\n]{0,80}届/.test(specification)?['graduationYear']:[]),...(/二[○〇]××年×月/.test(specification)?['completionDate']:[])];
 if(sections.length>1)warnings.push(preserve?'导出保留模板的多个分节及页面设置，请核对分节页码和页眉页脚。':pages.some(value=>JSON.stringify(value)!==JSON.stringify(pages.at(-1)))?'模板包含不同页面设置的多个分节，本次规则采用最后一节；封面、横向页及其他分节需人工核对。':'模板包含多个分节，规则采用最后一节，分节页码与页眉页脚需人工核对。');
 if(rules.page.width>rules.page.height)warnings.push('模板最后一节为横向页面，已读取横向尺寸，请核对是否适用于论文正文。');
 if(rules.page.top<mm(25)||rules.page.left<mm(25)||rules.page.bottom<mm(20)||rules.page.right<mm(20))warnings.push('模板的部分页边距低于通用学位论文留边建议，已保留原数值，请按院校要求核对。');
 if(all(document,'cols').some(node=>Number(attr(node,'num')||1)>1))warnings.push(preserve?'模板包含多栏排版，已保留原有分节设置，请核对正文流向。':'模板包含多栏排版，规则不包含分栏设置，请人工核对。');
 if(all(document,'textDirection').some(node=>!['lrTb','lr'].includes(attr(node,'val'))))warnings.push(preserve?'模板包含特殊文字方向，已保留原设置，请核对实际页面。':'模板包含竖排或特殊文字方向，规则不包含该设置。');
 if(docs.get(relatedPart(docs,'settings','word/settings.xml'))?.getElementsByTagNameNS(W,'mirrorMargins').length)warnings.push(preserve?'模板使用镜像页边距，已保留原设置，请核对双面装订。':'模板使用镜像页边距，当前规则仅记录页边距数值，请核对双面装订。');
 if(!stylesDoc)warnings.push('模板没有 styles.xml，仅从实际段落读取显式格式；未提供的样式使用通用默认值。');
 if([...docs.values()].some(doc=>['embedRegular','embedBold','embedItalic','embedBoldItalic'].some(name=>doc.getElementsByTagNameNS(W,name).length)))warnings.push('模板包含嵌入字体；字体授权及目标设备的字体显示效果需另行核对。');
 if(unresolved.length)warnings.push(preserve?'样式摘要有未识别属性；导出优先保留模板中实际段落的格式，缺失的正文样式使用通用默认值，请核对最终版式。':'未识别的字体、字号或段落属性已采用通用默认值；这不代表已完整复刻院校模板。');
 if(all(document,'drawing').length||all(document,'pict').length)warnings.push(preserve?'模板中的嵌入图片及形状保持在原文档内，请核对最终位置。':'模板含图片或形状；本识别结果不包含封面图形与版式位置。');
 warnings.push(...result.placement.warnings);
 result.warnings=[...new Set(warnings)];result.summary=[`已读取 ${recognized.filter(key=>key.startsWith('page.')).length} 项页面设置、${recognized.filter(key=>key.startsWith('styles.')).length} 项样式属性。`,unresolved.length?`${unresolved.length} 项摘要属性未明确识别，${preserve?'优先保留原段落格式；缺失正文样式使用通用默认值。':'使用通用默认值。'}`:'规则范围内的页面和样式属性均已识别。',preserve?'导出保留模板包、封面和分节，在识别的正文位置填入内容。':result.placement.mode==='ambiguous'?'当前模板正文位置不明确，导出前需要补充独立正文占位符。':'此文件仅提供样式规则，导出使用通用封面和目录；不表示完整复刻原件。'];
 return includeBytes?{profile:result,bytes:staticPictures?await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}):new Uint8Array(data)}:result;
}

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const P='http://schemas.openxmlformats.org/package/2006/relationships',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX_PACKED=2*1024*1024,MAX_UNPACKED=25*1024*1024,MAX_XML=8*1024*1024;
const ROLES=['Normal','Title','Heading1','Heading2','Heading3','Abstract','References','TableText'];
const STYLE_FIELDS=['eastAsia','ascii','size','bold','alignment','line','lineRule','firstLineChars','firstLine','hanging','before','after','pageBreakBefore'];
const PAGE_FIELDS=['width','height','top','bottom','left','right','header','footer','gutter'];
const CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
const all=(doc,name)=>[...doc.getElementsByTagName('*')].filter(node=>name==='*'||node.localName===name),children=(node,name)=>node?[...node.childNodes].filter(child=>child.nodeType===1&&child.namespaceURI===W&&child.localName===name):[],one=(node,name)=>children(node,name)[0],attr=(node,name)=>node?.getAttributeNS(W,name)||null;
function readNumber(node,name,min=0,max=31680){const value=attr(node,name);if(value===null||!/^\d+$/.test(value))return undefined;const number=Number(value);return Number.isSafeInteger(number)&&number>=min&&number<=max?number:undefined;}
function first(groups,name){for(const group of groups){const node=one(group,name);if(node)return node;}return undefined;}
function property(groups,name,attribute){for(const group of groups){const node=one(group,name),value=attr(node,attribute);if(value!==null)return value;}return null;}
function numeric(groups,name,attribute,min,max){for(const group of groups){const node=one(group,name);if(attr(node,attribute)!==null)return readNumber(node,attribute,min,max);}return undefined;}
function toggle(groups,name){const node=first(groups,name);if(!node)return undefined;const value=attr(node,'val');return value===null||['1','true','on'].includes(value)?true:['0','false','off'].includes(value)?false:undefined;}
function hasAncestor(node,name){for(let parent=node.parentNode;parent;parent=parent.parentNode)if(parent.namespaceURI===W&&parent.localName===name)return true;return false;}
function hasAncestorBetween(node,end,names){for(let parent=node.parentNode;parent&&parent!==end;parent=parent.parentNode)if(parent.namespaceURI===W&&names.includes(parent.localName))return true;return false;}
function paragraphText(paragraph){return[...paragraph.getElementsByTagNameNS(W,'t')].filter(node=>!hasAncestorBetween(node,paragraph,['p','txbxContent','drawing'])).map(node=>node.textContent).join('');}
function roleForStyle(node,p){
 const name=[attr(node,'styleId'),attr(one(node,'name'),'val'),attr(one(node,'aliases'),'val')].filter(Boolean).join('|').replace(/[_-]/g,' ');
 const canonical=name.split('|').map(value=>value.match(/^(?:PK|PaperKnow\s+)(Normal|Title|Heading[123]|Abstract|References|TableText)$/i)).find(Boolean);if(canonical)return ROLES.find(role=>role.toLowerCase()===canonical[1].toLowerCase());
 const numbered=name.match(/(?:heading|标题|標題)\s*([123一二三])/i);if(numbered)return'Heading'+({'一':1,'二':2,'三':3}[numbered[1]]||numbered[1]);
 const outline=numeric(p,'outlineLvl','val',0,2);if(outline!==undefined)return'Heading'+(outline+1);
 if(/(?:^|\|)(?:normal|body\s*text|论文正文|正文(?:文本|内容|首行缩进|段落)?|标准|標準)(?:\||$)/i.test(name))return'Normal';
 if(/(?:^|\|)(?:title|标题|標題|论文标题)(?:\||$)/i.test(name))return'Title';
 if(/abstract|摘要正文/i.test(name))return'Abstract';if(/references|bibliography|参考文献|參考文獻/i.test(name))return'References';if(/table\s*(?:text|content)|表格(?:文字|正文)/i.test(name))return'TableText';return null;
}
function themeFonts(document){const out={};if(!document)return out;for(const[type,prefix]of[['majorFont','major'],['minorFont','minor']]){const node=document.getElementsByTagNameNS(A,type)[0];if(!node)continue;out[prefix+'Ascii']=node.getElementsByTagNameNS(A,'latin')[0]?.getAttribute('typeface')||undefined;out[prefix+'HAnsi']=out[prefix+'Ascii'];out[prefix+'EastAsia']=node.getElementsByTagNameNS(A,'ea')[0]?.getAttribute('typeface')||[...node.getElementsByTagNameNS(A,'font')].find(item=>item.getAttribute('script')==='Hans')?.getAttribute('typeface')||undefined;}return out;}
function readStyle(p,r,theme,warnings){
 const out={};for(const field of ['eastAsia','ascii']){for(const group of r){const fonts=one(group,'rFonts');if(!fonts)continue;const explicit=attr(fonts,field)||(field==='ascii'?attr(fonts,'hAnsi'):null),themeKey=attr(fonts,field+'Theme')||(field==='ascii'?attr(fonts,'hAnsiTheme'):null),value=explicit||theme[themeKey];if(value&&value.length<=100&&!/[\x00-\x1f]/.test(value)){out[field]=value;break;}if(themeKey){warnings.push('部分字体通过主题引用，无法解析的主题字体使用默认值。');break;}}}
 out.size=numeric(r,'sz','val',2,400);out.bold=toggle(r,'b');
 const align=property(p,'jc','val');if(['both','left','center','right'].includes(align))out.alignment=align;else if(align==='start')out.alignment='left';else if(align==='end')out.alignment='right';else if(align)warnings.push('模板包含当前规则未支持的对齐方式，已使用默认值。');
 out.line=numeric(p,'spacing','line',1,4000);const rule=property(p,'spacing','lineRule');if(['auto','exact','atLeast'].includes(rule))out.lineRule=rule;else if(out.line!==undefined&&!rule)out.lineRule='auto';
 for(const group of p){const ind=one(group,'ind');if(['firstLineChars','firstLine','hanging','hangingChars'].some(field=>attr(ind,field)!==null)){out.firstLineChars=readNumber(ind,'firstLineChars',0,5000);out.firstLine=readNumber(ind,'firstLine',0,14400);out.hanging=readNumber(ind,'hanging',0,14400);if(out.hanging>0){out.firstLine=0;out.firstLineChars=0;}else if(out.firstLineChars!==undefined){out.firstLine=0;out.hanging=0;}else if(out.firstLine!==undefined){out.firstLineChars=0;out.hanging=0;}if(attr(ind,'hangingChars')!==null&&out.hanging===undefined)warnings.push('模板使用字符单位悬挂缩进，当前规则仅支持磅值悬挂缩进，请人工核对。');break;}}
 out.before=numeric(p,'spacing','before',0,14400);out.after=numeric(p,'spacing','after',0,14400);out.pageBreakBefore=toggle(p,'pageBreakBefore');
 return Object.fromEntries(Object.entries(out).filter(([,value])=>value!==undefined));
}
function readPage(section){const size=one(section,'pgSz'),margins=one(section,'pgMar'),result={};for(const field of PAGE_FIELDS){const value=readNumber(field==='width'||field==='height'?size:margins,field==='width'?'w':field==='height'?'h':field,field==='width'||field==='height'?1440:0,31680);if(value!==undefined)result[field]=value;}return result;}
function relatedPart(docs,type,fallback){const rels=docs.get('word/_rels/document.xml.rels');if(!rels)return fallback;const relation=[...rels.getElementsByTagNameNS(P,'Relationship')].find(node=>node.getAttribute('Type')===R+'/'+type&&node.getAttribute('TargetMode')!=='External');if(!relation)return fallback;return resolveRelationship('word',relation.getAttribute('Target'));}
function resolveRelationship(source,target){const parts=target.startsWith('/')?[]:source.split('/').filter(Boolean);for(const part of target.split('#')[0].split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)throw Error('模板关系超出文档范围。');parts.pop();}else parts.push(part);}return parts.join('/');}
function dangerousPath(path){return /(?:^|\/)(?:vbaProject[^/]*|activeX|embeddings|customUI)(?:\/|\.|$)|\.(?:svg|html?|xhtml)$/i.test(path)||/\.bin$/i.test(path)&&!/^word\/printerSettings\/printerSettings\d+\.bin$/.test(path);}
function inspectZipDirectory(data){
 if(data.length>MAX_PACKED)throw Error('DOCX 模板不能超过 2 MB。');const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let end=-1;
 for(let offset=data.length-22;offset>=Math.max(0,data.length-65557);offset--)if(view.getUint32(offset,true)===0x06054b50&&offset+22+view.getUint16(offset+20,true)===data.length){end=offset;break;}
 if(end<0)throw Error('不是有效的 DOCX ZIP 文件。');const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),length=view.getUint32(end+12,true);
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||count===65535||start===0xffffffff||length===0xffffffff||count>200||start+length!==end)throw Error('不支持分卷、ZIP64 或超过 200 项的模板。');
 let offset=start,total=0;const seen=new Set(),records=new Map();for(let index=0;index<count;index++){
  if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw Error('模板 ZIP 目录损坏。');const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),size=view.getUint32(offset+24,true),packed=view.getUint32(offset+20,true),nameSize=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);if(flags&0x41||![0,8].includes(method))throw Error('不支持加密或特殊压缩方式的模板。');
  if(offset+46+nameSize+extra+comment>end||local+30>start||view.getUint32(local,true)!==0x04034b50)throw Error('模板 ZIP 项损坏。');const name=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(offset+46,offset+46+nameSize));
  if(!name||/[\\\x00-\x1f]/.test(name)||name.startsWith('/')||/^[a-z]:/i.test(name)||name.split('/').some(part=>part==='..'||part==='.')||seen.has(name))throw Error('模板含重复或不安全的 ZIP 路径。');seen.add(name);
  const localNameSize=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true);if(local+30+localNameSize+localExtra+packed>start||view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==method||new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(local+30,local+30+localNameSize))!==name)throw Error('模板 ZIP 本地记录不一致。');
  total+=size;if(total>MAX_UNPACKED||size===0xffffffff||packed===0xffffffff)throw Error('模板解压后不能超过 25 MB。');records.set(name,{method,size,packed,offset:local+30+localNameSize+localExtra,crc:view.getUint32(offset+16,true)});offset+=46+nameSize+extra+comment;
 }if(offset!==end)throw Error('模板 ZIP 目录不一致。');return records;
}
function unpackBounded(data,record){
 if(!record)throw Error('模板 ZIP 部件记录缺失。');const compressed=data.subarray(record.offset,record.offset+record.packed),chunks=[];let length=0;
 const consume=chunk=>{length+=chunk.length;if(length>record.size||length>MAX_UNPACKED)throw Error('模板实际解压大小超出安全范围。');chunks.push(new Uint8Array(chunk));};
 try{if(record.method===0)consume(compressed);else{const decoder=new Inflate(consume);for(let index=0;index<compressed.length;index+=1024)decoder.push(compressed.subarray(index,index+1024),index+1024>=compressed.length);if(!compressed.length)decoder.push(new Uint8Array(),true);}}catch(error){if(/安全范围/.test(error.message))throw error;throw Error('模板压缩内容损坏。');}
 if(length!==record.size)throw Error('模板实际解压大小与 ZIP 记录不一致。');const out=new Uint8Array(length);let offset=0,crc=0xffffffff;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;for(const byte of chunk)crc=(crc>>>8)^CRC_TABLE[(crc^byte)&255];}
 if(((crc^0xffffffff)>>>0)!==record.crc)throw Error('模板部件校验失败。');return out;
}
function parseXml(bytes){
 let text;try{const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw Error('模板 XML 编码无效。');}
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('不支持含 DTD 或实体声明的模板。');
 // Reject pathological nesting before the XML parser builds a DOM. Comments
 // and CDATA cannot contain element structure and are excluded from the scan.
 let nesting=0,count=0;const structure=text.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g,'');for(const match of structure.matchAll(/<\s*(\/)?[A-Za-z_][^>]*>/g)){if(match[1])nesting--;else if(!/\/\s*>$/.test(match[0]))nesting++;if(nesting>128||++count>300000)throw Error('模板 XML 结构过于复杂。');}
 let document;try{document=new DOMParser({onError:()=>{throw Error('invalid');}}).parseFromString(text,'application/xml');}catch{throw Error('模板 XML 损坏。');}
 if(!document.documentElement||document.getElementsByTagName('parsererror').length)throw Error('模板 XML 损坏。');const nodes=all(document,'*');if(nodes.length>150000)throw Error('模板 XML 结构过于复杂。');for(const node of nodes){let depth=0;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(++depth>128)throw Error('模板 XML 嵌套过深。');}return document;
}
function inspectRelationships(docs,zip){
 let hyperlinks=0;
 for(const[path,document]of docs){if(!path.endsWith('.rels'))continue;const source=path==='_rels/.rels'?'':path.replace(/\/_rels\/[^/]+\.rels$/,'');for(const node of all(document,'Relationship')){
   const target=node.getAttribute('Target')||'',type=node.getAttribute('Type')||'',mode=node.getAttribute('TargetMode')||'';
   if(mode==='External'&&/\/hyperlink$/i.test(type)&&/^(?:https?:\/\/[^\s\\]+|mailto:[^\s\\]+)$/i.test(target)){hyperlinks++;continue;}
   if(mode==='External'||/^[a-z][a-z0-9+.-]*:|^[\\/]{2}|\\/i.test(target)||/\/(?:oleObject|package|control|attachedTemplate|aFChunk|externalLink|vbaProject)$/i.test(type))throw Error('模板包含外部链接、嵌入对象或危险关系，请移除后重试。');
   if(!target||target.includes('?')||/%[0-9a-f]{2}/i.test(target))throw Error('模板关系目标不受支持。');if(target.startsWith('#'))continue;
   const resolved=resolveRelationship(source,target);if(!zip.file(resolved))throw Error('模板关系引用了缺失的文档部件。');
  }}return hyperlinks;
}
function hyperlinkField(instruction){
 // A Word hyperlink is navigation, not an instruction to import remote content.
 // Recognize its fixed argument/switch grammar instead of rejecting all links.
 const reject=()=>{throw Error('模板中的超链接字段格式不受支持，或指向本地文件；请删除该链接，或选择其他 DOCX 模板。');};
 if(instruction.length>8192)return reject();
 const tokens=[];let end=0;
 for(const match of instruction.matchAll(/"((?:[^"\\]|\\.)*)"|([^\s"]+)/g)){
  if(instruction.slice(end,match.index).trim())return reject();
  tokens.push(match[1]===undefined?match[2]:match[1].replace(/\\"/g,'"'));end=match.index+match[0].length;
 }
 if(instruction.slice(end).trim()||tokens.shift()?.toUpperCase()!=='HYPERLINK')return reject();
 let target,anchor='';
 for(let index=0;index<tokens.length;index++){
  const token=tokens[index],flag=token.toLowerCase();
  if(['\\m','\\n'].includes(flag))continue;
  if(['\\l','\\o','\\t','\\*'].includes(flag)){
   const value=tokens[++index];if(value===undefined||value.length>1000||/[\u0000-\u001f\u007f]/.test(value))return reject();
   if(flag==='\\l'){if(!/^[\p{L}\p{N}_.:-]{1,256}$/u.test(value))return reject();anchor=value;}
   if(flag==='\\*'&&!/^(?:MERGEFORMAT|CHARFORMAT)$/i.test(value))return reject();
   continue;
  }
  if(token.startsWith('\\')||target!==undefined)return reject();target=token;
 }
 if(!target){if(anchor)return 0;return reject();}
 if(target.length>2000||/[\s\\\u0000-\u001f\u007f]/.test(target)||/%(?:0[ad]|00)/i.test(target))return reject();
 let url;try{url=new URL(target);}catch{return reject();}
 if(!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password||url.protocol==='mailto:'&&!url.pathname)return reject();
 return 1;
}
function inspectActiveContent(document){
 for(const name of ['object','altChunk','subDoc'])if(document.getElementsByTagNameNS(W,name).length)throw Error('模板包含不支持的嵌入对象或外部文档。');
 const instructions=[...document.getElementsByTagNameNS(W,'fldSimple')].map(node=>attr(node,'instr')||''),stack=[],loose=new Map();
 for(const node of all(document,'*')){
  if(node.namespaceURI!==W)continue;
  if(node.localName==='fldChar'){
   if(attr(node,'fldCharType')==='begin')stack.push('');
   else if(attr(node,'fldCharType')==='end'&&stack.length)instructions.push(stack.pop());
  }else if(node.localName==='instrText'){
   if(stack.length)stack[stack.length-1]+=node.textContent;
   else{let paragraph=node.parentNode;while(paragraph&&!(paragraph.namespaceURI===W&&paragraph.localName==='p'))paragraph=paragraph.parentNode;loose.set(paragraph,(loose.get(paragraph)||'')+node.textContent);}
  }
 }
 instructions.push(...stack,...loose.values());
 let hyperlinks=0;
 for(const instruction of instructions){
  if(/^\s*HYPERLINK\b/i.test(instruction)){hyperlinks+=hyperlinkField(instruction);continue;}
  if(/(?:INCLUDETEXT|INCLUDEPICTURE|DDEAUTO|DDE|DATABASE|HYPERLINK)|\b(?:LINK|RD)\b/i.test(instruction)||/(?:https?|file|ftp):|\\\\/i.test(instruction))throw Error('模板包含会加载外部文件、图片或动态数据的字段；请删除这些字段，或选择其他 DOCX 模板。');
 }
 return hyperlinks;
}
