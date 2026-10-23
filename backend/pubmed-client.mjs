const endpoint='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const publicError=(message,status='error')=>Object.assign(new Error(message),{status:503,sourceStatus:status});
const pmidPattern=/^[1-9]\d{0,11}$/;
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function text(value,maximum=1000){
  if(typeof value!=='string')return '';
  return value.replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
    if(entity[0]!=='#')return entities[entity.toLowerCase()]||'';
    const point=entity[1]?.toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):' ';
  }).replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,maximum);
}
function doiValue(value){if(typeof value!=='string'||value.length>320)return '';const doi=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>\u0000-\u001f\u007f-\u009f]+$/u.test(doi)?doi:'';}
function pagination(query){const limit=Number(query.limit??10),page=Number(query.page??1);if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(page)||page<1||page>5)throw publicError('PubMed 检索范围无效');return {mode:'offset',page,limit};}

export function pubmedQueryURL(query){
  if(typeof query.q!=='string'||query.q.length<2||query.q.length>200)throw publicError('PubMed 检索关键词无效');
  if(query.sort&&!['relevance','year'].includes(query.sort))throw publicError('PubMed 暂不支持此排序方式','unsupported');
  // Free full text is not an open licence; ESummary also has no citation counts.
  if(query.openAccess||query.hasCitations!==undefined)throw publicError('PubMed 暂不支持此筛选条件','unsupported');
  const {page,limit}=pagination(query),url=new URL('esearch.fcgi',endpoint);
  // Literal tokens cannot add PubMed field selectors or Boolean operators.
  const terms=query.q.split(/\s+/).map(part=>part.replace(/["\\[\]\u0000-\u001f\u007f-\u009f]/g,'')).filter(Boolean).map(part=>'"'+part+'"[All Fields]');
  if(!terms.length)throw publicError('PubMed 检索关键词无效');
  url.searchParams.set('db','pubmed');url.searchParams.set('retmode','json');url.searchParams.set('term',terms.join(' AND '));url.searchParams.set('retstart',String((page-1)*limit));url.searchParams.set('retmax',String(limit));url.searchParams.set('sort',query.sort==='year'?'pub date':'relevance');
  if(query.yearFrom||query.yearTo){
    const from=Number(query.yearFrom||1000),to=Number(query.yearTo||2100);
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<1000||to>2100||from>to)throw publicError('PubMed 检索年份无效');
    url.searchParams.set('datetype','pdat');url.searchParams.set('mindate',String(from));url.searchParams.set('maxdate',String(to));
  }
  url.searchParams.set('tool','PaperKnow');url.searchParams.set('email','contact@oneshowailab.com');
  return url;
}

function parseSearch(data,limit){
  const result=data?.esearchresult;
  if(data?.error||!result||typeof result!=='object'||!Array.isArray(result.idlist)||result.idlist.length>limit||!/^\d{1,15}$/.test(String(result.count)))throw publicError('PubMed 响应格式异常，请稍后重试');
  const total=Number(result.count);
  if(!Number.isSafeInteger(total)||total<0||result.idlist.some(id=>typeof id!=='string'||!pmidPattern.test(id)))throw publicError('PubMed 响应格式异常，请稍后重试');
  if(result.errorlist&&Object.values(result.errorlist).some(value=>Array.isArray(value)?value.length:Boolean(value)))throw publicError('PubMed 暂时无法完成检索，请调整关键词后重试');
  return {ids:[...new Set(result.idlist)],total};
}

export function parsePubMedSummary(data,ids){
  if(data?.error||!data?.result||typeof data.result!=='object'||!Array.isArray(ids)||ids.length>20)throw publicError('PubMed 响应格式异常，请稍后重试');
  const items=[];
  for(const pmid of [...new Set(ids)]){
    if(!pmidPattern.test(pmid))continue;
    const record=data.result[pmid];
    if(!record||record.error||record.uid!==pmid)continue;
    const title=text(record.title);if(!title)continue;
    const authorNames=(Array.isArray(record.authors)?record.authors:[]).slice(0,30).map(author=>text(author?.name,150)).filter(Boolean);
    const rawYear=/^(\d{4})(?:\D|$)/.exec(typeof record.pubdate==='string'?record.pubdate:'')?.[1],year=rawYear&&Number(rawYear)>=1000&&Number(rawYear)<=2100?Number(rawYear):null;
    const publicationTypes=(Array.isArray(record.pubtype)?record.pubtype:[]).slice(0,30).map(value=>text(value,100)).filter(Boolean);
    const type=publicationTypes.some(value=>/^(?:journal article|review|systematic review|meta-analysis|clinical trial|randomized controlled trial|case reports|editorial|letter)$/i.test(value))?'journal':publicationTypes.some(value=>/^book$/i.test(value))?'book':publicationTypes.some(value=>/^book chapter$/i.test(value))?'chapter':publicationTypes.length?'other':'';
    const doi=(Array.isArray(record.articleids)?record.articleids:[]).filter(value=>value?.idtype==='doi').map(value=>doiValue(value.value)).find(Boolean)||'';
    const journal=text(record.fulljournalname||record.source,500),volume=text(record.volume,50),issue=text(record.issue,50),pages=text(record.pages,100),publisher=text(record.publishername,300);
    // Summary flags such as "Has Abstract" and PMC identifiers are not full text.
    items.push({id:'pubmed:'+pmid,source:'pubmed',sourceId:pmid,pmid,title,authors:authorNames.join(', '),authorNames,year,doi,url:'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/',type,documentType:type,publicationTypes,...(journal?{journal}:{}),...(volume?{volume}:{}),...(issue?{issue}:{}),...(pages?{pages}:{}),...(publisher?{publisher}:{})});
  }
  if(ids.length&&!items.length)throw publicError('PubMed 文献详情暂时不可用，请稍后重试');
  return items;
}

// All clients sharing a fetch transport also share one NCBI request queue/cache.
// 350 ms between HTTP starts keeps anonymous access below three requests/second.
const transportGates=new WeakMap();
function gateFor(fetchImpl,clock,wait){let gate=transportGates.get(fetchImpl);if(!gate){gate={tail:Promise.resolve(),pending:0,nextAt:0,cooldownUntil:0,clock,wait,cache:new Map(),inflight:new Map()};transportGates.set(fetchImpl,gate);}return gate;}
export function createPubMedClient({fetchImpl=globalThis.fetch,clock=Date.now,wait=pause,timeoutMs=8000,maxResponseBytes=2*1024*1024,maxQueue=3,cacheTtlMs=3600000,maxCacheEntries=100}={}){
  const gate=gateFor(fetchImpl,clock,wait);
  const capacity=Math.min(1000,Math.max(1,Number(maxCacheEntries)||100)),queueCapacity=Math.min(10,Math.max(1,Number(maxQueue)||3));
  async function request(url){
    if(gate.cooldownUntil>gate.clock())throw publicError('PubMed 暂时限流，请稍后重试','rate_limited');
    const delay=gate.nextAt-gate.clock();if(delay>0)await gate.wait(delay);
    gate.nextAt=gate.clock()+350;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'PaperKnow/1.0 (https://paperknow.cn; mailto:contact@oneshowailab.com)'}});
      const reject=async(message,status='error')=>{try{await response.body?.cancel();}catch{}throw publicError(message,status);};
      if(response.status===429||response.status===503){const seconds=Number(response.headers.get('retry-after'));gate.cooldownUntil=gate.clock()+Math.min(300,Number.isFinite(seconds)&&seconds>0?Math.max(1,seconds):60)*1000;await reject('PubMed 暂时限流，请稍后重试','rate_limited');}
      if(!response.ok)await reject('PubMed 暂时不可用，请稍后重试');
      if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))await reject('PubMed 响应格式异常，请稍后重试');
      if(Number(response.headers.get('content-length'))>maxResponseBytes)await reject('PubMed 响应过大，请缩小检索范围');
      const reader=response.body?.getReader();if(!reader)throw publicError('PubMed 响应为空，请稍后重试');
      const chunks=[];let size=0;const cancel=()=>{reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
      try{for(;;){const {done,value}=await reader.read();if(controller.signal.aborted)throw publicError('PubMed 响应超时，请稍后重试');if(done)break;size+=value.byteLength;if(size>maxResponseBytes){await reader.cancel();throw publicError('PubMed 响应过大，请缩小检索范围');}chunks.push(Buffer.from(value));}}finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
      try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw publicError('PubMed 响应格式异常，请稍后重试');}
    }catch(error){if(controller.signal.aborted)throw publicError('PubMed 响应超时，请稍后重试');if(error?.sourceStatus)throw error;throw publicError('PubMed 暂时不可用，请稍后重试');}
    finally{clearTimeout(timer);}
  }
  return {async search(query){
    const searchUrl=pubmedQueryURL(query),cacheKey=searchUrl.href+'|'+(query.type||'all')+'|'+Boolean(query.hasDoi),cached=gate.cache.get(cacheKey);
    if(cached&&cached.until>gate.clock())return structuredClone(cached.value);if(cached)gate.cache.delete(cacheKey);
    if(gate.inflight.has(cacheKey))return structuredClone(await gate.inflight.get(cacheKey));
    if(gate.pending>=queueCapacity)throw publicError('PubMed 检索排队较多，请稍后重试','rate_limited');
    if(gate.cooldownUntil>gate.clock())throw publicError('PubMed 暂时限流，请稍后重试','rate_limited');
    gate.pending++;
    const run=gate.tail.then(async()=>{
      const paging=pagination(query),{ids,total}=parseSearch(await request(searchUrl),paging.limit);
      let items=[];
      if(ids.length){const url=new URL('esummary.fcgi',endpoint);url.searchParams.set('db','pubmed');url.searchParams.set('retmode','json');url.searchParams.set('id',ids.join(','));url.searchParams.set('tool','PaperKnow');url.searchParams.set('email','contact@oneshowailab.com');items=parsePubMedSummary(await request(url),ids);}
      return {items,total,hasMore:paging.page<5&&total>paging.page*paging.limit,pagination:paging};
    });
    gate.tail=run.catch(()=>{});gate.inflight.set(cacheKey,run);
    try{const value=await run;while(gate.cache.size>=capacity)gate.cache.delete(gate.cache.keys().next().value);gate.cache.set(cacheKey,{until:gate.clock()+cacheTtlMs,value});return structuredClone(value);}finally{gate.pending--;gate.inflight.delete(cacheKey);}
  }};
}
