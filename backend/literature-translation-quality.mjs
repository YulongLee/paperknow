import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {prepareTranslationPreview} from './document-translation-document.mjs';
export const literatureTranslationQualityVersion=3;
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraphs=doc=>[...doc.getElementsByTagNameNS(W,'p')];
const texts=p=>[...p.getElementsByTagName('*')].filter(n=>n.localName==='t'&&[W,'http://schemas.openxmlformats.org/officeDocument/2006/math'].includes(n.namespaceURI));
const text=p=>texts(p).map(n=>n.textContent).join('');
function edit(p,at,length,replacement){
 const nodes=texts(p);let position=0,inserted=false;
 for(const n of nodes){const old=n.textContent,start=position,end=position+old.length;position=end;if(end<=at||start>=at+length)continue;const left=Math.max(0,at-start),right=Math.min(old.length,at+length-start);n.textContent=old.slice(0,left)+(inserted?'':replacement)+old.slice(right);n.setAttribute('xml:space','preserve');inserted=true;}
}
function replace(p,pattern,substitute){
 const matches=[...text(p).matchAll(pattern)];let changed=0;
 for(const m of matches.reverse()){const value=typeof substitute==='function'?substitute(m):substitute;if(value===undefined||value===m[0])continue;edit(p,m.index,m[0].length,value);changed++;}return changed;
}
export async function repairAcademicTranslation(bytes,{source={}}={}){
 const prepared=await prepareTranslationPreview(bytes),zip=await JSZip.loadAsync(prepared.bytes),rawSource=source.text||'',knownRefs=new Set([...rawSource.matchAll(/\[(\d{1,4})\]/g)].map(m=>m[1])),decimals=new Set(rawSource.match(/\d+\.\d+/g)||[]);
 const learning=/\b(?:neural|learning|attention)\b/i.test(rawSource)&&/\b(?:training|network|Transformer)\b/i.test(rawSource);
 const rules=learning?[
  [/\bTransformer\b/i,/变压器/g,'Transformer'],[/\bdropout\b/i,/辍学/g,'Dropout'],[/Residual\s+Dropout/i,/剩余\s*Dropout/g,'残差 Dropout'],
  [/\btraining\b/i,/培训/g,'训练'],[/\bensembl(?:e|es)\b/i,/合奏/g,'集成模型'],[/constituency\s+parsing/i,/选区解析/g,'成分句法分析'],[/\bperplexity\b/i,/困惑(?!度)/g,'困惑度'],
 ]:[];
 const audit={version:literatureTranslationQualityVersion,terminologyCorrections:0,numberCorrections:0,citationCorrections:0,tableLayoutCorrections:0,titlePreserved:false,unresolvedCitations:[],sourceAvailable:!!rawSource};
 for(const name of ['word/document.xml','word/footnotes.xml','word/endnotes.xml']){
  const entry=zip.file(name);if(!entry)continue;const doc=new DOMParser({onError:()=>{throw Error('译文结构无法读取');}}).parseFromString(await entry.async('string'),'application/xml'),ps=paragraphs(doc);
  if(name==='word/document.xml'&&source.title&&source.title.length<=250){
   const candidates=ps.slice(0,18).filter(p=>text(p).trim().length>4&&!text(p).includes('@')).map(p=>({p,size:Math.max(0,...[...p.getElementsByTagNameNS(W,'sz')].map(n=>Number(n.getAttributeNS(W,'val'))||0))})).sort((a,b)=>b.size-a.size);
   const title=candidates[0];if(title?.size>=32&&text(title.p)!==source.title){const ts=texts(title.p);if(ts.length){ts[0].textContent=source.title;for(const n of ts.slice(1))n.textContent='';audit.titlePreserved=true;}}
  }
  for(const p of ps){
   for(const [inSource,pattern,value]of rules)if(inSource.test(rawSource))audit.terminologyCorrections+=replace(p,pattern,value);
   audit.numberCorrections+=replace(p,/(\d+)[。．](\d+)/g,m=>decimals.has(m[1]+'.'+m[2])?m[1]+'.'+m[2]:undefined);
   // Restore a damaged reference only when both sides identify the same
   // unambiguous named subsection. Never map an unknown number by similarity.
   if(learning&&/残差\s*Dropout/.test(text(p))){
    const at=rawSource.search(/Residual\s+Dropout/i),refs=[...text(p).matchAll(/\[(\d{1,4})\]/g)],expected=at>=0?rawSource.slice(at,at+350).match(/\[(\d{1,4})\]/):null;
    if(expected&&refs.length===1&&!knownRefs.has(refs[0][1]))audit.citationCorrections+=replace(p,/\[(\d{1,4})\]/g,'['+expected[1]+']');
   }
   if(knownRefs.size)for(const m of text(p).matchAll(/\[(\d{1,4})\]/g))if(!knownRefs.has(m[1]))audit.unresolvedCitations.push(m[1]);
   // Mathematical runs must not translate variable names or decimal separators.
   // Only restore these two named ML parameters when present in the source.
   for(const node of p.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math','t')){
    let value=node.textContent;
    if(learning&&/P\s*drop/.test(rawSource)&&value.includes('掉落')){value=value.replace(/掉落/g,'drop');audit.terminologyCorrections++;}
    if(learning&&/[εϵ]/.test(rawSource)&&/标签平滑/.test(text(p))&&value.includes('岁数')){value=value.replace(/岁数/g,'ε');audit.terminologyCorrections++;}
    value=value.replace(/(\d+)[。．](\d+)/g,(whole,a,b)=>{if(!decimals.has(a+'.'+b))return whole;audit.numberCorrections++;return a+'.'+b;});node.textContent=value;
   }
  }
  for(const cell of doc.getElementsByTagNameNS(W,'tc')){
   if(learning){for(const p of paragraphs(cell)){
    if(/^P掉落$/.test(text(p))&&/P\s*drop/.test(rawSource))audit.terminologyCorrections+=replace(p,/掉落/g,'drop');
    if(/^d型号$/.test(text(p))&&/d\s*model/.test(rawSource))audit.terminologyCorrections+=replace(p,/型号/g,'model');
    if(/^岁数ls$/.test(text(p))&&/[εϵ]\s*ls/.test(rawSource))audit.terminologyCorrections+=replace(p,/岁数/g,'ε');
   }}
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
