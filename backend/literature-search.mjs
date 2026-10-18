// Public bibliographic metadata only. Provider credentials stay in server-owned headers.
const providers = Object.freeze({
  crossref: {id:'crossref',label:'Crossref',endpoint:'https://api.crossref.org/works'},
  europepmc: {id:'europepmc',label:'Europe PMC',endpoint:'https://www.ebi.ac.uk/europepmc/webservices/rest/search'},
  openalex: {id:'openalex',label:'OpenAlex',endpoint:'https://api.openalex.org/works'},
});
const namedEntities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',times:'×',plusmn:'±',alpha:'α',beta:'β',gamma:'γ',Delta:'Δ',pi:'π',mu:'μ',le:'≤',ge:'≥',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“'};
class SearchError extends Error {
  constructor(status,message,response,retryAfter){super(message);this.status=status;this.response=response;this.retryAfter=retryAfter;}
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
function crossrefItem(item){
  const doi=doiValue(item?.DOI),title=plain(item?.title?.[0]);if(!doi||!title)return null;
  const authors=Array.isArray(item.author)?item.author.slice(0,30).map(author=>plain(author?.name||[author?.given,author?.family].filter(value=>typeof value==='string').join(' '),150)).filter(Boolean).join(', '):'';
  const year=yearValue(item.published?.['date-parts']?.[0]?.[0]??item.issued?.['date-parts']?.[0]?.[0]??item['published-print']?.['date-parts']?.[0]?.[0]??item['published-online']?.['date-parts']?.[0]?.[0]);
  const abstract=plain(item.abstract,3000),type=plain(item.type,80);
  // Crossref licences and deposited file links do not establish open-access status.
  return {id:'crossref:'+doi,title,authors,year,doi,url:doiLink(doi),source:'crossref',sourceId:doi,...(abstract?{abstract}:{}),...(type?{type}:{})};
}
function europeItem(item){
  const source=plain(item?.source,20),sourceId=plain(item?.id,100),title=plain(item?.title);
  if(!/^[A-Z][A-Z0-9_-]{0,19}$/.test(source)||!sourceId||!title)return null;
  const doi=doiValue(item.doi),year=yearValue(item.pubYear),abstract=plain(item.abstractText,3000),type=plain(item.pubTypeList?.pubType?.[0],80);
  const openAccess=item.isOpenAccess==='Y'?true:item.isOpenAccess==='N'?false:undefined;
  const fullTextUrl=openAccess&&/^PMC\d+$/.test(item.pmcid||'')?'https://europepmc.org/articles/'+item.pmcid:'';
  const url=safeLink('https://europepmc.org/article/'+encodeURIComponent(source)+'/'+encodeURIComponent(sourceId));
  return {id:'europepmc:'+source+':'+sourceId,title,authors:plain(item.authorString,3000),year,doi,url,source:'europepmc',sourceId:source+':'+sourceId,...(abstract?{abstract}:{}),...(openAccess!==undefined?{openAccess}:{}),...(fullTextUrl?{fullTextUrl}:{}),...(type?{type}:{})};
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
  const authors=Array.isArray(item.authorships)?item.authorships.slice(0,30).map(value=>plain(value?.author?.display_name,150)).filter(Boolean).join(', '):'';
  const openAccess=typeof item.open_access?.is_oa==='boolean'?item.open_access.is_oa:undefined;
  const location=item.best_oa_location;
  // OpenAlex's paid content_urls require our key and must never become public links.
  // Surface only provider-declared open locations, not arbitrary deposited PDF links.
  const publicOALink=value=>{const link=safeLink(value);return link&&new URL(link).hostname!=='content.openalex.org'?link:'';};
  const fullTextUrl=openAccess===true?(location?.is_oa===true?(publicOALink(location.pdf_url)||publicOALink(location.landing_page_url)):'')||publicOALink(item.open_access.oa_url):'';
  return {id:'openalex:'+sourceId,title,authors,year,doi,url:doi?doiLink(doi):'https://openalex.org/'+sourceId,source:'openalex',sourceId,...(abstract?{abstract}:{}),...(openAccess!==undefined?{openAccess}:{}),...(fullTextUrl?{fullTextUrl}:{}),...(type?{type}:{})};
}
export function parseLiteratureQuery(input){
  const p=input instanceof URLSearchParams?input:new URLSearchParams(input);
  const allowed=new Set(['q','source','yearFrom','yearTo','openAccess','limit']);
  for(const key of p.keys())if(!allowed.has(key)||p.getAll(key).length!==1)invalid('检索参数不正确');
  const raw=p.get('q')??'',q=raw.trim().replace(/\s+/g,' ');
  if(raw.length>300||q.length<2||q.length>200||/[\u0000-\u001f\u007f-\u009f]/.test(raw)||!/[\p{L}\p{N}]/u.test(q))invalid('请输入 2～200 字符的公开标题或关键词');
  const source=p.get('source')||'all';if(source!=='all'&&!Object.hasOwn(providers,source))invalid('请选择已接入的文献来源');
  const parseYear=key=>{const value=p.get(key);if(value===null||value==='')return null;if(!/^\d{4}$/.test(value)||!yearValue(value))invalid('年份应为 1000～2100 之间的四位数字');return Number(value);};
  const yearFrom=parseYear('yearFrom'),yearTo=parseYear('yearTo');if(yearFrom&&yearTo&&yearFrom>yearTo)invalid('起始年份不能晚于结束年份');
  const oa=p.get('openAccess');if(oa!==null&&oa!==''&&!['true','false'].includes(oa))invalid('开放获取筛选参数不正确');
  const rawLimit=p.get('limit'),limit=rawLimit===null||rawLimit===''?10:Number(rawLimit);if(!Number.isInteger(limit)||limit<1||limit>20||rawLimit&&!/^\d+$/.test(rawLimit))invalid('每次检索数量应为 1～20 条');
  return {q,source,yearFrom,yearTo,openAccess:oa==='true',limit};
}
function providerURL(id,query){
  const u=new URL(providers[id].endpoint);
  if(id==='crossref'){
    u.searchParams.set('query.bibliographic',query.q);u.searchParams.set('rows',String(query.limit));
    const filters=[];if(query.yearFrom)filters.push('from-pub-date:'+query.yearFrom+'-01-01');if(query.yearTo)filters.push('until-pub-date:'+query.yearTo+'-12-31');if(filters.length)u.searchParams.set('filter',filters.join(','));
  }else if(id==='europepmc'){
    // Treat all user tokens literally so advanced-query syntax cannot negate our filters.
    const terms=query.q.split(/\s+/).map(part=>part.replace(/["\\]/g,'')).filter(Boolean).map(part=>'"'+part+'"');
    let expression=terms.join(' AND ');if(query.yearFrom||query.yearTo)expression+=' AND FIRST_PDATE:['+(query.yearFrom||1000)+'-01-01 TO '+(query.yearTo||2100)+'-12-31]';if(query.openAccess)expression+=' AND OPEN_ACCESS:Y';
    u.searchParams.set('query',expression);u.searchParams.set('format','json');u.searchParams.set('pageSize',String(query.limit));u.searchParams.set('resultType','core');
  }else{
    // Search text is confined to one value; callers cannot add fields, filters or keys.
    u.searchParams.set('search',query.q);u.searchParams.set('per_page',String(query.limit));
    u.searchParams.set('select','id,doi,title,authorships,publication_year,abstract_inverted_index,open_access,best_oa_location,type');
    const filters=[];if(query.yearFrom)filters.push('from_publication_date:'+query.yearFrom+'-01-01');if(query.yearTo)filters.push('to_publication_date:'+query.yearTo+'-12-31');if(query.openAccess)filters.push('open_access.is_oa:true');if(filters.length)u.searchParams.set('filter',filters.join(','));
  }
  return u;
}
function boundedSet(map,key,value,maximum){if(map.has(key))map.delete(key);while(map.size>=maximum)map.delete(map.keys().next().value);map.set(key,value);}
export function createLiteratureSearch({fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=8000,maxResponseBytes=2*1024*1024,clientLimit=20,cacheTtlMs=300000,maxCacheEntries=100,maxConcurrent=4,openAlexApiKey='',openAlexDailyLimit=500}={}){
  const apiKey=typeof openAlexApiKey==='string'&&openAlexApiKey.length<=500&&!/[\s\u0000-\u001f\u007f]/.test(openAlexApiKey)?openAlexApiKey:'';
  const dailyLimit=Number.isInteger(openAlexDailyLimit)&&openAlexDailyLimit>=0&&openAlexDailyLimit<=10000?openAlexDailyLimit:500;
  const availableIds=Object.keys(providers).filter(id=>id!=='openalex'||Boolean(apiKey));
  let openAlexDay=-1,openAlexCount=0;
  const cache=new Map(),inflight=new Map(),clients=new Map(),providerState=new Map(Object.keys(providers).map(id=>[id,{active:0,minuteAt:0,minuteCount:0,secondAt:0,secondCount:0,cooldownUntil:0}]));let active=0;
  function clientRate(clientKey){
    const time=clock(),key=String(clientKey||'unknown').slice(0,100);let bucket=clients.get(key);
    if(!bucket||bucket.until<=time)bucket={until:time+60000,count:0};bucket.count++;boundedSet(clients,key,bucket,10000);
    if(bucket.count>clientLimit)throw new SearchError(429,'文献检索较频繁，请稍后再试',undefined,Math.max(1,Math.ceil((bucket.until-time)/1000)));
  }
  async function retrieve(id,query){
    const state=providerState.get(id),time=clock();
    if(id==='openalex'){
      const day=Math.floor(time/86400000);if(openAlexDay!==day){openAlexDay=day;openAlexCount=0;}
      if(openAlexCount>=dailyLimit)throw new SearchError(503,'OpenAlex 今日检索额度已用完，请明日再试');
    }
    if(state.minuteAt+60000<=time){state.minuteAt=time;state.minuteCount=0;}if(state.secondAt+1000<=time){state.secondAt=time;state.secondCount=0;}
    if(state.cooldownUntil>time||state.minuteCount>=60||state.secondCount>=3||state.active>=1||active>=maxConcurrent)throw new SearchError(503,'来源请求繁忙，请稍后重试');
    state.active++;active++;state.minuteCount++;state.secondCount++;
    if(id==='openalex')openAlexCount++;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      // URL and all outbound headers are server-owned, never supplied by the client.
      const response=await fetchImpl(providerURL(id,query),{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'PaperKnow/1.0 (https://paperknow.cn; mailto:contact@oneshowailab.com)',...(id==='openalex'?{Authorization:'Bearer '+apiKey}:{})}});
      const rejectResponse=async message=>{try{await response.body?.cancel();}catch{}throw new SearchError(503,message);};
      if(id==='openalex'&&response.headers.get('x-ratelimit-remaining')!==null&&Number(response.headers.get('x-ratelimit-remaining'))<=0){
        const reset=Number(response.headers.get('x-ratelimit-reset'));
        state.cooldownUntil=clock()+((Number.isFinite(reset)&&reset>0)?Math.min(86400,Math.ceil(reset))*1000:86400000-(clock()%86400000));
      }
      if(id==='openalex'&&[401,403].includes(response.status)){state.cooldownUntil=Math.max(state.cooldownUntil,clock()+300000);await rejectResponse('OpenAlex 授权暂时不可用，请联系平台支持');}
      if(response.status===429){const wait=Number(response.headers.get('retry-after'));state.cooldownUntil=Math.max(state.cooldownUntil,clock()+Math.min(300,Number.isFinite(wait)&&wait>0?wait:60)*1000);await rejectResponse('该文献来源限流，请稍后重试');}
      if(!response.ok)await rejectResponse('该文献来源暂时不可用');
      if(!/\bjson\b/i.test(response.headers.get('content-type')||''))await rejectResponse('该文献来源响应格式异常');
      if(Number(response.headers.get('content-length'))>maxResponseBytes)await rejectResponse('该文献来源响应过大');
      const reader=response.body?.getReader();if(!reader)throw new SearchError(503,'该文献来源响应为空');const chunks=[];let bytes=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxResponseBytes){await reader.cancel();throw new SearchError(503,'该文献来源响应过大');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SearchError(503,'该文献来源响应格式异常');}
      const rows=id==='crossref'?data?.message?.items:id==='europepmc'?data?.resultList?.result:data?.results,total=id==='crossref'?data?.message?.['total-results']:id==='europepmc'?data?.hitCount:data?.meta?.count;
      if(!Array.isArray(rows)||rows.length>1000)throw new SearchError(503,'该文献来源响应格式异常');
      const items=rows.slice(0,query.limit).map(id==='crossref'?crossrefItem:id==='europepmc'?europeItem:openAlexItem).filter(Boolean).filter(item=>(!query.yearFrom||item.year>=query.yearFrom)&&(!query.yearTo||item.year!==null&&item.year<=query.yearTo)&&(!query.openAccess||item.openAccess===true));
      return {items,...(Number.isSafeInteger(total)&&total>=0?{total}:{})};
    }catch(error){if(controller.signal.aborted)throw new SearchError(503,'该文献来源响应超时，请稍后重试');if(error instanceof SearchError)throw error;throw new SearchError(503,'该文献来源暂时不可用');}
    finally{clearTimeout(timer);state.active--;active--;}
  }
  async function execute(query){
    const ids=query.source==='all'?availableIds:[query.source];
    const results=await Promise.all(ids.map(async id=>{
      if(id==='openalex'&&!apiKey)return {source:{id,label:providers[id].label,status:'not_configured',reason:'OpenAlex 暂未开放，请选择其他文献来源。'},items:[]};
      if(id==='crossref'&&query.openAccess)return {source:{id,label:providers[id].label,status:'unsupported_filter',reason:'Crossref 不提供可靠的开放获取筛选；可改选 Europe PMC 或取消筛选。'},items:[]};
      try{const value=await retrieve(id,query);return{source:{id,label:providers[id].label,status:'ok',...(value.total!==undefined?{total:value.total}:{})},items:value.items};}catch(error){return {source:{id,label:providers[id].label,status:'error',reason:error.message},items:[]};}
    }));
    const sources=results.map(result=>result.source),ok=sources.filter(source=>source.status==='ok');
    if(!ok.length&&sources.some(source=>['error','not_configured'].includes(source.status)))throw new SearchError(503,'文献来源暂时不可用，请稍后重试',{items:[],sources,query,partial:true});
    const seen=new Map(),items=[];
    // Round-robin preserves each provider's relevance ordering without inventing a cross-provider score.
    for(let index=0;index<query.limit;index++)for(const result of results){const item=result.items[index];if(!item)continue;const key=item.doi||item.source+':'+item.sourceId;if(seen.has(key))continue;seen.set(key,item);items.push(item);}
    const value={items:items.slice(0,query.limit),sources,query,partial:sources.some(source=>source.status!=='ok'),...(sources.length===1&&sources[0].total!==undefined?{total:sources[0].total}:{})};
    return value;
  }
  return {
    listSources(){return [...availableIds];},
    sourceStatus(){return Object.values(providers).map(({id,label})=>({id,label,configured:availableIds.includes(id)}));},
    async search(input,{clientKey}={}){
      const query=parseLiteratureQuery(input);clientRate(clientKey);const key=JSON.stringify(query),time=clock(),saved=cache.get(key);
      if(saved&&saved.until>time)return structuredClone(saved.value);if(saved)cache.delete(key);
      if(inflight.has(key))return structuredClone(await inflight.get(key));
      const pending=execute(query);inflight.set(key,pending);
      try{const value=await pending;if(value.sources.every(source=>source.status!=='error'))boundedSet(cache,key,{until:clock()+cacheTtlMs,value},maxCacheEntries);return structuredClone(value);}finally{inflight.delete(key);}
    },
  };
}
