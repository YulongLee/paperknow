// Citation metadata is deliberately kept separate from readable source text.
// Parsing an identifier does not verify a publication or confer full-text access.
const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
const key=value=>clean(value).normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const plain=value=>clean(value).replace(/\\(?:textit|textbf|emph|url)\s*\{([^{}]*)\}/g,'$1').replace(/[{}]/g,'');
const safeURL=value=>{try{const url=new URL(clean(value));return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
const doiOf=value=>clean(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'').match(/^10\.\d{4,9}\/[^\s<>"{}]+$/i)?.[0]?.replace(/[.,;，；。]+$/,'')||'';
export const citationMetadataFields=Object.freeze(['documentType','journal','publisher','publicationPlace','publicationSource','volume','issue','pages','edition','medium','accessedAt','citationText']);
const metadataLimits={documentType:100,journal:500,publisher:500,publicationPlace:200,publicationSource:500,volume:100,issue:100,pages:100,edition:100,medium:20,accessedAt:50,citationText:4000};
const risTypes={JOUR:'journal',JFULL:'journal',EJOUR:'journal',BOOK:'book',CHAP:'chapter',CPAPER:'conference',CONF:'conference',THES:'thesis',RPRT:'report',REPORT:'report',STAND:'standard',STD:'standard',PAT:'patent',NEWS:'newspaper',UNPB:'preprint',ELEC:'webpage'};
const bibTypes={article:'journal',book:'book',booklet:'book',inbook:'chapter',incollection:'chapter',inproceedings:'conference',conference:'conference',proceedings:'conference',mastersthesis:'thesis',phdthesis:'thesis',techreport:'report',manual:'report',patent:'patent',standard:'standard',online:'webpage'};
const typeCodes={J:'journal',M:'book',D:'thesis',C:'conference',N:'newspaper',R:'report',S:'standard',P:'patent',EB:'webpage',DB:'database',A:'archive',PP:'preprint',DS:'dataset',CM:'map',G:'collection',CP:'software',Z:'generic'};
const referenceDate=value=>clean(value).match(/^(\d{4})[-/](\d{2})[-/](\d{2})/)?.slice(1).join('-')||'';
const citationLiteral=value=>clean(value).replace(/^\[\d+\]\s*/,'').replace(/\s+/g,' ').trim();
function safeCitationText(value){const text=citationLiteral(value);return text.length<=4000&&!/\[(?:source|figure):|(?:javascript|data):|https?:\/\/[^\s/]*@/i.test(text)?text:'';}
function authorName(value,literal=false){const name=plain(value),parts=!literal&&name.match(/^([^,]+),\s*([^,]+)$/);return parts?{family:parts[1].trim(),given:parts[2].trim()}:{literal:name};}
function bibAuthors(value=''){const rows=[];let depth=0,start=0;for(let i=0;i<value.length;i++){if(value[i]==='{')depth++;else if(value[i]==='}')depth--;else if(!depth&&/^\s+and\s+/i.test(value.slice(i))){const delimiter=value.slice(i).match(/^\s+and\s+/i)[0];rows.push(value.slice(start,i).trim());i+=delimiter.length-1;start=i+1;}}rows.push(value.slice(start).trim());return rows.filter(Boolean);}
function finish(raw,fields={}){
 const rawCitation=clean(raw),title=plain(fields.title),abstract=plain(fields.abstract),authors=plain(fields.authors);
 if(!title||title.length>500)throw Error('文献标题为空或超过 500 字符，请检查这条引文。');
 if(abstract.length>30000)throw Error('单篇摘要超过 30,000 字符，请分开导入正文。');
 if(authors.length>1000)throw Error('作者字段超过 1,000 字符，请按引用规范整理作者列表后再导入。');
 const details=Object.fromEntries(citationMetadataFields.flatMap(key=>{const value=key==='citationText'?safeCitationText(fields[key]):plain(fields[key]);if(value.length>metadataLimits[key])throw Error('文献著录字段过长，请检查导入内容。');return value?[[key,value]]:[];}));
 return {id:'ref-'+crypto.randomUUID(),title,authors,...(fields.authorNames?.length?{authorNames:fields.authorNames}:{}),year:clean(fields.year).match(/(?:18|19|20|21)\d{2}/)?.[0]||'',doi:doiOf(fields.doi),url:safeURL(fields.url),...details,text:abstract,rawCitation,sourceLabel:'用户导入引文，题录未系统核验'+(abstract?' · 含用户提供摘要':''),confirmed:false};
}
function ris(text){
 const records=text.split(/(?:^|\n)ER\s*-\s*(?:\r?\n|$)/),result=[];
 for(const record of records){if(!record.trim())continue;const fields={},authors=[];let previous='';
  for(const line of record.split(/\r?\n/)){const m=line.match(/^([A-Z0-9]{2})\s+-\s?(.*)$/);if(m){previous=m[1];if(['AU','A1'].includes(previous))authors.push(m[2]);else if(fields[previous]===undefined)fields[previous]=m[2];}else if(/^\s+\S/.test(line)&&previous&&fields[previous]!==undefined)fields[previous]+=' '+line.trim();}
  const kind=(Object.hasOwn(risTypes,clean(fields.TY).toUpperCase())?risTypes[clean(fields.TY).toUpperCase()]:'generic'),start=clean(fields.SP),end=clean(fields.EP);
  result.push(finish(record,{title:fields.TI||fields.T1||fields.CT,authors:authors.join('; '),authorNames:authors.map(value=>authorName(value)),year:fields.PY||fields.Y1||fields.DA,doi:fields.DO,url:fields.UR,abstract:fields.AB||fields.N2,documentType:kind,journal:fields.JO||fields.JF||fields.JA||(kind==='journal'?fields.T2:''),publicationSource:fields.T2||fields.BT,publisher:fields.PB,publicationPlace:fields.CY||fields.PP,volume:fields.VL,issue:fields.IS,pages:start?start+(end&&end!==start?'-'+end:''):end,edition:fields.ET,accessedAt:referenceDate(fields.Y2),medium:fields.TY==='EJOUR'?'OL':''}));
 }return result;
}
function bibtex(text){
 const results=[];let cursor=0;
 while(cursor<text.length){const start=text.slice(cursor).search(/@[A-Za-z]+\s*[{(]/);if(start<0){if(text.slice(cursor).trim())throw Error('BibTeX 中含未识别内容，请按完整条目导入。');break;}const offset=cursor+start,head=text.slice(offset).match(/^@([A-Za-z]+)\s*([{(])/),open=head[2],close=open==='{'?'}':')';let i=offset+head[0].length,depth=1,quoted=false,escape=false;
  for(;i<text.length;i++){const c=text[i];if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c==='"')quoted=!quoted;if(!quoted){if(c===open)depth++;if(c===close&&--depth===0)break;else if(c!==close)depth+=0;}}
  if(depth!==0)throw Error('BibTeX 括号不完整，请补全条目后再导入。');
  const raw=text.slice(offset,i+1);cursor=i+1;if(/^(?:comment|preamble|string)$/i.test(head[1]))continue;
  const body=raw.slice(head[0].length,-1),comma=body.indexOf(',');if(comma<0)throw Error('BibTeX 缺少文献键与字段。');const fields={};let p=comma+1;
  while(p<body.length){while(/[\s,]/.test(body[p]||'')&&p<body.length)p++;if(p>=body.length)break;const name=body.slice(p).match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/);if(!name)throw Error('BibTeX 字段格式无效，请使用完整的 title、author 等字段。');p+=name[0].length;let value='';const marker=body[p];
   if(marker==='{'||marker==='"'){const end=marker==='{'?'}':'"';p++;let nested=1,escaped=false;for(;p<body.length;p++){const c=body[p];if(escaped){value+='\\'+c;escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(marker==='{'&&c==='{')nested++;if(c===end&&--nested===0){p++;break;}else if(c!==end)nested+=0;value+=c;}if(nested!==0)throw Error('BibTeX 字段括号或引号不完整。');}
   else{const begin=p;while(p<body.length&&body[p]!==',')p++;value=body.slice(begin,p).trim();if(!/^\d+$/.test(value))throw Error('BibTeX 字段请使用引号或花括号，暂不支持字符串宏。');}
   if(body.slice(p).trimStart().startsWith('#'))throw Error('暂不支持 BibTeX 字符串拼接，请展开为完整字段。');fields[name[1].toLowerCase()]=value;
  }
  const kind=(Object.hasOwn(bibTypes,head[1].toLowerCase())?bibTypes[head[1].toLowerCase()]:'generic');
  const authors=bibAuthors(fields.author);
  results.push(finish(raw,{title:fields.title,authors:authors.map(plain).join('; '),authorNames:authors.map(value=>authorName(value,value.startsWith('{'))),year:fields.year||fields.date,doi:fields.doi,url:fields.url,abstract:fields.abstract,documentType:kind,journal:fields.journal||fields.journaltitle,publicationSource:fields.booktitle,publisher:fields.publisher||fields.school||fields.institution,publicationPlace:fields.address||fields.location,volume:fields.volume,issue:fields.number||fields.issue,pages:fields.pages?.replace(/--+/g,'-')||fields.eid,edition:fields.edition,accessedAt:referenceDate(fields.urldate)}));
 }return results;
}
function citations(text){
 const lines=text.split(/\r?\n/).map(clean).filter(Boolean),entries=[];
 const numbered=lines.some(line=>/^\[\d{1,3}\]\s*/.test(line));
 for(const line of lines){if(/^\[\d{1,3}\]\s*/.test(line)||!entries.length)entries.push(line);else if(/^(?:摘要|Abstract)\s*[:：]/i.test(line))entries[entries.length-1]+='\n'+line;else if(numbered&&(!/\[(?:J|D|M|C|N|R|S|P|EB|DB|A|Z|PP|DS|CM|G|CP)(?:\/OL)?\]/i.test(entries.at(-1))||!/\[(?:J|D|M|C|N|R|S|P|EB|DB|A|Z|PP|DS|CM|G|CP)(?:\/OL)?\]/i.test(line)&&(!/\](?:[^\n]*?)(?:18|19|20|21)\d{2}/.test(entries.at(-1))||/^(?:DOI\s*[:：]|https?:\/\/|\d)/i.test(line))))entries[entries.length-1]+=' '+line;else entries.push(line);}
 return entries.map(raw=>{const entry=raw.replace(/^\[\d{1,3}\]\s*/,''),parts=entry.split(/\n?(?:摘要|Abstract)\s*[:：]/i),citation=parts.shift().trim(),type=citation.match(/\[(?:J|D|M|C|N|R|S|P|EB|DB|A|Z|PP|DS|CM|G|CP)(?:\/OL)?\]/i);let title='',authors='';
  if(type){const before=citation.slice(0,type.index),separator=before.search(/[.．]\s*/);if(separator>0){authors=before.slice(0,separator);title=before.slice(separator+1).trim();}else title=before;}
  else throw Error('标准引文需含 [J]、[D]、[M] 等类型标记；也可改用 RIS 或 BibTeX。');
  const doi=citation.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*[:：]\s*)(10\.\d{4,9}\/[^\s<>"{}]+)/i)?.[1]||citation.match(/\b(10\.\d{4,9}\/[^\s<>"{}]+)/i)?.[1];
  const after=citation.slice(type.index+type[0].length).replace(/^[.．。\s]+/,''),yearMatch=after.match(/\b((?:18|19|20|21)\d{2})\b/),url=citation.match(/https?:\/\/[^\s<>"{}]+/i)?.[0]?.replace(/[.,;，；。]+$/,''),code=type[0].slice(1,-1).toUpperCase().split('/')[0],kind=Object.hasOwn(typeCodes,code)?typeCodes[code]:'generic',details={documentType:kind,medium:/\/OL\]/i.test(type[0])?'OL':'',citationText:citation};
  if(yearMatch){const publication=after.slice(0,yearMatch.index).replace(/[,，.．\s]+$/,'').trim(),tail=after.slice(yearMatch.index+4),locator=tail.match(/^[,，\s]*(\d+[A-Za-z]?|[IVXLCDM]+)?\s*(?:\(([^)]+)\))?\s*(?::\s*([^.[\]\s]+))?/i);if(kind==='journal'){details.journal=publication;details.volume=locator?.[1]||'';details.issue=locator?.[2]||'';details.pages=locator?.[3]||'';}else if(['conference','chapter'].includes(kind))details.publicationSource=publication.replace(/^\/\/\s*/,'');else{const place=publication.match(/^(.+?)[：:]\s*(.+)$/);details.publicationPlace=place?.[1]||'';details.publisher=place?.[2]||publication;details.pages=tail.match(/^\s*:\s*([^.[\]\s]+)/)?.[1]||'';}}
  return finish(raw,{title,authors,year:yearMatch?.[1],doi,url,abstract:parts.join('\n'),...details});
 });
}
// Old drafts retained the source citation even when the importer dropped its
// publication fields. Recover only matching bibliographic facts, never source text.
const citationRecoveryCache=new WeakMap();
export function recoverCitationMetadata(row={}){
 const raw=clean(row.rawCitation||row.citationText);if(!raw||raw.length>100000)return {};
 try{let cached=citationRecoveryCache.get(row);if(!cached||cached.raw!==raw){const parsed=/^TY\s+-/m.test(raw)?ris(raw):/^\s*@[A-Za-z]+\s*[{(]/.test(raw)?bibtex(raw):citations(raw);cached={raw,source:parsed.length===1?parsed[0]:null};citationRecoveryCache.set(row,cached);}const source=cached.source;if(!source)return {};if(key(source.title)!==key(row.title)&&!(doiOf(row.doi)&&doiOf(row.doi).toLowerCase()===source.doi.toLowerCase()))return {};const result=Object.fromEntries(citationMetadataFields.filter(field=>source[field]).map(field=>[field,source[field]]));
  if(source.authorNames?.length)result.authorNames=structuredClone(source.authorNames);
  if(['title','authors','year','doi',...citationMetadataFields.filter(field=>field!=='citationText')].some(field=>clean(row[field])&&clean(source[field])&&key(row[field])!==key(source[field])))delete result.citationText;
  return result;
 }catch{return {};}
}
export function parseCitationImport(input,{existing=[]}={}){
 const text=clean(input).replace(/^\uFEFF/,'');if(!text)throw Error('请粘贴需要导入的引文。');if(text.length>100000)throw Error('单次引文内容最多 100,000 字符。');
 const format=/^TY\s+-/m.test(text)?'ris':/^\s*@[A-Za-z]+\s*[{(]/.test(text)?'bibtex':'gbt',parsed=format==='ris'?ris(text):format==='bibtex'?bibtex(text):citations(text);
 if(!parsed.length)throw Error('没有解析到完整文献条目。');if(parsed.length>50)throw Error('单次最多导入 50 篇，请分批处理。');
 const seenDOI=new Set(existing.map(row=>doiOf(row.doi).toLowerCase()).filter(Boolean)),seenTitle=new Set(existing.map(row=>key(row.title))),items=[],warnings=[];
 parsed.forEach((item,index)=>{const doi=item.doi.toLowerCase(),title=key(item.title);if(doi&&seenDOI.has(doi)||seenTitle.has(title)){warnings.push(`第 ${index+1} 篇与已选文献重复，未再次添加。`);return;}if(doi)seenDOI.add(doi);seenTitle.add(title);items.push(item);if(!item.authors||!item.year)warnings.push(`第 ${index+1} 篇的作者或年份尚不完整，请在导入后核对。`);});
 return {format,items,warnings,total:parsed.length,notice:'解析仅整理题录；不会核验出版真实性，也不会自动获得全文。仅明确标注的用户摘要进入可读材料。'};
}
