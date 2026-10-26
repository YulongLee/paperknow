import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const marker=/(?:【|〔|\[|\{\{)\s*(?:待补充|待核对|待完善|请补充|待填写|来源待核对|文献信息待补全|草稿说明|To be supplied\b|To be verified\b|Draft note\b|TODO\b|TBD\b)[^\n\]】〕}]{0,500}(?:】|〕|\]|\}\})/giu;
const children=node=>[...node.childNodes].filter(n=>n.nodeType===1);

// Apply review color after template typography. Split only ordinary text runs;
// bookmarks, citation links, field codes, equations and code retain their data.
export async function highlightDraftReviewMarkers(bytes){
 const zip=await JSZip.loadAsync(bytes),file=zip.file('word/document.xml');if(!file)return bytes;
 const source=await file.async('string'),doc=new DOMParser().parseFromString(source,'application/xml');let changed=false;
 for(const paragraph of doc.getElementsByTagNameNS(W,'p')){
  if([...paragraph.getElementsByTagNameNS(W,'pStyle')].some(n=>n.getAttributeNS(W,'val')==='PKCode'))continue;
  let text='',runs=[];
  function scan(node){
   if(node.nodeType!==1)return;
   if(node.namespaceURI!==W){text+='\n';return;}
   if(node.localName==='r'){
    const parts=children(node);if(parts.some(n=>n.namespaceURI!==W||!['rPr','t'].includes(n.localName))){text+='\n';return;}
    const value=parts.filter(n=>n.localName==='t').map(n=>n.textContent).join('');if(value){runs.push({node,value,start:text.length});text+=value;}return;
   }
   if(['fldSimple','del'].includes(node.localName)){text+='\n';return;}
   for(const child of children(node))scan(child);
  }
  scan(paragraph);const ranges=[...text.matchAll(marker)].map(match=>[match.index,match.index+match[0].length]);if(!ranges.length)continue;
  for(const {node,value,start}of runs){
   const spans=ranges.filter(([from,to])=>from<start+value.length&&to>start).map(([from,to])=>[Math.max(0,from-start),Math.min(value.length,to-start)]);if(!spans.length)continue;
   const cuts=[...new Set([0,value.length,...spans.flat()])].sort((a,b)=>a-b);
   for(let index=0;index<cuts.length-1;index++){
    const from=cuts[index],to=cuts[index+1],copy=node.cloneNode(false),old=children(node).find(n=>n.localName==='rPr'),pr=old?.cloneNode(true);
    if(pr)copy.appendChild(pr);
    if(spans.some(([a,b])=>from>=a&&to<=b)){
     const properties=pr||doc.createElementNS(W,'w:rPr');if(!pr)copy.appendChild(properties);
     for(const color of [...properties.getElementsByTagNameNS(W,'color')])color.parentNode.removeChild(color);
     const color=doc.createElementNS(W,'w:color');color.setAttributeNS(W,'w:val','C00000');properties.appendChild(color);
    }
    const t=doc.createElementNS(W,'w:t');t.setAttribute('xml:space','preserve');t.textContent=value.slice(from,to);copy.appendChild(t);node.parentNode.insertBefore(copy,node);
   }
   node.parentNode.removeChild(node);changed=true;
  }
 }
 if(!changed)return bytes;
 zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
