import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {defaultThesisTemplateProfile,prepareThesisDocxTemplate} from './thesis-template-profile.js';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',P='http://schemas.openxmlformats.org/package/2006/relationships',CT='http://schemas.openxmlformats.org/package/2006/content-types';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const parse=value=>new DOMParser().parseFromString(value,'application/xml'),xml=node=>new XMLSerializer().serializeToString(node);
const children=(node,name)=>[...node.childNodes].filter(n=>n.nodeType===1&&(!name||n.namespaceURI===W&&n.localName===name));
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
 return styles+`<w:style w:type="paragraph" w:styleId="PKFrontHeading"><w:name w:val="PaperKnow Front Heading"/><w:basedOn w:val="PKHeading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>`+['1','2','3'].map(level=>`<w:style w:type="paragraph" w:styleId="PKTOC${level}"><w:name w:val="PaperKnow TOC ${level}"/><w:basedOn w:val="PKNormal"/><w:pPr><w:spacing w:before="0" w:after="80" w:line="300" w:lineRule="auto"/><w:ind w:left="${(Number(level)-1)*240}" w:firstLine="0" w:firstLineChars="0" w:hanging="0"/></w:pPr></w:style>`).join('');
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
function rewriteBlock(node,block,{reference=false,frontMatter=false,id=0,headingLevel,referenceAnchor,citationTargets,citationRanges}={}){
 const doc=node.ownerDocument;
 if(block.type==='table'){
  for(const para of node.getElementsByTagNameNS(W,'p'))setParagraphStyle(para,'TableText');
  for(const shade of [...node.getElementsByTagNameNS(W,'shd')])shade.setAttributeNS(W,'w:fill','F2F2F2');
  return xml(node);
 }
 const level=block.literal||block.type==='formula'?0:headingLevel??heading(block.text),role=level?'Heading'+level:reference?'References':frontMatter?'Abstract':'Normal';
 setParagraphStyle(node,role);
 if(block.type==='formula'){const pr=children(node,'pPr')[0];const jc=doc.createElementNS(W,'w:jc');jc.setAttributeNS(W,'w:val','center');pr.appendChild(jc);}
 if(level){let remaining=String(block.text).match(/^\s*#{1,3}\s+/)?.[0].length||0;for(const text of node.getElementsByTagNameNS(W,'t')){if(!remaining)break;const removed=Math.min(remaining,text.textContent.length);text.textContent=text.textContent.slice(removed);remaining-=removed;}addBookmark(node,{id,name:'PK_'+id});}
 if(referenceAnchor)addBookmark(node,referenceAnchor);
 if(!level&&!reference&&!block.literal&&block.type!=='formula'&&citationTargets?.size)linkCitations(node,citationTargets,block,citationRanges);
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
function fitTables(body,width){
 if(!body.includes('<w:tbl'))return body;
 const fragment=parse(`<w:body xmlns:w="${W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${body}</w:body>`);
 for(const table of fragment.getElementsByTagNameNS(W,'tbl')){
  const grid=children(table,'tblGrid')[0],columns=grid?children(grid,'gridCol'):[],total=columns.reduce((sum,column)=>sum+Number(column.getAttributeNS(W,'w')||0),0);if(!total)continue;
  const ratio=width/total,properties=children(table,'tblPr')[0],tableWidth=properties&&children(properties,'tblW')[0];if(tableWidth){tableWidth.setAttributeNS(W,'w:w',String(width));tableWidth.setAttributeNS(W,'w:type','dxa');}
  for(const item of [...columns,...table.getElementsByTagNameNS(W,'tcW')])item.setAttributeNS(W,'w:w',String(Math.max(1,Math.round(Number(item.getAttributeNS(W,'w')||0)*ratio))));
 }
 return children(fragment.documentElement).map(xml).join('');
}
function slotContentWidth(root,slot,page){
 const following=children(root).slice(children(root).indexOf(slot));let section;
 for(const node of following){section=node.localName==='sectPr'?node:node.getElementsByTagNameNS(W,'sectPr')[0];if(section)break;}
 if(!section)return contentWidth(page);
 const size=children(section,'pgSz')[0],margins=children(section,'pgMar')[0],read=(node,name,fallback)=>node?.hasAttributeNS(W,name)?Number(node.getAttributeNS(W,name)):fallback;
 return contentWidth({width:read(size,'w',page.width),left:read(margins,'left',page.left),right:read(margins,'right',page.right),gutter:read(margins,'gutter',page.gutter)});
}
async function relatedPart(zip,type,fallback){const rels=zip.file('word/_rels/document.xml.rels');if(rels){const rel=[...parse(await rels.async('string')).getElementsByTagNameNS(P,'Relationship')].find(n=>n.getAttribute('Type')===R+'/'+type);if(rel)return resolvePart('word/document.xml',rel.getAttribute('Target'));}return fallback;}
async function headerFooterParts(source,target,document,rels,{chapterTitle=''}={}){
 const sourceRels=source.file('word/_rels/document.xml.rels');if(!sourceRels)return {references:'',relationships:'',contentTypes:[]};
 const map=new Map([...parse(await sourceRels.async('string')).getElementsByTagNameNS(P,'Relationship')].map(n=>[n.getAttribute('Id'),n]));
 const sect=[...document.getElementsByTagNameNS(W,'sectPr')].at(-1);let references='',relationships='';const types=[];const visited=new Set();
 async function copy(part){if(visited.has(part))return;visited.add(part);const f=source.file(part);if(!f)throw Error('模板页眉页脚部件缺失，请重新上传。');target.file(part,await f.async('uint8array'));const relpart=part.replace(/(^|\/)([^/]+)$/,'$1_rels/$2.rels'),rf=source.file(relpart);if(rf){target.file(relpart,await rf.async('uint8array'));for(const r of parse(await rf.async('string')).getElementsByTagNameNS(P,'Relationship'))if(r.getAttribute('TargetMode')!=='External')await copy(resolvePart(part,r.getAttribute('Target')));}}
 for(const ref of sect?children(sect).filter(n=>['headerReference','footerReference'].includes(n.localName)):[]){if(ref.getAttributeNS(W,'type')!=='default')continue;const r=map.get(ref.getAttributeNS(R,'id'));if(!r)throw Error('模板页眉页脚关联失效。');const part=resolvePart('word/document.xml',r.getAttribute('Target'));await copy(part);
  if(ref.localName==='headerReference'){
   const header=parse(await target.file(part).async('string')),label=texts(header).replace(/\s/g,'');
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
async function updatedSettings(zip){const part=await relatedPart(zip,'settings','word/settings.xml');let settings=zip.file(part)?await zip.file(part).async('string'):`<w:settings xmlns:w="${W}"/>`;const doc=parse(settings),root=doc.documentElement;for(const n of [...doc.getElementsByTagNameNS(W,'updateFields')])n.parentNode.removeChild(n);const n=doc.createElementNS(W,'w:updateFields');n.setAttributeNS(W,'w:val','true');root.appendChild(n);zip.file(part,xml(doc));return part;}
async function fillTemplateSlot(source,body,rules,metadata){
 const document=parse(await source.file('word/document.xml').async('string')),root=document.getElementsByTagNameNS(W,'body')[0];
 const slot=children(root,'p').find(n=>/^\s*\{\{(?:正文|PAPERKNOW_CONTENT)\}\}\s*$/.test(texts(n)));if(!slot)return false;
 const wrapped=parse(`<w:body xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${fitTables(body,slotContentWidth(root,slot,rules.page))}</w:body>`);
 const values={'论文题目':metadata.title||'','标题':metadata.title||'','学校':metadata.institution||'','作者':metadata.author||'','学位':metadata.level||'','专业':metadata.major||'','指导教师':metadata.supervisor||''};
 for(const para of document.getElementsByTagNameNS(W,'p')){const value=texts(para);if(!/\{\{(?:论文题目|标题|学校|作者|学位|专业|指导教师)\}\}/.test(value))continue;const nodes=[...para.getElementsByTagNameNS(W,'t')];if(nodes.length){nodes[0].textContent=value.replace(/\{\{([^}]+)\}\}/g,(raw,key)=>Object.hasOwn(values,key)?String(values[key]):raw);for(const node of nodes.slice(1))node.textContent='';}}
 for(const n of children(wrapped.documentElement))root.insertBefore(document.importNode(n,true),slot);root.removeChild(slot);
 source.file('word/document.xml',xml(document));const stylePart=await relatedPart(source,'styles','word/styles.xml'),styles=source.file(stylePart)?parse(await source.file(stylePart).async('string')):parse(`<w:styles xmlns:w="${W}"/>`);for(const n of [...styles.getElementsByTagNameNS(W,'style')])if(/^PK(?:Normal|Title|FrontHeading|Heading[123]|Abstract|References|TableText|TOC[123])$/.test(n.getAttributeNS(W,'styleId')))n.parentNode.removeChild(n);const additions=parse(`<w:styles xmlns:w="${W}">${styleEntries(rules)}</w:styles>`);for(const n of children(additions.documentElement))styles.documentElement.appendChild(styles.importNode(n,true));source.file(stylePart,xml(styles));const settingsPart=await updatedSettings(source);
 const types=parse(await source.file('[Content_Types].xml').async('string'));for(const [part,type]of [['/'+stylePart,'styles'],['/'+settingsPart,'settings']])if(![...types.getElementsByTagNameNS(CT,'Override')].some(n=>n.getAttribute('PartName')===part)){const n=types.createElementNS(types.documentElement.namespaceURI,'Override');n.setAttribute('PartName',part);n.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.'+type+'+xml');types.documentElement.appendChild(n);}source.file('[Content_Types].xml',xml(types));
 const relfile='word/_rels/document.xml.rels',relations=source.file(relfile)?parse(await source.file(relfile).async('string')):parse(`<Relationships xmlns="${P}"/>`),ids=new Set([...relations.getElementsByTagNameNS(P,'Relationship')].map(n=>n.getAttribute('Id')));for(const type of ['styles','settings'])if(![...relations.getElementsByTagNameNS(P,'Relationship')].some(n=>n.getAttribute('Type')===R+'/'+type)){const n=relations.createElementNS(P,'Relationship');let id='pk'+type;while(ids.has(id))id+='_';ids.add(id);n.setAttribute('Id',id);n.setAttribute('Type',R+'/'+type);n.setAttribute('Target',type+'.xml');relations.documentElement.appendChild(n);}source.file(relfile,xml(relations));return source.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

export async function applyThesisDocumentTemplate(bytes,{blocks=[],metadata={},template=null,chapterTitles=metadata.chapterTitles||[]}={}){
 const original=await JSZip.loadAsync(bytes),doc=parse(await original.file('word/document.xml').async('string')),nodes=children(doc.getElementsByTagNameNS(W,'body')[0]).filter(n=>n.localName!=='sectPr');
 if(nodes.length!==blocks.length)throw Error('论文段落结构不一致，未导出不完整文件。');
 let profile=defaultThesisTemplateProfile(),source;
 if(template){if(template.status==='unavailable'||!template.bytes)throw Error('所选论文模板不可用，请重新上传模板或明确切换为通用模板。');const prepared=await prepareThesisDocxTemplate(template.bytes);profile=prepared.profile;source=await JSZip.loadAsync(prepared.bytes);}
 const rules=profile.rules,title=String(metadata.title||blocks[0]?.text||'研究论文').trim();metadata={...metadata,title};
 const explicitTitles=new Set((Array.isArray(chapterTitles)?chapterTitles:[]).map(value=>String(value?.title??value).trim()).filter(Boolean));
 const existing=source?parse(await source.file('word/document.xml').async('string')):null,bookmarks=existing?[...existing.getElementsByTagNameNS(W,'bookmarkStart')]:[],usedIds=new Set(bookmarks.map(n=>n.getAttributeNS(W,'id'))),usedNames=new Set(bookmarks.map(n=>n.getAttributeNS(W,'name')));
 const entries=[],front=[],headings=[],citationRanges=new Map();let reference=false,frontMatter=false,nonCitation=false,identifier=1;
 if(Array.isArray(metadata.citationRanges)&&metadata.citationRanges.length<=20000)for(const range of metadata.citationRanges){if(!Number.isSafeInteger(range?.start)||range.start<0||!Number.isSafeInteger(range.end)||range.end>500000||!Number.isSafeInteger(range.number)||range.number<1||range.number>9999||range.end-range.start!==String(range.number).length+2)continue;citationRanges.set(range.start,citationRanges.has(range.start)?null:{...range});}
 const nextId=(prefix='PK_')=>{while(usedIds.has(String(identifier))||usedNames.has(prefix+identifier))identifier++;const id=identifier++;usedIds.add(String(id));usedNames.add(prefix+id);return id;};
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
  if(!block.literal&&abstract(value)){frontMatter=true;front.push(p(displayHeading(value).replace(/\s/g,''),'FrontHeading'));continue;}
  const level=block.literal||block.type==='formula'?0:explicitTitles.has(value)?1:heading(value);if(level){frontMatter=false;reference=referenceHeading(value);nonCitation=nonCitationHeading(value);}
  const id=nextId(),rendered=rewriteBlock(nodes[index],block,{reference,frontMatter,id,headingLevel:level,referenceAnchor:citationTargets.get(referenceBlocks.get(index)),citationTargets:nonCitation?null:citationTargets,citationRanges});
  if(frontMatter)front.push(rendered);else{entries.push(rendered);if(level)headings.push({text:displayHeading(block.text),level,id});}
 }
 // Explicit slots retain the uploaded package and cover layout byte-for-byte
 // outside the documented content/metadata slots and styles/settings updates.
 if(source){const filled=await fillTemplateSlot(source,front.join('')+entries.join(''),rules,metadata);if(filled)return filled;}
 const zip=new JSZip(),page=rules.page,width=contentWidth(page),body=fitTables(entries.join(''),width);
 const references=source?await headerFooterParts(source,zip,parse(await source.file('word/document.xml').async('string')),[],{chapterTitle:headings.find(row=>row.level===1)?.text||title}):{references:'',relationships:'',contentTypes:[]};
 const footer=`<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
 zip.file('word/pk-footer.xml',footer);
 const header=references.references.match(/<w:headerReference[^>]+\/>/g)?.join('')||'',customFooter=references.references.match(/<w:footerReference[^>]+\/>/g)?.join('')||'';
 const documentBody=cover(title,metadata)+sectionBreak(section(page,{cover:true}))+front.join('')+contents(headings,width)+sectionBreak(section(page,{front:true}))+body+section(page,{header,refs:customFooter});
 zip.file('word/document.xml',`<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${documentBody}</w:body></w:document>`);
 const originalStylePart=source?await relatedPart(source,'styles','word/styles.xml'):null,styles=source?.file(originalStylePart)?parse(await source.file(originalStylePart).async('string')):parse(`<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${rPr(rules.styles.Normal)}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${pPr(rules.styles.Normal)}</w:pPr></w:pPrDefault></w:docDefaults></w:styles>`);
 for(const n of [...styles.getElementsByTagNameNS(W,'style')])if(/^PK(?:Normal|Title|FrontHeading|Heading[123]|Abstract|References|TableText|TOC[123])$/.test(n.getAttributeNS(W,'styleId')))n.parentNode.removeChild(n);
 const additions=parse(`<w:styles xmlns:w="${W}">${styleEntries(rules)}</w:styles>`);for(const n of children(additions.documentElement))styles.documentElement.appendChild(styles.importNode(n,true));zip.file('word/styles.xml',xml(styles));
 let sharedRelationships='';if(source?.file('word/_rels/document.xml.rels'))for(const rel of parse(await source.file('word/_rels/document.xml.rels').async('string')).getElementsByTagNameNS(P,'Relationship')){const type=rel.getAttribute('Type');if(![R+'/theme',R+'/fontTable',R+'/numbering'].includes(type))continue;const target=rel.getAttribute('Target'),part=resolvePart('word/document.xml',target);await references.copy(part);sharedRelationships+=`<Relationship Id="pkShared${sharedRelationships.length}" Type="${esc(type)}" Target="${esc(target)}"/>`;}
 zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="${P}"><Relationship Id="pkStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="pkSettings" Type="${R}/settings" Target="settings.xml"/><Relationship Id="pkFooter" Type="${R}/footer" Target="pk-footer.xml"/>${references.relationships}${sharedRelationships}</Relationships>`);
 zip.file('_rels/.rels',`<Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
 const overrides=[['word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],['word/styles.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],['word/settings.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],['word/pk-footer.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml']];
 if(source){const sourceTypes=parse(await source.file('[Content_Types].xml').async('string'));for(const entry of sourceTypes.getElementsByTagNameNS(CT,'Override'))if(zip.file(entry.getAttribute('PartName').slice(1)))overrides.push([entry.getAttribute('PartName').slice(1),entry.getAttribute('ContentType')]);const defaults=[...sourceTypes.getElementsByTagNameNS(CT,'Default')].map(n=>`<Default Extension="${esc(n.getAttribute('Extension'))}" ContentType="${esc(n.getAttribute('ContentType'))}"/>`).join('');zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${[...new Map(overrides.map(x=>[x[0],x])).values()].map(([part,type])=>`<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`);}
 else zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([part,type])=>`<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`);
 await updatedSettings(zip);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
