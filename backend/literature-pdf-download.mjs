import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {parse} from 'parse5';
import {publicIP} from './web-similarity-source.mjs';

const MAX=20*1024*1024;
const fail=(status,message)=>{throw Object.assign(Error(message),{status,literatureDownloadSafe:true});};
function publicURL(value){
 if(typeof value!=='string'||value.length>3000||/[\u0000-\u0020\u007f\\]/.test(value))fail(400,'这篇文献没有可获取的公开全文地址。');
 let u;try{u=new URL(value);}catch{fail(400,'全文地址无效，请重新检索。');}
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||host.endsWith('.')||isIP(host)||/(^|\.)(localhost|local|internal|invalid|test|onion|lan|home|corp)$/.test(host))fail(400,'全文地址暂不支持直接获取。');
 for(const [key]of u.searchParams){const name=key.replace(/[_.-]/g,'').toLowerCase();if(/token|secret|password|signature|credential|authorization|accesskey|apikey|session|jwt|ticket|bearer|^x(amz|oss|goog)/.test(name)||['key','sig','policy','expires'].includes(name))fail(400,'此全文地址需要授权，请前往文献原页获取。');}
 u.hash='';return u;
}
export function literaturePDFLocation(row){
 let value=row?.fullTextUrl;if(!value)return '';
 try{
  const u=new URL(value);
  if(/^(?:export\.)?arxiv\.org$/.test(u.hostname)&&/^\/(?:pdf|abs)\/(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?$/i.test(u.pathname))return publicURL('https://arxiv.org'+u.pathname.replace(/^\/abs\//,'/pdf/')).href;
  return row.openAccess===true?publicURL(value).href:'';
 }catch{return '';}
}
function pdfLink(bytes,base){
 const tree=parse(bytes.toString('utf8'));let found='';
 const visit=node=>{if(found)return;const attrs=Object.fromEntries((node.attrs||[]).map(a=>[a.name,a.value]));if(node.tagName==='meta'&&/^(citation_pdf_url|wkhealth_pdf_url)$/i.test(attrs.name||'')&&attrs.content){try{found=publicURL(new URL(attrs.content,base).href).href;}catch{}}for(const child of node.childNodes||[])visit(child);};visit(tree);return found;
}

/** HTTPS only, DNS pinned per hop, no cookies/credentials, bounded redirects and bytes. */
export function createLiteraturePDFReader({lookupImpl=lookup,requestImpl=httpsRequest,timeoutMs=40000}={}){
 return async(value,{signal}={})=>{
  const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;let u=publicURL(value),htmlSeen=false;
  try{for(let hop=0;hop<5;hop++){
   let dnsAbort;let addresses;try{addresses=await Promise.race([lookupImpl(u.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{dnsAbort=()=>reject(Error('aborted'));if(combined.aborted)dnsAbort();else combined.addEventListener('abort',dnsAbort,{once:true});})]);}finally{if(dnsAbort)combined.removeEventListener('abort',dnsAbort);}
   if(!Array.isArray(addresses)||!addresses.length||addresses.length>64||addresses.some(a=>!publicIP(a?.address)||a.family!==isIP(a.address)))fail(422,'全文地址暂时无法安全连接，请前往文献原页获取。');
   const pinned=addresses[0];const result=await new Promise((resolve,reject)=>{
    let req,res,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;combined.removeEventListener('abort',abort);if(error){res?.destroy();req?.destroy();reject(error);}else resolve(value);};const abort=()=>finish(Error('aborted'));if(combined.aborted)return abort();combined.addEventListener('abort',abort,{once:true});
    req=requestImpl({protocol:'https:',hostname:u.hostname,port:443,path:u.pathname+u.search,servername:u.hostname,rejectUnauthorized:true,agent:false,autoSelectFamily:false,family:pinned.family,signal:combined,lookup:(_host,options,cb)=>options?.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family),headers:{Accept:'application/pdf, text/html;q=0.8','Accept-Encoding':'identity','User-Agent':'PaperKnow/1.0 (+https://paperknow.cn; contact@oneshowailab.com)'}},response=>{
     res=response;res.once('error',e=>finish(e));res.once('aborted',()=>finish(Error('aborted')));
     if([301,302,303,307,308].includes(res.statusCode)){finish(null,{redirect:res.headers.location});res.destroy();return;}
     if([401,402,403,407].includes(res.statusCode)){finish(Object.assign(Error('该文献需要访问授权，请前往原文页面获取后上传。'),{status:422,literatureDownloadSafe:true}));return;}
     if(res.statusCode===429){finish(Object.assign(Error('原文站点当前繁忙，请稍后再试。'),{status:429,literatureDownloadSafe:true}));return;}
     if(res.statusCode!==200){finish(Error('upstream'));return;}
     const type=String(res.headers['content-type']||''),isHTML=/^(?:text\/html|application\/xhtml\+xml)\b/i.test(type),limit=isHTML?512*1024:MAX;
     if(res.headers['content-encoding']&&!/^identity$/i.test(res.headers['content-encoding'])||Number(res.headers['content-length'])>limit){finish(Object.assign(Error('全文文件超过 20MB 或无法直接下载，请获取文件后上传。'),{status:413,literatureDownloadSafe:true}));return;}
     let length=0;const chunks=[];res.on('data',chunk=>{if(settled)return;length+=chunk.length;if(length>limit){finish(Object.assign(Error('全文文件超过可保存大小，请下载后拆分上传。'),{status:413,literatureDownloadSafe:true}));return;}chunks.push(Buffer.from(chunk));});res.once('end',()=>finish(null,{bytes:Buffer.concat(chunks,length),isHTML}));
    });req.once('error',e=>finish(e));req.end();
   });
   if(Object.hasOwn(result,'redirect')){if(typeof result.redirect!=='string')fail(422,'全文跳转无效，请前往原文页面获取。');u=publicURL(new URL(result.redirect,u).href);continue;}
   if(result.isHTML&&!htmlSeen){const link=pdfLink(result.bytes,u);if(link){htmlSeen=true;u=publicURL(link);continue;}}
   if(result.bytes?.subarray(0,5).toString()!=='%PDF-'||result.bytes.length<10)fail(422,'该链接未提供可直接保存的 PDF，请前往原文页面获取后上传。');
   return {bytes:result.bytes,url:u.href};
  }fail(422,'全文跳转较多，请前往原文页面获取后上传。');}
  catch(error){if(signal?.aborted)fail(499,'已取消获取全文。');if(timeout.aborted)fail(504,'获取全文超时，请稍后重试或前往原文页面下载。');if(error.literatureDownloadSafe)throw error;fail(502,'原文暂时无法获取，请稍后重试或前往文献原页下载。');}
 };
}

export function createLiteratureDownloadService({files,storage,db,signingKey,readPDF=createLiteraturePDFReader(),clock=Date.now}={}){
 const secret=typeof signingKey==='string'&&signingKey.length>=32?createHmac('sha256',signingKey).update('paperknow-literature-download-v1').digest():randomBytes(32),active=new Set(),rates=new Map(),writes=new Map();let activeCount=0;
 if(db)db.exec('CREATE TABLE IF NOT EXISTS literature_fulltext_files(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,source_hash TEXT NOT NULL,file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,source_hash))');
 const sign=payload=>createHmac('sha256',secret).update(payload).digest('base64url');
 function decorate(row){const url=literaturePDFLocation(row);if(!url)return {...row,downloadAvailable:false};const payload=Buffer.from(JSON.stringify({url,title:String(row.title||'文献').slice(0,250),expires:clock()+7*86400000})).toString('base64url');return {...row,downloadAvailable:true,downloadToken:payload+'.'+sign(payload)};}
 function verify(token){if(typeof token!=='string'||token.length>6000)fail(400,'请从检索结果选择文献全文。');const [payload,mac,...extra]=token.split('.'),expected=sign(payload||'');if(extra.length||!mac||!/^[A-Za-z0-9_-]{43}$/.test(mac)||mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))fail(400,'全文获取信息无效，请重新检索。');let row;try{row=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{fail(400,'全文获取信息无效。');}if(!Number.isSafeInteger(row.expires)||row.expires<=clock())fail(410,'这条全文链接已过期，请重新检索后获取。');return row;}
 async function save(input,user,{signal}={}){
  if(!user?.id)fail(401,'请先登录，再保存文献全文。');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['token','expectedUserId'].includes(k)))fail(400,'全文获取参数不正确。');
  if(input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后再保存全文。');
  if(storage?.provider!=='aliyun_oss')fail(503,'云端文件服务暂不可用，请稍后重试。');
  const item=verify(input.token),sourceHash=createHash('sha256').update(item.url).digest('hex'),key=user.id+':'+input.token;const cached=db?.prepare("SELECT f.id,f.name FROM literature_fulltext_files l JOIN files f ON f.id=l.file_id AND f.user_id=l.user_id WHERE l.user_id=? AND l.source_hash=? AND NOT EXISTS(SELECT 1 FROM workspace_file_deletions d WHERE d.file_id=f.id AND d.status='pending')").get(user.id,sourceHash);if(cached)return{id:cached.id,fileName:cached.name,ownerId:user.id,reused:true,downloadUrl:'/api/files/'+cached.id+'/download?expectedUserId='+encodeURIComponent(user.id)};if(active.has(key))fail(409,'这篇文献正在获取，请等待当前操作完成。');if(activeCount>=4||[...active].filter(k=>k.startsWith(user.id+':')).length>=2)fail(429,'当前正在获取文献，请稍后再试。');
  const now=clock();let rate=rates.get(user.id);if(!rate||rate.until<now)rate={until:now+3600000,count:0};if(rate.count>=30)fail(429,'全文获取较频繁，请稍后再试。');rate.count++;rates.delete(user.id);rates.set(user.id,rate);if(rates.size>5000)rates.delete(rates.keys().next().value);
  active.add(key);activeCount++;
  try{const result=await readPDF(item.url,{signal});if(signal?.aborted)fail(499,'已取消获取全文。');if(!Buffer.isBuffer(result.bytes)||result.bytes.length>MAX||result.bytes.subarray(0,5).toString()!=='%PDF-')fail(422,'取得的文件不是有效 PDF，未保存。');
   const name=item.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,170)+'.pdf';const sha=createHash('sha256').update(result.bytes).digest('hex'),writeKey=user.id+':'+sha;
   let saving=writes.get(writeKey);if(!saving){saving=(async()=>{const existing=db?.prepare("SELECT f.id FROM files f WHERE f.user_id=? AND f.sha256=? AND f.kind='pdf' AND f.project_id IS NULL AND NOT EXISTS(SELECT 1 FROM workspace_file_deletions d WHERE d.file_id=f.id AND d.status='pending') ORDER BY f.created_at LIMIT 1").get(user.id,sha);if(existing)return{value:{id:existing.id}};const handle=typeof files==='function'?files:files.handle.bind(files);return handle({path:'/api/files',method:'POST',user,readBody:async()=>({name,data:result.bytes.toString('base64'),expectedUserId:user.id})});})();writes.set(writeKey,saving);}
   let response;try{response=await saving;}finally{if(writes.get(writeKey)===saving)writes.delete(writeKey);}
   if(db)db.prepare('INSERT INTO literature_fulltext_files VALUES(?,?,?,?) ON CONFLICT(user_id,source_hash) DO UPDATE SET file_id=excluded.file_id,created_at=excluded.created_at').run(user.id,sourceHash,response.value.id,new Date(clock()).toISOString());
   return {...response.value,fileName:name,ownerId:user.id,downloadUrl:'/api/files/'+response.value.id+'/download?expectedUserId='+encodeURIComponent(user.id)};
  }finally{active.delete(key);activeCount--;}
 }
 return {decorate,save};
}
