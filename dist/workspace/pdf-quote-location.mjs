const normalized=text=>String(text||'').normalize('NFKC').replace(/\\(?:cdot|times|left|right)\b/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
// Only exact normalized text is accepted. Ambiguous or scanned content never
// guesses a page. Returned geometry comes from the actual PDF text layer.
export function locatePdfQuote(lines,quote){
 const target=normalized(quote);if(target.length<12)return null;
 const pages=new Map();for(const line of lines){const list=pages.get(line.page)||[];list.push(line);pages.set(line.page,list);}
 const matches=[];
 for(const [page,items]of pages){let text='';const spans=items.map(line=>{const start=text.length;text+=normalized(line.text);return{line,start,end:text.length};});
  let at=text.indexOf(target);if(at<0)continue;if(text.indexOf(target,at+1)>=0)return null;
  const hits=spans.filter(s=>s.end>at&&s.start<at+target.length).map(s=>s.line);matches.push({page,fraction:Math.max(0,(hits[0]?.y||0)-.08),lines:hits});
 }
 return matches.length===1?matches[0]:null;
}
