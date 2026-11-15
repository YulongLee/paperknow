import {numberedMarkdownTables} from '../dist/workspace/numbered-markdown-tables.mjs';
// Exact, limited decimal addition. This does not evaluate arbitrary formulas,
// infer rounding rules, or establish that the author's data are true.
const decimal=/^(\d{1,8})\.(\d{1,12})$/u;
export function exactDecimalSum(a,b){const x=decimal.exec(String(a)),y=decimal.exec(String(b));if(!x||!y||x[2].length!==y[2].length)return null;const n=x[2].length,scale=10n**BigInt(n),sum=(BigInt(x[1])*scale+BigInt(x[2]))+(BigInt(y[1])*scale+BigInt(y[2]));return String(sum/scale)+'.'+String(sum%scale).padStart(n,'0');}
export function manuscriptDecimalSums(cross){
 const facts=[];for(const table of cross?.tables||[]){if(table.entireTable!==true||typeof table.text!=='string')continue;const named=numberedMarkdownTables(table.text).filter(row=>row.number===table.number);if(named.length!==1)continue;const exactTable=table.text.slice(named[0].offset,named[0].end),tableLines=new Set(exactTable.split('\n')),lines=table.text.split('\n');
  let weightedHeader=false;for(const line of lines){if(tableLines.has(line)&&line.includes('|')&&/(?:权重|weight)/iu.test(line))weightedHeader=true;if(weightedHeader&&tableLines.has(line)&&line.includes('|')){const cells=line.split('|').map(s=>s.trim()).filter(Boolean);if(cells.length===3&&decimal.test(cells[1])&&decimal.test(cells[2])){const sum=exactDecimalSum(cells[1],cells[2]);if(sum)facts.push({table:table.number,digits:cells[1].split('.')[1].length,a:cells[1],b:cells[2],sum,origin:'table',line});}}
   if(/(?:复算|权重|输出)/u.test(line)){for(const match of line.matchAll(/(?<![\d.])(\d{1,8}\.\d{6,12})\s*(?:、|,|，|和|与|及)\s*(\d{1,8}\.\d{6,12})(?![\d.])/gu)){const sum=exactDecimalSum(match[1],match[2]);if(sum)facts.push({table:table.number,digits:match[1].split('.')[1].length,a:match[1],b:match[2],sum,origin:'nearby_text',line:line.slice(Math.max(0,match.index-80),Math.min(line.length,match.index+match[0].length+80))});}}
  }
 }
 // A truncated list cannot establish that all relevant rows have the same
 // sum. In that case provide no facts and never reject the model's warning.
 return facts.length<=12?facts:[];
}
