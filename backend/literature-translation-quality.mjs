import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {prepareTranslationPreview} from './document-translation-document.mjs';
export const literatureTranslationQualityVersion=4;
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraphs=doc=>[...doc.getElementsByTagNameNS(W,'p')];
const texts=p=>[...p.getElementsByTagName('*')].filter(n=>n.localName==='t'&&[W,'http://schemas.openxmlformats.org/officeDocument/2006/math'].includes(n.namespaceURI));
const text=p=>texts(p).map(n=>n.textContent).join('');
export async function repairAcademicTranslation(bytes,{source={}}={}){
 const prepared=await prepareTranslationPreview(bytes),zip=await JSZip.loadAsync(prepared.bytes),rawSource=source.text||'',knownRefs=new Set([...rawSource.matchAll(/\[(\d{1,4})\]/g)].map(m=>m[1]));
 const audit={version:literatureTranslationQualityVersion,terminologyCorrections:0,numberCorrections:0,citationCorrections:0,tableLayoutCorrections:0,titlePreserved:false,unresolvedCitations:[],sourceAvailable:!!rawSource};
 for(const name of ['word/document.xml','word/footnotes.xml','word/endnotes.xml']){
  const entry=zip.file(name);if(!entry)continue;const doc=new DOMParser({onError:()=>{throw Error('译文结构无法读取');}}).parseFromString(await entry.async('string'),'application/xml'),ps=paragraphs(doc);
  // Source-wide keyword matches cannot establish which translated paragraph or
  // formula they support. Preserve provider text, numbers, and citations rather
  // than silently rewriting a different passage. Flag unknown citations only.
  if(knownRefs.size)for(const p of ps)for(const m of text(p).matchAll(/\[(\d{1,4})\]/g))if(!knownRefs.has(m[1]))audit.unresolvedCitations.push(m[1]);
  for(const cell of doc.getElementsByTagNameNS(W,'tc')){
   // Fixed-width translated tables can split a single number (2048 -> 204 / 8)
   // because imported paragraph indents consume the cell's usable width.
   const content=text(cell).trim(),numeric=/^[\s\d.,+−–\-eEkKmM×%()]+$/.test(content),identifier=/^[A-Za-zα-ωΑ-Ωϵ][A-Za-z0-9_α-ωΑ-Ωϵ]{0,11}$/.test(content);
   if((!numeric&&!identifier)||content.length>80)continue;
   const before=cell.toString(),ensure=(parent,name)=>{let node=[...parent.childNodes].find(n=>n.namespaceURI===W&&n.localName===name);if(!node){node=doc.createElementNS(W,'w:'+name);const first=['tcPr','pPr'].includes(name)?parent.firstChild:parent.localName==='pPr'?[...parent.childNodes].find(n=>n.localName==='rPr'):null;parent.insertBefore(node,first||null);}return node;};
   const props=ensure(cell,'tcPr');ensure(props,'noWrap');const margins=ensure(props,'tcMar');
   for(const side of ['left','right']){const margin=ensure(margins,side);margin.setAttributeNS(W,'w:w','40');margin.setAttributeNS(W,'w:type','dxa');}
   for(const p of paragraphs(cell)){const ind=ensure(ensure(p,'pPr'),'ind');for(const side of ['left','right','firstLine'])ind.setAttributeNS(W,'w:'+side,'0');}
   if(cell.toString()!==before)audit.tableLayoutCorrections++;
  }
  zip.file(name,new XMLSerializer().serializeToString(doc));
 }
 audit.unresolvedCitations=[...new Set(audit.unresolvedCitations)].slice(0,30);
 return{bytes:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),audit};
}
