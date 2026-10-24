import {decodeThesisTemplateXml} from '../src/thesis-template-placement.js';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse=s=>new DOMParser().parseFromString(s,'application/xml');
const key=s=>s.trim().replace(/\s+/g,' ').replace(/\s*\\\*\s+(?:MERGEFORMAT|CHARFORMAT)\b/gi,'').replace(/^(page|numpages|sectionpages|pageref|ref)\b/i,m=>m.toUpperCase()).replace(/"([A-Za-z_][\w]*)"/g,'$1').replace(/\s+\\h\b/g,'').trim();
function indexPageValues(document,values){
 const anchors=new Map();for(const p of document.getElementsByTagNameNS(W,'p')){const names=[...p.getElementsByTagNameNS(W,'bookmarkStart')].map(n=>n.getAttributeNS(W,'name'));for(const name of names)anchors.set(name,names);}
 for(const p of document.getElementsByTagNameNS(W,'p')){
  const style=p.getElementsByTagNameNS(W,'pStyle')[0]?.getAttributeNS(W,'val');if(!/^(?:TOC|Contents)[123]$/i.test(style||''))continue;
  const nodes=[...p.getElementsByTagNameNS(W,'t')],page=nodes.at(-1)?.textContent.trim();if(!/^\d{1,5}$/.test(page||''))continue;
  for(const link of p.getElementsByTagNameNS(W,'hyperlink'))for(const name of anchors.get(link.getAttributeNS(W,'anchor'))||[])if(/^PK_\d+$/.test(name))values.set('PAGEREF '+name,page);
 }
}
function fields(document){
 const result=[],stack=[];
 const walk=node=>{
  if(node.namespaceURI===W){
   if(node.localName==='fldSimple'){const field={instruction:key(node.getAttributeNS(W,'instr')||''),nodes:[...node.getElementsByTagNameNS(W,'t')]};result.push(field);for(const child of node.childNodes)walk(child);return;}
   if(node.localName==='fldChar'){const type=node.getAttributeNS(W,'fldCharType');if(type==='begin')stack.push({instruction:'',nodes:[],phase:'instruction'});else if(type==='separate'&&stack.length)stack.at(-1).phase='cache';else if(type==='end'&&stack.length){const field=stack.pop();field.instruction=key(field.instruction);result.push(field);}}
   else if(node.localName==='instrText'&&stack.at(-1)?.phase==='instruction')stack.at(-1).instruction+=node.textContent;
   else if(node.localName==='t'&&stack.at(-1)?.phase==='cache')stack.at(-1).nodes.push(node);
  }
  for(const child of node.childNodes||[])walk(child);
 };walk(document);return result;
}
// Writer may rewrite styles, drawings and unrelated OOXML while saving.
// Return the source package and transfer numeric field display caches only.
// Never use Writer's reconstructed package as the template-based deliverable.
export async function mergeThesisFieldCaches(sourceBytes,renderedBytes){
 const source=await JSZip.loadAsync(sourceBytes),rendered=await JSZip.loadAsync(renderedBytes),globalValues=new Map(),activeParts=new Set(['word/document.xml']);let updated=0,unresolved=0;
 const sourceDocument=parse(decodeThesisTemplateXml(await source.file('word/document.xml').async('uint8array'))),usedRelations=new Set([...sourceDocument.getElementsByTagName('*')].filter(n=>['headerReference','footerReference'].includes(n.localName)).map(n=>n.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'))),relationFile=source.file('word/_rels/document.xml.rels');
 if(relationFile)for(const relation of parse(decodeThesisTemplateXml(await relationFile.async('uint8array'))).getElementsByTagName('*'))if(relation.localName==='Relationship'&&usedRelations.has(relation.getAttribute('Id'))&&/\/(?:header|footer)$/.test(relation.getAttribute('Type')||'')){const url=new URL(relation.getAttribute('Target'),'file:///word/document.xml');activeParts.add(decodeURIComponent(url.pathname.slice(1)));}
 for(const entry of Object.values(rendered.files))if(!entry.dir&&/^word\/[^/]+\.xml$/.test(entry.name)){const document=parse(decodeThesisTemplateXml(await entry.async('uint8array')));if(entry.name==='word/document.xml')indexPageValues(document,globalValues);for(const field of fields(document)){const value=field.nodes.map(n=>n.textContent).join('').trim();if(/^(?:NUMPAGES|PAGEREF|REF)\b/.test(field.instruction)&&/^\d{1,5}$/.test(value))globalValues.set(field.instruction,value);}}
 for(const entry of Object.values(source.files)){
  if(entry.dir||!activeParts.has(entry.name))continue;
  const originalText=decodeThesisTemplateXml(await entry.async('uint8array')),document=parse(originalText),actual=rendered.file(entry.name)?parse(decodeThesisTemplateXml(await rendered.file(entry.name).async('uint8array'))):null,values=new Map();
  for(const field of actual?fields(actual):[]){const value=field.nodes.map(n=>n.textContent).join('').trim();if(!/^\d{1,5}$/.test(value))continue;const list=values.get(field.instruction)||[];list.push(value);values.set(field.instruction,list);}
  let changed=false;
  for(const field of fields(document)){
   if(!/^(?:PAGE|NUMPAGES|SECTIONPAGES|PAGEREF\s+[^\s]+(?:\s+\\h)?|REF\s+[^\s]+(?:\s+\\h)?)$/i.test(field.instruction))continue;
   const list=values.get(field.instruction),value=(list?.length>1?list.shift():list?.[0])||globalValues.get(field.instruction)||(/^PAGE$/.test(field.instruction)?'1':null);
   if(!value||!field.nodes.length){unresolved++;continue;}
   field.nodes[0].textContent=value;for(const n of field.nodes.slice(1))n.textContent='';updated++;changed=true;
  }
  if(changed)source.file(entry.name,new XMLSerializer().serializeToString(document).replace(/^(<\?xml[^?]*encoding\s*=\s*["'])utf-16(?:le|be)?(["'][^?]*\?>)/i,'$1UTF-8$2'));
 }
 return {bytes:await source.generateAsync({type:'uint8array',compression:'DEFLATE'}),updated,unresolved};
}
