const endpoint='https://api.semanticscholar.org/graph/v1/paper/search';
const fields='paperId,title,authors,year,externalIds,abstract,venue,citationCount,isOpenAccess,openAccessPdf,journal,publicationTypes';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const publicError=(message,sourceStatus='error')=>Object.assign(new Error(message),{status:503,sourceStatus});
const unsupported=()=>publicError('Semantic Scholar 暂不支持所选筛选条件，请切换筛选条件或文献来源','unsupported_filter');
const text=(value,max=1000)=>typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const types={journal:'JournalArticle',book:'Book',chapter:'BookSection',conference:'Conference',other:'Dataset'};
const typeName=value=>String(value||'').replace(/[\s_-]/g,'').toLowerCase();
function paperType(value){const list=Array.isArray(value)?value.map(typeName):[];if(list.includes('booksection'))return 'chapter';if(list.includes('book'))return 'book';if(list.includes('conference'))return 'conference';if(list.some(item=>['journalarticle','review','casereport','clinicaltrial','editorial','lettersandcomments','metaanalysis','news','study'].includes(item)))return 'journal';if(list.includes('dataset'))return 'other';return undefined;}
function doiValue(value){if(typeof value!=='string'||value.length>320)return '';const doi=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>\u0000-\u001f\u007f-\u009f]+$/u.test(doi)?doi:'';}
function publicLink(value){if(typeof value!=='string'||value.length>2048)return '';try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||!/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/i.test(url.hostname)||/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(url.hostname))return '';return url.href;}catch{return '';}}
function normalizeQuery(input){
  const q=typeof input?.q==='string'?input.q.trim():'',limit=input?.limit??10,page=input?.page??1;
  if(q.length<2||q.length>200||/[\u0000-\u001f\u007f]/.test(q)||!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(page)||page<1||page>5)throw publicError('Semantic Scholar 检索参数无效','invalid_query');
  const yearFrom=input?.yearFrom??null,yearTo=input?.yearTo??null;
  if([yearFrom,yearTo].some(year=>year!==null&&(!Number.isInteger(year)||year<1000||year>2100))||yearFrom&&yearTo&&yearFrom>yearTo)throw publicError('Semantic Scholar 年份范围无效','invalid_query');
  if(input.sort&&input.sort!=='relevance'||input.dateFrom||input.dateTo||input.hasDoi!==undefined&&input.hasDoi!==null||input.hasCitations===false||input.type&&input.type!=='all'&&!Object.hasOwn(types,input.type))throw unsupported();
  if(input.openAccess!==undefined&&typeof input.openAccess!=='boolean'||input.hasCitations!==undefined&&input.hasCitations!==null&&typeof input.hasCitations!=='boolean')throw publicError('Semantic Scholar 筛选条件无效','invalid_query');
  return {...input,q,limit,page,yearFrom,yearTo};
}

export function semanticScholarQueryURL(input){
  const query=normalizeQuery(input),url=new URL(endpoint);
  url.searchParams.set('query',query.q);url.searchParams.set('fields',fields);url.searchParams.set('limit',String(query.limit));url.searchParams.set('offset',String((query.page-1)*query.limit));
  if(query.yearFrom||query.yearTo)url.searchParams.set('year',query.yearFrom===query.yearTo?String(query.yearFrom):`${query.yearFrom||''}-${query.yearTo||''}`);
  if(query.openAccess)url.searchParams.set('openAccessPdf','');
  if(query.type&&query.type!=='all')url.searchParams.set('publicationTypes',types[query.type]);
  if(query.hasCitations===true)url.searchParams.set('minCitationCount','1');
  return url;
}

export function parseSemanticScholarResponse(payload,input){
  const query=normalizeQuery(input),offset=(query.page-1)*query.limit;
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.data)||payload.data.length>query.limit||payload.offset!==undefined&&payload.offset!==offset)throw publicError('Semantic Scholar 响应格式异常，请稍后重试');
  const items=[],seen=new Set();
  for(const raw of payload.data){
    if(!raw||typeof raw!=='object'||typeof raw.paperId!=='string'||!/^[a-f\d]{40}$/i.test(raw.paperId))continue;
    const sourceId=raw.paperId.toLowerCase(),title=text(raw.title),year=Number.isInteger(raw.year)&&raw.year>=1000&&raw.year<=2100?raw.year:null;
    if(!title||seen.has(sourceId)||query.yearFrom&&(!year||year<query.yearFrom)||query.yearTo&&(!year||year>query.yearTo))continue;
    const openAccess=typeof raw.isOpenAccess==='boolean'?raw.isOpenAccess:undefined,pdfUrl=openAccess===true?publicLink(raw.openAccessPdf?.url):'',type=paperType(raw.publicationTypes);
    if(query.openAccess&&(!openAccess||!pdfUrl)||query.type&&query.type!=='all'&&type!==query.type)continue;
    const citationCount=Number.isSafeInteger(raw.citationCount)&&raw.citationCount>=0?raw.citationCount:undefined;if(query.hasCitations===true&&!(citationCount>0))continue;
    const authorNames=(Array.isArray(raw.authors)?raw.authors:[]).slice(0,30).map(author=>text(author?.name,150)).filter(Boolean),abstract=text(raw.abstract,6000),doi=doiValue(raw.externalIds?.DOI);
    const item={id:'semantic_scholar:'+sourceId,source:'semantic_scholar',sourceId,title,authors:authorNames.join(', '),authorNames,year,doi,url:'https://www.semanticscholar.org/paper/'+sourceId+'?utm_source=api',...(type?{type,documentType:type}:{}),...(openAccess!==undefined?{openAccess}:{}),...(citationCount!==undefined?{citationCount}:{}),...(pdfUrl?{pdfUrl,fullTextUrl:pdfUrl}:{}),...(abstract?{abstract}:{})};
    const venue=text(raw.venue,300),journal=text(raw.journal?.name||(type==='journal'?venue:''),300),volume=text(raw.journal?.volume,50),pages=text(raw.journal?.pages,80);if(venue)item.venue=venue;if(journal)item.journal=journal;if(volume)item.volume=volume;if(pages)item.pages=pages;
    seen.add(sourceId);items.push(item);
  }
  const total=Number.isSafeInteger(payload.total)&&payload.total>=0?payload.total:undefined,next=Number.isSafeInteger(payload.next)&&payload.next===offset+payload.data.length&&payload.next>offset?payload.next:null;
  const hasMore=query.page<5&&next!==null&&(total===undefined||next<total);
  return {items,...(total!==undefined?{total}:{}),hasMore,pagination:{page:query.page,limit:query.limit,offset,nextOffset:hasMore?next:null,maxPages:5}};
}

// Each credential has a separate queue/cache; one request is active per key, including body reads.
const transportGates=new WeakMap();
function gateFor(fetchImpl,apiKey,clock,wait){let credentials=transportGates.get(fetchImpl);if(!credentials){credentials=new Map();transportGates.set(fetchImpl,credentials);}let gate=credentials.get(apiKey);if(!gate){gate={tail:Promise.resolve(),pending:0,nextAt:0,cooldownUntil:0,clock,wait,cache:new Map(),inflight:new Map()};credentials.set(apiKey,gate);}return gate;}

export function createSemanticScholarClient({apiKey='',fetchImpl=globalThis.fetch,beforeRequest=()=>{},clock=Date.now,wait=pause,timeoutMs=8000,maxResponseBytes=2*1024*1024,maxQueue=3,cacheTtlMs=3600000,maxCacheEntries=100}={}){
  const key=typeof apiKey==='string'?apiKey.trim():'';
  return {async search(input){
    // Commercial authorization and per-user access are additionally enforced by the caller.
    if(!key||key.length>512||/[^\x21-\x7e]/.test(key))throw publicError('Semantic Scholar 尚未配置检索凭据','not_configured');
    const query=normalizeQuery(input),url=semanticScholarQueryURL(query),cacheKey=url.href,gate=gateFor(fetchImpl,key,clock,wait),cached=gate.cache.get(cacheKey);
    if(cached&&cached.until>gate.clock())return structuredClone(cached.value);if(cached)gate.cache.delete(cacheKey);
    if(gate.inflight.has(cacheKey))return structuredClone(await gate.inflight.get(cacheKey));
    if(gate.pending>=maxQueue||gate.cooldownUntil>gate.clock())throw publicError('Semantic Scholar 暂时限流，请稍后重试','rate_limited');
    gate.pending++;
    const run=gate.tail.then(async()=>{
      if(gate.cooldownUntil>gate.clock())throw publicError('Semantic Scholar 暂时限流，请稍后重试','rate_limited');
      const delay=gate.nextAt-gate.clock();if(delay>0)await gate.wait(delay);gate.nextAt=gate.clock()+1000;
      // Reserve outbound budget only for the uncached transport request, never cache/coalesced reads.
      await beforeRequest();
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json','x-api-key':key,'User-Agent':'PaperKnow/1.0 (https://paperknow.cn; mailto:contact@oneshowailab.com)'}});
        const reject=async(message,status='error')=>{try{await response.body?.cancel();}catch{}throw publicError(message,status);};
        if(response.status===429||response.status===503){const seconds=Number(response.headers.get('retry-after'));gate.cooldownUntil=gate.clock()+Math.min(300,Number.isFinite(seconds)&&seconds>0?Math.max(1,seconds):60)*1000;await reject('Semantic Scholar 暂时限流，请稍后重试','rate_limited');}
        if(response.status===401||response.status===403)await reject('Semantic Scholar 检索凭据不可用，请联系管理员','not_configured');
        if(!response.ok)await reject('Semantic Scholar 暂时不可用，请稍后重试');
        if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))await reject('Semantic Scholar 响应格式异常，请稍后重试');
        if(Number(response.headers.get('content-length'))>maxResponseBytes)await reject('Semantic Scholar 响应过大，请缩小检索范围');
        const reader=response.body?.getReader();if(!reader)throw publicError('Semantic Scholar 响应为空，请稍后重试');const chunks=[];let size=0;
        const abortRead=()=>{try{void reader.cancel().catch(()=>{});}catch{}};controller.signal.addEventListener('abort',abortRead,{once:true});
        try{if(controller.signal.aborted)abortRead();for(;;){if(controller.signal.aborted)throw publicError('Semantic Scholar 响应超时，请稍后重试');const {done,value}=await reader.read();if(controller.signal.aborted)throw publicError('Semantic Scholar 响应超时，请稍后重试');if(done)break;size+=value.byteLength;if(size>maxResponseBytes){await reader.cancel();throw publicError('Semantic Scholar 响应过大，请缩小检索范围');}chunks.push(Buffer.from(value));}}finally{controller.signal.removeEventListener('abort',abortRead);reader.releaseLock();}
        let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw publicError('Semantic Scholar 响应格式异常，请稍后重试');}
        return parseSemanticScholarResponse(payload,query);
      }catch(error){if(controller.signal.aborted)throw publicError('Semantic Scholar 响应超时，请稍后重试');if(error?.sourceStatus)throw error;throw publicError('Semantic Scholar 暂时不可用，请稍后重试');}finally{clearTimeout(timer);}
    });
    gate.tail=run.catch(()=>{});gate.inflight.set(cacheKey,run);
    try{const value=await run;if(cacheTtlMs>0&&maxCacheEntries>0){while(gate.cache.size>=maxCacheEntries)gate.cache.delete(gate.cache.keys().next().value);gate.cache.set(cacheKey,{until:gate.clock()+cacheTtlMs,value});}return structuredClone(value);}finally{gate.pending--;gate.inflight.delete(cacheKey);}
  }};
}
