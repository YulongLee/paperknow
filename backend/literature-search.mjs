import {createHmac} from 'node:crypto';
import {createArxivClient} from './arxiv-client.mjs';
import {createPubMedClient} from './pubmed-client.mjs';
import {createSemanticScholarClient} from './semantic-scholar-client.mjs';

// Public bibliographic metadata only. Provider credentials stay in server-owned headers.
const providers = Object.freeze({
  crossref: {id:'crossref',label:'Crossref',endpoint:'https://api.crossref.org/works'},
  europepmc: {id:'europepmc',label:'Europe PMC',endpoint:'https://www.ebi.ac.uk/europepmc/webservices/rest/search'},
  aminer: {id:'aminer',label:'AMiner',endpoint:'https://datacenter.aminer.cn/gateway/open_platform/api/paper/search'},
  openalex: {id:'openalex',label:'OpenAlex',endpoint:'https://api.openalex.org/works'},
  arxiv: {id:'arxiv',label:'arXiv',endpoint:'https://export.arxiv.org/api/query'},
  pubmed: {id:'pubmed',label:'PubMed'},
  semantic_scholar: {id:'semantic_scholar',label:'Semantic Scholar'},
  cnki: {id:'cnki',label:'知网'},
});
// Crossref's official type IDs may be OR-ed by repeating the type filter.
const crossrefTypes=Object.freeze({journal:['journal-article','journal','journal-issue','journal-volume'],thesis:['dissertation'],book:['book','edited-book','monograph','reference-book','book-set','book-series'],report:['report','report-series','report-component'],chapter:['book-chapter','book-section','book-part','book-track','reference-entry'],preprint:['posted-content'],conference:['proceedings-article','proceedings','proceedings-series'],other:['other','dataset','database','standard','component','peer-review','grant']});
const namedEntities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',times:'×',plusmn:'±',alpha:'α',beta:'β',gamma:'γ',Delta:'Δ',pi:'π',mu:'μ',le:'≤',ge:'≥',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“'};
class SearchError extends Error {
  constructor(status,message,response,retryAfter,sourceStatus){super(message);this.status=status;this.response=response;this.retryAfter=retryAfter;this.sourceStatus=sourceStatus;}
}
const invalid=message=>{throw new SearchError(400,message);};
function plain(value,max=1000){
  if(typeof value!=='string')return '';
  // Providers return JSON strings that can contain JATS/HTML. Never parse external entities.
  let text=value.slice(0,150000).replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi,(whole,entity)=>{
    if(entity[0]!=='#')return namedEntities[entity]??whole;
    const code=entity[1]?.toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return Number.isInteger(code)&&code>31&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):' ';
  });
  text=text.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ');
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function safeLink(value){
  if(typeof value!=='string'||value.length>2000)return '';
  try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(u.hostname))return '';return u.href;}catch{return '';}
}
function doiValue(value){if(typeof value!=='string'||value.length>320)return '';const doi=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>\u0000-\u001f\u007f-\u009f]+$/u.test(doi)?doi:'';}
const doiLink=doi=>'https://doi.org/'+doi.split('/').map(encodeURIComponent).join('/');
function yearValue(value){const year=Number(value);return Number.isInteger(year)&&year>=1000&&year<=2100?year:null;}
function countValue(value){if(typeof value==='string'&&/^\d{1,15}$/.test(value))value=Number(value);return Number.isSafeInteger(value)&&value>=0?value:undefined;}
const stringList=(value,max=50)=>Array.isArray(value)?[...new Set(value.slice(0,max).map(v=>plain(v,150)).filter(Boolean))]:[];
function documentType(types){
 const values=(Array.isArray(types)?types:[types]).map(v=>plain(v,80).toLowerCase()).filter(Boolean);if(!values.length)return '';
 const groups={preprint:['preprint','posted-content'],thesis:['dissertation','thesis'],chapter:['book-chapter','book chapter','book-section','book-part','book-track','reference-entry'],conference:['proceedings-article','proceedings','proceedings-series','conference-paper','conference-abstract','conference paper','conference proceedings'],report:['report','report-series','report-component','technical report'],book:['book','edited-book','monograph','reference-book','book-set','book-series'],journal:['journal-article','journal','journal-issue','journal-volume','journal article','research article','article','review','editorial','letter','erratum','retraction','book-review','data-paper','software-paper']};
 for(const [type,names]of Object.entries(groups))if(values.some(v=>names.includes(v)))return type;return 'other';
}
function bibliographic(fields){const result={};for(const [key,value]of Object.entries(fields)){const cleaned=plain(value,500);if(cleaned)result[key]=cleaned;}return result;}
function crossrefItem(item){
  const doi=doiValue(item?.DOI),title=plain(item?.title?.[0]);if(!doi||!title)return null;
  const authorNames=Array.isArray(item.author)?item.author.slice(0,30).map(author=>plain(author?.name||[author?.given,author?.family].filter(value=>typeof value==='string').join(' '),150)).filter(Boolean):[],authors=authorNames.join(', ');
  const year=yearValue(item.published?.['date-parts']?.[0]?.[0]??item.issued?.['date-parts']?.[0]?.[0]??item['published-print']?.['date-parts']?.[0]?.[0]??item['published-online']?.['date-parts']?.[0]?.[0]);
  const abstract=plain(item.abstract,3000),type=plain(item.type,80),normalizedType=documentType(type),citationCount=countValue(item['is-referenced-by-count']),keywords=stringList(item.subject);
  // Crossref licences and deposited file links do not establish open-access status.
  return {id:'crossref:'+doi,title,authors,year,doi,url:doiLink(doi),source:'crossref',sourceId:doi,authorNames,...(abstract?{abstract}:{}),...(type?{type,documentType:normalizedType}:{}),...(citationCount!==undefined?{citationCount}:{}),...(keywords.length?{keywords}:{}),...bibliographic({journal:normalizedType==='journal'?item['container-title']?.[0]:'',publisher:item.publisher,volume:item.volume,issue:item.issue,pages:item.page})};
}
function europeItem(item){
  const source=plain(item?.source,20),sourceId=plain(item?.id,100),title=plain(item?.title);
  if(!/^[A-Z][A-Z0-9_-]{0,19}$/.test(source)||!sourceId||!title)return null;
  const doi=doiValue(item.doi),year=yearValue(item.pubYear),abstract=plain(item.abstractText,3000),types=stringList(item.pubTypeList?.pubType),type=types[0]||'',normalizedType=documentType(types),citationCount=countValue(item.citedByCount),keywords=stringList(item.keywordList?.keyword),authorNames=Array.isArray(item.authorList?.author)?item.authorList.author.slice(0,30).map(a=>plain(a?.fullName||[a?.firstName,a?.lastName].filter(v=>typeof v==='string').join(' '),150)).filter(Boolean):stringList(plain(item.authorString,3000).split(/,\s*/));
  const openAccess=item.isOpenAccess==='Y'?true:item.isOpenAccess==='N'?false:undefined;
  const fullTextUrl=openAccess&&/^PMC\d+$/.test(item.pmcid||'')?'https://europepmc.org/articles/'+item.pmcid:'';
  const url=safeLink('https://europepmc.org/article/'+encodeURIComponent(source)+'/'+encodeURIComponent(sourceId));
  return {id:'europepmc:'+source+':'+sourceId,title,authors:plain(item.authorString,3000),year,doi,url,source:'europepmc',sourceId:source+':'+sourceId,authorNames,...(abstract?{abstract}:{}),...(openAccess!==undefined?{openAccess}:{}),...(fullTextUrl?{fullTextUrl}:{}),...(type?{type,documentType:normalizedType}:{}),...(citationCount!==undefined?{citationCount}:{}),...(keywords.length?{keywords}:{}),...bibliographic({journal:item.journalInfo?.journal?.title||item.journalTitle,publisher:item.bookOrReportDetails?.publisher,volume:item.journalInfo?.volume||item.journalVolume,issue:item.journalInfo?.issue||item.issue,pages:item.pageInfo})};
}
function openAlexAbstract(index){
  if(!index||typeof index!=='object'||Array.isArray(index))return '';
  // Never allocate a sparse array from untrusted positions. Work and output are bounded
  // independently of the response-byte limit, including repeated/malformed positions.
  const words=new Map();let positions=0;
  for(const word of Object.keys(index).slice(0,4096)){
    const offsets=index[word];if(typeof word!=='string'||word.length>256||!Array.isArray(offsets))continue;
    for(const offset of offsets.slice(0,4096)){
      if(++positions>8192)break;
      if(Number.isInteger(offset)&&offset>=0&&offset<4096&&!words.has(offset))words.set(offset,word);
    }
    if(positions>8192)break;
  }
  return plain([...words.entries()].sort((a,b)=>a[0]-b[0]).map(([,word])=>word).join(' '),3000);
}
function openAlexItem(item){
  const sourceId=typeof item?.id==='string'&&item.id.length<100?item.id.match(/^https:\/\/openalex\.org\/(W\d{1,30})$/)?.[1]:'';
  const title=plain(item?.title||item?.display_name);if(!sourceId||!title)return null;
  const doi=doiValue(item.doi),year=yearValue(item.publication_year),abstract=openAlexAbstract(item.abstract_inverted_index),type=plain(item.type,80);
  const authorNames=Array.isArray(item.authorships)?item.authorships.slice(0,30).map(value=>plain(value?.author?.display_name,150)).filter(Boolean):[],authors=authorNames.join(', '),citationCount=countValue(item.cited_by_count),keywords=stringList(Array.isArray(item.keywords)?item.keywords.map(k=>k?.display_name):[]),normalizedType=documentType(type),venue=item.primary_location?.source;
  const openAccess=typeof item.open_access?.is_oa==='boolean'?item.open_access.is_oa:undefined;
  const location=item.best_oa_location;
  // OpenAlex's paid content_urls require our key and must never become public links.
  // Surface only provider-declared open locations, not arbitrary deposited PDF links.
  const publicOALink=value=>{const link=safeLink(value);return link&&new URL(link).hostname!=='content.openalex.org'?link:'';};
  const fullTextUrl=openAccess===true?(location?.is_oa===true?(publicOALink(location.pdf_url)||publicOALink(location.landing_page_url)):'')||publicOALink(item.open_access.oa_url):'';
  return {id:'openalex:'+sourceId,title,authors,year,doi,url:doi?doiLink(doi):'https://openalex.org/'+sourceId,source:'openalex',sourceId,authorNames,...(abstract?{abstract}:{}),...(openAccess!==undefined?{openAccess}:{}),...(fullTextUrl?{fullTextUrl}:{}),...(type?{type,documentType:normalizedType}:{}),...(citationCount!==undefined?{citationCount}:{}),...(keywords.length?{keywords}:{}),...bibliographic({journal:venue?.type==='journal'?venue.display_name:'',publisher:/^https:\/\/openalex\.org\/P\d+$/.test(venue?.host_organization||'')?venue.host_organization_name:'',volume:item.biblio?.volume,issue:item.biblio?.issue,pages:[plain(item.biblio?.first_page,100),plain(item.biblio?.last_page,100)].filter(Boolean).join('-')})};
}
function aminerItem(item){
  const sourceId=typeof item?.id==='string'&&/^[a-f\d]{24}$/i.test(item.id)?item.id.toLowerCase():'';
  const title=plain(item?.title)||plain(item?.title_zh);if(!sourceId||!title)return null;
  // The free route supplies a citation bucket, never an exact cited-by count or access proof.
  const firstAuthor=plain(item.first_author,150),citationBucket=typeof item.n_citation_bucket==='string'&&/^(?:0|1-10|11-50|51-200|200-1000|201-1000|1000-5000|1001-5000|5000\+)$/.test(item.n_citation_bucket)?item.n_citation_bucket:'';
  return {id:'aminer:'+sourceId,title,authors:firstAuthor,authorNames:firstAuthor?[firstAuthor]:[],year:yearValue(item.year),doi:doiValue(item.doi),url:'https://www.aminer.cn/pub/'+sourceId,source:'aminer',sourceId,...(citationBucket?{citationBucket}:{}),...bibliographic({venue:item.venue_name})};
}
function signAminerToken(apiKey,userId,time){
  const timestamp=Math.floor(time/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const content=encode({alg:'HS256',sign_type:'SIGN'})+'.'+encode({user_id:userId,exp:timestamp+300,timestamp});
  return content+'.'+createHmac('sha256',apiKey).update(content).digest('base64url');
}
function aminerTokenExpiry(token){
  if(typeof token!=='string'||token.length>10000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))return null;
  try{
    const [headerPart,payloadPart,signaturePart]=token.split('.');
    const decode=part=>{const bytes=Buffer.from(part,'base64url');if(bytes.toString('base64url')!==part)throw Error();return JSON.parse(bytes.toString('utf8'));};
    const header=decode(headerPart),payload=decode(payloadPart),signature=Buffer.from(signaturePart,'base64url');
    const validUser=typeof payload?.user_id==='string'?Boolean(payload.user_id.trim())&&payload.user_id.length<=100:Number.isSafeInteger(payload?.user_id)&&payload.user_id>0;
    if(!header||Array.isArray(header)||header.alg!=='HS256'||!payload||Array.isArray(payload)||!validUser||!Number.isSafeInteger(payload.exp)||payload.exp<=0||signature.length!==32||signature.toString('base64url')!==signaturePart)return null;
    // Administrator-supplied tokens are private trusted configuration. No signature claim is
    // made here: without the issuer's secret, only structure and expiry can be checked.
    return payload.exp*1000;
  }catch{return null;}
}
export function parseLiteratureQuery(input){
  const p=input instanceof URLSearchParams?input:new URLSearchParams(input);
  const allowed=new Set(['q','source','yearFrom','yearTo','openAccess','limit','sort','dateFrom','dateTo','type','hasDoi','hasCitations','page']);
  for(const key of p.keys())if(!allowed.has(key)||p.getAll(key).length!==1)invalid('检索参数不正确');
  const raw=p.get('q')??'',q=raw.trim().replace(/\s+/g,' ');
  if(raw.length>300||q.length<2||q.length>200||/[\u0000-\u001f\u007f-\u009f]/.test(raw)||!/[\p{L}\p{N}]/u.test(q))invalid('请输入 2～200 字符的公开标题或关键词');
  const rawSource=p.get('source')||'all',selected=rawSource.split(',').map(v=>v.trim());if(rawSource.length>250||/[\u0000-\u001f\u007f-\u009f]/.test(rawSource)||new Set(selected).size>Object.keys(providers).length||selected.some(v=>!v||v!=='all'&&!Object.hasOwn(providers,v))||selected.includes('all')&&selected.length!==1)invalid('请选择已接入的文献来源，全部来源不能与单个来源混选');const source=[...new Set(selected)].join(',');
  const parseYear=key=>{const value=p.get(key);if(value===null||value==='')return null;if(!/^\d{4}$/.test(value)||!yearValue(value))invalid('年份应为 1000～2100 之间的四位数字');return Number(value);};
  const yearFrom=parseYear('yearFrom'),yearTo=parseYear('yearTo');if(yearFrom&&yearTo&&yearFrom>yearTo)invalid('起始年份不能晚于结束年份');
  const oa=p.get('openAccess');if(oa!==null&&oa!==''&&!['true','false'].includes(oa))invalid('开放获取筛选参数不正确');
  const rawLimit=p.get('limit'),limit=rawLimit===null||rawLimit===''?10:Number(rawLimit);if(!Number.isInteger(limit)||limit<1||limit>20||rawLimit&&!/^\d+$/.test(rawLimit))invalid('每次检索数量应为 1～20 条');
  const sort=p.get('sort');if(sort!==null&&!['relevance','year','citations','submittedDate','lastUpdatedDate'].includes(sort))invalid('请选择有效的文献排序方式');if(['submittedDate','lastUpdatedDate'].includes(sort)&&source!=='arxiv')invalid('最新提交及更新时间排序仅适用于 arXiv 来源');
  const date=key=>{const value=p.get(key);if(value===null||value==='')return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1000||Number(value.slice(0,4))>2100)invalid('日期应为 1000～2100 年的有效日期');const stamp=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)invalid('请输入有效的日期');return value;};
  const dateFrom=date('dateFrom'),dateTo=date('dateTo');if((dateFrom||dateTo)&&source!=='arxiv')invalid('提交日期筛选仅适用于 arXiv 来源');
  const effectiveFrom=[yearFrom?yearFrom+'-01-01':'',dateFrom].filter(Boolean).sort().at(-1),effectiveTo=[yearTo?yearTo+'-12-31':'',dateTo].filter(Boolean).sort()[0];if(effectiveFrom&&effectiveTo&&effectiveFrom>effectiveTo)invalid('起始日期不能晚于结束日期');
  const type=p.get('type');if(type!==null&&!['all','journal','thesis','book','report','chapter','preprint','conference','other'].includes(type))invalid('请选择有效的文献类型');
  const bool=key=>{const value=p.get(key);if(value!==null&&!['true','false'].includes(value))invalid('文献筛选参数不正确');return value===null?undefined:value==='true';},hasDoi=bool('hasDoi'),hasCitations=bool('hasCitations');
  const rawPage=p.get('page'),page=rawPage===null?undefined:Number(rawPage);if(rawPage!==null&&(!/^[1-5]$/.test(rawPage)||!Number.isInteger(page)))invalid('检索页码应为 1～5 页');
  return {q,source,yearFrom,yearTo,openAccess:oa==='true',limit,...(sort!==null?{sort}:{}),...(dateFrom?{dateFrom}:{}),...(dateTo?{dateTo}:{}),...(type!==null?{type}:{}),...(hasDoi!==undefined?{hasDoi}:{}),...(hasCitations!==undefined?{hasCitations}:{}),...(page!==undefined?{page}:{})};
}
function providerURL(id,query){
  const u=new URL(providers[id].endpoint);
  if(id==='crossref'){
    u.searchParams.set('query.bibliographic',query.q);u.searchParams.set('rows',String(query.limit));u.searchParams.set('offset',String(((query.page||1)-1)*query.limit));if(query.sort==='year'||query.sort==='citations'){u.searchParams.set('sort',query.sort==='year'?'published':'is-referenced-by-count');u.searchParams.set('order','desc');}
    const filters=[];if(query.yearFrom)filters.push('from-pub-date:'+query.yearFrom+'-01-01');if(query.yearTo)filters.push('until-pub-date:'+query.yearTo+'-12-31');for(const type of crossrefTypes[query.type]||[])filters.push('type:'+type);if(filters.length)u.searchParams.set('filter',filters.join(','));
  }else if(id==='europepmc'){
    // Treat all user tokens literally so advanced-query syntax cannot negate our filters.
    const terms=query.q.split(/\s+/).map(part=>part.replace(/["\\]/g,'')).filter(Boolean).map(part=>'"'+part+'"');
    let expression=terms.join(' AND ');if(query.yearFrom||query.yearTo)expression+=' AND FIRST_PDATE:['+(query.yearFrom||1000)+'-01-01 TO '+(query.yearTo||2100)+'-12-31]';if(query.openAccess)expression+=' AND OPEN_ACCESS:Y';
    u.searchParams.set('format','json');if(query.hasDoi!==undefined)expression+=' AND HAS_DOI:'+(query.hasDoi?'Y':'N');if(query.hasCitations!==undefined)expression+=' AND CITED:'+(query.hasCitations?'[1 TO *]':'0');if(query.sort==='year')expression+=' sort_date:y';if(query.sort==='citations')expression+=' sort_cited:y';u.searchParams.set('query',expression);u.searchParams.set('pageSize',String(Math.min(100,(query.page||1)*query.limit)));u.searchParams.set('resultType','core');
  }else if(id==='openalex'){
    // Search text is confined to one value; callers cannot add fields, filters or keys.
    u.searchParams.set('search',query.q);u.searchParams.set('per_page',String(query.limit));u.searchParams.set('page',String(query.page||1));if(query.sort==='year'||query.sort==='citations')u.searchParams.set('sort',(query.sort==='year'?'publication_year':'cited_by_count')+':desc');
    u.searchParams.set('select','id,doi,title,authorships,publication_year,abstract_inverted_index,open_access,best_oa_location,primary_location,biblio,type,cited_by_count,keywords');
    const filters=[];if(query.yearFrom)filters.push('from_publication_date:'+query.yearFrom+'-01-01');if(query.yearTo)filters.push('to_publication_date:'+query.yearTo+'-12-31');if(query.openAccess)filters.push('open_access.is_oa:true');if(query.hasDoi!==undefined)filters.push('has_doi:'+query.hasDoi);if(query.hasCitations!==undefined)filters.push('cited_by_count:'+(query.hasCitations?'>0':'0'));const types={journal:'article|review|editorial|letter|erratum|retraction|book-review|data-paper|software-paper',thesis:'dissertation',book:'book',report:'report',chapter:'book-chapter|reference-entry',preprint:'preprint',conference:'conference-paper|conference-abstract',other:'other|dataset|paratext|peer-review|libguides|software|standard|supplementary-materials'};if(types[query.type])filters.push('type:'+types[query.type]);if(filters.length)u.searchParams.set('filter',filters.join(','));
  }else if(id==='aminer'){
    // Only the confirmed free title-search endpoint is used, with bounded 1-based pages.
    u.searchParams.set('page',String(query.page||1));u.searchParams.set('size',String(query.limit));u.searchParams.set('title',query.q);
  }
  return u;
}
function windowFiltered(id,query){
 return Boolean(id==='pubmed'&&(query.yearFrom||query.yearTo||query.hasDoi!==undefined||query.type&&query.type!=='all')||id==='crossref'&&query.hasCitations!==undefined||id==='europepmc'&&query.type&&query.type!=='all'||id==='arxiv'&&query.hasDoi!==undefined||id==='aminer'&&(query.yearFrom||query.yearTo||query.hasDoi!==undefined||query.hasCitations!==undefined));
}
function matchesQuery(item,query){
 if(query.yearFrom&&(item.year===null||item.year<query.yearFrom)||query.yearTo&&(item.year===null||item.year>query.yearTo)||query.openAccess&&item.openAccess!==true)return false;
 if(query.type&&query.type!=='all'&&item.documentType!==query.type)return false;
 if(query.hasDoi!==undefined&&Boolean(item.doi)!==query.hasDoi)return false;
 if(query.hasCitations!==undefined){const states=(item.sourceProvenance||[item]).map(source=>{const known=countValue(source.citationCount);return known!==undefined?known>0:source.citationBucket==='0'?false:typeof source.citationBucket==='string'?true:undefined;}),present=states.some(value=>value===true)?true:states.some(value=>value===false)?false:undefined;if(present!==query.hasCitations)return false;}return true;
}
function provenance(item){
 const out={};for(const key of ['source','sourceId','id','url','doi','year','openAccess','fullTextUrl','pdfUrl','citationCount','citationBucket','pmid','documentType','journal','publisher','volume','issue','pages','venue'])if(item[key]!==undefined&&item[key]!==null&&item[key]!=='')out[key]=item[key];return out;
}
function mergeMetadata(target,item){
 target.sourceProvenance.push(provenance(item));
 for(const key of ['abstract','authors','citationBucket','arxivId','pmid','pdfUrl','fullTextUrl','documentType','type','journal','publisher','volume','issue','pages','venue'])if(!target[key]&&item[key])target[key]=item[key];
 if(target.year===null&&item.year!==null)target.year=item.year;
 if(item.openAccess===true)target.openAccess=true;else if(target.openAccess===undefined&&item.openAccess===false)target.openAccess=false;
 // Counts from different indexes overlap. Preserve every source's count and expose
 // the largest reported value with its source, never add them as disjoint citations.
 if(item.citationCount!==undefined&&(target.citationCount===undefined||item.citationCount>target.citationCount)){target.citationCount=item.citationCount;target.citationCountSource=item.source;}
 for(const key of ['authorNames','keywords']){const values=[...new Set([...(target[key]||[]),...(item[key]||[])])].slice(0,key==='authorNames'?30:50);if(values.length)target[key]=values;}
 const links=[...new Set(target.sourceProvenance.map(p=>p.fullTextUrl).filter(Boolean))];if(links.length>1)target.fullTextUrls=links;
}
function boundedSet(map,key,value,maximum){if(map.has(key))map.delete(key);while(map.size>=maximum)map.delete(map.keys().next().value);map.set(key,value);}
export function createLiteratureSearch({fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=8000,maxResponseBytes=2*1024*1024,clientLimit=20,cacheTtlMs=300000,maxCacheEntries=100,maxConcurrent=4,semanticScholarEnabled=false,semanticScholarApiKey='',semanticScholarDailyLimit=100,openAlexApiKey='',openAlexDailyLimit=500,aminerEnabled=false,aminerApiKey='',aminerUserId='',aminerToken='',aminerDailyLimit=100}={}){
  const apiKey=typeof openAlexApiKey==='string'&&openAlexApiKey.length<=500&&!/[\s\u0000-\u001f\u007f]/.test(openAlexApiKey)?openAlexApiKey:'';
  const dailyLimit=Number.isInteger(openAlexDailyLimit)&&openAlexDailyLimit>=0&&openAlexDailyLimit<=10000?openAlexDailyLimit:500;
  const aminerKey=typeof aminerApiKey==='string'&&aminerApiKey.length<=500&&!/[\s\u0000-\u001f\u007f]/.test(aminerApiKey)?aminerApiKey:'';
  const aminerId=typeof aminerUserId==='string'&&/^[a-z\d_-]{1,100}$/i.test(aminerUserId)?aminerUserId:'';
  const aminerLimit=Number.isInteger(aminerDailyLimit)&&aminerDailyLimit>=0&&aminerDailyLimit<=10000?aminerDailyLimit:100;
  const aminerTokenProvided=aminerToken!==''&&aminerToken!==undefined&&aminerToken!==null,aminerExpires=aminerTokenProvided?aminerTokenExpiry(aminerToken):null;
  // An explicitly supplied invalid/expired token never silently falls back to another credential.
  const aminerConfigured=()=>aminerEnabled===true&&(aminerTokenProvided?aminerExpires!==null&&aminerExpires>clock():Boolean(aminerKey&&aminerId));
  const semanticKey=typeof semanticScholarApiKey==='string'&&semanticScholarApiKey.length<=500&&!/[\s\u0000-\u001f\u007f]/.test(semanticScholarApiKey)?semanticScholarApiKey:'';
  const semanticLimit=Number.isInteger(semanticScholarDailyLimit)&&semanticScholarDailyLimit>=0&&semanticScholarDailyLimit<=10000?semanticScholarDailyLimit:100;
  const semanticConfigured=()=>semanticScholarEnabled===true&&Boolean(semanticKey);
  const availableIds=({allowAminer=true,allowSemanticScholar=false}={})=>Object.keys(providers).filter(id=>id!=='cnki'&&(id!=='openalex'||Boolean(apiKey))&&(id!=='aminer'||allowAminer===true&&aminerConfigured())&&(id!=='semantic_scholar'||allowSemanticScholar===true&&semanticConfigured()));
  // Process-local request caps reset on restart and are not a persistent financial safeguard.
  let openAlexDay=-1,openAlexCount=0,aminerDay=-1,aminerCount=0,semanticDay=-1,semanticCount=0;
  const cache=new Map(),inflight=new Map(),clients=new Map(),providerState=new Map(Object.keys(providers).map(id=>[id,{active:0,minuteAt:0,minuteCount:0,secondAt:0,secondCount:0,cooldownUntil:0}]));let active=0;
  const arxiv=createArxivClient({fetchImpl,clock,timeoutMs,maxResponseBytes});
  const pubmed=createPubMedClient({fetchImpl,clock,timeoutMs,maxResponseBytes});
  const semantic=createSemanticScholarClient({fetchImpl,clock,timeoutMs,maxResponseBytes,apiKey:semanticKey,beforeRequest:()=>{
    const day=Math.floor(clock()/86400000);if(semanticDay!==day){semanticDay=day;semanticCount=0;}
    if(semanticCount>=semanticLimit)throw new SearchError(503,'Semantic Scholar 今日检索额度已用完，请明日再试',undefined,undefined,'budget_exhausted');
    semanticCount++;
  }});
  function clientRate(clientKey){
    const time=clock(),key=String(clientKey||'unknown').slice(0,100);let bucket=clients.get(key);
    if(!bucket||bucket.until<=time)bucket={until:time+60000,count:0};bucket.count++;boundedSet(clients,key,bucket,10000);
    if(bucket.count>clientLimit)throw new SearchError(429,'文献检索较频繁，请稍后再试',undefined,Math.max(1,Math.ceil((bucket.until-time)/1000)));
  }
  async function retrieve(id,query){
    // arXiv has its own process-wide serialized transport and bounded queue, independent
    // of the four existing providers' slots. Their credentials never enter its request.
    if(id==='arxiv'){const value=await arxiv.search(query);return{...value,...(windowFiltered(id,query)?{total:undefined,filterScope:'window'}:{}),pagination:{mode:'offset',page:query.page||1,limit:query.limit}};}
    if(id==='pubmed'){const value=await pubmed.search(query);return{...value,...(windowFiltered(id,query)?{total:undefined,filterScope:'window'}:{})};}
    if(id==='semantic_scholar')return semantic.search(query);
    const state=providerState.get(id),time=clock();
    if(id==='openalex'){
      const day=Math.floor(time/86400000);if(openAlexDay!==day){openAlexDay=day;openAlexCount=0;}
      if(openAlexCount>=dailyLimit)throw new SearchError(503,'OpenAlex 今日检索额度已用完，请明日再试');
    }
    if(id==='aminer'){
      if(aminerTokenProvided&&(aminerExpires===null||aminerExpires<=time))throw new SearchError(503,'AMiner 授权已过期或不可用，请联系平台支持',undefined,undefined,'not_configured');
      const day=Math.floor(time/86400000);if(aminerDay!==day){aminerDay=day;aminerCount=0;}
      if(aminerCount>=aminerLimit)throw new SearchError(503,'AMiner 今日检索额度已用完，请明日再试',undefined,undefined,'budget_exhausted');
    }
    if(state.minuteAt+60000<=time){state.minuteAt=time;state.minuteCount=0;}if(state.secondAt+1000<=time){state.secondAt=time;state.secondCount=0;}
    if(state.cooldownUntil>time||state.minuteCount>=60||state.secondCount>=3||state.active>=1||active>=maxConcurrent)throw new SearchError(503,'来源请求繁忙，请稍后重试');
    state.active++;active++;state.minuteCount++;state.secondCount++;
    if(id==='openalex')openAlexCount++;
    if(id==='aminer')aminerCount++;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      // URL and all outbound headers are server-owned, never supplied by the client.
      const response=await fetchImpl(providerURL(id,query),{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'PaperKnow/1.0 (https://paperknow.cn; mailto:contact@oneshowailab.com)',...(id==='openalex'?{Authorization:'Bearer '+apiKey}:id==='aminer'?{Authorization:aminerTokenProvided?aminerToken:signAminerToken(aminerKey,aminerId,time)}:{})}});
      const rejectResponse=async message=>{try{await response.body?.cancel();}catch{}throw new SearchError(503,message);};
      if(id==='openalex'&&response.headers.get('x-ratelimit-remaining')!==null&&Number(response.headers.get('x-ratelimit-remaining'))<=0){
        const reset=Number(response.headers.get('x-ratelimit-reset'));
        state.cooldownUntil=clock()+((Number.isFinite(reset)&&reset>0)?Math.min(86400,Math.ceil(reset))*1000:86400000-(clock()%86400000));
      }
      if(id==='openalex'&&[401,403].includes(response.status)){state.cooldownUntil=Math.max(state.cooldownUntil,clock()+300000);await rejectResponse('OpenAlex 授权暂时不可用，请联系平台支持');}
      if(id==='aminer'&&[401,403].includes(response.status)){state.cooldownUntil=Math.max(state.cooldownUntil,clock()+300000);await rejectResponse('AMiner 授权暂时不可用，请联系平台支持');}
      if(response.status===429){const wait=Number(response.headers.get('retry-after'));state.cooldownUntil=Math.max(state.cooldownUntil,clock()+Math.min(300,Number.isFinite(wait)&&wait>0?wait:60)*1000);await rejectResponse('该文献来源限流，请稍后重试');}
      if(!response.ok)await rejectResponse('该文献来源暂时不可用');
      if(!/\bjson\b/i.test(response.headers.get('content-type')||''))await rejectResponse('该文献来源响应格式异常');
      if(Number(response.headers.get('content-length'))>maxResponseBytes)await rejectResponse('该文献来源响应过大');
      const reader=response.body?.getReader();if(!reader)throw new SearchError(503,'该文献来源响应为空');const chunks=[];let bytes=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxResponseBytes){await reader.cancel();throw new SearchError(503,'该文献来源响应过大');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SearchError(503,'该文献来源响应格式异常');}
      if(id==='aminer'&&(data?.code!==200||data?.success!==true)){
        const code=data?.code,auth=[40301,40302,40307,40308].includes(code),limited=code===40306;
        state.cooldownUntil=Math.max(state.cooldownUntil,clock()+(auth?300000:60000));
        throw new SearchError(503,auth?'AMiner 授权暂时不可用，请联系平台支持':limited?'AMiner 检索较频繁，请稍后重试':'AMiner 暂时不可用，请稍后重试',undefined,undefined,limited?'rate_limited':'error');
      }
      const rows=id==='crossref'?data?.message?.items:id==='europepmc'?data?.resultList?.result:id==='aminer'?data?.data:data?.results,total=id==='crossref'?data?.message?.['total-results']:id==='europepmc'?data?.hitCount:id==='aminer'?(query.yearFrom||query.yearTo?undefined:data?.total):data?.meta?.count;
      if(!Array.isArray(rows)||rows.length>1000)throw new SearchError(503,'该文献来源响应格式异常');
      const page=query.page||1,window=id==='europepmc',start=window?(page-1)*query.limit:0,raw=rows.slice(start,start+query.limit),items=raw.map(id==='crossref'?crossrefItem:id==='europepmc'?europeItem:id==='aminer'?aminerItem:openAlexItem).filter(Boolean),local=windowFiltered(id,query),knownTotal=countValue(total);
      return {items,hasMore:page<5&&(knownTotal!==undefined?knownTotal>page*query.limit:window?rows.length>=page*query.limit:rows.length>=query.limit),pagination:{mode:window?'window':id==='crossref'?'offset':'page',page,limit:query.limit,...(window?{windowLimit:100,fetchedCount:Math.min(rows.length,page*query.limit)}:{})},...(local?{filterScope:'window'}:{}),...(!window&&!local&&knownTotal!==undefined?{total:knownTotal}:{})};
    }catch(error){if(controller.signal.aborted)throw new SearchError(503,'该文献来源响应超时，请稍后重试');if(error instanceof SearchError)throw error;throw new SearchError(503,'该文献来源暂时不可用');}
    finally{clearTimeout(timer);state.active--;active--;}
  }
  async function execute(query,{allowAminer=true,allowSemanticScholar=false}={}){
    const ids=query.source==='all'?availableIds({allowAminer,allowSemanticScholar}):query.source.split(',');
    const results=await Promise.all(ids.map(async id=>{
      if(id==='openalex'&&!apiKey)return {source:{id,label:providers[id].label,status:'not_configured',reason:'OpenAlex 暂未开放，请选择其他文献来源。'},items:[]};
      if(id==='aminer'&&(allowAminer!==true||!aminerConfigured()))return {source:{id,label:providers[id].label,status:'not_configured',reason:'AMiner 当前暂未开放，请选择其他文献来源。'},items:[]};
      if(id==='cnki')return{source:{id,label:providers[id].label,status:'not_configured',reason:'知网需配置授权检索接口后开放。'},items:[]};
      if(id==='semantic_scholar'&&(allowSemanticScholar!==true||!semanticConfigured()))return{source:{id,label:providers[id].label,status:'not_configured',reason:'Semantic Scholar 需配置接口密钥及商用许可后开放。'},items:[]};
      const unsupported=id==='pubmed'&&(query.openAccess||query.hasCitations!==undefined||query.sort==='citations')?'PubMed 不提供可核对的开放许可或被引次数，请取消相应筛选。':id==='semantic_scholar'&&query.sort&&query.sort!=='relevance'?'Semantic Scholar 当前检索不支持该排序方式。':id==='semantic_scholar'&&(query.hasDoi!==undefined||query.hasCitations===false||['thesis','report','preprint'].includes(query.type))?'Semantic Scholar 当前检索不支持该筛选条件。':id==='crossref'&&query.openAccess?'Crossref 不提供可靠的开放获取筛选；请选择其他来源或取消筛选。':id==='aminer'&&query.openAccess?'AMiner 免费检索不提供可靠的开放获取筛选。':id==='aminer'&&query.type&&query.type!=='all'?'AMiner 免费检索未提供可核对的文献类型。':id==='aminer'&&['year','citations'].includes(query.sort)?'AMiner 免费检索不支持年份或被引次数排序。':id==='arxiv'&&(query.hasCitations!==undefined||query.sort==='citations')?'arXiv API 不提供被引次数，不能按被引状态筛选或排序。':'';
      if(unsupported)return{source:{id,label:providers[id].label,status:'unsupported_filter',reason:unsupported},items:[]};
      // DOI-only Crossref and homogeneous arXiv preprints can answer impossible
      // filters definitively without spending a provider request.
      if(id==='crossref'&&query.hasDoi===false||id==='arxiv'&&query.type&&query.type!=='all'&&query.type!=='preprint')return{source:{id,label:providers[id].label,status:'ok',hasMore:false,pagination:{mode:'known_empty',page:query.page||1,limit:query.limit}},items:[]};
      try{const value=await retrieve(id,query);return{source:{id,label:providers[id].label,status:'ok',hasMore:Boolean(value.hasMore),...(value.pagination?{pagination:value.pagination}:{}),...(value.filterScope?{filterScope:value.filterScope}:{}),...(value.total!==undefined?{total:value.total}:{})},items:value.items};}catch(error){return {source:{id,label:providers[id].label,status:error.sourceStatus||'error',reason:error.message},items:[]};}
    }));
    const sources=results.map(result=>result.source),ok=sources.filter(source=>source.status==='ok');
    if(!ok.length&&sources.some(source=>['error','not_configured','budget_exhausted','rate_limited'].includes(source.status)))throw new SearchError(503,'文献来源暂时不可用，请稍后重试',{items:[],sources,query,partial:true,page:query.page||1,returnedCount:0,hasMore:false,window:{scope:'per_source',maxPages:5,limit:query.limit}});
    const seen=new Map(),items=[];
    // Round-robin preserves each provider's relevance ordering without inventing a cross-provider score.
    for(let index=0;index<query.limit;index++)for(const result of results){const item=result.items[index];if(!item)continue;const key=item.doi||item.source+':'+item.sourceId;if(seen.has(key)){mergeMetadata(seen.get(key),item);continue;}const merged={...item,sourceProvenance:[provenance(item)],...(item.citationCount!==undefined?{citationCountSource:item.source}:{})};seen.set(key,merged);items.push(merged);}
    const matching=items.filter(item=>matchesQuery(item,query));
    if(['year','citations'].includes(query.sort)){const key=query.sort==='year'?'year':'citationCount';matching.sort((a,b)=>{const av=a[key],bv=b[key],ak=Number.isSafeInteger(av),bk=Number.isSafeInteger(bv);return ak&&bk?bv-av:ak?-1:bk?1:0;});}
    const selected=matching.slice(0,query.limit),page=query.page||1;
    const value={items:selected,sources,query,partial:sources.some(source=>source.status!=='ok'),page,returnedCount:selected.length,hasMore:page<5&&sources.some(source=>source.status==='ok'&&source.hasMore),window:{scope:'per_source',maxPages:5,limit:query.limit,candidateCount:matching.length,truncated:matching.length>query.limit},...(sources.length===1&&sources[0].total!==undefined?{total:sources[0].total}:{})};
    return value;
  }
  return {
    listSources(options={}){return availableIds(options);},
    sourceStatus({allowAminer=true,allowSemanticScholar=false}={}){const ids=availableIds({allowAminer,allowSemanticScholar});return Object.values(providers).filter(({id})=>id!=='aminer'||allowAminer===true).map(({id,label})=>({id,label,configured:ids.includes(id),...(id==='cnki'?{reason:'知网需配置授权检索接口后开放。'}:id==='semantic_scholar'&&!ids.includes(id)?{reason:'Semantic Scholar 需配置接口密钥及商用许可后开放。'}:{})}));},
    async search(input,{clientKey,allowAminer=true,allowSemanticScholar=false}={}){
      const scope={allowAminer:allowAminer===true,allowSemanticScholar:allowSemanticScholar===true},query=parseLiteratureQuery(input);clientRate(clientKey);const key=JSON.stringify([query,availableIds(scope),scope]),time=clock(),saved=cache.get(key);
      if(saved&&saved.until>time)return structuredClone(saved.value);if(saved)cache.delete(key);
      if(inflight.has(key))return structuredClone(await inflight.get(key));
      const pending=execute(query,scope);inflight.set(key,pending);
      try{const value=await pending;if(value.sources.every(source=>!['error','budget_exhausted','rate_limited'].includes(source.status)))boundedSet(cache,key,{until:clock()+cacheTtlMs,value},maxCacheEntries);return structuredClone(value);}finally{inflight.delete(key);}
    },
  };
}
