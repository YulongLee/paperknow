import {researchWordCount} from './text-length.mjs';
// Lock original Word objects and original Markdown tables through automatic
// revision. A later author edit becomes a new baseline. The server restores
// exact blocks; the model cannot silently drop or change their data.
const paragraphs=text=>[...String(text||'').matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)].map(m=>({start:m.index,end:m.index+m[0].length,text:m[0]}));
// Match the exporter's ordinary pipe tables, including escaped cell pipes
// and optional outer pipes, without treating examples in fenced code as data.
function markdownTableOffsets(text){
 const lines=String(text||'').split('\n'),offsets=[];let pos=0,fence='';for(const line of lines){offsets.push(pos);pos+=line.length+1;}
 const cells=line=>{if(!line)return [];let parts=[],cell='',pipe=false,code=0,math=false;
  for(let i=0;i<line.length;i++){const ch=line[i];let slashes=0;for(let n=i-1;n>=0&&line[n]==='\\';n--)slashes++;const escaped=slashes%2===1;
   if(ch==='`'&&!escaped){let len=1;while(line[i+len]==='`')len++;code=code===len?0:code||len;cell+='`'.repeat(len);i+=len-1;continue;}
   if(ch==='$'&&!escaped&&!code){math=!math;cell+=ch;continue;}
   if(ch==='|'&&!escaped&&!code&&!math){parts.push(cell.trim());cell='';pipe=true;}else cell+=ch;
  }
  if(!pipe)return [];parts.push(cell.trim());if(/^\s*\|/.test(line))parts.shift();if(/\|\s*$/.test(line)&&!/(?:^|[^\\])(?:\\\\)*\\\|\s*$/.test(line))parts.pop();return parts;
 };
 const divider=row=>row.length>=2&&row.length<=30&&row.every(cell=>/^:?-{3,}:?$/.test(cell));const found=[];
 for(let i=0;i<lines.length;i++){
  const marker=lines[i].match(/^\s*(`{3,}|~{3,})/);if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence='';continue;}if(fence)continue;
  const head=cells(lines[i]),sep=cells(lines[i+1]);if(head.length>=2&&head.length===sep.length&&divider(sep)){found.push(offsets[i]+lines[i].search(/\S/));continue;}
  // The exporter also recognizes caption / separator / header / data.
  const separator=cells(lines[i]),next=cells(lines[i+1]),row=cells(lines[i+2]);let prior=i-1;while(prior>=0&&!lines[prior].trim())prior--;
  const caption=prior>=0?lines[prior].trim().replace(/^\|\s*/,'').replace(/\s*\|$/,''):'';
  if(divider(separator)&&next.length===separator.length&&row.length===separator.length&&/^(?:表\s*\d+(?:[.\-－]\d+)*|Table\s+\d+(?:[.\-－]\d+)*)(?:\s*[:：.、]\s*|\s+)\S/i.test(caption))found.push(offsets[i]+lines[i].search(/\S/));
 }
 return found;
}
export function protectedTableRanges(text){const starts=markdownTableOffsets(text);return paragraphs(text).filter(part=>starts.some(start=>start>=part.start&&start<part.end)).map(({start,end})=>({start,end}));}
function blocksFor(unit){
 const text=String(unit?.completion?.originalText||''),parts=paragraphs(text),tableRanges=protectedTableRanges(text),indexes=new Set();
 for(let i=0;i<parts.length;i++){
  if(/\[docx:obj-[a-f0-9]{24}\]/.test(parts[i].text))for(let n=Math.max(0,i-1);n<=Math.min(parts.length-1,i+1);n++)indexes.add(n);
  // The DOCX importer represents a normal table as Markdown. Lock the full
  // block containing its header and separator, including every original cell.
  if(tableRanges.some(range=>range.start===parts[i].start))indexes.add(i);
 }
 const ordered=[...indexes].sort((a,b)=>a-b),ranges=[];for(const n of ordered){const previous=ranges.at(-1);if(previous&&n===previous.last+1)previous.last=n;else ranges.push({first:n,last:n});}
 return ranges.map(({first,last},i)=>{let token='【保留原稿段'+(i+1)+'】';while(text.includes(token))token=token.replace('】','甲】');return {token,text:text.slice(parts[first].start,parts[last].end)};});
}
export function thesisObjectAliases(unit){return blocksFor(unit).map(({token})=>token);}
// Prevent appended text from becoming a new row of an original locked table
// after restoration. A protected table block must remain its own paragraph.
export function assertLockedTableBoundaries(text,unit){
 const candidate=String(text||'');for(const block of blocksFor(unit)){
  if(!protectedTableRanges(block.text).length)continue;
  const at=candidate.indexOf(block.token);if(at<0)continue; // restoration reports a missing token
  const before=candidate.slice(0,at),after=candidate.slice(at+block.token.length);
  if(!/(?:^|\n\s*\n)[ \t]*$/.test(before)||!/^[ \t]*(?:\n\s*\n|$)/.test(after))throw Error('原稿表格保护块必须独立成段，不能紧邻其他文字或新增表格行。');
 }
}
export function aliasThesisRevision(revision,unit){
 const locks=blocksFor(unit);if(!locks.length)return revision;let excerpt=revision.originalExcerpt;
 for(const block of locks){if(!excerpt.includes(block.text))throw Error('原稿对象位置超出当前可核对范围，请拆分章节后重试。');excerpt=excerpt.replace(block.text,block.token);}
 return {...revision,originalExcerpt:excerpt,originalObjects:[],lockedBlocks:locks.map(({token,text})=>({token,chineseCharacters:researchWordCount(text,'中文'),englishWords:researchWordCount(text,'English'),context:text.replace(/\[docx:obj-[a-f0-9]{24}\]/g,'（原稿图片或公式）').slice(0,1000),sourceIds:[...new Set([...text.matchAll(/\[source:([^\]]+)\]/g)].map(m=>m[1]))]}))};
}
export function restoreThesisObjects(text,unit){
 const locks=blocksFor(unit);if(!locks.length)return text;let result=String(text),previous=-1;
 for(const block of locks){const at=result.indexOf(block.token);if(at<0||at<=previous||result.indexOf(block.token,at+block.token.length)>=0)throw Error('原稿图片、公式或表格所在段落无法准确对应，已保留原稿，请核对后重试。');previous=at;}
 if((result.match(/【保留原稿段\d+甲*】/g)||[]).length!==locks.length)throw Error('原稿图片、公式或表格位置标记无效，已保留原稿。');
 for(const block of locks)result=result.replace(block.token,block.text);
 return result;
}
