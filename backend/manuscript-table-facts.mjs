import {numberedMarkdownTables} from '../dist/workspace/numbered-markdown-tables.mjs';
// Arithmetic over complete displayed tables; neither source verification nor
// statistical inference. These facts never suppress an independent warning.
const decimal=/^(-?)(\d{1,8})(?:\.(\d{1,12}))?$/u;
const cells=line=>line.trim().replace(/^\|/u,'').replace(/\|$/u,'').split('|').map(x=>x.trim());
const comparable=value=>{const m=decimal.exec(value);return m?(m[1]?-1n:1n)*(BigInt(m[2])*10n**12n+BigInt((m[3]||'').padEnd(12,'0'))):null;};
export function manuscriptTableFacts(cross){
 const facts=[];
 for(const table of cross?.tables||[]){
  if(table.entireTable!==true||typeof table.text!=='string')continue;
  const matches=numberedMarkdownTables(table.text).filter(t=>t.number===table.number);if(matches.length!==1)continue;
  const lines=table.text.slice(matches[0].offset,matches[0].end).split('\n').filter(l=>l.includes('|'));
  if(lines.length<4||lines.length>24)continue;const header=cells(lines[0]),body=lines.slice(2).map(cells);
  if(header.length<2||header.length>9||body.some(r=>r.length!==header.length||r.slice(1).some(v=>comparable(v)===null)))continue;
  const groups=new Map();for(const row of body){const stat=row[0].match(/(?:均值|平均值|标准差|中位数|mean|median|SD|standard deviation)$/iu)?.[0];if(!stat)continue;if(!groups.has(stat))groups.set(stat,[]);groups.get(stat).push(row);}
  for(const [statistic,rows]of groups){if(rows.length<2)continue;const columns=header.slice(1).map((label,index)=>{const values=rows.map(row=>({row:row[0],displayed:row[index+1],value:comparable(row[index+1])})),ordered=[...values].sort((a,b)=>a.value<b.value?-1:a.value>b.value?1:0),min=ordered[0].value,max=ordered.at(-1).value;return {label,min:values.filter(v=>v.value===min).map(({row,displayed})=>({row,displayed})),max:values.filter(v=>v.value===max).map(({row,displayed})=>({row,displayed}))};});
   facts.push({table:table.number,statistic,rows:rows.map(row=>row[0]),columns,displayedDecimalPlaces:[...new Set(rows.flatMap(row=>row.slice(1).map(v=>v.split('.')[1]?.length||0)))].sort((a,b)=>a-b)});
  }
 }
 return facts.length<=8&&JSON.stringify(facts).length<=3000?facts:[];
}
export function displayedTableExtremaConflicts(text){
 // Deliberately narrow: one unambiguous table, explicit all-column assertion,
 // homogeneous named statistics. Do not infer intent from arbitrary prose.
 const tables=numberedMarkdownTables(text);if(tables.length!==1)return [];
 const table=tables[0],facts=manuscriptTableFacts({tables:[{number:table.number,entireTable:true,text}]});let fence='';
 const prose=text.split('\n').map(line=>{const marker=line.match(/^\s*(\x60{3,}|~{3,})/);if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence='';return ' '.repeat(line.length);}return fence||/^\s*>/.test(line)?' '.repeat(line.length):line;}).join('\n');
 const result=[],count={二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8},escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const fact of facts){
  if(!['均值','平均值','标准差','中位数'].includes(fact.statistic))continue;
  const labels=new Set(fact.rows);
  for(const label of labels){const group=label.slice(0,-fact.statistic.length).trim();if(!group||group.length>40)continue;
   const pattern=new RegExp('(?<![\\p{L}\\p{N}])'+escape(group)+'\\s*(所有|全部|各个|每个|[二三四五六七八两2-8]个)(?:变量|指标|列)(?:的)?'+escape(fact.statistic)+'(?:均|都)(?:为|是)?(?:[二三四五六七八两2-8]+组)?(最小|最大)','gu');
   for(const match of prose.matchAll(pattern)){
    const prior=prose.slice(Math.max(0,match.index-16),match.index);if(/[“「"'\x60]$|(?:不是|并非|不能说|假设|如果|例如|不应).{0,12}$/u.test(prior))continue;
    if(match[1].endsWith('个')&&!['各个','每个'].includes(match[1])&&(count[match[1][0]]||Number(match[1][0]))!==fact.columns.length)continue;
    const edge=match[2]==='最小'?'min':'max',conflicts=fact.columns.filter(c=>!c[edge].some(v=>v.row===label));if(!conflicts.length)continue;
    result.push({quote:match[0],offset:match.index,table:table.number,statistic:fact.statistic,conflicts:conflicts.map(c=>({column:c.label,actual:c[edge]}))});
   }
  }
 }
 return result.slice(0,10);
}
