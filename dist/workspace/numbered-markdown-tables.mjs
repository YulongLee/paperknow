// Only actual Markdown tables count. Captions and examples inside fenced code
// do not establish table identity; never infer references or renumber content.
export function numberedMarkdownTables(text){
 text=String(text||'');const lines=text.split('\n'),tables=[],offsets=[];let fence='',offset=0;
 for(const line of lines){offsets.push(offset);offset+=line.length+1;}
 const cells=line=>{if(!line||!line.includes('|')||/\\\|/.test(line))return [];return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(value=>value.trim());};
 const divider=row=>row.length>=2&&row.length<=20&&row.every(value=>/^:?-{3,}:?$/.test(value));
 const record=(match,index,headerIndex,firstDataIndex,shortContinuation=false)=>{
  const number=match[1].replace(/[.－]/g,'-'),quote=lines[index].trim(),at=offsets[index]+lines[index].indexOf(quote),header=cells(lines[headerIndex]).join('\u0001');let endIndex=firstDataIndex;
  while(endIndex<lines.length&&cells(lines[endIndex]).length===cells(lines[headerIndex]).length)endIndex++;
  const end=endIndex<lines.length?offsets[endIndex]:text.length,previous=tables.at(-1),hasContinuation=/(?:[（(]\s*续(?:表)?\s*[）)]|续表|^\s*\|?\s*续表|[（(]\s*continued\s*[）)]|\bcontinued\b)/iu.test(quote);
  const continued=Boolean(hasContinuation&&previous&&previous.number===number&&previous.header===header&&previous.end<=at&&!text.slice(previous.end,at).trim());
  if(!shortContinuation||continued)tables.push({number,quote,offset:at,header,end,continued});
 };
 for(let i=0;i<lines.length;i++){
  const marker=lines[i].match(/^\s*(\x60{3,}|~{3,})/);if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence='';continue;}if(fence)continue;
  const title=lines[i].trim().replace(/^\|\s*/,'').replace(/\s*\|$/,'');const titleMatch=title.match(/^(?:表\s*|Table\s+)(\d+(?:[.\-－]\d+)*)(?:\s*[:：.、]\s*|\s+)\S/i),reversedSep=cells(lines[i+1]),next=cells(lines[i+2]),row=cells(lines[i+3]);
  if(titleMatch&&divider(reversedSep)&&next.length===reversedSep.length&&row.length===reversedSep.length)record(titleMatch,i,i+2,i+3);
  const head=cells(lines[i]),sep=cells(lines[i+1]);if(head.length<2||head.length!==sep.length||!divider(sep))continue;
  let prior=i-1;while(prior>=0&&!lines[prior].trim())prior--;
  const caption=prior<0?'':lines[prior].trim().replace(/^#{1,6}\s*/,'').replace(/^\|\s*((?:表|Table)\s*\d[^|]*)\s*\|$/i,'$1').trim();
  const match=caption.match(/^(?:表\s*|Table\s+)(\d+(?:[.\-－]\d+)*)(?:\s*[:：.、]\s*|\s+)\S/i);
  if(match)record(match,prior,i,i+2);else{const short=caption.match(/^(?:表\s*(\d+(?:[.\-－]\d+)*)\s*[（(]\s*续(?:表)?\s*[）)]|续表\s*(\d+(?:[.\-－]\d+)*))\s*$/u);if(short)record([short[0],short[1]||short[2]],prior,i,i+2,true);}
 }
 return tables;
}
