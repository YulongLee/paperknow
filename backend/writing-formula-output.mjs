import {formulaMathMLMarkup} from '../src/research-formula-core.js';
import {mathmlToOmml} from '../src/research-formula-document.js';

// A narrow formatting check for evident function equations already present in
// a selected-formula section. It never creates formulas, alters manuscript
// text, claims mathematical correctness or requires a formula without evidence.
export function formulaOutputIssue(value){
 let text=String(value||'').replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g,match=>' '.repeat(match.length));
 const formulas=[],before=text;
 const escaped=at=>{let slashes=0;while(at>0&&before[--at]==='\\')slashes++;return slashes%2===1;};
 // Scan once, remembering when a closing delimiter cannot occur later. This
 // avoids rescanning a long unfinished expression for each opening token.
 const ranges=[],exhausted=new Set();let i=0;
 while(i<before.length){
  let open='',close='';
  if((before[i]==='$'||before[i]==='\\'&&(before[i+1]==='['||before[i+1]==='('))&&!escaped(i)){
   if(before.startsWith('$$',i)){open=close='$$';}
   else if(before.startsWith('\\[',i)){open='\\[';close='\\]';}
   else if(before.startsWith('\\(',i)){open='\\(';close='\\)';}
   else if(before[i]==='$'&&!/[\s$]/.test(before[i+1]||' ')){open=close='$';}
  }
  if(!open||exhausted.has(open)){i++;continue;}
  let end=before.indexOf(close,i+open.length),lineEnd=close==='$'?before.indexOf('\n',i+open.length):-1;
  while(end>=0&&(escaped(end)||close==='$'&&(/[\s]/.test(before[end-1]||' ')||/\d/.test(before[end+1]||''))))end=before.indexOf(close,end+close.length);
  if(end<0){exhausted.add(open);i+=open.length;continue;}
  if(lineEnd>=0&&end>lineEnd){i=lineEnd+1;continue;}
  if(!before.slice(i+open.length,end).trim()){i=end+close.length;continue;}
  const finish=end+close.length;formulas.push({value:before.slice(i,finish),at:i});ranges.push([i,finish]);i=finish;
 }
 let offset=0;const pieces=[];for(const [start,end] of ranges){pieces.push(before.slice(offset,start),' '.repeat(end-start));offset=end;}pieces.push(before.slice(offset));text=pieces.join('');
 if(formulas.length>50)return '本节公式数量超出可安全核对的范围，请分节处理。';
 for(const formula of formulas){
  if(formula.value.startsWith('\\[')||formula.value.startsWith('$$')&&formula.value.includes('\n')){const start=before.lastIndexOf('\n',formula.at)+1,next=before.indexOf('\n',formula.at+formula.value.length),end=next<0?before.length:next;if(before.slice(start,formula.at).trim()||before.slice(formula.at+formula.value.length,end).trim())return '块级公式须独立成段，以便导出可编辑 Word 公式。';}
  try{if(!mathmlToOmml(formulaMathMLMarkup(formula.value).markup).startsWith('<m:oMath '))throw Error('unsupported');}catch{return '已有公式未能转换为可编辑 Word 公式，请核对 LaTeX 定界符与语法。';}
 }
 const functionEquation=/(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9_]{0,20}\s*\([^()\n]{1,40}\)\s*=\s*([A-Za-z0-9()+\-−*/^²³·×]+(?:\s*[+\-−*/^×·]\s*[A-Za-z0-9()²³]+)*)/gu;
 if([...text.matchAll(functionEquation)].some(match=>/[0-9²³+\-−*/^·×]/u.test(match[1]))||/(?<![A-Za-z0-9_])[A-Za-z]\s*=\s*[A-Za-z][A-Za-z0-9]*[²³]/u.test(text))return '已出现的函数等式需要使用完整的 LaTeX 数学定界符（如 $C(n)=n^{2}$），以便导出可编辑公式。';
 return '';
}
