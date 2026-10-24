import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {defaultThesisTemplateProfile,prepareThesisDocxTemplate} from './thesis-template-profile.js';
import {analyzeThesisTemplatePlacement,decodeThesisTemplateXml} from './thesis-template-placement.js';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',P='http://schemas.openxmlformats.org/package/2006/relationships',CT='http://schemas.openxmlformats.org/package/2006/content-types';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const parse=value=>new DOMParser().parseFromString(value,'application/xml'),xml=node=>new XMLSerializer().serializeToString(node).replace(/^(<\?xml[^?]*encoding\s*=\s*["'])utf-16(?:le|be)?(["'][^?]*\?>)/i,'$1UTF-8$2');
const readXml=async file=>decodeThesisTemplateXml(await file.async('uint8array'));
const children=(node,name)=>node?[...node.childNodes].filter(n=>n.nodeType===1&&(!name||n.namespaceURI===W&&n.localName===name)):[];
const texts=node=>[...node.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('');
const run=value=>`<w:r><w:t xml:space="preserve">${esc(value)}</w:t></w:r>`;
const p=(value,style='Normal',extra='')=>`<w:p><w:pPr><w:pStyle w:val="PK${style}"/>${extra}</w:pPr>${run(value)}</w:p>`;
const displayHeading=value=>String(value).trim().replace(/^#{1,3}\s+/,'');
const referenceHeading=value=>!/^参考文献整理原文/.test(displayHeading(value))&&/^(?:参考文献|已使用的参考文献)|^(?:references|bibliography)$/i.test(displayHeading(value));
const nonCitationHeading=value=>/^(?:待引用文献|参考文献整理原文|研究材料来源|引用核对提示)/.test(displayHeading(value));
const heading=(value)=>{const s=String(value).trim();if(referenceHeading(s)||nonCitationHeading(s))return 1;if(/^#{1,3}\s+/.test(s))return s.match(/^#+/)[0].length;if(s.length>120||/[。！？；;]/u.test(s))return 0;if(/^\d+\.\d+\.\d+(?:\s|[、.．])/u.test(s))return 3;if(/^\d+\.\d+(?:\s|[、.．])/u.test(s))return 2;if(/^(?:第.{1,12}[章节篇]|\d{1,2}[、.．\s]|[一二三四五六七八九十]+[、．]|参考文献|已使用的参考文献|待引用文献|研究材料来源|附录|致谢|引用核对提示)/u.test(s)||/^(?:绪论|引言|研究背景|研究方法|材料与方法|结果|讨论|结论|总结|结论与展望|references|bibliography)$/i.test(s))return 1;return 0;};
const abstract=value=>/^(?:摘\s*要|abstract)$/i.test(displayHeading(value));
function rPr(rule){return `<w:rFonts w:ascii="${esc(rule.ascii)}" w:hAnsi="${esc(rule.ascii)}" w:eastAsia="${esc(rule.eastAsia)}"/><w:b w:val="${rule.bold?1:0}"/><w:color w:val="000000"/><w:sz w:val="${rule.size}"/><w:szCs w:val="${rule.size}"/>`;}
function pPr(rule){return `<w:jc w:val="${rule.alignment}"/><w:spacing w:before="${rule.before}" w:after="${rule.after}" w:line="${rule.line}" w:lineRule="${rule.lineRule}"/>${rule.hanging>0?`<w:ind w:left="${rule.hanging}" w:hanging="${rule.hanging}" w:hangingChars="${Math.round(rule.hanging/(rule.size*10)*100)}" w:firstLineChars="0"/>`:`<w:ind w:firstLine="${rule.firstLine||0}" w:firstLineChars="${rule.firstLineChars||0}"/>`}${rule.pageBreakBefore?'<w:pageBreakBefore/>':''}`;}
function styleEntries(rules){
 const styles=Object.entries(rules.styles).map(([role,rule])=>`<w:style w:type="paragraph" w:styleId="PK${role}"><w:name w:val="PaperKnow ${role}"/>${role==='Normal'?'':'<w:basedOn w:val="PKNormal"/>'}<w:next w:val="PKNormal"/><w:pPr>${pPr(rule)}${role.startsWith('Heading')?`<w:keepNext/><w:keepLines/><w:outlineLvl w:val="${Number(role.at(-1))-1}"/>`:''}</w:pPr><w:rPr>${rPr(rule)}</w:rPr></w:style>`).join('');
 return styles+`<w:style w:type="paragraph" w:styleId="PKCode"><w:name w:val="PaperKnow Code"/><w:pPr><w:ind w:firstLine="0" w:firstLineChars="0"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="atLeast"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="PKFrontHeading"><w:name w:val="PaperKnow Front Heading"/><w:basedOn w:val="PKHeading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>`+['1','2','3'].map(level=>`<w:style w:type="paragraph" w:styleId="PKTOC${level}"><w:name w:val="PaperKnow TOC ${level}"/><w:basedOn w:val="PKNormal"/><w:pPr><w:spacing w:before="0" w:after="80" w:line="300" w:lineRule="auto"/><w:ind w:left="${(Number(level)-1)*240}" w:firstLine="0" w:firstLineChars="0" w:hanging="0"/></w:pPr></w:style>`).join('');
}
function section(page,{front=false,cover=false,footer='pkFooter',header='',refs=''}={}){return `<w:sectPr>${!cover?`${header}${refs||`<w:footerReference w:type="default" r:id="${footer}"/>`}`:''}<w:type w:val="nextPage"/><w:pgSz w:w="${page.width}" w:h="${page.height}"/><w:pgMar w:top="${page.top}" w:bottom="${page.bottom}" w:left="${page.left}" w:right="${page.right}" w:header="${page.header}" w:footer="${page.footer}" w:gutter="${page.gutter}"/>${!cover?`<w:pgNumType w:fmt="${front?'upperRoman':'decimal'}" w:start="1"/>`:''}</w:sectPr>`;}
const sectionBreak=section=>`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${section}</w:pPr></w:p>`;
function contents(headings,width){
 const entries=headings.map(({text,level,id})=>`<w:p><w:pPr><w:pStyle w:val="PKTOC${level}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${Math.max(720,width-120)}"/></w:tabs></w:pPr><w:hyperlink w:anchor="PK_${id}">${run(text)}</w:hyperlink><w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF PK_${id} \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(' ')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`).join('');
 // The cached TOC contains actual headings without invented page numbers.
 // Word/WPS calculates hyperlinks and page numbers from the native TOC field.
 return p('目录','FrontHeading')+`<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>${entries}<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
}
function cover(title,metadata){
 const labels=[['author','作者'],['major','学科专业'],['supervisor','指导教师']];
 const known=labels.filter(([key])=>String(metadata[key]||'').trim()).map(([key,label])=>p(`${label}：${metadata[key]}`,'Normal','<w:jc w:val="center"/><w:ind w:firstLine="0" w:firstLineChars="0"/><w:spacing w:before="180" w:after="0"/>')).join('');
 const degree=String(metadata.level||'').trim(),kind=['专科','本科','硕士','博士'].includes(degree)?degree+'毕业论文':'研究论文';
 return p(metadata.institution||'','Normal','<w:jc w:val="center"/><w:ind w:firstLine="0" w:firstLineChars="0"/>')+p(kind,'FrontHeading','<w:jc w:val="center"/><w:pageBreakBefore w:val="0"/><w:spacing w:before="1600" w:after="800"/>')+p(title,'Title')+p('','Normal','<w:spacing w:after="800"/>')+known;
}
function addBookmark(node,{id,name}){
 const doc=node.ownerDocument,start=doc.createElementNS(W,'w:bookmarkStart'),end=doc.createElementNS(W,'w:bookmarkEnd');start.setAttributeNS(W,'w:id',String(id));start.setAttributeNS(W,'w:name',name);end.setAttributeNS(W,'w:id',String(id));node.insertBefore(start,node.childNodes[1]||null);node.appendChild(end);
}
function linkCitations(node,targets,block,ranges){
 // Only source-marker provenance authorizes a citation. A matching [n] in a
 // bibliography is insufficient: array indices and literal symbols stay text.
 if(!ranges.size||!Number.isSafeInteger(block.sourceStart)||!Array.isArray(block.inlineSegments))return;
 const parts=children(node).filter(child=>child.localName!=='pPr');if(parts.length!==block.inlineSegments.length)return;
 for(const [index,segment]of block.inlineSegments.entries()){
  const original=parts[index];if(segment.formula||original.namespaceURI!==W||original.localName!=='r'||children(original).some(child=>!['rPr','t'].includes(child.localName)))continue;
  const value=texts(original),plain=String(segment.text||'');if(value!==plain.replace(/\t/g,'    '))continue;
  const code=[...plain.matchAll(/(`+)([\s\S]*?)\1/g)].map(match=>[match.index,match.index+match[0].length]),matches=[];let sourceCursor=0,visibleCursor=0;
  for(const match of plain.matchAll(/\[([1-9]\d{0,3})\]/g)){
   const start=block.sourceStart+segment.sourceOffset+match.index,range=ranges.get(start),number=Number(match[1]);
   if(!range||range.number!==number||range.end!==start+match[0].length||!targets.has(number)||code.some(([from,to])=>match.index>=from&&match.index<to))continue;
   visibleCursor+=plain.slice(sourceCursor,match.index).replace(/\t/g,'    ').length;matches.push({index:visibleCursor,0:match[0],1:match[1]});visibleCursor+=match[0].length;sourceCursor=match.index+match[0].length;
  }
  if(!matches.length)continue;
  const doc=node.ownerDocument,properties=children(original,'rPr')[0];let cursor=0;
  const makeRun=(text,superscript=false)=>{const result=doc.createElementNS(W,'w:r'),pr=properties?properties.cloneNode(true):doc.createElementNS(W,'w:rPr');if(superscript){for(const old of children(pr,'vertAlign'))pr.removeChild(old);const align=doc.createElementNS(W,'w:vertAlign');align.setAttributeNS(W,'w:val','superscript');pr.appendChild(align);}if(pr.childNodes.length)result.appendChild(pr);const t=doc.createElementNS(W,'w:t');t.setAttribute('xml:space','preserve');t.textContent=text;result.appendChild(t);return result;};
  for(const match of matches){if(match.index>cursor)node.insertBefore(makeRun(value.slice(cursor,match.index)),original);const link=doc.createElementNS(W,'w:hyperlink');link.setAttributeNS(W,'w:anchor',targets.get(Number(match[1])).name);link.setAttributeNS(W,'w:history','1');link.appendChild(makeRun(match[0],true));node.insertBefore(link,original);cursor=match.index+match[0].length;}
  if(cursor<value.length)node.insertBefore(makeRun(value.slice(cursor)),original);node.removeChild(original);
 }
}
function rewriteBlock(node,block,{reference=false,frontMatter=false,id=0,headingLevel,referenceAnchor,citationTargets,citationRanges,inputAnchor}={}){
 const doc=node.ownerDocument;
 if(block.type==='table'){
  for(const para of node.getElementsByTagNameNS(W,'p'))setParagraphStyle(para,'TableText');
  for(const shade of [...node.getElementsByTagNameNS(W,'shd')])shade.setAttributeNS(W,'w:fill','F2F2F2');
  if(inputAnchor&&node.getElementsByTagNameNS(W,'p')[0])addBookmark(node.getElementsByTagNameNS(W,'p')[0],inputAnchor);
  return xml(node);
 }
 const level=block.literal||block.type==='formula'||block.type==='figure'?0:headingLevel??heading(block.text),role=block.literal?'Code':level?'Heading'+level:reference?'References':frontMatter?'Abstract':'Normal';
 setParagraphStyle(node,role);
 if(block.type==='figure'){const pr=children(node,'pPr')[0],jc=doc.createElementNS(W,'w:jc'),ind=doc.createElementNS(W,'w:ind'),keep=doc.createElementNS(W,'w:keepLines');jc.setAttributeNS(W,'w:val','center');ind.setAttributeNS(W,'w:firstLine','0');ind.setAttributeNS(W,'w:firstLineChars','0');pr.appendChild(jc);pr.appendChild(ind);pr.appendChild(keep);}
 if(block.type==='formula'){const pr=children(node,'pPr')[0];const jc=doc.createElementNS(W,'w:jc');jc.setAttributeNS(W,'w:val','center');pr.appendChild(jc);}
 if(level){let remaining=String(block.text).match(/^\s*#{1,3}\s+/)?.[0].length||0;for(const text of node.getElementsByTagNameNS(W,'t')){if(!remaining)break;const removed=Math.min(remaining,text.textContent.length);text.textContent=text.textContent.slice(removed);remaining-=removed;}addBookmark(node,{id,name:'PK_'+id});}
 if(referenceAnchor)addBookmark(node,referenceAnchor);
 if(!level&&!reference&&!block.literal&&block.type!=='formula'&&citationTargets?.size)linkCitations(node,citationTargets,block,citationRanges);
 if(inputAnchor)addBookmark(node,inputAnchor);
 return xml(node);
}
function setParagraphStyle(node,role){
 for(const old of children(node,'pPr'))node.removeChild(old);
 const pr=node.ownerDocument.createElementNS(W,'w:pPr'),s=node.ownerDocument.createElementNS(W,'w:pStyle');s.setAttributeNS(W,'w:val','PK'+role);pr.appendChild(s);node.insertBefore(pr,node.firstChild);
 // The paragraph role controls typography; retain semantic emphasis and
 // super/subscripts while removing direct fonts, sizes and theme colors.
 const semantic=new Set(['b','bCs','i','iCs','u','strike','dstrike','vertAlign']);
 for(const old of [...node.getElementsByTagNameNS(W,'rPr')])if(old.parentNode?.namespaceURI===W&&old.parentNode.localName==='r'){for(const property of children(old))if(!semantic.has(property.localName))old.removeChild(property);if(!old.childNodes.length)old.parentNode.removeChild(old);}
}
function resolvePart(base,target){const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const s of target.split('/'))if(s==='..')parts.pop();else if(s&&s!=='.')parts.push(s);return parts.join('/');}
function contentWidth(page){const width=page.width-page.left-page.right-page.gutter;if(!Number.isFinite(width)||width<720)throw Error('模板正文区域过窄，未导出可能溢出的文件，请核对页边距。');return width;}
function contentHeight(page){const height=page.height-page.top-page.bottom;if(!Number.isFinite(height)||height<720)throw Error('模板正文区域过矮，无法安全放置图片与说明，请核对纸张高度和页边距。');return height;}
function sectionContentArea(section,page){
 if(!section)return {width:contentWidth(page),height:contentHeight(page)};
 const size=children(section,'pgSz')[0],margins=children(section,'pgMar')[0],read=(node,name,fallback)=>node?.hasAttributeNS(W,name)?Number(node.getAttributeNS(W,name)):fallback,values={width:read(size,'w',page.width),height:read(size,'h',page.height),left:read(margins,'left',page.left),right:read(margins,'right',page.right),gutter:read(margins,'gutter',page.gutter),top:read(margins,'top',page.top),bottom:read(margins,'bottom',page.bottom)};let width=contentWidth(values);
 const cols=children(section,'cols')[0],explicit=children(cols,'col').map(node=>Number(node.getAttributeNS(W,'w'))).filter(value=>Number.isFinite(value)&&value>0),count=read(cols,'num',1),space=read(cols,'space',720);if(explicit.length)width=Math.min(width,...explicit);else if(Number.isInteger(count)&&count>1&&count<=10)width=(width-(count-1)*space)/count;if(width<720)throw Error('模板正文分栏过窄，请核对分栏设置。');return {width,height:contentHeight(values)};
}
function figureCaptionLayout(paragraph,width,captionRule){
 const defaults=captionRule&&typeof captionRule==='object'?captionRule:{size:captionRule||24};
 const pr=children(paragraph,'pPr')[0],spacing=children(pr,'spacing')[0],read=name=>Math.max(0,Number(spacing?.hasAttributeNS(W,name)?spacing.getAttributeNS(W,name):defaults[name]||0)),sizes=[...paragraph.getElementsByTagNameNS(W,'r')].filter(node=>node.getElementsByTagNameNS(W,'t').length).flatMap(node=>[...node.getElementsByTagNameNS(W,'sz')].map(size=>Number(size.getAttributeNS(W,'val')))).filter(size=>Number.isFinite(size)&&size>0),size=Math.max(defaults.size||24,...sizes),em=size*10;
 // Counting every codepoint as one em deliberately reserves at least the
 // width needed by Chinese text and is conservative for Latin captions.
 const lines=texts(paragraph).split(/\r?\n/).reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].length*em/width)),0),line=read('line'),rule=spacing?.getAttributeNS(W,'lineRule')||defaults.lineRule||'auto',lineHeight=Math.max(em*1.3,line?rule==='auto'?em*line/240:line:em*1.5);
 return {reserved:Math.ceil(lines*lineHeight+read('before')+read('after')+em*.8+160),lineHeight:Math.ceil(lineHeight),before:read('before'),after:read('after')};
}
function fitTables(body,width,height=Infinity,captionRule=24){
 if(!body.includes('<w:tbl')&&!body.includes('PKFigure_'))return body;
 const fragment=parse(`<w:body xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${body}</w:body>`);
 for(const table of fragment.getElementsByTagNameNS(W,'tbl')){
  const grid=children(table,'tblGrid')[0],columns=grid?children(grid,'gridCol'):[],total=columns.reduce((sum,column)=>sum+Number(column.getAttributeNS(W,'w')||0),0);if(!total)continue;
  const ratio=width/total,properties=children(table,'tblPr')[0],tableWidth=properties&&children(properties,'tblW')[0];if(tableWidth){tableWidth.setAttributeNS(W,'w:w',String(width));tableWidth.setAttributeNS(W,'w:type','dxa');}
  for(const item of [...columns,...table.getElementsByTagNameNS(W,'tcW')])item.setAttributeNS(W,'w:w',String(Math.max(1,Math.round(Number(item.getAttributeNS(W,'w')||0)*ratio))));
 }
 for(const inline of fragment.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','inline')){if(![...inline.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','docPr')].some(node=>node.getAttribute('name').startsWith('PKFigure_')))continue;const extent=inline.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','extent')[0],cx=Number(extent?.getAttribute('cx')),cy=Number(extent?.getAttribute('cy'));if(!cx||!cy)throw Error('论文图片尺寸无效，已停止导出。');let paragraph=inline;while(paragraph&&!(paragraph.namespaceURI===W&&paragraph.localName==='p'))paragraph=paragraph.parentNode;if(!paragraph)throw Error('论文图片段落无效，已停止导出。');const layout=figureCaptionLayout(paragraph,width,captionRule),properties=children(paragraph,'pPr')[0],spacing=children(properties,'spacing')[0]||paragraph.ownerDocument.createElementNS(W,'w:spacing');if(!spacing.parentNode)properties.appendChild(spacing);spacing.setAttributeNS(W,'w:lineRule','atLeast');spacing.setAttributeNS(W,'w:line',String(layout.lineHeight));spacing.setAttributeNS(W,'w:before',String(layout.before));spacing.setAttributeNS(W,'w:after',String(layout.after));const available=height-layout.reserved;if(available<720)throw Error('模板正文可用高度不足以同时放置图片及多行说明，请缩短图片说明或调整模板纸张和页边距。');const ratio=Math.min(1,width*635/cx,available*635/cy);if(ratio<1)for(const size of [extent,...inline.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','ext')]){size.setAttribute('cx',String(Math.floor(cx*ratio)));size.setAttribute('cy',String(Math.floor(cy*ratio)));}}
 return children(fragment.documentElement).map(xml).join('');
}
function slotContentArea(root,slot,page){
 const following=children(root).slice(children(root).indexOf(slot));let section;
 for(const node of following){section=node.localName==='sectPr'?node:node.getElementsByTagNameNS(W,'sectPr')[0];if(section)break;}
 return sectionContentArea(section,page);
}
const slotContentWidth=(root,slot,page)=>slotContentArea(root,slot,page).width;
async function relatedPart(zip,type,fallback){const rels=zip.file('word/_rels/document.xml.rels');if(rels){const rel=[...parse(await readXml(rels)).getElementsByTagNameNS(P,'Relationship')].find(n=>n.getAttribute('Type')===R+'/'+type);if(rel)return resolvePart('word/document.xml',rel.getAttribute('Target'));}return fallback;}
async function headerFooterParts(source,target,document,rels,{chapterTitle=''}={}){
 const sourceRels=source.file('word/_rels/document.xml.rels');if(!sourceRels)return {references:'',relationships:'',contentTypes:[]};
 const map=new Map([...parse(await readXml(sourceRels)).getElementsByTagNameNS(P,'Relationship')].map(n=>[n.getAttribute('Id'),n]));
 const sect=[...document.getElementsByTagNameNS(W,'sectPr')].at(-1);let references='',relationships='';const types=[];const visited=new Set();
 async function copy(part){if(visited.has(part))return;visited.add(part);const f=source.file(part);if(!f)throw Error('模板页眉页脚部件缺失，请重新上传。');target.file(part,await f.async('uint8array'));const relpart=part.replace(/(^|\/)([^/]+)$/,'$1_rels/$2.rels'),rf=source.file(relpart);if(rf){target.file(relpart,await rf.async('uint8array'));for(const r of parse(await readXml(rf)).getElementsByTagNameNS(P,'Relationship'))if(r.getAttribute('TargetMode')!=='External')await copy(resolvePart(part,r.getAttribute('Target')));}}
 for(const ref of sect?children(sect).filter(n=>['headerReference','footerReference'].includes(n.localName)):[]){if(ref.getAttributeNS(W,'type')!=='default')continue;const r=map.get(ref.getAttributeNS(R,'id'));if(!r)throw Error('模板页眉页脚关联失效。');const part=resolvePart('word/document.xml',r.getAttribute('Target'));await copy(part);
  if(ref.localName==='headerReference'){
   const header=parse(await readXml(target.file(part))),label=texts(header).replace(/\s/g,'');
   // A last-section chapter label is not a school-wide header. In a rebuilt
   // manuscript it must follow the actual chapter, never repeat “致谢” on every
   // body page. Fixed institutional text and visual/header links are untouched.
   if(/^(?:第.{1,12}[章节篇].{0,80}|参考文献|致谢|摘要|目录|正文|附录.{0,20})$/.test(label)&&!header.getElementsByTagNameNS(W,'hyperlink').length&&!header.getElementsByTagNameNS(W,'drawing').length&&!header.getElementsByTagNameNS(W,'pict').length){
    const para=[...header.getElementsByTagNameNS(W,'p')].find(node=>texts(node).trim());if(para){for(const node of [...para.childNodes])if(!(node.namespaceURI===W&&node.localName==='pPr'))para.removeChild(node);const field=header.createElementNS(W,'w:fldSimple');field.setAttributeNS(W,'w:instr',' STYLEREF "PaperKnow Heading1" ');field.setAttributeNS(W,'w:dirty','true');const wrapped=parse(`<w:p xmlns:w="${W}">${run(chapterTitle)}</w:p>`);for(const child of children(wrapped.documentElement))field.appendChild(header.importNode(child,true));para.appendChild(field);target.file(part,xml(header));}
   }
  }
  const id='pkTemplate'+rels.length;rels.push(id);relationships+=`<Relationship Id="${id}" Type="${esc(r.getAttribute('Type'))}" Target="${esc(r.getAttribute('Target'))}"/>`;references+=`<w:${ref.localName} w:type="default" r:id="${id}"/>`;types.push(part);}
 return {references,relationships,contentTypes:types,copy};
}
async function updatedSettings(zip){const part=await relatedPart(zip,'settings','word/settings.xml');let settings=zip.file(part)?await readXml(zip.file(part)):`<w:settings xmlns:w="${W}"/>`;const doc=parse(settings),root=doc.documentElement;for(const n of [...doc.getElementsByTagNameNS(W,'updateFields')])n.parentNode.removeChild(n);const n=doc.createElementNS(W,'w:updateFields');n.setAttributeNS(W,'w:val','true');root.appendChild(n);zip.file(part,xml(doc));return part;}
async function fillTemplateSlot(source,body,rules,metadata){
 const document=parse(await readXml(source.file('word/document.xml'))),root=document.getElementsByTagNameNS(W,'body')[0];
 const slot=children(root,'p').find(n=>/^\s*\{\{(?:正文|PAPERKNOW_CONTENT)\}\}\s*$/.test(texts(n)));if(!slot)return false;
 const area=slotContentArea(root,slot,rules.page),wrapped=parse(`<w:body xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${fitTables(body,area.width,area.height,rules.styles.Normal)}</w:body>`);
 const values={'论文题目':metadata.title||'','标题':metadata.title||'','学校':metadata.institution||'','作者':metadata.author||'','学位':metadata.level||'','专业':metadata.major||'','指导教师':metadata.supervisor||''};
 for(const para of document.getElementsByTagNameNS(W,'p')){const value=texts(para);if(!/\{\{(?:论文题目|标题|学校|作者|学位|专业|指导教师)\}\}/.test(value))continue;const nodes=[...para.getElementsByTagNameNS(W,'t')];if(nodes.length){nodes[0].textContent=value.replace(/\{\{([^}]+)\}\}/g,(raw,key)=>Object.hasOwn(values,key)?String(values[key]):raw);for(const node of nodes.slice(1))node.textContent='';}}
 for(const n of children(wrapped.documentElement))root.insertBefore(document.importNode(n,true),slot);root.removeChild(slot);
 if(rules.bodyPageNumbers)await applyExplicitBodyPageNumbers(source,document,(metadata.chapterTitles||[]).find(title=>!abstract(title)&&!referenceHeading(title)),rules);
 return finishPreservedTemplate(source,document,rules,metadata);
}
async function finishPreservedTemplate(source,document,rules,metadata){
 await normalizeTemplateFurniture(source);
 source.file('word/document.xml',xml(document));const stylePart=await relatedPart(source,'styles','word/styles.xml'),styles=source.file(stylePart)?parse(await readXml(source.file(stylePart))):parse(`<w:styles xmlns:w="${W}"/>`);for(const n of [...styles.getElementsByTagNameNS(W,'style')])if(/^PK(?:Normal|Title|FrontHeading|Heading[123]|Abstract|References|TableText|Code|TOC[123])$/.test(n.getAttributeNS(W,'styleId')))n.parentNode.removeChild(n);const additions=parse(`<w:styles xmlns:w="${W}">${styleEntries(rules)}</w:styles>`);for(const n of children(additions.documentElement))styles.documentElement.appendChild(styles.importNode(n,true));source.file(stylePart,xml(styles));const settingsPart=await updatedSettings(source);
 const types=parse(await readXml(source.file('[Content_Types].xml')));for(const [part,type]of [['/'+stylePart,'styles'],['/'+settingsPart,'settings']])if(![...types.getElementsByTagNameNS(CT,'Override')].some(n=>n.getAttribute('PartName')===part)){const n=types.createElementNS(types.documentElement.namespaceURI,'Override');n.setAttribute('PartName',part);n.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.'+type+'+xml');types.documentElement.appendChild(n);}source.file('[Content_Types].xml',xml(types));
 const relfile='word/_rels/document.xml.rels',relations=source.file(relfile)?parse(await readXml(source.file(relfile))):parse(`<Relationships xmlns="${P}"/>`),ids=new Set([...relations.getElementsByTagNameNS(P,'Relationship')].map(n=>n.getAttribute('Id')));for(const type of ['styles','settings'])if(![...relations.getElementsByTagNameNS(P,'Relationship')].some(n=>n.getAttribute('Type')===R+'/'+type)){const n=relations.createElementNS(P,'Relationship');let id='pk'+type;while(ids.has(id))id+='_';ids.add(id);n.setAttribute('Id',id);n.setAttribute('Type',R+'/'+type);n.setAttribute('Target',type+'.xml');relations.documentElement.appendChild(n);}source.file(relfile,xml(relations));await updateManuscriptCoreProperties(source,metadata);return source.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
async function updateManuscriptCoreProperties(zip,metadata={}){
 const CP='http://schemas.openxmlformats.org/package/2006/metadata/core-properties',DC='http://purl.org/dc/elements/1.1/',type=P+'/metadata/core-properties',relations=zip.file('_rels/.rels')?parse(await readXml(zip.file('_rels/.rels'))):parse(`<Relationships xmlns="${P}"><Relationship Id="pkDocument" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
 const relationship=[...relations.getElementsByTagNameNS(P,'Relationship')].find(node=>node.getAttribute('Type')===type&&node.getAttribute('TargetMode')!=='External'),part=relationship?resolvePart('package.xml',relationship.getAttribute('Target')):'docProps/core.xml',document=zip.file(part)?parse(await readXml(zip.file(part))):parse(`<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${DC}"/>`),root=document.documentElement;
 if(root.namespaceURI!==CP||root.localName!=='coreProperties')throw Error('模板文档属性结构无效，请重新保存 DOCX 模板后重试。');
 const set=(namespace,name,value)=>{const existing=[...root.childNodes].filter(node=>node.nodeType===1&&node.namespaceURI===namespace&&node.localName===name),node=existing.shift()||document.createElementNS(namespace,(namespace===DC?'dc:':'cp:')+name);for(const duplicate of existing)root.removeChild(duplicate);node.textContent=String(value??'');if(!node.parentNode)root.appendChild(node);};
 set(DC,'title',metadata.title||'');set(DC,'creator',metadata.author||'');set(CP,'lastModifiedBy','PaperKnow');zip.file(part,xml(document));
 if(!relationship){const node=relations.createElementNS(P,'Relationship'),ids=new Set([...relations.getElementsByTagNameNS(P,'Relationship')].map(row=>row.getAttribute('Id')));let id='pkCoreProperties';while(ids.has(id))id+='_';node.setAttribute('Id',id);node.setAttribute('Type',type);node.setAttribute('Target',part);relations.documentElement.appendChild(node);zip.file('_rels/.rels',xml(relations));}
 const types=parse(await readXml(zip.file('[Content_Types].xml')));if(![...types.getElementsByTagNameNS(CT,'Override')].some(node=>node.getAttribute('PartName')==='/'+part)){const node=types.createElementNS(CT,'Override');node.setAttribute('PartName','/'+part);node.setAttribute('ContentType','application/vnd.openxmlformats-package.core-properties+xml');types.documentElement.appendChild(node);zip.file('[Content_Types].xml',xml(types));}
}

function preserveRegionSections(original,placement,region,generated){
 const boundaries=original.filter(node=>node.namespaceURI===W&&node.localName==='p'&&children(children(node,'pPr')[0],'sectPr').length);
 if(!boundaries.length)return generated;
 const result=[...generated],topLevels=result.map((node,index)=>({index,style:children(children(node,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val'),outline:children(children(node,'pPr')[0],'outlineLvl')[0]?.getAttributeNS(W,'val')})).filter(row=>row.style==='PKHeading1'||row.outline==='0');
 let inserted=0;
 for(const boundary of boundaries){
  const local=original.indexOf(boundary),following=original.slice(local+1).some(node=>{const value=texts(node).replace(/\s/g,'');return value&&!/^[（(]空[一二三四五六七八九十\d]+行[）)]$/.test(value);});let at=result.length;
  if(following){
   const before=original.slice(0,local+1).filter(node=>{const pr=children(node,'pPr')[0],outline=children(pr,'outlineLvl')[0]?.getAttributeNS(W,'val'),style=children(pr,'pStyle')[0]?.getAttributeNS(W,'val'),value=texts(node);return outline==='0'||outline===undefined&&style&&style===placement.roleStyles.Heading1||heading(value)===1&&!referenceHeading(value);}).length;
   if(region.kind!=='body'||before<1||topLevels.length<=before)throw Error('模板正文包含无法与本次章节对应的独立分节。请在保留的学校版式中设置独立 {{正文}} 占位符后重新上传。');
   at=topLevels[before].index+inserted;
  }
  const carrier=boundary.cloneNode(false),properties=children(boundary,'pPr')[0].cloneNode(true);carrier.appendChild(properties);result.splice(at,0,carrier);inserted++;
 }
 return result;
}
function fitInsertedSections(nodes,root,anchor,page,captionRule=24){
 const result=[...nodes],fallback=slotContentArea(root,anchor,page);let start=0;
 const fit=(end,area)=>{for(let index=start;index<end;index++)if(result[index].getElementsByTagNameNS(W,'tbl').length||result[index].localName==='tbl'||result[index].getElementsByTagNameNS(W,'drawing').length){const fragment=parse(`<w:body xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${fitTables(xml(result[index]),area.width,area.height,captionRule)}</w:body>`);result[index]=children(fragment.documentElement)[0];}start=end+1;};
 for(let index=0;index<result.length;index++){const section=children(children(result[index],'pPr')[0],'sectPr')[0];if(section)fit(index,sectionContentArea(section,page));}
 fit(result.length,fallback);return result;
}
function adoptTemplateParagraphs(fragment,sourceNodes,placement,stylesDocument,region){
 const styleNodes=new Map([...stylesDocument.getElementsByTagNameNS(W,'style')].map(node=>[node.getAttributeNS(W,'styleId'),node]));
 const defaultStyle=[...styleNodes.values()].find(node=>node.getAttributeNS(W,'type')==='paragraph'&&['1','true','on'].includes(node.getAttributeNS(W,'default')))||styleNodes.get('Normal'),defaults=stylesDocument.getElementsByTagNameNS(W,'docDefaults')[0];
 const inherited=(sample,type)=>{const groups=[],seen=new Set();let id=children(children(sample,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val')||defaultStyle?.getAttributeNS(W,'styleId');while(id&&!seen.has(id)){seen.add(id);const style=styleNodes.get(id);if(!style)break;const group=children(style,type)[0];if(group)groups.push(group);id=children(style,'basedOn')[0]?.getAttributeNS(W,'val');}const group=children(children(defaults,type==='pPr'?'pPrDefault':'rPrDefault')[0],type)[0];if(group)groups.push(group);return groups;};
 const numbered=(id,seen=new Set())=>{if(!id||seen.has(id))return false;seen.add(id);const style=styleNodes.get(id);return Boolean(children(children(style,'pPr')[0],'numPr').length)||numbered(children(style,'basedOn')[0]?.getAttributeNS(W,'val'),seen);};
 for(const paragraph of fragment.getElementsByTagNameNS(W,'p')){
  const current=children(paragraph,'pPr')[0],style=children(current,'pStyle')[0]?.getAttributeNS(W,'val'),role=style?.match(/^PK(Normal|Title|Heading[123]|Abstract|References|TableText|FrontHeading|TOC[123])$/)?.[1];if(!role)continue;
  let sample=sourceNodes[placement.roleSamples[role]],styleId=placement.roleStyles[role];
  if(role==='Title'&&['title','title_en'].includes(region.kind)){sample=sourceNodes[region.startIndex];styleId=children(children(sample,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val');}
  if(role==='Abstract'&&region.kind.startsWith('abstract_')){const candidate=sourceNodes[region.startIndex];if(/[:：]/.test(texts(candidate)))sample=candidate;else sample=sourceNodes.slice(region.startIndex+1,region.endIndex).find(node=>node.localName==='p'&&texts(node).trim());styleId=children(children(sample,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val');}
  if(role==='Heading1'&&['references','acknowledgements','appendix'].includes(region.kind)&&paragraph===children(fragment.documentElement).find(node=>node.localName==='p')){sample=sourceNodes[region.startIndex];styleId=children(children(sample,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val');}
  if(role==='FrontHeading'&&region.kind!=='body'){sample=sourceNodes[region.startIndex];styleId=children(children(sample,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val');}
  if(role.startsWith('TOC')){styleId=[...styleNodes.values()].find(node=>new RegExp('^(?:TOC\\s*|目录\\s*)'+role.at(-1)+'$','i').test(children(node,'name')[0]?.getAttributeNS(W,'val')||''))?.getAttributeNS(W,'styleId');}
  if(sample?.localName!=='p')sample=null;
  const samplePr=sample&&children(sample,'pPr')[0],properties=samplePr?samplePr.cloneNode(true):current.cloneNode(true),doc=paragraph.ownerDocument;
  if(sample)for(const group of inherited(sample,'pPr'))for(const child of children(group))if(!['sectPr','pStyle'].includes(child.localName)&&!children(properties,child.localName).length)properties.appendChild(doc.importNode(child,true));
  for(const node of children(properties).filter(node=>['sectPr','pStyle','numPr'].includes(node.localName)))properties.removeChild(node);
  const styleProperty=doc.createElementNS(W,'w:pStyle');styleProperty.setAttributeNS(W,'w:val',styleId||style);properties.insertBefore(styleProperty,properties.firstChild);
  if(sample&&!styleId)for(const name of ['pageBreakBefore','keepNext','keepLines'])if(!children(properties,name).length){const property=doc.createElementNS(W,'w:'+name);property.setAttributeNS(W,'w:val','0');properties.appendChild(property);}
  if(/^Heading[123]$/.test(role)){
   if(!children(properties,'outlineLvl').length){const outline=doc.createElementNS(W,'w:outlineLvl');outline.setAttributeNS(W,'w:val',String(Number(role.at(-1))-1));properties.appendChild(outline);}
   if(numbered(styleId)||samplePr&&children(samplePr,'numPr').length){const num=doc.createElementNS(W,'w:numPr'),id=doc.createElementNS(W,'w:numId');id.setAttributeNS(W,'w:val','0');num.appendChild(id);properties.appendChild(num);}
  }
  // A table cell or formula may have meaningful generated alignment; source
  // typography must not erase the formula's own centered paragraph geometry.
  if(paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math','oMathPara').length){for(const jc of children(properties,'jc'))properties.removeChild(jc);const jc=doc.createElementNS(W,'w:jc');jc.setAttributeNS(W,'w:val','center');properties.appendChild(jc);}
  if([...paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','docPr')].some(node=>node.getAttribute('name').startsWith('PKFigure_'))){for(const property of children(properties).filter(node=>['jc','ind'].includes(node.localName)))properties.removeChild(property);const jc=doc.createElementNS(W,'w:jc'),ind=doc.createElementNS(W,'w:ind');jc.setAttributeNS(W,'w:val','center');ind.setAttributeNS(W,'w:firstLine','0');ind.setAttributeNS(W,'w:firstLineChars','0');properties.appendChild(jc);properties.appendChild(ind);if(!children(properties,'keepLines').length)properties.appendChild(doc.createElementNS(W,'w:keepLines'));for(const spacing of children(properties,'spacing'))if(spacing.getAttributeNS(W,'lineRule')==='exact')spacing.setAttributeNS(W,'w:lineRule','atLeast');}
  if(paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math','oMath').length)for(const spacing of children(properties,'spacing'))if(spacing.getAttributeNS(W,'lineRule')==='exact')spacing.setAttributeNS(W,'w:lineRule','atLeast');
  paragraph.replaceChild(doc.importNode(properties,true),current);
  let sourceRun=sample&&[...sample.getElementsByTagNameNS(W,'r')].filter(node=>texts(node).length).sort((a,b)=>texts(b).length-texts(a).length)[0];
  if(role==='Abstract'&&sample&&/[:：]/.test(texts(sample))){const runs=[...sample.getElementsByTagNameNS(W,'r')],colon=runs.findIndex(node=>/[:：]/.test(texts(node)));sourceRun=runs.slice(colon+1).find(node=>texts(node).trim()&&!children(children(node,'rPr')[0],'b').some(b=>!['0','false','off'].includes(b.getAttributeNS(W,'val'))))||sourceRun;}
  const sourceGroups=sample?[sourceRun&&children(sourceRun,'rPr')[0],children(samplePr,'rPr')[0],...inherited(sample,'rPr')].filter(Boolean):[],sourceProperties=[];
  for(const name of ['rFonts','sz','szCs','b','bCs','color','spacing','kern']){const candidates=sourceGroups.map(group=>children(group,name)[0]).filter(Boolean);if(!candidates.length)continue;const property=candidates[0].cloneNode(true);if(name==='rFonts')for(const candidate of candidates.slice(1))for(const attribute of candidate.attributes)if(!property.hasAttributeNS(attribute.namespaceURI,attribute.localName))property.setAttributeNS(attribute.namespaceURI,attribute.name,attribute.value);sourceProperties.push(property);}
  if(sourceProperties.length)for(const run of paragraph.getElementsByTagNameNS(W,'r')){
   let own=children(run,'rPr')[0];if(!own){own=doc.createElementNS(W,'w:rPr');run.insertBefore(own,run.firstChild);}
   for(const property of sourceProperties){if(['b','bCs'].includes(property.localName)&&children(own,property.localName).length)continue;for(const old of children(own,property.localName))own.removeChild(old);own.appendChild(doc.importNode(property,true));}
  }
 }
}
function fillKnownCoverField(para,metadata){
 const value=texts(para),fontNote=/[（(][^（）()]{0,100}(?:宋体|黑体|楷体|仿宋|Times New Roman|粗体|字号|[一二三四五六七八九十]+号)[^（）()]{0,100}[）)]/gi,labels=['中文题目','论文题目','题目','学生','姓名','作者','学科专业','专业班级','专业','校内指导教师','校外指导老师','校外指导教师','指导教师','导师','专业技术职务','学院','学号'],patterns=labels.map(label=>label.replace(/[\u4e00-\u9fff]/g,letter=>letter+'\\s*')).join('|'),matches=[...value.matchAll(new RegExp('(?:'+patterns+')(?=\\s|[:：（(_＿×Xx]|$)[:：]?\\s*','g'))],operations=[];
 const keyFor=(label,prior)=>({中文题目:'title',论文题目:'title',题目:'title',学生:'author',姓名:'author',作者:'author',学科专业:'major',专业班级:'major',专业:'major',校内指导教师:'supervisor',校外指导老师:'externalSupervisor',校外指导教师:'externalSupervisor',指导教师:'supervisor',导师:'supervisor',学院:'college',学号:'studentId',专业技术职务:/校外/.test(prior)?'externalSupervisorTitle':'supervisorTitle'}[label]);
 for(let index=0;index<matches.length;index++){
  const match=matches[index],label=match[0].replace(/[\s:：]/g,''),from=match.index+match[0].length,to=matches[index+1]?.index??value.length,remainder=value.slice(from,to).replace(fontNote,''),key=keyFor(label,matches.slice(0,index).map(row=>row[0]).join(''));
  // Adjacent cover fields are handled independently. Existing personal names,
  // academic titles and signatures are never inferred or overwritten.
  const provided=label==='专业班级'?[metadata.major,metadata.className].filter(Boolean).join(' '):metadata[key];if(!key||!String(provided||'').trim()||!/^[\s_＿×Xx\.．·—-]*$/.test(remainder))continue;
  const filled=String(provided)+(to<value.length?'   ':'');operations.push({from,to,text:filled});
 }
 // Remove explicit printing/font instructions only, retaining the original
 // text runs and their underline properties for unprovided blank fields.
 for(const match of value.matchAll(fontNote)){const from=match.index,to=from+match[0].length;if(!operations.some(row=>from>=row.from&&to<=row.to))operations.push({from,to,text:''});}
 if(metadata.graduationYear)for(const match of value.matchAll(/×{4}(?=[^\n]{0,70}届)/g))operations.push({from:match.index,to:match.index+4,text:String(metadata.graduationYear)});
 if(metadata.completionDate)for(const match of value.matchAll(/二[○〇]××年×月/g))operations.push({from:match.index,to:match.index+match[0].length,text:String(metadata.completionDate)});
 replaceParagraphTextRanges(para,operations);
 // Two blank signature-date fields must stay on one line. The template's
 // four-character first-line indent can otherwise strand its final 日.
 if(/^\s*日期[:：]\s*年\s*月\s*日\s+日期[:：]\s*年\s*月\s*日\s*$/.test(value)){const pr=children(para,'pPr')[0];if(pr){for(const ind of children(pr,'ind')){ind.setAttributeNS(W,'w:firstLine','0');ind.setAttributeNS(W,'w:firstLineChars','0');}for(const old of children(pr,'keepLines'))pr.removeChild(old);pr.appendChild(para.ownerDocument.createElementNS(W,'w:keepLines'));}}
}
function replaceParagraphTextRanges(para,operations){
 if(!operations.length)return;let offset=0;const spans=[...para.getElementsByTagNameNS(W,'t')].map(node=>{const span={node,from:offset,to:offset+node.textContent.length};offset=span.to;return span;});
 for(const operation of operations.sort((a,b)=>b.from-a.from)){
  let first=true;for(const span of spans){if(span.to<=operation.from||span.from>=operation.to)continue;const from=Math.max(0,operation.from-span.from),to=Math.min(span.to-span.from,operation.to-span.from);span.node.textContent=span.node.textContent.slice(0,from)+(first?operation.text:'')+span.node.textContent.slice(to);first=false;}
  if(first&&operation.from===operation.to){const span=spans.find(row=>row.from<=operation.from&&row.to>=operation.from)||spans.at(-1);if(span){const at=Math.min(span.node.textContent.length,Math.max(0,operation.from-span.from));span.node.textContent=span.node.textContent.slice(0,at)+operation.text+span.node.textContent.slice(at);}}
 }
}
function typographyNoteRanges(value){
 const result=[];for(const match of value.matchAll(/[（(]([^（）()]{1,100})[）)]/g)){const note=match[1].replace(/\s/g,'');if(!/(?:宋体|黑体|楷体|仿宋|TimesNewRoman|Arial|Calibri|小[一二三四五六]|[一二三四五六七八九十]+号|\d+(?:pt|磅))/i.test(note))continue;if(!/^(?:(?:新宋体|宋体|黑体|楷体|仿宋|TimesNewRoman|Arial|Calibri|Cambria|居中|左对齐|右对齐|两端对齐|顶格|粗体|加粗|斜体|常规|字体|字号|中文|英文|西文|数字|小?[一二三四五六七八九十]号?|\d+(?:\.\d+)?(?:pt|磅|号))|[，,、；;:：/])+$/i.test(note))continue;result.push({from:match.index,to:match.index+match[0].length,text:''});}return result;
}
function installEmptyPageCountFields(paragraph){
 const value=texts(paragraph);if(!/^\s*第[\s_＿×Xx]*页\s*[,，]?\s*共[\s_＿×Xx]*页\s*$/.test(value))return false;
 // Existing fields, bookmarks, drawings or other controls are meaningful
 // source content. Only a plain, exact empty page-count example is replaced.
 if(children(paragraph).some(node=>node.localName!=='pPr'&&(node.localName!=='r'||children(node).some(child=>!['rPr','t'].includes(child.localName)))))return false;
 const document=paragraph.ownerDocument,runs=children(paragraph,'r'),sample=runs.find(node=>texts(node).trim())||runs[0],properties=sample&&children(sample,'rPr')[0],createRun=value=>{const run=document.createElementNS(W,'w:r');if(properties)run.appendChild(properties.cloneNode(true));const text=document.createElementNS(W,'w:t');text.setAttribute('xml:space','preserve');text.textContent=value;run.appendChild(text);return run;},field=instruction=>{const node=document.createElementNS(W,'w:fldSimple');node.setAttributeNS(W,'w:instr',instruction);node.setAttributeNS(W,'w:dirty','true');node.appendChild(createRun('1'));return node;};
 for(const node of [...paragraph.childNodes])if(!(node.namespaceURI===W&&node.localName==='pPr'))paragraph.removeChild(node);
 for(const node of [createRun('第 '),field('PAGE'),createRun(' 页 共 '),field('NUMPAGES'),createRun(' 页')])paragraph.appendChild(node);return true;
}
async function normalizeTemplateFurniture(zip){
 const file=zip.file('word/_rels/document.xml.rels');if(!file)return;const relations=parse(await readXml(file)),parts=new Set([...relations.getElementsByTagNameNS(P,'Relationship')].filter(node=>[R+'/header',R+'/footer'].includes(node.getAttribute('Type'))&&node.getAttribute('TargetMode')!=='External').map(node=>resolvePart('word/document.xml',node.getAttribute('Target'))));
 for(const part of parts){const file=zip.file(part);if(!file)continue;const document=parse(await readXml(file)),isFooter=document.documentElement.namespaceURI===W&&document.documentElement.localName==='ftr';let changed=false;
  for(const paragraph of document.getElementsByTagNameNS(W,'p')){const ranges=typographyNoteRanges(texts(paragraph));if(ranges.length){replaceParagraphTextRanges(paragraph,ranges);changed=true;}if(isFooter&&installEmptyPageCountFields(paragraph))changed=true;}
  if(changed)zip.file(part,xml(document));
 }
}
function joinInlineAbstract(fragment,label){
 const paragraphs=children(fragment.documentElement),heading=paragraphs[0],body=paragraphs[1];if(heading?.localName!=='p'||body?.localName!=='p'||children(children(heading,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val')!=='PKFrontHeading'||children(children(body,'pPr')[0],'pStyle')[0]?.getAttributeNS(W,'val')!=='PKAbstract')return;
 const doc=fragment,tag=doc.createElementNS(W,'w:r'),value=doc.createElementNS(W,'w:t');value.setAttribute('xml:space','preserve');value.textContent=label.startsWith('摘要')?'：':': ';tag.appendChild(value);
 for(const run of heading.getElementsByTagNameNS(W,'r')){let properties=children(run,'rPr')[0];if(!properties){properties=doc.createElementNS(W,'w:rPr');run.insertBefore(properties,run.firstChild);}if(!children(properties,'b').length)properties.appendChild(doc.createElementNS(W,'w:b'));}
 // Preserve each input bookmark around its original label/body text. The
 // inserted colon sits outside both ranges and cannot hide dropped content.
 heading.appendChild(tag);for(const node of children(body).filter(node=>node.localName!=='pPr'))heading.appendChild(node.cloneNode(true));body.parentNode.removeChild(body);children(children(heading,'pPr')[0],'pStyle')[0].setAttributeNS(W,'w:val','PKAbstract');
}
async function refreshSampleChapterHeaders(source,document,placement,styles,chapterTitle){
 const relationFile=source.file('word/_rels/document.xml.rels');if(!relationFile)return;
 const relations=new Map([...parse(await readXml(relationFile)).getElementsByTagNameNS(P,'Relationship')].map(node=>[node.getAttribute('Id'),node])),styleId=placement.roleStyles.Heading1||'PKHeading1',style=[...styles.getElementsByTagNameNS(W,'style')].find(node=>node.getAttributeNS(W,'styleId')===styleId),name=children(style,'name')[0]?.getAttributeNS(W,'val')||'PaperKnow Heading1',changed=new Set();
 for(const reference of document.getElementsByTagNameNS(W,'headerReference')){
  const relation=relations.get(reference.getAttributeNS(R,'id'));if(!relation)continue;const part=resolvePart('word/document.xml',relation.getAttribute('Target'));if(changed.has(part)||!source.file(part))continue;changed.add(part);
  const header=parse(await readXml(source.file(part))),label=texts(header).replace(/\s/g,'');if(!/^(?:第.{1,12}[章节篇].{0,80}|参考文献|致谢|正文|附录.{0,20})$/.test(label)||header.getElementsByTagNameNS(W,'hyperlink').length||header.getElementsByTagNameNS(W,'drawing').length||header.getElementsByTagNameNS(W,'pict').length)continue;
  if(!/^[^"\\\r\n]{1,100}$/.test(name))throw Error('模板章标题样式名称无法用于自动页眉，请简化该样式名称后重新上传。');
  const paragraph=[...header.getElementsByTagNameNS(W,'p')].find(node=>texts(node).trim());if(!paragraph)continue;
  const sample=paragraph.getElementsByTagNameNS(W,'rPr')[0]?.cloneNode(true);for(const node of [...paragraph.childNodes])if(!(node.namespaceURI===W&&node.localName==='pPr'))paragraph.removeChild(node);
  const field=header.createElementNS(W,'w:fldSimple');field.setAttributeNS(W,'w:instr',` STYLEREF "${name}" `);field.setAttributeNS(W,'w:dirty','true');const run=header.createElementNS(W,'w:r'),value=header.createElementNS(W,'w:t');if(sample)run.appendChild(sample);value.textContent=chapterTitle;run.appendChild(value);field.appendChild(run);paragraph.appendChild(field);source.file(part,xml(header));
 }
}
async function fillRecognizedTemplate(source,rules,metadata,placement,{frontGroups,contentGroups,headings}){
 const document=parse(await readXml(source.file('word/document.xml'))),root=document.getElementsByTagNameNS(W,'body')[0],sourceNodes=children(root),stylePart=await relatedPart(source,'styles','word/styles.xml'),styles=source.file(stylePart)?parse(await readXml(source.file(stylePart))):parse(`<w:styles xmlns:w="${W}"/>`),used=new Set();
 const values={'论文题目':metadata.title||'','标题':metadata.title||'','学校':metadata.institution||'','作者':metadata.author||'','学位':metadata.level||'','专业':metadata.major||'','指导教师':metadata.supervisor||''};
 // Replace only explicit metadata tokens in retained source nodes. Generated
 // prose remains literal, including research discussing template syntax.
 const removed=new Set();for(const region of placement.regions)for(let i=region.startIndex;i<region.endIndex;i++)removed.add(sourceNodes[i]);
 const coverEnd=Math.min(...placement.regions.filter(row=>/^(?:abstract_|toc$|body$)/.test(row.kind)).map(row=>row.startIndex));
 for(const [index,node]of sourceNodes.entries()){if(removed.has(node))continue;for(const para of node.localName==='p'?[node,...node.getElementsByTagNameNS(W,'p')]:node.getElementsByTagNameNS(W,'p')){const value=texts(para);if(!/\{\{(?:论文题目|标题|学校|作者|学位|专业|指导教师)\}\}/.test(value)){if(index<coverEnd)fillKnownCoverField(para,metadata);continue;}const nodes=[...para.getElementsByTagNameNS(W,'t')];if(nodes.length){nodes[0].textContent=value.replace(/\{\{([^}]+)\}\}/g,(raw,key)=>Object.hasOwn(values,key)?String(values[key]):raw);for(const child of nodes.slice(1))child.textContent='';}}}
 const regions=[...placement.regions].sort((a,b)=>b.startIndex-a.startIndex);
 for(const region of regions){
  const original=sourceNodes.slice(region.startIndex,region.endIndex),anchor=sourceNodes[region.startIndex];if(!anchor)throw Error('模板正文定位已变化，请重新选择模板。');let body='';
  if(region.kind==='instructions')body='';
  else if(region.kind==='body')body=contentGroups.body.join('');
  else if(region.kind==='toc')body=contents(headings,slotContentWidth(root,anchor,rules.page));
  else if(region.kind==='title')body=p(metadata.title,'Title');
  else if(region.kind==='title_en')body=p(metadata.englishTitle||'【待补充：英文题目】','Title');
  else if(region.kind==='appendix'&&metadata.submission&&!contentGroups.appendix.length)body='';
  else if(region.kind.startsWith('abstract_'))body=frontGroups[region.kind]?.join('')||p(region.kind==='abstract_zh'?'摘要':'Abstract','FrontHeading')+p('【待补充：'+(region.kind==='abstract_zh'?'中文摘要':'英文摘要')+'】','Abstract');
  else {const key=region.kind,provided=!used.has(key)&&contentGroups[key]?.length;body=provided?contentGroups[key].join(''):p(region.label||({references:'参考文献',acknowledgements:'致谢',appendix:'附录'}[key]),'Heading1')+p('【待补充：'+({references:'参考文献',acknowledgements:'致谢',appendix:'附录'}[key])+'】');used.add(key);}
  const area=slotContentArea(root,anchor,rules.page),fragment=parse(`<w:body xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${fitTables(body,area.width,area.height,rules.styles.Normal)}</w:body>`);
  if(region.kind.startsWith('abstract_')&&/[:：]/.test(texts(anchor)))joinInlineAbstract(fragment,region.kind==='abstract_zh'?'摘要：':'Abstract: ');
  adoptTemplateParagraphs(fragment,sourceNodes,placement,styles,region);
  let inserted=children(fragment.documentElement);if(region.kind!=='instructions'&&!(region.kind==='appendix'&&metadata.submission&&!body))inserted=preserveRegionSections(original,placement,region,inserted);
  // Abstracts or bibliography without their own template region still belong
  // to this manuscript. Insert them at the recognized body boundary, never at
  // the document tail after the school's appendix or declaration.
  if(region.kind==='body'){
   let prefix='';for(const key of ['abstract_zh','abstract_en'])if(!placement.regions.some(row=>row.kind===key))prefix+=frontGroups[key].join('');
   const suffix=['references','acknowledgements','appendix'].filter(key=>!placement.regions.some(row=>row.kind===key)).map(key=>contentGroups[key].join('')).join('');
   for(const [content,before]of [[prefix,true],[suffix,false]])if(content){const addition=parse(`<w:body xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${fitTables(content,area.width,area.height,rules.styles.Normal)}</w:body>`);adoptTemplateParagraphs(addition,sourceNodes,placement,styles,region);if(before)inserted.unshift(...children(addition.documentElement));else{const at=inserted.findLastIndex(node=>children(children(node,'pPr')[0],'sectPr').length);inserted.splice(at<0?inserted.length:at,0,...children(addition.documentElement));}}
  }
  inserted=fitInsertedSections(inserted,root,anchor,rules.page,rules.styles.Normal);for(const node of inserted)root.insertBefore(document.importNode(node,true),anchor);for(const node of original)root.removeChild(node);
 }
 if(metadata.submission){let tail=children(root).at(-2);while(tail?.localName==='p'&&!texts(tail).trim()&&!tail.getElementsByTagNameNS(W,'drawing').length&&children(children(tail,'pPr')[0],'sectPr').length){const section=children(children(tail,'pPr')[0],'sectPr')[0],last=children(root).at(-1);if(last?.localName!=='sectPr')break;root.replaceChild(section.cloneNode(true),last);root.removeChild(tail);tail=children(root).at(-2);}}
 compactEmptySectionCarriers(root);
 await refreshSampleChapterHeaders(source,document,placement,styles,headings.find(row=>row.level===1)?.text||metadata.title);
 if(rules.bodyPageNumbers)await applyExplicitBodyPageNumbers(source,document,headings.find(row=>row.level===1)?.text,rules);
 return finishPreservedTemplate(source,document,rules,metadata);
}

function compactEmptySectionCarriers(root){
 for(let node of children(root))while(node.parentNode===root){const section=children(children(node,'pPr')[0],'sectPr')[0];let previous=node.previousSibling;while(previous&&previous.nodeType!==1)previous=previous.previousSibling;const controls=children(node).some(child=>child.localName!=='pPr'&&(child.localName!=='r'||children(child).some(part=>!['rPr','t'].includes(part.localName))));if(node.localName!=='p'||!section||texts(node).trim()||controls||previous?.localName!=='p')break;let properties=children(previous,'pPr')[0];if(properties&&children(properties,'sectPr').length)break;if(!properties){properties=root.ownerDocument.createElementNS(W,'w:pPr');previous.insertBefore(properties,previous.firstChild);}properties.appendChild(section);root.removeChild(node);node=previous;}
}

async function applyExplicitBodyPageNumbers(source,document,firstHeading,rules){
 const body=document.getElementsByTagNameNS(W,'body')[0];let nodes=children(body),start=nodes.findIndex(node=>node.localName==='p'&&texts(node).trim()===firstHeading&&[...node.getElementsByTagNameNS(W,'bookmarkStart')].some(marker=>/^PKInput_\d+$/.test(marker.getAttributeNS(W,'name'))));if(start<0)return;
 // An explicit slot can share its template section with the cover/contents.
 // Separate that front matter before applying a body-only footer.
 const bodyHeading=nodes[start],previous=nodes[start-1];if(previous&&!previous.getElementsByTagNameNS(W,'sectPr').length){const governing=nodes.slice(start).flatMap(node=>node.localName==='sectPr'?[node]:[...node.getElementsByTagNameNS(W,'sectPr')])[0];if(governing){let carrier=previous.localName==='p'?previous:document.createElementNS(W,'w:p'),properties=children(carrier,'pPr')[0];if(!properties){properties=document.createElementNS(W,'w:pPr');carrier.insertBefore(properties,carrier.firstChild);}properties.appendChild(governing.cloneNode(true));if(carrier!==previous)body.insertBefore(carrier,nodes[start]);nodes=children(body);start=nodes.indexOf(bodyHeading);}}
 const bookmarks=[...body.getElementsByTagNameNS(W,'bookmarkStart')],names=new Set(bookmarks.map(node=>node.getAttributeNS(W,'name')));let lastPage='PKBodyLastPage';while(names.has(lastPage))lastPage+='_';const bookmarkId=String(Math.max(0,...bookmarks.map(node=>Number(node.getAttributeNS(W,'id'))||0))+1),lastParagraph=[...body.getElementsByTagNameNS(W,'p')].at(-1),begin=document.createElementNS(W,'w:bookmarkStart'),end=document.createElementNS(W,'w:bookmarkEnd');begin.setAttributeNS(W,'w:id',bookmarkId);begin.setAttributeNS(W,'w:name',lastPage);end.setAttributeNS(W,'w:id',bookmarkId);lastParagraph.appendChild(begin);lastParagraph.appendChild(end);
 const relPath='word/_rels/document.xml.rels',relations=parse(await readXml(source.file(relPath))),ids=new Set([...relations.getElementsByTagNameNS(P,'Relationship')].map(node=>node.getAttribute('Id')));let id='pkBodyPageNumbers';while(ids.has(id))id+='_';
 const part='word/'+id+'.xml',footer=parse(`<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('第 ')}<w:fldSimple w:instr="PAGE" w:dirty="true">${run('1')}</w:fldSimple>${run(' 页 共 ')}<w:fldSimple w:instr="PAGEREF ${lastPage}" w:dirty="true">${run('1')}</w:fldSimple>${run(' 页')}</w:p></w:ftr>`);for(const node of footer.getElementsByTagNameNS(W,'r')){const properties=footer.createElementNS(W,'w:rPr'),fonts=footer.createElementNS(W,'w:rFonts'),size=footer.createElementNS(W,'w:sz');fonts.setAttributeNS(W,'w:ascii','Times New Roman');fonts.setAttributeNS(W,'w:eastAsia','宋体');size.setAttributeNS(W,'w:val','24');properties.appendChild(fonts);properties.appendChild(size);node.insertBefore(properties,node.firstChild);}source.file(part,xml(footer));
 const relation=relations.createElementNS(P,'Relationship');relation.setAttribute('Id',id);relation.setAttribute('Type',R+'/footer');relation.setAttribute('Target',id+'.xml');relations.documentElement.appendChild(relation);source.file(relPath,xml(relations));
 const types=parse(await readXml(source.file('[Content_Types].xml'))),override=types.createElementNS(CT,'Override');override.setAttribute('PartName','/'+part);override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml');types.documentElement.appendChild(override);source.file('[Content_Types].xml',xml(types));
 let first=true;for(const [index,node]of nodes.entries())for(const section of node.localName==='sectPr'?[node]:node.getElementsByTagNameNS(W,'sectPr')){
  for(const ref of children(section,'footerReference'))section.removeChild(ref);
  for(const number of children(section,'pgNumType'))section.removeChild(number);
  if(index<start){for(const ref of children(section,'headerReference'))section.removeChild(ref);continue;}
  const ref=document.createElementNS(W,'w:footerReference');ref.setAttributeNS(W,'w:type','default');ref.setAttributeNS(R,'r:id',id);section.insertBefore(ref,children(section).find(node=>node.localName!=='headerReference')||null);
  const number=document.createElementNS(W,'w:pgNumType');number.setAttributeNS(W,'w:fmt','decimal');if(first){number.setAttributeNS(W,'w:start','1');first=false;}const columns=children(section,'cols')[0]||children(section,'docGrid')[0];if(columns)section.insertBefore(number,columns);else section.appendChild(number);
 }
}

async function mergeGeneratedFigureImages(original,target,document,reserved){
 const part='word/_rels/document.xml.rels',imageType=R+'/image',sourceRelations=original.file(part)?parse(await readXml(original.file(part))):null,relations=target.file(part)?parse(await readXml(target.file(part))):parse(`<Relationships xmlns="${P}"/>`),used=new Set([...relations.getElementsByTagNameNS(P,'Relationship')].map(node=>node.getAttribute('Id'))),draw='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';let count=0,number=1,relationships='';
 const existing=reserved?.file('word/document.xml')?parse(await readXml(reserved.file('word/document.xml'))):null;let drawingId=Math.max(0,...(existing?[...existing.getElementsByTagNameNS(draw,'docPr')].map(node=>Number(node.getAttribute('id'))||0):[]))+1;
 for(const relation of sourceRelations?.getElementsByTagNameNS(P,'Relationship')||[]){const old=relation.getAttribute('Id');if(!/^pkFigure\d+$/.test(old))continue;const location=relation.getAttribute('Target');if(relation.getAttribute('Type')!==imageType||relation.getAttribute('TargetMode')==='External'||!/^media\/pkfigure-\d+\.png$/.test(location)||!original.file('word/'+location))throw Error('论文图片关联无效，已停止导出。');let id,name;do{id='pkGeneratedFigure'+number;name='media/pk-generated-figure-'+number+'.png';number++;}while(used.has(id)||target.file('word/'+name)||reserved?.file('word/'+name));used.add(id);target.file('word/'+name,await original.file('word/'+location).async('uint8array'));const next=relations.createElementNS(P,'Relationship');next.setAttribute('Id',id);next.setAttribute('Type',imageType);next.setAttribute('Target',name);relations.documentElement.appendChild(next);relationships+=xml(next);let references=0;for(const blip of document.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','blip'))if(blip.getAttributeNS(R,'embed')===old){blip.setAttributeNS(R,'r:embed',id);references++;}if(references!==1)throw Error('论文图片位置不唯一，已停止导出。');count++;}
 if(count){for(const node of document.getElementsByTagNameNS(draw,'docPr'))if(node.getAttribute('name').startsWith('PKFigure_'))node.setAttribute('id',String(drawingId++));target.file(part,xml(relations));if(target.file('[Content_Types].xml')){const types=parse(await readXml(target.file('[Content_Types].xml'))),entry=[...types.getElementsByTagNameNS(CT,'Default')].find(node=>node.getAttribute('Extension')==='png');if(entry&&entry.getAttribute('ContentType')!=='image/png')throw Error('模板 PNG 图片类型定义异常，请重新保存模板。');if(!entry){const node=types.createElementNS(CT,'Default');node.setAttribute('Extension','png');node.setAttribute('ContentType','image/png');types.documentElement.appendChild(node);}target.file('[Content_Types].xml',xml(types));}}
 return {count,relationships};
}

export async function applyThesisDocumentTemplate(bytes,{blocks=[],metadata={},template=null,submission=false,chapterTitles=metadata.chapterTitles||[]}={}){
 const original=await JSZip.loadAsync(bytes),doc=parse(await readXml(original.file('word/document.xml'))),nodes=children(doc.getElementsByTagNameNS(W,'body')[0]).filter(n=>n.localName!=='sectPr');
 if(nodes.length!==blocks.length)throw Error('论文段落结构不一致，未导出不完整文件。');
 let profile=defaultThesisTemplateProfile(),source,placement;
 if(template){if(template.status==='unavailable'||!template.bytes)throw Error('所选论文模板不可用，请重新上传模板或明确切换为通用模板。');const prepared=await prepareThesisDocxTemplate(template.bytes);profile=prepared.profile;source=await JSZip.loadAsync(prepared.bytes);}
 if(source){const stylePart=await relatedPart(source,'styles','word/styles.xml');placement=analyzeThesisTemplatePlacement(parse(await readXml(source.file('word/document.xml'))),source.file(stylePart)?parse(await readXml(source.file(stylePart))):null);if(placement.mode==='ambiguous')throw Error(placement.warnings[0]||'无法可靠识别模板正文区域，请使用独立 {{正文}} 占位符。');}
 const output=source&&placement.mode!=='rules_only'?source:new JSZip(),generatedImages=await mergeGeneratedFigureImages(original,output,doc,source);
 const rules=profile.rules,title=String(metadata.title||blocks[0]?.text||'研究论文').trim();metadata={...metadata,title,submission};
 if(rules.tableFormat==='threeLine'||!template)for(const node of nodes.filter(node=>node.localName==='tbl')){
  const properties=children(node,'tblPr')[0];for(const old of children(properties,'tblBorders'))properties.removeChild(old);
  const border=doc.createElementNS(W,'w:tblBorders');for(const edge of ['top','bottom','left','right','insideH','insideV']){const line=doc.createElementNS(W,'w:'+edge);line.setAttributeNS(W,'w:val',['top','bottom'].includes(edge)?'single':'nil');line.setAttributeNS(W,'w:sz','8');line.setAttributeNS(W,'w:color','000000');border.appendChild(line);}properties.appendChild(border);
  for(const cell of children(children(node,'tr')[0],'tc')){const pr=children(cell,'tcPr')[0],b=doc.createElementNS(W,'w:tcBorders'),line=doc.createElementNS(W,'w:bottom');line.setAttributeNS(W,'w:val','single');line.setAttributeNS(W,'w:sz','4');line.setAttributeNS(W,'w:color','000000');b.appendChild(line);pr.appendChild(b);}
  for(const shade of [...node.getElementsByTagNameNS(W,'shd')])shade.parentNode.removeChild(shade);
 }
 const explicitTitles=new Set((Array.isArray(chapterTitles)?chapterTitles:[]).map(value=>String(value?.title??value).trim()).filter(Boolean));
 const existing=source?parse(await readXml(source.file('word/document.xml'))):null;
 if(existing){const owned=[...existing.getElementsByTagNameNS(W,'bookmarkStart')].filter(node=>/^PKInput_\d+$/.test(node.getAttributeNS(W,'name'))),ids=new Set(owned.map(node=>node.getAttributeNS(W,'id')));for(const node of [...owned,...existing.getElementsByTagNameNS(W,'bookmarkEnd')].filter(node=>ids.has(node.getAttributeNS(W,'id'))))node.parentNode.removeChild(node);if(owned.length)source.file('word/document.xml',xml(existing));}
 const bookmarks=existing?[...existing.getElementsByTagNameNS(W,'bookmarkStart')]:[],usedIds=new Set(bookmarks.map(n=>n.getAttributeNS(W,'id'))),usedNames=new Set(bookmarks.map(n=>n.getAttributeNS(W,'name')));
 const entries=[],front=[],headings=[],citationRanges=new Map(),frontGroups={abstract_zh:[],abstract_en:[]},contentGroups={body:[],references:[],acknowledgements:[],appendix:[]};let reference=false,frontMatter=false,nonCitation=false,identifier=1,frontKind='abstract_zh',contentKind='body';
 if(Array.isArray(metadata.citationRanges)&&metadata.citationRanges.length<=20000)for(const range of metadata.citationRanges){if(!Number.isSafeInteger(range?.start)||range.start<0||!Number.isSafeInteger(range.end)||range.end>500000||!Number.isSafeInteger(range.number)||range.number<1||range.number>9999||range.end-range.start!==String(range.number).length+2)continue;citationRanges.set(range.start,citationRanges.has(range.start)?null:{...range});}
 const nextId=(prefix='PK_')=>{while(usedIds.has(String(identifier))||usedNames.has(prefix+identifier))identifier++;const id=identifier++;usedIds.add(String(id));usedNames.add(prefix+id);return id;};
 const inputAnchor=index=>{const id=nextId('PKInput_'),name='PKInput_'+index;usedNames.add(name);return {id,name};};
 const anchored=(markup,anchor)=>{const fragment=parse(`<w:body xmlns:w="${W}">${markup}</w:body>`),paragraph=fragment.getElementsByTagNameNS(W,'p')[0];addBookmark(paragraph,anchor);return children(fragment.documentElement).map(xml).join('');};
 const indexedReferences=new Map(),referenceBlocks=new Map();let scanningReferences=false;
 for(let index=1;index<blocks.length;index++){
  const block=blocks[index],value=String(block.text||'').trim();if(block.literal||block.type==='formula'||block.type==='table')continue;
  const level=explicitTitles.has(value)?1:heading(value);if(level)scanningReferences=referenceHeading(value);
  const number=!level&&scanningReferences?value.match(/^\[([1-9]\d{0,3})\]\s+\S/)?.[1]:null;if(!number)continue;
  const key=Number(number);referenceBlocks.set(index,key);indexedReferences.set(key,indexedReferences.has(key)?null:{index});
 }
 const citationTargets=new Map();for(const [number,row]of indexedReferences)if(row){const id=nextId('PKRef_');citationTargets.set(number,{id,name:'PKRef_'+id});}
 for(let index=1;index<blocks.length;index++){
  const block=blocks[index],value=String(block.text||'').trim();if(!value&&block.type!=='table')continue;
  if(!block.literal&&abstract(value)){if(/abstract/i.test(value)&&metadata.englishTitle&&(!source||!placement?.regions?.some(region=>region.kind==='title_en'))){const english=p(metadata.englishTitle,'Title');front.push(english);frontGroups.abstract_en.push(english);}frontMatter=true;frontKind=/abstract/i.test(value)?'abstract_en':'abstract_zh';const rendered=anchored(p(displayHeading(value).replace(/\s/g,''),'FrontHeading'),inputAnchor(index));front.push(rendered);frontGroups[frontKind].push(rendered);continue;}
  const level=block.literal||block.type==='formula'||block.type==='figure'?0:explicitTitles.has(value)?1:heading(value);if(level){frontMatter=false;reference=referenceHeading(value);nonCitation=nonCitationHeading(value);}
  const id=nextId(),rendered=rewriteBlock(nodes[index],block,{reference,frontMatter,id,headingLevel:level,referenceAnchor:citationTargets.get(referenceBlocks.get(index)),citationTargets:nonCitation?null:citationTargets,citationRanges,inputAnchor:inputAnchor(index)});
  if(frontMatter){front.push(rendered);frontGroups[frontKind].push(rendered);}else{entries.push(rendered);if(level===1){const label=displayHeading(value).replace(/\s/g,'');if(referenceHeading(value))contentKind='references';else if(/^(?:致谢|acknowledg(?:e)?ments?)$/i.test(label))contentKind='acknowledgements';else if(/^(?:附录|appendix|appendices)/i.test(label))contentKind='appendix';else if(!nonCitationHeading(value))contentKind='body';}contentGroups[contentKind].push(rendered);if(level)headings.push({text:displayHeading(block.text),level,id});}
 }
 // Explicit slots retain the uploaded package and cover layout byte-for-byte
 // outside the documented content/metadata slots and styles/settings updates.
 if(source){if(placement.mode==='recognized_body')return fillRecognizedTemplate(source,rules,metadata,placement,{frontGroups,contentGroups,headings});const filled=await fillTemplateSlot(source,front.join('')+entries.join(''),rules,metadata);if(filled)return filled;}
 const zip=output,page=rules.page,width=contentWidth(page),body=fitTables(entries.join(''),width,contentHeight(page),rules.styles.Normal);
 const references=source?await headerFooterParts(source,zip,parse(await readXml(source.file('word/document.xml'))),[],{chapterTitle:headings.find(row=>row.level===1)?.text||title}):{references:'',relationships:'',contentTypes:[]};
 const footer=`<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
 zip.file('word/pk-footer.xml',footer);
 const header=references.references.match(/<w:headerReference[^>]+\/>/g)?.join('')||'',customFooter=references.references.match(/<w:footerReference[^>]+\/>/g)?.join('')||'';
 const documentBody=cover(title,metadata)+sectionBreak(section(page,{cover:true}))+front.join('')+contents(headings,width)+sectionBreak(section(page,{front:true}))+body+section(page,{header,refs:customFooter});
 zip.file('word/document.xml',`<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${documentBody}</w:body></w:document>`);
 const originalStylePart=source?await relatedPart(source,'styles','word/styles.xml'):null,styles=source?.file(originalStylePart)?parse(await readXml(source.file(originalStylePart))):parse(`<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${rPr(rules.styles.Normal)}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${pPr(rules.styles.Normal)}</w:pPr></w:pPrDefault></w:docDefaults></w:styles>`);
 for(const n of [...styles.getElementsByTagNameNS(W,'style')])if(/^PK(?:Normal|Title|FrontHeading|Heading[123]|Abstract|References|TableText|Code|TOC[123])$/.test(n.getAttributeNS(W,'styleId')))n.parentNode.removeChild(n);
 const additions=parse(`<w:styles xmlns:w="${W}">${styleEntries(rules)}</w:styles>`);for(const n of children(additions.documentElement))styles.documentElement.appendChild(styles.importNode(n,true));zip.file('word/styles.xml',xml(styles));
 let sharedRelationships='';if(source?.file('word/_rels/document.xml.rels'))for(const rel of parse(await readXml(source.file('word/_rels/document.xml.rels'))).getElementsByTagNameNS(P,'Relationship')){const type=rel.getAttribute('Type');if(![R+'/theme',R+'/fontTable',R+'/numbering'].includes(type))continue;const target=rel.getAttribute('Target'),part=resolvePart('word/document.xml',target);await references.copy(part);sharedRelationships+=`<Relationship Id="pkShared${sharedRelationships.length}" Type="${esc(type)}" Target="${esc(target)}"/>`;}
 zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="${P}"><Relationship Id="pkStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="pkSettings" Type="${R}/settings" Target="settings.xml"/><Relationship Id="pkFooter" Type="${R}/footer" Target="pk-footer.xml"/>${references.relationships}${sharedRelationships}${generatedImages.relationships}</Relationships>`);
 zip.file('_rels/.rels',`<Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
 const overrides=[['word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],['word/styles.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],['word/settings.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],['word/pk-footer.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml']];
 if(source){const sourceTypes=parse(await readXml(source.file('[Content_Types].xml')));for(const entry of sourceTypes.getElementsByTagNameNS(CT,'Override'))if(zip.file(entry.getAttribute('PartName').slice(1)))overrides.push([entry.getAttribute('PartName').slice(1),entry.getAttribute('ContentType')]);const defaults=(generatedImages.count&&![...sourceTypes.getElementsByTagNameNS(CT,'Default')].some(node=>node.getAttribute('Extension')==='png')?'<Default Extension="png" ContentType="image/png"/>':'')+[...sourceTypes.getElementsByTagNameNS(CT,'Default')].map(n=>`<Default Extension="${esc(n.getAttribute('Extension'))}" ContentType="${esc(n.getAttribute('ContentType'))}"/>`).join('');zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${[...new Map(overrides.map(x=>[x[0],x])).values()].map(([part,type])=>`<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`);}
 else zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${generatedImages.count?'<Default Extension="png" ContentType="image/png"/>':''}${overrides.map(([part,type])=>`<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`);
 await normalizeTemplateFurniture(zip);await updatedSettings(zip);await updateManuscriptCoreProperties(zip,metadata);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
