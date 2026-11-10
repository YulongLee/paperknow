import {researchWordCount} from './text-length.mjs';
// Lock the original Word-object paragraph and its immediate context. Models
// see short immutable tokens; only the server can restore the original blocks.
function blocksFor(unit){
 const text=String(unit?.completion?.originalText||''),parts=[...text.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)].map(m=>({start:m.index,end:m.index+m[0].length,text:m[0]})),indexes=new Set();
 for(let i=0;i<parts.length;i++)if(/\[docx:obj-[a-f0-9]{24}\]/.test(parts[i].text))for(let n=Math.max(0,i-1);n<=Math.min(parts.length-1,i+1);n++)indexes.add(n);
 const ordered=[...indexes].sort((a,b)=>a-b),ranges=[];for(const n of ordered){const previous=ranges.at(-1);if(previous&&n===previous.last+1)previous.last=n;else ranges.push({first:n,last:n});}
 return ranges.map(({first,last},i)=>{let token='【保留原稿段'+(i+1)+'】';while(text.includes(token))token=token.replace('】','甲】');return {token,text:text.slice(parts[first].start,parts[last].end)};});
}
export function thesisObjectAliases(unit){return blocksFor(unit).map(({token})=>token);}
export function aliasThesisRevision(revision,unit){
 const locks=blocksFor(unit);if(!locks.length)return revision;let excerpt=revision.originalExcerpt;
 for(const block of locks){if(!excerpt.includes(block.text))throw Error('原稿对象位置超出当前可核对范围，请拆分章节后重试。');excerpt=excerpt.replace(block.text,block.token);}
 return {...revision,originalExcerpt:excerpt,originalObjects:[],lockedBlocks:locks.map(({token,text})=>({token,chineseCharacters:researchWordCount(text,'中文'),englishWords:researchWordCount(text,'English'),context:text.replace(/\[docx:obj-[a-f0-9]{24}\]/g,'（原稿图片或公式）').slice(0,1000),sourceIds:[...new Set([...text.matchAll(/\[source:([^\]]+)\]/g)].map(m=>m[1]))]}))};
}
export function restoreThesisObjects(text,unit){
 const locks=blocksFor(unit);if(!locks.length)return text;let result=String(text),previous=-1;
 for(const block of locks){const at=result.indexOf(block.token);if(at<0||at<=previous||result.indexOf(block.token,at+block.token.length)>=0)throw Error('原稿图片或公式所在段落无法准确对应，已保留原稿，请核对后重试。');previous=at;}
 if((result.match(/【保留原稿段\d+甲*】/g)||[]).length!==locks.length)throw Error('原稿图片或公式位置标记无效，已保留原稿。');
 for(const block of locks)result=result.replace(block.token,block.text);
 return result;
}
