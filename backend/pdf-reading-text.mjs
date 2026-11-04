import {pdfTextLines} from '../dist/workspace/pdf-content-alignment.mjs';

export async function readPdfTextIndex(bytes){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false});
 try{const doc=await task.promise;if(doc.numPages>100)throw Error('PDF页数超过范围');const pages=[];let chars=0;
  for(let n=1;n<=doc.numPages;n++){
   const p=await doc.getPage(n),viewport=p.getViewport({scale:1}),lines=pdfTextLines(await p.getTextContent(),viewport,n),text=lines.map(l=>l.text).join('\n');chars+=text.length;if(chars>400000)throw Error('PDF文本超过范围');pages.push({pageIndex:n-1,text,lines});
  }
  const first=pages[0]?.lines||[],title=[...first].filter(l=>l.text.length>5&&l.y<.5).sort((a,b)=>b.h-a.h)[0]?.text||'';
  return{pages,text:pages.map(p=>p.text).join('\n\n'),title};
 }finally{await task.destroy();}
}
const normalized=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function restorePdfFootnotes(parsed,native){
 const known=normalized(parsed.text),extra=[];
 for(const page of native.pages||[]){
  const heights=(page.lines||[]).filter(l=>l.text.length>20&&l.y>.1&&l.y<.85).map(l=>l.h).sort((a,b)=>a-b),body=heights[Math.floor(heights.length*.75)]||0;let group=null;
  const finish=()=>{if(!group)return;const plain=normalized(group.text),parts=[];for(let i=0;i+12<=plain.length;i+=12)parts.push(plain.slice(i,i+12));const coverage=parts.filter(p=>known.includes(p)).length/Math.max(1,parts.length);if(plain.length>=35&&coverage<.65)extra.push({pageIndex:page.pageIndex,text:group.text});group=null;};
  for(const line of page.lines||[]){
   const small=line.y>.6&&line.h<body*.94;
   if(small&&/^\d{1,2}\s*[A-Z\u3400-\u9fff]/u.test(line.text)){finish();group={text:line.text,last:line};}
   else if(group&&small&&line.y-group.last.y<.045){group.text+=' '+line.text;group.last=line;}
   else finish();
  }finish();
 }
 if(!extra.length)return parsed;
 const additions=extra.map(p=>'[原文第 '+(p.pageIndex+1)+' 页脚注]\n'+p.text),text=parsed.text+'\n\n'+additions.join('\n\n');if(text.length>200000)return parsed;
 return{...parsed,text,markdown:(parsed.markdown||parsed.text)+'\n\n'+additions.join('\n\n'),pages:parsed.pages.map(p=>({...p,text:p.text+'\n\n'+extra.filter(e=>e.pageIndex===p.pageIndex).map(e=>e.text).join('\n\n')})),recoveredFootnotes:extra.length};
}
