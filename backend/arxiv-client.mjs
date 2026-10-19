import {DOMParser} from '@xmldom/xmldom';

const ATOM='http://www.w3.org/2005/Atom',ARXIV='http://arxiv.org/schemas/atom',OPEN_SEARCH='http://a9.com/-/spec/opensearch/1.1/';
const endpoint='https://export.arxiv.org/api/query';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const publicError=(message,status='error')=>Object.assign(new Error(message),{status:503,sourceStatus:status});
const text=(value,maximum=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,maximum);
const children=(node,ns,name)=>Array.from(node.childNodes||[]).filter(child=>child.nodeType===1&&child.namespaceURI===ns&&child.localName===name);
const childText=(node,ns,name)=>children(node,ns,name)[0]?.textContent||'';
const arxivIdPattern=/^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]{0,35}\/\d{7})(?:v[1-9]\d{0,5})?$/i;
function canonicalId(value){
  if(typeof value!=='string'||value.length>200)return '';
  try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!['arxiv.org','www.arxiv.org','export.arxiv.org'].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/abs/'))return '';const id=url.pathname.slice(5).replace(/V(\d+)$/,'v$1');return arxivIdPattern.test(id)?id:'';}catch{return '';}
}
function isoDate(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return '';
  const stamp=Date.parse(value);if(!Number.isFinite(stamp))return '';const result=new Date(stamp).toISOString();return result.slice(0,19)===value.slice(0,19)?result:'';
}
function doiValue(value){if(typeof value!=='string'||value.length>320)return '';const doi=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>\u0000-\u001f\u007f-\u009f]+$/u.test(doi)?doi:'';}

export function arxivQueryURL(query){
  const url=new URL(endpoint);
  // Search syntax is server-owned. Tokens cannot introduce Boolean operators or filters.
  const terms=query.q.split(/\s+/).map(part=>part.replace(/["\\]/g,'')).filter(Boolean).map(part=>'all:"'+part+'"');
  let expression=terms.join(' AND ');
  const from=[query.yearFrom?String(query.yearFrom)+'-01-01':'',query.dateFrom||''].filter(Boolean).sort().at(-1),to=[query.yearTo?String(query.yearTo)+'-12-31':'',query.dateTo||''].filter(Boolean).sort()[0];
  if(from||to)expression+=' AND submittedDate:['+(from||'1000-01-01').replaceAll('-','')+'0000 TO '+(to||'2100-12-31').replaceAll('-','')+'2359]';
  url.searchParams.set('search_query',expression);url.searchParams.set('start',String(((query.page||1)-1)*query.limit));url.searchParams.set('max_results',String(query.limit));url.searchParams.set('sortBy',query.sort==='year'?'submittedDate':query.sort||'relevance');url.searchParams.set('sortOrder','descending');
  return url;
}

export function parseArxivFeed(xml,query){
  // xmldom does not retrieve URLs. Reject DTD/entity declarations before parsing anyway.
  if(typeof xml!=='string'||xml.length>2*1024*1024||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml))throw publicError('arXiv 响应格式异常，请稍后重试');
  let document;try{document=new DOMParser({onError(){throw Error('Invalid XML');}}).parseFromString(xml,'application/xml');}catch{throw publicError('arXiv 响应格式异常，请稍后重试');}
  const feed=document?.documentElement;if(!feed||feed.namespaceURI!==ATOM||feed.localName!=='feed')throw publicError('arXiv 响应格式异常，请稍后重试');
  let count=0;const pending=[[feed,0]];while(pending.length){const [node,depth]=pending.pop();if(++count>50000||depth>32)throw publicError('arXiv 响应过于复杂，请稍后重试');for(let child=node.firstChild;child;child=child.nextSibling)pending.push([child,depth+1]);}
  const entries=children(feed,ATOM,'entry');if(entries.length>1000)throw publicError('arXiv 响应过大，请稍后重试');
  const items=[],seen=new Map();
  for(const entry of entries){
    const rawId=childText(entry,ATOM,'id');if(/arxiv\.org\/api\/errors/i.test(rawId))throw publicError('arXiv 暂时无法完成检索，请稍后重试');
    const arxivId=canonicalId(rawId),title=text(childText(entry,ATOM,'title')),publishedDate=isoDate(childText(entry,ATOM,'published')),updatedDate=isoDate(childText(entry,ATOM,'updated'));
    if(!arxivId||!title||!publishedDate||!updatedDate)continue;
    const baseId=arxivId.replace(/v[1-9]\d*$/,'');
    const date=publishedDate.slice(0,10),year=Number(date.slice(0,4));
    if(query.yearFrom&&year<query.yearFrom||query.yearTo&&year>query.yearTo||query.dateFrom&&date<query.dateFrom||query.dateTo&&date>query.dateTo)continue;
    const abstract=text(childText(entry,ATOM,'summary'),6000),doi=doiValue(childText(entry,ARXIV,'doi'));
    const authorNames=children(entry,ATOM,'author').slice(0,30).map(author=>text(childText(author,ATOM,'name'),150)).filter(Boolean),authors=authorNames.join(', ');
    const categories=children(entry,ATOM,'category').slice(0,30).map(category=>category.getAttribute('term')||'').filter(value=>/^[a-z][a-z\d.\-]{0,50}$/i.test(value));
    // Always construct external original links from validated arXiv IDs. Never trust feed URLs.
    const url='https://arxiv.org/abs/'+arxivId,pdfUrl='https://arxiv.org/pdf/'+arxivId;
    const item={id:'arxiv:'+baseId,source:'arxiv',sourceId:baseId,arxivId,title,authors,authorNames,year,doi,url,pdfUrl,fullTextUrl:pdfUrl,publishedDate,updatedDate,type:'preprint',documentType:'preprint',openAccess:true,categories,...(abstract?{abstract}:{})};
    if(seen.has(baseId)){const at=seen.get(baseId);if(updatedDate>items[at].updatedDate)items[at]=item;}else{seen.set(baseId,items.length);items.push(item);}
  }
  // The provider owns relevance ordering; dates can additionally be sorted deterministically.
  if(query.sort==='submittedDate'||query.sort==='year')items.sort((a,b)=>b.publishedDate.localeCompare(a.publishedDate));
  if(query.sort==='lastUpdatedDate')items.sort((a,b)=>b.updatedDate.localeCompare(a.updatedDate));
  const rawTotal=childText(feed,OPEN_SEARCH,'totalResults').trim(),total=/^\d{1,15}$/.test(rawTotal)?Number(rawTotal):undefined;
  return {items:items.slice(0,query.limit),hasMore:(query.page||1)<5&&(Number.isSafeInteger(total)&&total>=0?total>(query.page||1)*query.limit:entries.length>=query.limit),...(Number.isSafeInteger(total)&&total>=0?{total}:{})};
}

// Share the production fetch transport's gate across service instances in this process.
// A gate retains its active slot until the response body is consumed/cancelled.
const transportGates=new WeakMap();
function gateFor(fetchImpl,clock,wait){let gate=transportGates.get(fetchImpl);if(!gate){gate={tail:Promise.resolve(),pending:0,nextAt:0,cooldownUntil:0,clock,wait,cache:new Map(),inflight:new Map()};transportGates.set(fetchImpl,gate);}return gate;}
export function createArxivClient({fetchImpl=globalThis.fetch,clock=Date.now,wait=pause,timeoutMs=8000,maxResponseBytes=2*1024*1024,maxQueue=3,cacheTtlMs=3600000,maxCacheEntries=100}={}){
  const gate=gateFor(fetchImpl,clock,wait);
  return {async search(query){
    const cacheKey=arxivQueryURL(query).href,cached=gate.cache.get(cacheKey);
    if(cached&&cached.until>gate.clock())return structuredClone(cached.value);if(cached)gate.cache.delete(cacheKey);
    if(gate.inflight.has(cacheKey))return structuredClone(await gate.inflight.get(cacheKey));
    if(gate.pending>=maxQueue)throw publicError('arXiv 检索排队较多，请稍后重试','rate_limited');
    if(gate.cooldownUntil>gate.clock())throw publicError('arXiv 暂时限流，请稍后重试','rate_limited');
    gate.pending++;
    const run=gate.tail.then(async()=>{
      if(gate.cooldownUntil>gate.clock())throw publicError('arXiv 暂时限流，请稍后重试','rate_limited');
      const delay=gate.nextAt-gate.clock();if(delay>0)await gate.wait(delay);
      // Earliest request starts are 3 seconds apart; slow bodies also remain single-connection.
      gate.nextAt=gate.clock()+3000;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetchImpl(arxivQueryURL(query),{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/atom+xml, application/xml;q=0.9','User-Agent':'PaperKnow/1.0 (https://paperknow.cn; mailto:contact@oneshowailab.com)'}});
        const reject=async(message,status='error')=>{try{await response.body?.cancel();}catch{}throw publicError(message,status);};
        if(response.status===429||response.status===503){const seconds=Number(response.headers.get('retry-after'));gate.cooldownUntil=gate.clock()+Math.min(300,Number.isFinite(seconds)&&seconds>0?Math.max(3,seconds):60)*1000;await reject('arXiv 暂时限流，请稍后重试','rate_limited');}
        if(!response.ok)await reject('arXiv 暂时不可用，请稍后重试');
        if(!/^(?:application\/(?:atom\+xml|xml)|text\/xml)(?:\s*;|$)/i.test(response.headers.get('content-type')||''))await reject('arXiv 响应格式异常，请稍后重试');
        if(Number(response.headers.get('content-length'))>maxResponseBytes)await reject('arXiv 响应过大，请缩小检索范围');
        const reader=response.body?.getReader();if(!reader)throw publicError('arXiv 响应为空，请稍后重试');const chunks=[];let size=0;
        try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxResponseBytes){await reader.cancel();throw publicError('arXiv 响应过大，请缩小检索范围');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
        let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw publicError('arXiv 响应格式异常，请稍后重试');}
        return parseArxivFeed(xml,query);
      }catch(error){if(controller.signal.aborted)throw publicError('arXiv 响应超时，请稍后重试');if(error?.sourceStatus)throw error;throw publicError('arXiv 暂时不可用，请稍后重试');}
      finally{clearTimeout(timer);}
    });
    gate.tail=run.catch(()=>{});gate.inflight.set(cacheKey,run);
    try{const value=await run;while(gate.cache.size>=maxCacheEntries)gate.cache.delete(gate.cache.keys().next().value);gate.cache.set(cacheKey,{until:gate.clock()+cacheTtlMs,value});return structuredClone(value);}finally{gate.pending--;gate.inflight.delete(cacheKey);}
  }};
}
