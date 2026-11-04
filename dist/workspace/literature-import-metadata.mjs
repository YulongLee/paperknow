// Conservative extraction from the imported document, without guessing authors
// from a filename or treating PDF creation dates as publication years.
export function enrichLiteraturePaper(paper){
 const blocks=String(paper.text||'').split(/\n\s*\n/),abstractAt=blocks.findIndex(b=>/^#{1,6}\s*(?:abstract|摘要|摘\s*要)\s*$/i.test(b.trim()));
 if(abstractAt<0)return paper;
 const head=blocks.slice(0,abstractAt),names=[];
 for(const block of head){if(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(block))continue;
  const line=block.split('\n')[0],marked=/\$|\\?[*†‡]/.test(line);if(!marked&&/\b(?:University|Institute|Google|Department|Laboratory|School|College)\b/i.test(line))continue;
  const first=(marked?line.split(/\$|\\?[*†‡]/)[0]:line).trim();
  if(/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,4}$/u.test(first)&&first.length<=80)names.push(first);
 }
 const abstract=[];for(const block of blocks.slice(abstractAt+1)){if(/^#{1,6}\s+/.test(block))break;abstract.push(block);}
 const text=abstract.join('\n\n');return {...paper,...(!paper.authors&&names.length?{authors:[...new Set(names)].join(', ')}:{}),...(!paper.abstract&&text.length<=20000?{abstract:text}:{})};
}
