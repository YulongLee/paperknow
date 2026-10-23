import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',P='http://schemas.openxmlformats.org/package/2006/relationships';
const children=(node,name)=>node?[...node.childNodes].filter(n=>n.nodeType===1&&(!name||n.namespaceURI===W&&n.localName===name)):[];
const one=(node,name)=>children(node,name)[0],attr=(node,name)=>node?.getAttributeNS(W,name)||'';
const all=(node,name)=>[...node.getElementsByTagNameNS(W,name)];
const compact=text=>text.replace(/\s/g,'');
function ownText(node){return all(node,'t').filter(n=>{for(let p=n.parentNode;p&&p!==node;p=p.parentNode)if(p.namespaceURI===W&&['txbxContent','drawing','pict'].includes(p.localName))return false;return true;}).map(n=>n.textContent).join('');}
const visibleLabel=text=>compact(text).replace(/[（(].*$/,'').replace(/[:：].*$/,'');
const firstChapter=text=>/^(?:第[一1壹]章|[一壹]、|1[.．、\s](?!\d))/.test(text.trim())&&!/[。！？；;]/.test(text)&&text.length<=120;
const chapterText=text=>/^(?:第[一二三四五六七八九十百零〇壹贰叁肆伍陆柒捌玖拾\d]+[章节篇]|[一二三四五六七八九十]+、|\d{1,2}[.．、\s](?!\d))/.test(text.trim())&&!/[。！？；;]/.test(text)&&text.length<=120;
const dotted=text=>/[.…·]{3,}|\.{3,}/.test(text)||/\t\s*[IVXivx\d]+\s*$/.test(text);
function roleName(value){const s=value.replace(/[_-]/g,' '),number=s.match(/(?:heading|标题|標題)\s*([123一二三])/i);if(number)return 'Heading'+({'一':1,'二':2,'三':3}[number[1]]||number[1]);if(/^(?:Normal|Body\s*Text|正文(?:文本|内容|首行缩进|段落)?|论文正文|标准|標準)$/i.test(s))return 'Normal';if(/^(?:Title|论文标题)$/i.test(s))return 'Title';if(/^(?:Abstract|摘要正文)$/i.test(s))return 'Abstract';if(/^(?:References|Bibliography|参考文献|參考文獻)$/i.test(s))return 'References';if(/^(?:Table\s*(?:Text|Content)|表格(?:文字|正文))$/i.test(s))return 'TableText';return null;}
function special(text){const label=visibleLabel(text);if(/^(?:摘要|中文摘要)$/i.test(label))return 'abstract_zh';if(/^(?:Abstract|英文摘要)$/i.test(label))return 'abstract_en';if(/^(?:目录|contents|tableofcontents)$/i.test(label))return 'toc';if(/^(?:参考文献|已使用的参考文献|references|bibliography)$/i.test(label))return 'references';if(/^(?:致谢|acknowledg(?:e)?ments?)$/i.test(label))return 'acknowledgements';if(/^(?:附录[A-Z一二三四五六七八九十\d]*|appendix(?:[A-Z\d]+)?|appendices)$/i.test(label))return 'appendix';return null;}
function styleInfo(stylesDocument){
 const map=new Map();for(const node of stylesDocument?all(stylesDocument,'style'):[]){const id=attr(node,'styleId');if(id)map.set(id,{id,node,name:attr(one(node,'name'),'val'),basedOn:attr(one(node,'basedOn'),'val')});}
 const effective=(id,seen=new Set())=>{if(!id||seen.has(id))return {};seen.add(id);const row=map.get(id);if(!row)return {};const parent=effective(row.basedOn,seen),outline=attr(one(one(row.node,'pPr'),'outlineLvl'),'val');return {...parent,...(roleName(row.name)||roleName(id)?{role:roleName(row.name)||roleName(id)}:{}),...(outline!==''?{outline:Number(outline)}:{}),name:row.name,id};};
 return {map,effective};
}
function safeRanges(rows,regions){
 const membership=new Map();for(const region of regions)for(let i=region.startIndex;i<region.endIndex;i++)membership.set(i,region);
 const active=new Map(),fields=[];
 for(const row of rows){for(const node of [...row.node.getElementsByTagName('*')]){if(node.namespaceURI!==W)continue;const name=node.localName;
  if(['bookmarkStart','commentRangeStart','permStart','moveFromRangeStart','moveToRangeStart'].includes(name)){const key=name.replace(/Start$/,'')+':'+attr(node,'id');active.set(key,{index:row.index,region:membership.get(row.index)});}
  else if(['bookmarkEnd','commentRangeEnd','permEnd','moveFromRangeEnd','moveToRangeEnd'].includes(name)){const key=name.replace(/End$/,'')+':'+attr(node,'id'),start=active.get(key);if(start&&start.region!==membership.get(row.index)&&(start.region||membership.get(row.index)))return false;active.delete(key);}
  else if(name==='fldChar'){const type=attr(node,'fldCharType');if(type==='begin')fields.push({index:row.index,region:membership.get(row.index)});else if(type==='end'){const start=fields.pop();if(start&&start.region!==membership.get(row.index)&&(start.region||membership.get(row.index)))return false;}}
 }}
 return ![...active.values(),...fields].some(row=>row.region);
}
function roleSamples(rows,regions,styles){
 const samples={},roleStyles={};
 const main=regions.find(row=>row.kind==='body'),refs=regions.find(row=>row.kind==='references');
 const consider=(role,row)=>{if(!row||row.node.localName!=='p')return;const existing=samples[role];if(existing===undefined){samples[role]=row.index;const style=styles.map.get(row.styleId);if(style)roleStyles[role]=style.id;}};
 if(main){const relevant=rows.slice(main.startIndex,main.endIndex),chinesePrimary=/^[一二三四五六七八九十]+、/.test(relevant[0]?.text.trim()||'');for(const row of relevant){if(row.outline>=0&&row.outline<=2)consider('Heading'+(row.outline+1),row);else if(/^\d+\.\d+\.\d+(?:\s|[、.．])/.test(row.text.trim()))consider('Heading3',row);else if(/^\d+\.\d+(?:\s|[、.．])/.test(row.text.trim()))consider('Heading2',row);else if(/^[（(][一二三四五六七八九十]+[）)]/.test(row.text.trim()))consider('Heading2',row);else if(chinesePrimary&&/^\d+[.．、]\s*[^\d]/.test(row.text.trim())&&row.text.length<100&&!/[。；;]/.test(row.text))consider('Heading3',row);else if(chapterText(row.text)&&!dotted(row.text))consider('Heading1',row);}
  const normal=relevant.filter(row=>row.node.localName==='p'&&row.text.trim().length>=20&&row.outline===undefined&&!special(row.text)&&!chapterText(row.text)&&!/^(?:说明|注[:：]|图\d|表\d|[①②③④⑤⑥⑦⑧⑨])/.test(row.text.trim())).sort((a,b)=>Number(b.role==='Normal')-Number(a.role==='Normal')||a.index-b.index)[0];consider('Normal',normal);
 }
 const abstract=regions.find(row=>row.kind==='abstract_zh')||regions.find(row=>row.kind==='abstract_en');if(abstract)consider('Abstract',/[:：]/.test(rows[abstract.startIndex].text)?rows[abstract.startIndex]:rows.slice(abstract.startIndex+1,abstract.endIndex).find(row=>row.text.trim().length>=10));
 if(refs)consider('References',rows.slice(refs.startIndex+1,refs.endIndex).find(row=>/^\s*\[[1-9]\d*\]/.test(row.text)));
 for(const role of ['Normal','Title','Heading1','Heading2','Heading3','Abstract','References','TableText'])if(!roleStyles[role]&&samples[role]===undefined){const named=[...styles.map.values()].find(row=>roleName(row.name)===role||roleName(row.id)===role);if(named)roleStyles[role]=named.id;}
 return {roleSamples:samples,roleStyles};
}

// This is placement analysis only. The caller must validate the DOCX package
// and external relationships before using any source XML in an export.
export function analyzeThesisTemplatePlacement(document,stylesDocument){
 const root=all(document,'body')[0];if(!root)throw Error('DOCX 模板缺少正文。');const nodes=children(root),styles=styleInfo(stylesDocument),rows=nodes.map((node,index)=>{const pr=node.localName==='p'?one(node,'pPr'):null,styleId=attr(one(pr,'pStyle'),'val'),info=styles.effective(styleId),outline=attr(one(pr,'outlineLvl'),'val'),text=ownText(node),instructions=all(node,'instrText').map(n=>n.textContent).join(' '),tocStyle=/^(?:TOC\d*|目录[一二三\d]*)$/i.test(info.name||styleId);return {node,index,text,styleId,role:info.role,outline:outline!==''?Number(outline):info.outline,kind:special(text),toc:tocStyle||dotted(text)||/\bTOC\b/i.test(instructions),section:node.localName==='sectPr'||all(node,'sectPr').length>0};});
 const sections=all(document,'sectPr').length,base={version:1,mode:'ambiguous',preservesTemplate:false,sections,candidate:null,regions:[],roleStyles:{},roleSamples:{},warnings:[]};
 const slots=rows.filter(row=>row.node.localName==='p'&&/^\s*\{\{(?:正文|PAPERKNOW_CONTENT)\}\}\s*$/.test(row.text));
 if(slots.length===1){const slot=slots[0],regions=[{kind:'explicit_slot',startIndex:slot.index,endIndex:slot.index+1,label:'正文占位符'}];if(!safeRanges(rows,regions))return {...base,warnings:['正文占位符穿过书签或域边界，请将 {{正文}} 放在独立普通段落后重试。']};return {...base,mode:'explicit_slot',preservesTemplate:true,candidate:{startIndex:slot.index,endIndex:slot.index+1,startText:slot.text.slice(0,96),endText:slot.text.slice(0,96),description:'在独立正文占位符中填入论文，保留模板其余页面与文档部件。'},regions,...roleSamples(rows,regions,styles)};}
 if(slots.length>1)return {...base,warnings:['模板含多个正文占位符，无法确定填充位置。请只保留一个独立的 {{正文}}。']};
 const textRows=rows.filter(row=>row.text.trim()),hasFurniture=rows.some(row=>row.node.localName==='tbl'||all(row.node,'drawing').length||all(row.node,'pict').length||all(row.node,'txbxContent').length),hasFormalFront=rows.some(row=>row.kind||/声明|原创性|独创性|作者签名|学位论文授权|(?:学号|学\s*号)[:：]/.test(row.text))||textRows.slice(0,3).some(row=>/大学|学院|(?:本科|硕士|博士)(?:毕业|学位)论文/.test(row.text));
 if(textRows.length<=4&&textRows.reduce((sum,row)=>sum+row.text.length,0)<=300&&sections<=1&&!hasFurniture&&!hasFormalFront){return {...base,mode:'rules_only',warnings:['这是仅含少量示例段落的样式模板，将采用其可识别的格式规则生成通用论文版式；不包含学校封面或复杂页面的保真复刻。'],...roleSamples(rows,[],styles)};}
 const tocMarkers=rows.filter(row=>row.kind==='toc'||(/\bTOC\b/i.test(all(row.node,'instrText').map(n=>n.textContent).join(' ')))),toc=tocMarkers.at(-1),frontMarker=rows.filter(row=>/声明|原创性|独创性/.test(row.text)&&row.text.length<100).at(-1),after=Math.max(toc?.index??-1,frontMarker?.index??-1);
 const firstCandidates=rows.filter(row=>row.index>after&&!row.toc&&!row.kind&&row.node.localName==='p'&&(row.outline===undefined||row.outline===0)&&firstChapter(row.text)),firstFamily=row=>/^第/.test(row.text.trim())?'chapter':/^[一壹]、/.test(row.text.trim())?'chinese':'decimal',firstEnd=firstCandidates.length?rows.find(row=>row.index>firstCandidates[0].index&&['references','acknowledgements','appendix'].includes(row.kind)&&!row.toc)?.index??rows.length:rows.length,firsts=firstCandidates.filter(row=>row.index<firstEnd&&firstFamily(row)===firstFamily(firstCandidates[0]));
 let start=firsts[0];if(!start){const candidates=rows.filter(row=>row.index>after&&!row.toc&&!row.kind&&row.outline===0&&row.text.trim().length>0&&row.text.length<=120);if(candidates.length&&toc)start=candidates[0];}
 if(!start||firsts.length>1)return {...base,warnings:[firsts.length>1?'检测到多个可能的第一章，无法可靠区分示例和实际正文。请在要替换的正文区域放置独立 {{正文}} 占位符。':'无法可靠识别学校模板的正文区域。请在封面、声明之后放置独立 {{正文}} 占位符，或使用提供的通用模板。']};
 const following=rows.slice(start.index+1).filter(row=>row.text.trim()&&!row.toc),hasBody=following.some(row=>row.text.length>=20||row.role==='Normal'||row.node.localName==='tbl');
 if(!hasBody)return {...base,warnings:['模板只有章节标题，没有可确认的正文样例。请使用独立 {{正文}} 占位符标明填充位置。']};
 const finalIndex=rows.findLast(row=>row.node.localName==='sectPr')?.index??rows.length,back=rows.filter(row=>row.index>start.index&&['references','acknowledgements','appendix'].includes(row.kind)&&!row.toc),end=back[0]?.index??finalIndex;
 const regions=[{kind:'body',startIndex:start.index,endIndex:end,label:'论文正文'}];
 for(let i=0;i<back.length;i++){const row=back[i];regions.push({kind:row.kind,startIndex:row.index,endIndex:back[i+1]?.index??finalIndex,label:visibleLabel(row.text).slice(0,96)});}
 if(toc&&toc.index<start.index){const boundary=rows.slice(toc.index+1,start.index).find(row=>row.section);regions.push({kind:'toc',startIndex:toc.index,endIndex:boundary?boundary.index+1:start.index,label:'目录'});}
 const tocIndex=toc?.index??start.index,frontFloor=frontMarker?.index??-1,abstracts=rows.filter(row=>row.index>frontFloor&&row.index<tocIndex&&['abstract_zh','abstract_en'].includes(row.kind));
 if(abstracts.filter(row=>row.kind==='abstract_zh').length>1||abstracts.filter(row=>row.kind==='abstract_en').length>1)return {...base,warnings:['检测到重复的摘要区域，无法可靠选择模板正文。请使用独立 {{正文}} 占位符。']};
 for(let i=0;i<abstracts.length;i++){const row=abstracts[i],limit=abstracts[i+1]?.index??tocIndex,boundary=rows.slice(row.index+1,limit).find(item=>item.section);let endIndex=boundary?boundary.index+1:limit;
  const nextTitle=rows.slice(row.index+1,endIndex).find(item=>/^(?:Title|英文题名|英文题目)[（(:：]/i.test(item.text.trim()));if(nextTitle)endIndex=nextTitle.index;
  regions.push({kind:row.kind,startIndex:row.index,endIndex,label:row.kind==='abstract_zh'?'中文摘要':'英文摘要'});
 }
 // Recognize title examples immediately adjacent to an actual abstract, never
 // guess arbitrary personal data or rewrite the institutional cover.
 for(const abstract of abstracts){const previous=rows.slice(Math.max(frontFloor+1,abstract.index-4),abstract.index).filter(row=>row.text.trim()).at(-1);if(previous&&/^(?:(?:毕业论文[（(]设计[）)])?题名|论文题目|Title)[（(:：]/i.test(previous.text.trim()))regions.push({kind:abstract.kind==='abstract_en'?'title_en':'title',startIndex:previous.index,endIndex:previous.index+1,label:'题名示例'});}
 // A writing guide before an independently sectioned formal cover is not
 // manuscript content. Only this narrowly recognized prefix is omitted.
 if(rows.slice(0,3).some(row=>/毕业论文.{0,10}(?:撰写规范|规范要求|撰写要求)/.test(row.text))){const cut=rows.find(row=>row.section&&row.index<start.index),cover=cut&&rows.slice(cut.index+1,Math.min(start.index,cut.index+35));if(cover?.some(row=>/毕业论文|毕业设计/.test(row.text))&&cover.some(row=>/题\s*目|学\s*号|学\s*生/.test(row.text))){regions.push({kind:'instructions',startIndex:0,endIndex:cut.index+1,label:'模板附带的撰写说明'});base.warnings.push('已识别模板前置撰写说明页，导出时将移除说明并保留后续学校封面。');}}
 const tocRegion=regions.find(row=>row.kind==='toc');if(tocRegion&&tocRegion.endIndex<start.index){const gap=rows.slice(tocRegion.endIndex,start.index),nonempty=gap.filter(row=>row.text.trim());if(nonempty.length&&nonempty.some(row=>/^术\s*语\s*表/.test(row.text))&&nonempty.every(row=>/^术\s*语\s*表|^说明[:：]|^\s*$/.test(row.text))){regions.push({kind:'instructions',startIndex:tocRegion.endIndex,endIndex:start.index,label:'术语表说明示例'});base.warnings.push('术语表仅含模板填写说明，已移除示例说明；实际术语表需由作者提供。');}}
 regions.sort((a,b)=>a.startIndex-b.startIndex);if(regions.some((row,index)=>index&&row.startIndex<regions[index-1].endIndex)||!safeRanges(rows,regions))return {...base,warnings:['正文与目录、书签或域边界交叉，无法安全替换。请在独立段落使用 {{正文}} 明确正文位置。']};
 const examples=back.map(row=>row.kind==='acknowledgements'?'致谢':row.kind==='appendix'?'附录':null).filter(Boolean);if(examples.length)base.warnings.push('未提供的'+[...new Set(examples)].join('、')+'将清除模板示例内容，并保留明确的待补充标记。');
 base.warnings.push('保留学校封面、声明、原有页眉页脚、分节与文档部件；未提供的个人信息需自行填写，最终分页与目录仍需核对。');
 return {...base,mode:'recognized_body',preservesTemplate:true,candidate:{startIndex:start.index,endIndex:end,startText:start.text.slice(0,96),endText:(rows[end]?.text||'文档末尾').slice(0,96),description:'已识别学校模板的正文、摘要与目录区域，将替换示例内容并保留外围版式。'},regions,...roleSamples(rows,regions,styles)};
}
function resolvePart(base,target){const parts=base.split('/').slice(0,-1);for(const part of target.split('/'))if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);return parts.join('/');}
export function decodeThesisTemplateXml(bytes){
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),encoding=data[0]===0xff&&data[1]===0xfe?'utf-16le':data[0]===0xfe&&data[1]===0xff?'utf-16be':data[0]===0x3c&&data[1]===0?'utf-16le':data[0]===0&&data[1]===0x3c?'utf-16be':'utf-8';let value;try{value=new TextDecoder(encoding,{fatal:true}).decode(data);}catch{throw Error('模板 XML 编码无效。');}if(/<!DOCTYPE|<!ENTITY/i.test(value))throw Error('不支持含 DTD 或实体声明的模板。');return value;
}
export async function inspectThesisTemplatePlacement(bytes){
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);if(data.byteLength>2*1024*1024)throw Error('DOCX 模板不能超过 2 MB。');const zip=await JSZip.loadAsync(data),files=Object.values(zip.files).filter(row=>!row.dir);if(files.length>200||files.some(row=>Number(row._data?.uncompressedSize)>8*1024*1024)||files.reduce((sum,row)=>sum+Number(row._data?.uncompressedSize||0),0)>25*1024*1024)throw Error('模板结构超出可识别范围。');
 const read=async file=>decodeThesisTemplateXml(await file.async('uint8array')),parse=value=>new DOMParser({onError:()=>{throw Error('模板 XML 损坏。');}}).parseFromString(value,'application/xml'),documentFile=zip.file('word/document.xml');if(!documentFile)throw Error('DOCX 模板缺少正文。');const document=parse(await read(documentFile));
 let stylePart='word/styles.xml';const relationships=zip.file('word/_rels/document.xml.rels');if(relationships){const relation=[...parse(await read(relationships)).getElementsByTagNameNS(P,'Relationship')].find(row=>row.getAttribute('Type')===R+'/styles'&&row.getAttribute('TargetMode')!=='External');if(relation)stylePart=resolvePart('word/document.xml',relation.getAttribute('Target'));}
 const styles=zip.file(stylePart)?parse(await read(zip.file(stylePart))):null,report=analyzeThesisTemplatePlacement(document,styles);let hash=2166136261;for(const byte of data)hash=Math.imul(hash^byte,16777619);return {...report,sourceFingerprint:'advisory-fnv1a32:'+((hash>>>0).toString(16).padStart(8,'0'))};
}
