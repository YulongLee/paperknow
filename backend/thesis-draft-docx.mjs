import JSZip from 'jszip';
import {extractDocxObjects} from './thesis-docx-objects.mjs';
import {DOMParser} from '@xmldom/xmldom';
import {createHash} from 'node:crypto';
import {importDraftReferences,remapDraftCitations} from './thesis-draft-references.mjs';
import {formatThesisReference} from '../dist/workspace/thesis-document.mjs';
import {thesisFrontMatterKind,thesisManualBackMatter} from '../dist/workspace/thesis-delivery.mjs';
import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';
import {thesisError} from './thesis-model.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',M='http://schemas.openxmlformats.org/officeDocument/2006/math';
const fail=message=>{throw thesisError(422,message,'draft_import_invalid');};
const kids=(node,name)=>Array.from(node?.childNodes||[]).filter(row=>row.nodeType===1&&(!name||row.namespaceURI===W&&row.localName===name));
const attr=(node,name)=>node?.getAttributeNS(W,name)||'';
const key=text=>String(text).normalize('NFKC').replace(/^(?:第[^\s]{1,12}章|chapter\s+(?:\d+|[ivxlcdm]+)|\d+[.、．])\s*/i,'').replace(/[\s\p{P}]/gu,'').toLowerCase();
function xml(text){if(Buffer.byteLength(text)>6*1024*1024)fail('初稿的文档结构过大，请精简后重试。');if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('初稿含有无法安全读取的文档结构，请另存为普通 DOCX 后重试。');let invalid=false;let doc;try{doc=new DOMParser({onError:()=>{invalid=true;}}).parseFromString(text,'application/xml');}catch{invalid=true;}if(invalid||!doc?.documentElement)fail('初稿文件内容不完整，请在 Word 中重新另存为 DOCX 后上传。');return doc;}
function paragraphText(node,markers){if(markers?.has(node))return markers.get(node);return Array.from(node.childNodes||[]).map(child=>markers?.has(child)?markers.get(child):child.nodeType!==1?'':child.namespaceURI===W&&child.localName==='t'?child.textContent:child.namespaceURI===W&&['tab','br','cr'].includes(child.localName)?child.localName==='tab'?'\t':'\n':['pPr','rPr','instrText','del','drawing','pict','object'].includes(child.localName)?'':paragraphText(child,markers)).join('');}
function heading(text,node,styles){
 if(thesisFrontMatterKind({title:text})||thesisManualBackMatter({title:text})||isOutlineReferenceChapter({title:text}))return 1;
 if(text.length>160||/[。！？；;]$/.test(text))return 0;
 let style=attr(kids(kids(node,'pPr')[0],'pStyle')[0],'val'),seen=new Set(),outline=attr(kids(kids(node,'pPr')[0],'outlineLvl')[0],'val');
 while(style&&!seen.has(style)){seen.add(style);const row=styles.get(style);if(!row)break;if(!outline)outline=attr(kids(kids(row,'pPr')[0],'outlineLvl')[0],'val');style=attr(kids(row,'basedOn')[0],'val');}
 if(outline==='0'||/^(?:Heading1|标题1)$/i.test(attr(kids(kids(node,'pPr')[0],'pStyle')[0],'val')))return 1;
 if(outline&&Number(outline)<6)return Number(outline)+1;
 return /^(?:第[一二三四五六七八九十百\d]+章\s*\S|chapter\s+(?:[IVXLCDM]+|\d+)\b|\d+[.、．]\s*[^\d\s])/i.test(text)?1:/^\d+(?:\.\d+){1,4}\s+\S/.test(text)?2:0;
}
export async function parseThesisDraftDocx(bytes,{name='初稿.docx',snapshot}={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>2*1024*1024||!bytes.subarray(0,2).equals(Buffer.from('PK')))fail('请上传不超过 2MB 的有效 DOCX 初稿。');
 let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false});}catch{fail('初稿无法读取，请确认文件未加密或损坏，并另存为 DOCX 后重试。');}
 const files=Object.values(zip.files);if(files.length>2000||files.some(row=>(row._data?.uncompressedSize||0)>10*1024*1024)||files.reduce((sum,row)=>sum+(row._data?.uncompressedSize||0),0)>30*1024*1024)fail('文档内容过大，请拆分或精简初稿后重试。');
 if(files.some(row=>/vbaProject|embeddings\//i.test(row.name)))fail('初稿包含宏或嵌入对象，请另存为普通 DOCX 文档后上传。');
 const document=zip.file('word/document.xml');if(!document)fail('没有找到 Word 正文，请选择有效的 DOCX 初稿。');
 const doc=xml(await document.async('string')),body=doc.getElementsByTagNameNS(W,'body')[0];if(!body)fail('初稿没有可读取的正文。');
 const unsupported=[['object','嵌入对象'],['txbxContent','文本框'],['ins','未接受的修订'],['del','未接受的修订'],['moveFrom','未接受的修订'],['moveTo','未接受的修订'],['footnoteReference','脚注'],['endnoteReference','尾注']].filter(([tag])=>doc.getElementsByTagNameNS(W,tag).length).map(([,label])=>label);
 if(unsupported.length)fail('这份初稿含有'+[...new Set(unsupported)].join('、')+'，当前无法完整导入这些对象。请先整理为正文和普通表格版本后重试；原文不会被替换。仅需保留原件调整格式时，可使用格式排版。');
 if(/\[docx\b/i.test(paragraphText(body)))fail('初稿包含无法确认的原稿位置标记，请使用正常导出的 DOCX 文档后重试。');
 const fileSha=createHash('sha256').update(bytes).digest('hex'),{objects,markers}=await extractDocxObjects(zip,doc,fileSha);
 const styles=new Map();if(zip.file('word/styles.xml'))for(const node of Array.from(xml(await zip.file('word/styles.xml').async('string')).getElementsByTagNameNS(W,'style')))styles.set(attr(node,'styleId'),node);
 const blocks=[],warnings=[];let tableCount=0,tocDepth=null,fieldDepth=0;
 function collect(node){for(const child of kids(node)){
  if(child.namespaceURI!==W)continue;
  if(child.localName==='p'){
   const text=paragraphText(child,markers).trim(),style=attr(kids(kids(child,'pPr')[0],'pStyle')[0],'val');let toc=tocDepth!==null;
   for(const field of Array.from(child.getElementsByTagName('*'))){if(field.namespaceURI!==W)continue;if(field.localName==='fldChar'&&attr(field,'fldCharType')==='begin')fieldDepth++;if(field.localName==='instrText'&&/^\s*TOC\b/.test(field.textContent)){tocDepth=fieldDepth;toc=true;}if(field.localName==='fldChar'&&attr(field,'fldCharType')==='end'){if(tocDepth===fieldDepth)tocDepth=null;fieldDepth=Math.max(0,fieldDepth-1);}}
   if(!text||toc||/^(?:TOC|目录)\d*$/i.test(style)||/^(?:目\s*录|table of contents)$/i.test(text)||/^.{1,180}(?:\.{3,}|…{2,}|·{3,})\s*\d+\s*$/.test(text))continue;
   blocks.push({text,level:heading(text,child,styles)});
  }else if(child.localName==='tbl'){
   if(child.getElementsByTagNameNS(W,'tbl').length||['vMerge','gridSpan'].some(tag=>child.getElementsByTagNameNS(W,tag).length))fail('初稿中的合并单元格或嵌套表格暂不能完整导入，请整理为普通表格后重试；原文不会被替换。');
   const rows=kids(child,'tr').map(tr=>kids(tr,'tc').map(tc=>kids(tc,'p').map(node=>paragraphText(node,markers)).join(' / ').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ').trim()));
   if(!rows.length||rows.length>200||rows.some(row=>row.length>30)||rows.some(row=>row.length!==rows[0].length))fail('表格结构或大小不符合导入要求，请使用不超过 200 行、30 列的普通表格。');
   blocks.push({text:[rows[0],rows[0].map(()=> '---'),...rows.slice(1)].map(row=>'| '+row.join(' | ')+' |').join('\n'),level:0});tableCount++;
  }else if(['sdt','sdtContent','customXml'].includes(child.localName))collect(child);
 }}collect(body);
 if(blocks.length>3000)fail('初稿段落较多，请拆分后再上传。');
 const groups=[];let current=null;
 for(const block of blocks){if(block.level===1){current={title:block.text,texts:[]};groups.push(current);}else{if(!current){current={title:'导入初稿正文',texts:[]};groups.push(current);}current.texts.push(block.level>1?'## '+block.text:block.text);}}
 const meaningful=groups.filter(row=>row.texts.some(text=>text.trim()));if(!meaningful.some(row=>!isOutlineReferenceChapter(row)&&!thesisFrontMatterKind(row)&&!thesisManualBackMatter(row)))fail('没有识别到可导入的正文，请检查初稿是否仅包含封面、目录或参考文献。');
 if(meaningful.length>30)fail('初稿章节超过 30 个，请合并章节后重试。');
 const characters=meaningful.reduce((sum,row)=>sum+row.texts.join('\n\n').length,0);if(characters<100||characters>200000)fail('初稿正文需为 100～200,000 个字符，请检查文件内容。');
 const sha=fileSha,referenceGroups=meaningful.filter(isOutlineReferenceChapter),imported=importDraftReferences(referenceGroups,{sha,references:snapshot.references||[]}),{references,citationIds}=imported;warnings.push(...imported.warnings);
 let unmatched=0;const remap=text=>remapDraftCitations(text,citationIds,{onUnmatched:()=>unmatched++});
 const used=new Set(),existing=snapshot.outline||[];
 const chapters=meaningful.map((group,index)=>{const known=existing.find(row=>!used.has(row.id)&&key(row.title)===key(group.title)),front=thesisFrontMatterKind(group),back=thesisManualBackMatter(group);let id=known?.id||(front?'front-'+front:back?'back-acknowledgements':'import-'+sha.slice(0,16)+'-'+index);while(used.has(id))id+='-new';used.add(id);const text=group.texts.join('\n\n');if(text.length>16000&&!isOutlineReferenceChapter(group))fail('“'+group.title+'”超过 16,000 字符，请拆分为更短的章节后导入，以便完整检查和完善。');if(/\[(?:source|figure):/i.test(text))fail('初稿包含无法确认来源的内部索引，请使用正常导出的 DOCX 文档后重试。');return{id,title:group.title,text:isOutlineReferenceChapter(group)?(imported.groupEntries.get(referenceGroups.indexOf(group))||[]).map(row=>'[source:'+row.id+'] '+formatThesisReference(references.find(reference=>reference.id===row.id))).join('\n'):remap(text),targetWords:0,sections:[],sourceIds:[],...(isOutlineReferenceChapter(group)?{kind:'references'}:{})};});
 if(unmatched)warnings.push('有 '+unmatched+' 处方括号数字未关联到标准题录，已保留原文，请核对其是否为引文。');
 warnings.push('导入仅整理初稿，不代表文献、研究结果或终稿已通过检查。');
 return {name,sha256:sha,characters,tableCount,chapters,references,objects,imageCount:objects.filter(row=>row.kind==='image').length,formulaCount:objects.filter(row=>row.kind==='formula').length,warnings:[...new Set(warnings)].slice(0,20),referenceCount:imported.referenceCount,referenceReviewCount:imported.reviewCount};
}
