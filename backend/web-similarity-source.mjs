import {lookup} from 'node:dns/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {parse} from 'parse5';

const defaults=Object.freeze({timeoutMs:10000,maxResponseBytes:1024*1024,maxTextChars:50000,maxRedirects:2});
const messages=Object.freeze({
 invalid_url:'网页地址未通过安全检查', dns_invalid:'网页域名未通过安全检查', dns_failed:'网页域名暂时无法解析',
 timeout:'网页读取超时', cancelled:'网页读取已取消', transport_failed:'网页暂时无法读取',
 access_restricted:'网页需要登录、授权或访问验证，未读取其正文', rate_limited:'网页访问较频繁，请稍后再试',
 http_error:'网页暂时无法访问', redirects:'网页跳转次数超过限制', unsupported:'本次仅支持公开 HTML 或纯文本网页',
 too_large:'网页内容超过安全大小限制', encoding:'网页文字编码暂不支持', empty:'网页未提供可比对的公开正文',
 invalid_configuration:'网页读取安全限制配置无效',
});
function failure(code,status=422){const e=new Error(messages[code]||messages.transport_failed);e.code='web_source_'+code;e.status=status;e.webSourceSafe=true;return e;}
function reject(code,status){throw failure(code,status);}
const clean=value=>String(value||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').replace(/[\t\f\v ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const limitChars=(value,max)=>Array.from(value).slice(0,max).join('');

// Reject every special-use/non-global family, including IPv4-mapped IPv6,
// documentation space, NAT64, 6to4, link-local and cloud metadata addresses.
function publicIP(value){
 if(typeof value!=='string')return false;
 const family=isIP(value);
 if(family===4){
  const [a,b,c]=value.split('.').map(Number);
  return a>0&&a<224&&![10,127].includes(a)&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===0||b===168||b===88&&c===99))&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
 }
 if(family!==6||value.includes('.')||value.includes('%'))return false;
 const [left,right]=value.toLowerCase().split('::'),a=left?left.split(':'):[],b=right?right.split(':'):[];
 const words=right!==undefined?[...a,...Array(8-a.length-b.length).fill('0'),...b].map(x=>parseInt(x,16)):a.map(x=>parseInt(x,16));
 if(words.length!==8||words.some(x=>!Number.isInteger(x)))return false;
 return words[0]>=0x2000&&words[0]<=0x3fff&&!(words[0]===0x2001&&(words[1]<0x0200||words[1]===0x0db8))&&words[0]!==0x2002&&words[0]!==0x3ffe&&!(words[0]===0x3fff&&words[1]<0x1000);
}
function checkedURL(value){
 if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020\u007f\\]/.test(value))reject('invalid_url',400);
 let url;try{url=new URL(value);}catch{reject('invalid_url',400);}
 const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!host||host.endsWith('.')||!isIP(host)&&(!host.includes('.')||/(^|\.)(localhost|local|internal|invalid|test|onion|lan|home|corp)$/.test(host)))reject('invalid_url',400);
 if(isIP(host)&&!publicIP(host))reject('invalid_url',400);
 // Signed downloads and credentials are not public evidence URLs. Never store
 // their secrets in a report or forward them to another redirect destination.
 for(const [key]of url.searchParams){const name=key.replace(/[_.-]/g,'').toLowerCase();if(/token|secret|password|passwd|signature|credential|authorization|accesskey|apikey|session|jwt|ticket|bearer/.test(name)||['sig','key','code','policy','expires'].includes(name)||/^x(?:amz|oss|goog)/.test(name))reject('invalid_url',400);}
 url.hash='';return url;
}
function raceAbort(promise,signal){
 return new Promise((resolve,rejectPromise)=>{const abort=()=>rejectPromise(failure('cancelled',499));if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,rejectPromise).finally(()=>signal.removeEventListener('abort',abort));});
}
const attr=(node,name)=>node.attrs?.find(a=>a.name===name)?.value||'';
const ignored=new Set(['script','style','noscript','template','nav','header','footer','aside','iframe','object','embed','canvas','svg','form','button','select','input','textarea']);
const block=new Set(['address','article','blockquote','br','dd','div','dl','dt','figcaption','figure','h1','h2','h3','h4','h5','h6','hr','li','main','p','pre','section','table','td','th','tr','ul','ol']);
function hidden(node){return node.attrs?.some(a=>a.name==='hidden'||a.name==='inert'||a.name==='aria-hidden'&&a.value.toLowerCase()==='true')||/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s|;|$))/i.test(attr(node,'style'));}
function chrome(node){return /(?:^|[-_\s])(?:nav|navbar|navigation|header|footer|sidebar|cookies?|breadcrumbs?|social|share|menu|advert|advertisement|recommendations)(?:$|[-_\s])/i.test(attr(node,'class')+' '+attr(node,'id'))||['navigation','banner','contentinfo','complementary'].includes(attr(node,'role').toLowerCase());}
function visibleText(root){
 const out=[],stack=[root];let count=0;
 while(stack.length){const node=stack.pop();if(typeof node==='string'){out.push(node);continue;}if(++count>100000)reject('too_large');if(node.nodeName==='#text'){out.push(node.value);continue;}if(ignored.has(node.tagName)||hidden(node)||chrome(node))continue;if(block.has(node.tagName))out.push('\n');if(block.has(node.tagName))stack.push('\n');const children=node.childNodes||[];for(let i=children.length-1;i>=0;i--)stack.push(children[i]);}
 return clean(out.join(''));
}
function htmlText(value){
 let doc;try{doc=parse(value);}catch{reject('empty');}
 const stack=[doc],candidates=[];let body,title='',count=0,accessMarker=false;
 while(stack.length){const node=stack.pop();if(++count>100000)reject('too_large');if(node.tagName==='body')body=node;if(node.tagName==='title')title=visibleText(node);if(ignored.has(node.tagName)||hidden(node)||chrome(node))continue;if(['main','article'].includes(node.tagName))candidates.push(node);if(/(?:^|[-_\s])(?:paywall|login-required|subscription-required|captcha|challenge-platform)(?:$|[-_\s])/i.test(attr(node,'class')+' '+attr(node,'id')))accessMarker=true;for(const child of node.childNodes||[])stack.push(child);}
 const all=visibleText(body||doc),article=candidates.slice(0,30).map(visibleText).sort((a,b)=>b.length-a.length)[0];
 const text=article&&article.length>=200&&article.length>=all.length/4?article:all;
 const titleGate=/^(?:\s*(?:用户|会员)?登录|\s*注册|\s*login\b|\s*sign[ -]?in\b|\s*access denied\b|\s*just a moment\b|\s*security verification\b|\s*验证码|\s*访问验证|\s*安全验证)/i.test(title);
 const textGate=/(?:登录|登入|订阅|购买|付费|授权)后(?:才可|即可|可以|可)?(?:查看|阅读|下载)(?:全|本|此|该)?(?:文|篇|文章)|sign[ -]?in to (?:read|access)|subscribe to (?:read|access)|verify (?:that )?you are human|checking your browser|enable javascript and cookies to continue/i.test(text);
 if(titleGate&&text.length<5000||textGate&&(accessMarker||text.length<2000))reject('access_restricted');
 return {title:limitChars(clean(title).replace(/\s+/g,' '),300),text};
}
function decode(bytes,type){
 const declared=type.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
 const meta=type.toLowerCase().includes('html')?bytes.subarray(0,8192).toString('latin1').match(/<meta\b[^>]*charset\s*=\s*["']?\s*([^\s;"'/>]+)/i)?.[1]:'';
 let charset=(declared||meta||'utf-8').toLowerCase();if(['gb2312','gbk','x-gbk'].includes(charset))charset='gb18030';
 // An unknown charset must never produce apparently successful mojibake.
 if(!['utf-8','utf8','gb18030','big5','windows-1252','iso-8859-1','us-ascii'].includes(charset))reject('encoding');
 try{return new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{reject('encoding');}
}

/** Read only a bounded public webpage; requestImpl is a trusted test transport. */
export function createWebSourceReader({lookupImpl=lookup,requestImpl,clock=Date.now,...overrides}={}){
 const limits={...defaults};for(const [key,value]of Object.entries(overrides)){if(!Object.hasOwn(defaults,key)||!Number.isSafeInteger(value)||value<1||value>defaults[key])reject('invalid_configuration',500);limits[key]=value;}
 const transport=requestImpl||((options,callback)=>(options.protocol==='https:'?httpsRequest:httpRequest)(options,callback));
 async function resolve(url,signal){
  const host=url.hostname.replace(/^\[|\]$/g,'');if(isIP(host))return [{address:host,family:isIP(host)}];
  let addresses;try{addresses=await raceAbort(lookupImpl(host,{all:true,verbatim:true}),signal);}catch(e){if(e?.webSourceSafe)throw e;reject('dns_failed');}
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>64||addresses.some(a=>!a||!publicIP(a.address)||a.family!==isIP(a.address)))reject('dns_invalid');return addresses;
 }
 function request(url,address,signal){
  return new Promise((resolvePromise,rejectPromise)=>{
   let req,response,settled=false;
   const finish=(err,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(err){response?.destroy?.();req?.destroy?.();rejectPromise(err);}else resolvePromise(value);};
   const abort=()=>finish(failure('cancelled',499));if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});
   try{
    const host=url.hostname.replace(/^\[|\]$/g,'');
    req=transport({protocol:url.protocol,hostname:host,port:url.protocol==='https:'?443:80,path:url.pathname+url.search,method:'GET',servername:isIP(host)?undefined:host,rejectUnauthorized:true,agent:false,autoSelectFamily:false,family:address.family,signal,headers:{Accept:'text/html, application/xhtml+xml, text/plain;q=0.9','Accept-Encoding':'identity','User-Agent':'PaperKnowSourceReader/1.0 (+https://paperknow.cn; contact@oneshowailab.com)'},lookup:(_host,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family)},res=>{
     response=res;res.once('error',()=>finish(failure('transport_failed')));res.once('aborted',()=>finish(failure('transport_failed')));
     const status=res.statusCode,headers=res.headers||{};
     if([301,302,303,307,308].includes(status)){const location=headers.location;finish(null,{redirect:location});res.destroy?.();req?.destroy?.();return;}
     if([401,402,403,407].includes(status)){finish(failure('access_restricted'));return;}
     if(status===429){finish(failure('rate_limited',429));return;}
     if(!Number.isInteger(status)||status<200||status>=300){finish(failure('http_error'));return;}
     const type=typeof headers['content-type']==='string'?headers['content-type']:'';
     if(!/^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:\s*;|\s*$)/i.test(type)||headers['content-disposition']&&/attachment/i.test(headers['content-disposition'])||headers['content-encoding']&&!/^identity$/i.test(headers['content-encoding'])){finish(failure('unsupported'));return;}
     const length=headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>limits.maxResponseBytes)){finish(failure('too_large'));return;}
     const chunks=[];let bytes=0;
     res.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>limits.maxResponseBytes){finish(failure('too_large'));return;}chunks.push(Buffer.from(chunk));});
     res.once('end',()=>finish(null,{bytes:Buffer.concat(chunks,bytes),type}));
    });
    req.once('error',()=>finish(failure('transport_failed')));req.end();
   }catch{finish(failure('transport_failed'));}
  });
 }
 return async function read(value,{signal}={}){
  let url=checkedURL(value);const timerSignal=AbortSignal.timeout(limits.timeoutMs),combined=signal?AbortSignal.any([signal,timerSignal]):timerSignal;
  try{
   for(let redirects=0;;redirects++){
    if(combined.aborted)reject('cancelled',499);const addresses=await resolve(url,combined),result=await request(url,addresses[0],combined);
    if(Object.hasOwn(result,'redirect')){if(redirects>=limits.maxRedirects)reject('redirects');if(typeof result.redirect!=='string'||!result.redirect||result.redirect.length>4096)reject('invalid_url');let target;try{target=new URL(result.redirect,url).href;}catch{reject('invalid_url');}url=checkedURL(target);continue;}
    const raw=decode(result.bytes,result.type),content=/^text\/plain(?:\s*;|\s*$)/i.test(result.type)?{title:'',text:clean(raw)}:htmlText(raw),text=limitChars(content.text,limits.maxTextChars);
    if(Array.from(text).length<40)reject('empty');
    return {url:url.href,title:content.title||url.hostname,text,fetchedAt:new Date(clock()).toISOString(),contentHash:createHash('sha256').update(text).digest('hex'),kind:'web',provider:'公开网页',license:'本次可访问网页文本，仅用于比对'};
   }
  }catch(e){if(signal?.aborted)throw failure('cancelled',499);if(timerSignal.aborted)throw failure('timeout',504);if(e?.webSourceSafe)throw e;throw failure('transport_failed');}
 };
}
