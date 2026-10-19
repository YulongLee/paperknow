import {download,esc} from './ui.mjs';

// These local plain-text templates use only supplied bibliographic facts.
// They do not copy CSL styles or load a processor, locale, metadata or full text.
// Reference conventions: APA 7 https://apastyle.apa.org/style-grammar-guidelines/references/examples
// MLA 9 https://style.mla.org/works-cited/citations-by-format/
// Vancouver/NLM https://www.ncbi.nlm.nih.gov/books/NBK7256/
// GB/T is explicitly the 7714-2015 numeric convention, not an unspecified edition.
export const literatureCitationStyles=Object.freeze([
 ['gbt','GB/T 7714-2015（顺序编码）'],['apa','APA 7'],['mla','MLA 9'],
 ['ieee','IEEE'],['vancouver','Vancouver'],['bibtex','BibTeX'],['ris','RIS']
].map(value=>Object.freeze(value)));
const styleKeys=new Set(literatureCitationStyles.map(([key])=>key));
const metadataFields=['id','title','authors','authorNames','year','doi','url','documentType','type','journal','publisher','publicationSource','volume','issue','pages','keywords','abstract','accessedAt'];
const text=value=>typeof value==='string'||typeof value==='number'&&Number.isFinite(value)?String(value).replace(/<\/?[A-Za-z][^>]*>/g,'').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/gu,' ').trim():'';
const sentence=value=>value?/(?:[.!?。！？][”’"']*)$/u.test(value)?value:value+'.':'';
const sentences=values=>values.filter(Boolean).map(sentence).join(' ');
const join=(values,delimiter=', ')=>values.filter(Boolean).join(delimiter);
const typeAliases={journal:'journal',article:'journal','journal-article':'journal','article-journal':'journal',book:'book',thesis:'thesis',dissertation:'thesis',conference:'conference','conference-paper':'conference','paper-conference':'conference',patent:'patent',standard:'standard',yearbook:'yearbook',newspaper:'newspaper','article-newspaper':'newspaper',preprint:'preprint',report:'report',chapter:'chapter','book-chapter':'chapter',generic:'generic'};
function kindOf(paper){const resolve=value=>typeof value==='string'&&Object.hasOwn(typeAliases,value)?typeAliases[value]:null,selected=resolve(paper.documentType);return selected&&selected!=='generic'?selected:resolve(paper.type)||selected||'generic';}
function yearOf(value){const raw=text(value);return /^(?!0000)\d{4}$/.test(raw)?raw:'';}
function dateOf(value){const raw=value instanceof Date&&!Number.isNaN(value.valueOf())?value.toISOString():text(value),match=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\S+)?$/);if(!match||raw.length>10&&Number.isNaN(Date.parse(raw)))return '';const date=new Date(match[1]+'-'+match[2]+'-'+match[3]+'T00:00:00Z');return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===match[0].slice(0,10)?match[0].slice(0,10):'';}
function urlOf(value){if(typeof value!=='string'||/[\u0000-\u0020\u007f<>\\\u202a-\u202e\u2066-\u2069]/.test(value))return '';try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function doiOf(value){const raw=text(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'');return /^10\.\d{4,9}\/[^\s<>"\\]+$/i.test(raw)?raw:'';}
const doiURL=doi=>'https://doi.org/'+encodeURIComponent(doi).replace(/%2F/gi,'/');
function authorsOf(paper,warn){
 let names=[];
 if(paper.authorNames!==undefined){
  if(Array.isArray(paper.authorNames))for(const row of paper.authorNames){
   if(typeof row==='string'&&text(row))names.push({literal:text(row)});
   else if(row&&typeof row==='object'&&!Array.isArray(row)){
    const literal=text(row.literal),family=text(row.family??row.familyName),given=text(row.given??row.givenName);
    if(literal)names.push({literal});else if(family)names.push({family,given});else if(text(row.name))names.push({literal:text(row.name)});else warn('结构化作者有缺项，未推断姓名。');
   }else warn('结构化作者格式无效，未推断姓名。');
  }else warn('结构化作者格式无效，改按已有作者原文处理。');
 }
 if(!names.length){const raw=Array.isArray(paper.authors)?paper.authors:[paper.authors];names=raw.flatMap(value=>typeof value==='string'?value.split(/[;；]/u):[]).map(text).filter(Boolean).map(literal=>({literal}));}
 if(names.some(row=>row.literal))warn('作者按原文保留，未推断逗号、顿号或空格中的姓与名；如需姓名缩写，请补充结构化作者。');
 return names;
}
function normalizePaper(paper,index,warnings){
 if(!paper||typeof paper!=='object'||Array.isArray(paper))throw Error('第 '+(index+1)+' 条文献格式无效。');
 const warn=message=>warnings.push('第 '+(index+1)+' 条：'+message),kind=kindOf(paper),title=text(paper.title),authors=authorsOf(paper,warn),year=yearOf(paper.year),doi=doiOf(paper.doi),url=urlOf(paper.url),accessedAt=dateOf(paper.accessedAt);
 if(!title)warn('缺少标题，以“[标题未提供]”标明。');if(!authors.length)warn('缺少作者，未补造作者。');if(!year)warn(text(paper.year)?'年份不是有效四位年份，未采用。':'缺少年份，未补造出版年份。');
 if(paper.doi&&!doi)warn('DOI 格式无效，未导出。');if(paper.url&&!url)warn('URL 格式无效或含账户信息，未导出。');if(paper.accessedAt&&!accessedAt)warn('访问日期无效，未采用，也未以今天代替。');
 const fields=Object.fromEntries(['journal','publisher','publicationSource','volume','issue','pages','abstract'].map(key=>[key,text(paper[key])]));
 if(kind==='journal'){if(!fields.journal)warn('缺少刊名。');if(!fields.volume)warn('未提供卷号。');if(!fields.issue)warn('未提供期号，请按原刊物核对是否需要。');if(!fields.pages)warn('未提供页码或文章号。');}
 if(['book','thesis','standard','yearbook'].includes(kind)&&!fields.publisher)warn('未提供出版机构或学位授予机构。');
 if(['conference','chapter'].includes(kind)&&!fields.journal&&!fields.publicationSource)warn(kind==='chapter'?'未提供所属图书名称。':'未提供会议或论文集名称。');
 if(kind==='report'&&!fields.publisher)warn('未提供报告发布机构。');
 if(kind==='generic')warn('文献类型未确定，仅按现有题录整理。');
 if(['thesis','patent','standard','conference','yearbook','newspaper','report','chapter'].includes(kind))warn('该文献类型的学位层次、编号、完整日期或会议细节可能不全，请按目标格式核对；未补造缺项。');
 if(url&&!accessedAt)warn('未提供访问日期，未自动填入今天。');
 const keywords=(Array.isArray(paper.keywords)?paper.keywords:typeof paper.keywords==='string'?paper.keywords.split(/[;；]/u):[]).map(text).filter(Boolean);
 return{kind,title:title||'[标题未提供]',authors,year,doi,url,accessedAt,keywords,...fields};
}
function initials(given,{dots=true,spaces=true}={}){return given.split(/\s+/u).filter(Boolean).map(part=>part.split('-').filter(Boolean).map(value=>{const initial=value.match(/\p{L}/u)?.[0]||value[0];return initial.toLocaleUpperCase()+(dots?'.':'');}).join('-')).join(spaces?' ':'');}
function authorName(row,style,{first=true}={}){
 if(row.literal)return row.literal;
 const {family,given}=row;if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(family+given))return family+given;
 if(style==='apa')return join([family,initials(given)]);
 if(style==='mla')return first?join([family,given]):join([given,family],' ');
 if(style==='gbt')return join([family.toLocaleUpperCase(),initials(given,{dots:false})],' ');
 if(style==='vancouver')return join([family,initials(given,{dots:false,spaces:false})],' ');
 if(style==='bibtex'||style==='ris')return join([family,given]);
 return join([initials(given),family],' ');
}
function authorList(p,style){
 const names=p.authors.map((row,index)=>authorName(row,style,{first:index===0}));if(!names.length)return '';
 if(style==='gbt')return names.slice(0,3).join(', ')+(names.length>3?(/[\p{Script=Han}]/u.test(names.join(''))?', 等':', et al.'):'');
 if(style==='mla')return names.length>2?names[0]+', et al.':names.join(', and ');
 if(style==='vancouver')return names.slice(0,6).join(', ')+(names.length>6?', et al.':'');
 if(style==='apa'){if(names.length>20)return names.slice(0,19).join(', ')+', … '+names.at(-1);return names.length<2?names[0]:names.slice(0,-1).join(', ')+', & '+names.at(-1);}
 if(names.length>6)return names[0]+' et al.';
 return names.length<2?names[0]:names.slice(0,-1).join(', ')+' and '+names.at(-1);
}
const locator=p=>p.volume+(p.issue?'('+p.issue+')':'')+(p.pages?':'+p.pages:'');
const directLink=p=>p.doi?doiURL(p.doi):p.url;
function gbt(p,index){
 const codes={journal:'J',book:'M',thesis:'D',conference:'C',patent:'P',standard:'S',yearbook:'M',newspaper:'N',preprint:'Z',report:'R',chapter:'M',generic:'Z'},author=authorList(p,'gbt'),title=p.title+'['+codes[p.kind]+']';
 const part=['conference','chapter'].includes(p.kind),publication=p.kind==='journal'?join([p.journal,p.year,locator(p)],', ').replace(/, :(?!\S*:)/,': '):join([part?join([p.journal||p.publicationSource,p.publisher],'. '):p.publisher||p.journal||p.publicationSource,p.year],', ')+(p.pages?': '+p.pages:'');
 const dated=publication+(p.accessedAt?'['+p.accessedAt+']':'');
 return'['+(index+1)+'] '+sentences([author,part?title+(dated?'// '+dated:''):title,...(part?[]:[dated]),p.doi?'DOI: '+p.doi:p.url]);
}
function apa(p){
 const author=authorList(p,'apa'),prefix=author?sentence(author)+' ('+(p.year||'n.d.')+'). '+sentence(p.title):sentence(p.title)+' ('+(p.year||'n.d.')+').';
 const journal=join([p.journal,join([p.volume+(p.issue?'('+p.issue+')':''),p.pages])]);
 const types={thesis:'[Thesis]',preprint:'[Preprint]',conference:'[Conference paper]',patent:'[Patent]',standard:'[Standard]',report:'[Report]',chapter:'[Book chapter]'};
 const part=['chapter','conference'].includes(p.kind),container=part?join([p.journal||p.publicationSource,p.pages?'pp. '+p.pages:'']):'';
 const publication=part?sentences([container?'In '+container:'',p.publisher]):p.kind==='journal'?journal:join([types[p.kind],p.publisher||p.journal||p.publicationSource],' ');
 return join([prefix,sentence(publication),directLink(p)],' ');
}
function mla(p){
 const book=['book','yearbook','thesis','standard','report'].includes(p.kind),title=book?p.title:'“'+p.title.replace(/[.]$/,'')+'.”',parts=[p.journal||p.publicationSource,p.volume?'vol. '+p.volume:'',p.issue?'no. '+p.issue:'',p.kind==='journal'?'':p.publisher,p.year,p.pages?(/[-–—]/u.test(p.pages)?'pp. ':'p. ')+p.pages:'',directLink(p)];
 const cited=p.accessedAt?'Accessed '+dateWords(p.accessedAt,'mla'):'';
 return sentences([authorList(p,'mla'),title,join(parts),cited]);
}
function dateWords(value,style){const[year,month,day]=value.split('-'),months=['Jan.','Feb.','Mar.','Apr.','May','June','July','Aug.','Sept.','Oct.','Nov.','Dec.'],name=months[Number(month)-1];return style==='mla'?Number(day)+' '+name+' '+year:name+' '+Number(day)+', '+year;}
function ieee(p,index){
 const author=authorList(p,'ieee'),book=['book','yearbook','thesis','standard','report'].includes(p.kind),parts=[author,book?p.title:'“'+p.title.replace(/[.,]$/,'')+'”',p.journal||p.publicationSource,p.kind==='journal'?'':p.publisher,p.volume?'vol. '+p.volume:'',p.issue?'no. '+p.issue:'',p.pages?(/[-–—]/u.test(p.pages)?'pp. ':'p. ')+p.pages:'',p.year,p.kind==='preprint'?'preprint':'',p.doi?'doi: '+p.doi:''];
 const content=join(parts).replace(/”, /g,',” ');return'['+(index+1)+'] '+sentence(content)+(p.url&&!p.doi?' '+(p.accessedAt?'Accessed: '+dateWords(p.accessedAt,'ieee')+'. ':'')+'[Online]. Available: '+p.url:'');
}
function vancouver(p,index){
 const source=p.kind==='journal'?sentence(p.journal):sentence(p.publisher||p.journal||p.publicationSource),publication=p.kind==='journal'?p.year+(locator(p)?(p.year?';':'')+locator(p):''):p.year+(p.pages?':'+p.pages:'');
 return(index+1)+'. '+sentences([authorList(p,'vancouver'),p.title,p.kind==='preprint'?'[Preprint]':'',source,publication,p.doi?'doi:'+p.doi:''])+(p.url&&!p.doi?' '+(p.accessedAt?'[cited '+p.accessedAt+']. ':'')+'Available from: '+p.url:'');
}
const bibEscape=value=>value.replace(/[\\{}%&_#$^~]/g,char=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','_':'\\_','#':'\\#','$':'\\$','^':'\\textasciicircum{}','~':'\\textasciitilde{}'}[char]));
function bibtex(p,index){
 const types={journal:'article',book:'book',thesis:'misc',conference:'inproceedings',patent:'misc',standard:'misc',yearbook:'book',newspaper:'article',preprint:'unpublished',report:'techreport',chapter:'incollection',generic:'misc'},fields=[['title',bibEscape(p.title)]];
 if(p.authors.length)fields.push(['author',p.authors.map(row=>row.literal?'{'+bibEscape(row.literal)+'}':bibEscape(authorName(row,'bibtex'))).join(' and ')]);
 for(const[key,value]of [['year',p.year],['journal',p.kind==='journal'||p.kind==='newspaper'?p.journal:''],['booktitle',['conference','chapter'].includes(p.kind)?p.journal||p.publicationSource:''],['publisher',p.kind==='report'?'':p.publisher],['institution',p.kind==='report'?p.publisher:''],['volume',p.volume],['number',p.issue],['pages',p.pages.replace(/(\d)\s*[-–—]\s*(?=\d)/g,'$1--')],['doi',p.doi],['url',p.url],['urldate',p.accessedAt],['keywords',p.keywords.join('; ')],['abstract',p.abstract],['note',p.kind==='thesis'?'Thesis (degree not specified)':p.kind==='preprint'?'Preprint':'']])if(value)fields.push([key,bibEscape(value)]);
 return'@'+types[p.kind]+'{paper'+(index+1)+(p.year?'_'+p.year:'')+',\n'+fields.map(([key,value])=>'  '+key+' = {'+value+'}').join(',\n')+'\n}';
}
function ris(p,index){
 const types={journal:'JOUR',book:'BOOK',thesis:'THES',conference:'CPAPER',patent:'PAT',standard:'STAND',yearbook:'SER',newspaper:'NEWS',preprint:'UNPB',report:'RPRT',chapter:'CHAP',generic:'GEN'},fields=[['TY',types[p.kind]],['ID',String(index+1)],['TI',p.title],...p.authors.map(row=>['AU',authorName(row,'ris')]),['PY',p.year],['JO',p.journal],['T2',p.publicationSource],['PB',p.publisher],['VL',p.volume],['IS',p.issue]];
 const pages=p.pages.match(/^(.+?)\s*[-–—]\s*(.+)$/u);if(p.pages)fields.push(['SP',pages?pages[1]:p.pages]);if(pages)fields.push(['EP',pages[2]]);
 fields.push(['DO',p.doi],['UR',p.url],['Y2',p.accessedAt?p.accessedAt.replaceAll('-','/')+'/':''],...p.keywords.map(value=>['KW',value]),['AB',p.abstract]);
 return fields.filter(([,value])=>value).map(([key,value])=>key+'  - '+value).join('\n')+'\nER  -';
}
const formatters={gbt,apa,mla,ieee,vancouver,bibtex,ris};
export function formatLiteratureCitations(papers,style='gbt'){
 if(!styleKeys.has(style))throw Error('不支持的引用格式。');if(!Array.isArray(papers))throw Error('请选择文献列表。');
 const warnings=[],normalized=papers.map((paper,index)=>normalizePaper(paper,index,warnings)),extension=style==='bibtex'?'bib':style==='ris'?'ris':'txt',mime=style==='bibtex'?'application/x-bibtex;charset=utf-8':style==='ris'?'application/x-research-info-systems;charset=utf-8':'text/plain;charset=utf-8';
 if(!normalized.length)warnings.push('尚未选择文献。');
 return{text:normalized.map(formatters[style]).join('\n\n'),warnings,extension,mime};
}

export function openLiteratureCitations({papers,modal,notify=()=>{}}={}){
 if(typeof modal!=='function')throw Error('引用预览区域不可用。');if(!Array.isArray(papers)||!papers.length){notify('请先选择需要引用的文献。');return null;}
 // Freeze only metadata: never copy a paper's full text, notes, files or AI result.
 const frozen=papers.map(paper=>Object.fromEntries(metadataFields.filter(key=>paper?.[key]!==undefined).map(key=>[key,structuredClone(paper[key])])));
 let style='gbt',result=formatLiteratureCitations(frozen,style),live=true,busy=false;
 modal('引用与导出',`<section class="rdc-dialog" data-literature-citations><p class="hub-description">已选 ${frozen.length} 篇。根据现有题录在本页整理，不调用 AI、不产生 AI 费用，也不自动获取全文。</p><label for="literature-citation-style">引用格式</label><select id="literature-citation-style" data-lc-style>${literatureCitationStyles.map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select><p class="hub-footnote">文本引用按选中顺序排列，不含斜体和悬挂缩进。作者未拆分时保留原文；投稿或提交前请核对目标要求和缺失题录。</p><ul data-lc-warnings></ul><label for="literature-citation-preview">引用预览</label><textarea id="literature-citation-preview" data-lc-preview readonly rows="14" style="width:100%;box-sizing:border-box"></textarea><div class="actions"><button type="button" class="btn secondary" data-lc-copy>复制引用</button><button type="button" class="btn primary" data-lc-download>下载引用文件</button></div><p data-lc-status role="status" aria-live="polite"></p></section>`);
 const host=document.querySelector('[data-literature-citations]');if(!host)return null;const $=selector=>host.querySelector(selector),current=()=>live&&host.isConnected;
 function render(){if(!current())return;$('[data-lc-preview]').value=result.text;const warnings=$('[data-lc-warnings]');warnings.hidden=!result.warnings.length;warnings.innerHTML=result.warnings.map(value=>'<li>'+esc(value)+'</li>').join('');$('[data-lc-copy]').disabled=busy||!result.text;$('[data-lc-download]').disabled=busy||!result.text;$('[data-lc-style]').disabled=busy;}
 $('[data-lc-style]').addEventListener('change',event=>{if(busy)return;style=event.target.value;result=formatLiteratureCitations(frozen,style);$('[data-lc-status]').textContent='';render();});
 $('[data-lc-copy]').addEventListener('click',async()=>{if(busy||!current())return;busy=true;render();try{if(globalThis.navigator?.clipboard?.writeText)await globalThis.navigator.clipboard.writeText(result.text);else{const preview=$('[data-lc-preview]');preview.focus();preview.select();if(!document.execCommand?.('copy'))throw Error('请选中预览文字后复制。');}if(current()){$('[data-lc-status]').textContent='引用已复制。';notify('引用已复制。');}}catch{if(current())$('[data-lc-status]').textContent='自动复制未完成，请选中预览文字后复制。';}finally{busy=false;render();}});
 $('[data-lc-download]').addEventListener('click',async()=>{if(busy||!current())return;busy=true;render();const selected=result,selectedStyle=style;try{const value=await download('references-'+selectedStyle+'.'+selected.extension,selected.text,selected.mime,{sourceType:'literature'});if(current())$('[data-lc-status]').textContent=value.message;}catch(error){if(current()){$('[data-lc-status]').textContent=error.message||'下载未完成，预览内容仍保留。';notify(error.message||'下载未完成。');}}finally{busy=false;render();}});
 render();return{dispose(){live=false;},getValue:()=>({...result,warnings:[...result.warnings]})};
}
