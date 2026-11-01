import {normalizeThesisFigures} from './thesis-figure.mjs';

export function manuscriptFigures(chapter={},text=chapter.text||''){
 const ids=new Set([...String(text).matchAll(/\[figure:([^\]\r\n]+)\]/g)].map(match=>match[1]));
 if(!ids.size)return [];
 const figures=normalizeThesisFigures(chapter.figures||[]).filter(row=>ids.has(row.id));
 if(figures.length!==ids.size)throw Error('正文插图与图形内容不完整，不能确认图文已检查。');
 return figures;
}

// Keep each marker with its actual diagram, and count both against the context
// allowance. Surrogate pairs and figure markers must never straddle batches.
export function manuscriptPart(chapter,start,limit){
 const source=chapter.text;let end=Math.min(source.length,start+limit);
 for(let attempt=0;attempt<130;attempt++){
  if(end<source.length&&/[\uD800-\uDBFF]/.test(source[end-1]))end--;
  for(const match of source.matchAll(/\[figure:[^\]\r\n]+\]/g))if(match.index<end&&match.index+match[0].length>end){end=match.index;break;}
  if(end<=start)throw Error('单张插图超过检查范围，未将图文检查标记为完成。');
  const text=source.slice(start,end),figures=manuscriptFigures(chapter,text),cost=text.length+(figures.length?JSON.stringify(figures).length:0);
  if(cost<=limit)return {text,figures,end,cost};
  end-=cost-limit;
 }
 throw Error('图文检查范围无法完整划分，请精简单张图的内容。');
}

export function assertCheckedFigures(value,figures=[]){
 const expected=new Set(figures.map(row=>row.id));
 if(!expected.size){if(value!==undefined&&(!Array.isArray(value)||value.length))throw Error('检查结果包含未提供的图片。');return [];}
 if(!Array.isArray(value)||value.length!==expected.size||new Set(value).size!==value.length||value.some(id=>!expected.has(id)))throw Error('尚未逐张完成图片内容检查。');
 return [...value];
}
