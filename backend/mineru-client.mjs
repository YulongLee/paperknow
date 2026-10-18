import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import JSZip from 'jszip';

const MiB=1024*1024;
const defaults=Object.freeze({timeoutMs:30000,dnsTimeoutMs:5000,maxApiBytes:256*1024,maxZipBytes:20*MiB,maxEntries:400,maxUncompressedBytes:40*MiB,maxEntryBytes:10*MiB,maxMarkdownBytes:2*MiB,maxJsonBytes:5*MiB,maxTextCharacters:200000});
const error=(code,message,status=502)=>Object.assign(new Error(message),{code,status,mineruSafe:true});
const reject=(code='mineru_response_invalid',message='文档解析服务返回了无效结果',status=502)=>{throw error(code,message,status);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const safePath=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/^[\/\\]|^[A-Za-z]:|[\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)&&!value.split('/').some(part=>part==='..'||part==='.')&&value.split('/').length<=16;

function publicIP(address){
 if(isIP(address)===4){
  const [a,b,c]=address.split('.').map(Number);
  return a>0&&a<224&&![10,127].includes(a)&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&[0,168].includes(b))&&!(a===192&&b===2)&&!(a===198&&[18,19].includes(b))&&!(a===198&&b===51&&c===100)&&!(a===203&&b===0&&c===113);
 }
 if(isIP(address)!==6||address.includes('.'))return false;
 const first=parseInt(address.split(':')[0],16);
 return first>=0x2000&&first<=0x3fff&&!/^2001:(?:0:|db8:|0?10:|0?20:)/i.test(address)&&!/^2002:|^3fff:/i.test(address);
}
function allowedURL(value,kind){
 if(typeof value!=='string'||value.length>12000)reject('mineru_url_invalid','文档解析服务地址不受支持');
 let url;try{url=new URL(value);}catch{reject('mineru_url_invalid','文档解析服务地址不受支持');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443')reject('mineru_url_invalid','文档解析服务地址不受支持');
 const oss=/^[a-z0-9][a-z0-9-]{1,62}\.oss-(?:cn-[a-z0-9-]+|ap-[a-z0-9-]+|us-[a-z0-9-]+|eu-[a-z0-9-]+|me-[a-z0-9-]+)\.aliyuncs\.com$/.test(url.hostname);
 if(kind==='api'?(url.hostname!=='mineru.net'||url.search||!url.pathname.startsWith('/api/v4/')):kind==='upload'?!oss:!(oss||url.hostname==='cdn-mineru.openxlab.org.cn'))reject('mineru_url_invalid','文档解析服务地址不在允许范围');
 return url;
}
function pageRanges(value){
 if(typeof value!=='string'||value.length>400||!/^\d{1,3}(?:-\d{1,3})?(?:,\d{1,3}(?:-\d{1,3})?)*$/.test(value))reject('mineru_input_invalid','请选择 1～100 页内的有效解析范围',400);
 const seen=new Set();for(const part of value.split(',')){const [from,to=from]=part.split('-').map(Number);if(from<1||to>100||to<from)reject('mineru_input_invalid','请选择 1～100 页内的有效解析范围',400);for(let i=from;i<=to;i++){if(seen.has(i))reject('mineru_input_invalid','解析页码范围不能重复',400);seen.add(i);}}
 return value;
}
async function boundedBody(response,maximum){
 const length=response.headers?.get?.('content-length');
 if(length!==null&&length!==undefined&&/^\d+$/.test(length)&&Number(length)>maximum){await response.body?.cancel?.().catch(()=>{});reject('mineru_response_too_large','文档解析结果超过安全大小限制');}
 const chunks=[];let size=0;
 if(!response.body)return Buffer.alloc(0);
 try{for await(const chunk of response.body){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>maximum)reject('mineru_response_too_large','文档解析结果超过安全大小限制');chunks.push(bytes);}}
 finally{if(size>maximum){try{await response.body?.cancel?.();}catch{}try{response.body?.destroy?.();}catch{}}}
 return Buffer.concat(chunks,size);
}
function httpFailure(status){
 if(status===401||status===403)reject('mineru_auth_failed','文档解析凭据或权限暂不可用，请联系管理员',503);
 if(status===429)reject('mineru_rate_limited','文档解析服务繁忙，请稍后重试',429);
 reject('mineru_unavailable','文档解析服务暂时不可用，请稍后重试');
}
function validateTree(root){
 let nodes=0;const stack=[[root,0]];
 while(stack.length){const [value,depth]=stack.pop();if(++nodes>200000||depth>40)reject('mineru_zip_invalid','文档解析结构超过安全限制');if(!value||typeof value!=='object')continue;for(const [key,child]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))reject('mineru_zip_invalid','文档解析结构包含不受支持的字段');stack.push([child,depth+1]);}}
}
function centralDirectory(buffer,limits){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0)reject('mineru_zip_invalid','文档解析压缩包无效');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
 if(buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||buffer.readUInt16LE(end+8)!==count||count===0||count>limits.maxEntries||size===0xffffffff||offset===0xffffffff||offset+size!==end)reject('mineru_zip_invalid','文档解析压缩包超限或不受支持');
 let cursor=offset,total=0;const names=new Set();
 for(let n=0;n<count;n++){
  if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50)reject('mineru_zip_invalid','文档解析压缩包目录无效');
  const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),uncompressed=buffer.readUInt32LE(cursor+24),nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),disk=buffer.readUInt16LE(cursor+34),mode=buffer.readUInt32LE(cursor+38)>>>16,local=buffer.readUInt32LE(cursor+42),next=cursor+46+nameLength+extra+comment;
  if(flags&1||![0,8].includes(method)||disk!==0||(mode&0o170000)===0o120000||next>end||local>=offset||compressed>limits.maxZipBytes||uncompressed>limits.maxEntryBytes||(total+=uncompressed)>limits.maxUncompressedBytes)reject('mineru_zip_invalid','文档解析压缩包超限或不受支持');
  const raw=buffer.subarray(cursor+46,cursor+46+nameLength),name=raw.toString('utf8'),key=name.normalize('NFC').toLowerCase().replace(/\/+$/,'');if(!safePath(name)||names.has(key))reject('mineru_zip_invalid','文档解析压缩包含有不安全路径或重复条目');names.add(key);cursor=next;
 }
 if(cursor!==end)reject('mineru_zip_invalid','文档解析压缩包目录无效');
 return count;
}
const plainMarkdown=value=>value.replace(/!\[[^\]]*\]\([^\n)]*\)/g,'').replace(/\[([^\]]+)\]\([^\n)]*\)/g,'$1').replace(/<\/?(?:table|thead|tbody|tfoot|tr|td|th|br|p|div|span|strong|em|sup|sub|img)\b[^<>]*>/gi,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\r/g,'').trim();
function structuredText(value){
 const parts=[],keys=new Set(['text','content','paragraph_content','title_content','caption','table_caption','table_body','html','equation_content','code_content','list_items','list_item_content']);
 const stack=[[value,'']];while(stack.length){const [item,key]=stack.pop();if(typeof item==='string'){if(keys.has(key))parts.push(item);continue;}if(!item||typeof item!=='object')continue;const entries=Array.isArray(item)?item.map(child=>[key,child]):Object.entries(item);for(let i=entries.length-1;i>=0;i--)stack.push([entries[i][1],entries[i][0]]);}
 return plainMarkdown(parts.join('\n'));
}

// fetchImpl is an explicitly trusted test transport. Production defaults to
// node:https with pinned public DNS, TLS SNI and no redirect following.
export function createMineruClient({token,baseURL='https://mineru.net/api/v4',fetchImpl,lookupImpl=lookup,requestImpl=httpsRequest,...overrides}={}){
 if(typeof token!=='string'||!token||token.length>16384||/[\x00-\x20\x7f]/.test(token))reject('mineru_configuration','文档解析服务尚未配置',503);
 if(baseURL!=='https://mineru.net/api/v4'&&baseURL!=='https://mineru.net/api/v4/')reject('mineru_configuration','文档解析接口配置不受支持',503);
 const base=baseURL.replace(/\/$/,''),limits={...defaults};
 for(const [key,value]of Object.entries(overrides)){if(!Object.hasOwn(defaults,key)||!Number.isSafeInteger(value)||value<1||value>defaults[key])reject('mineru_configuration','文档解析安全限制配置无效',503);limits[key]=value;}
 async function resolve(url,signal){
  let timer,abort;try{
   const addresses=await Promise.race([lookupImpl(url.hostname,{all:true,verbatim:true}),new Promise((_,rejectPromise)=>{timer=setTimeout(()=>rejectPromise(error('mineru_dns_failed','文档解析服务域名暂不可用')),limits.dnsTimeoutMs);}),new Promise((_,rejectPromise)=>{abort=()=>rejectPromise(error('mineru_cancelled','文档解析已取消',499));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});})]);
   if(!Array.isArray(addresses)||!addresses.length||addresses.some(row=>!row||!publicIP(row.address)))reject('mineru_dns_invalid','文档解析服务域名未通过安全检查');return addresses;
  }finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);}
 }
 async function request(value,kind,{method='GET',body}={},externalSignal,maximum=limits.maxApiBytes){
  const url=allowedURL(value,kind),timerSignal=AbortSignal.timeout(limits.timeoutMs),signal=externalSignal?AbortSignal.any([externalSignal,timerSignal]):timerSignal;
  try{
   if(signal.aborted)throw error('mineru_cancelled','文档解析已取消',499);
   const addresses=await resolve(url,signal),headers={...(kind==='api'?{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})}:{}),...(body?{'Content-Length':String(Buffer.byteLength(body))}:{})};
   if(fetchImpl){
    const response=await fetchImpl(url.href,{method,headers,body,redirect:'error',signal});if(!Number.isInteger(response?.status)||response.status<200||response.status>=300){try{await response?.body?.cancel?.();}catch{}httpFailure(response?.status);}
    return {bytes:await boundedBody(response,maximum),contentType:response.headers?.get?.('content-type')||''};
   }
   return await new Promise((resolvePromise,rejectPromise)=>{
    const address=addresses[0];let response;
    const request=requestImpl({protocol:'https:',hostname:url.hostname,port:443,path:url.pathname+url.search,method,servername:url.hostname,agent:false,headers,signal,lookup:(_host,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family||isIP(address.address))},res=>{
     response=res;
     if(res.statusCode<200||res.statusCode>=300){res.resume?.();try{httpFailure(res.statusCode);}catch(err){rejectPromise(err);}return;}
     const contentLength=res.headers?.['content-length'];if(contentLength&&/^\d+$/.test(contentLength)&&Number(contentLength)>maximum){res.destroy();rejectPromise(error('mineru_response_too_large','文档解析结果超过安全大小限制'));return;}
     const chunks=[];let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>maximum){res.destroy();request.destroy();rejectPromise(error('mineru_response_too_large','文档解析结果超过安全大小限制'));return;}chunks.push(Buffer.from(chunk));});
     res.once('end',()=>resolvePromise({bytes:Buffer.concat(chunks,length),contentType:res.headers?.['content-type']||''}));res.once('error',rejectPromise);res.once('aborted',()=>rejectPromise(error('mineru_transport_failed','文档解析连接未完成')));
    });
    request.once('error',rejectPromise);request.once('close',()=>{if(signal.aborted)response?.destroy();});request.end(body);
   });
  }catch(err){
   if(externalSignal?.aborted)throw error('mineru_cancelled','文档解析已取消',499);
   if(timerSignal.aborted)throw error('mineru_timeout','文档解析服务响应超时，请稍后查询',504);
   if(err?.mineruSafe)throw err;
   throw error('mineru_transport_failed','文档解析服务暂时无法连接，请稍后查询');
  }
 }
 async function api(path,body,signal){
  const response=await request(base+path,'api',body?{method:'POST',body:JSON.stringify(body)}:{},signal);
  if(!/\bjson\b/i.test(response.contentType))reject();let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bytes));}catch{reject();}
  if(!plain(data)||data.code!==0)reject('mineru_business_error','文档解析服务未接受本次操作，请联系支持核对');
  if(!plain(data.data))reject();return data.data;
 }
 async function createUpload({name,dataId,pageRanges:range='1-100'}={},signal){
  if(typeof name!=='string'||name.length>200||!name.toLowerCase().endsWith('.pdf')||/[\/\\\u0000-\u001f\u007f]/.test(name)||!id(dataId))reject('mineru_input_invalid','请提供有效的 PDF 文件名和资料编号',400);
  const data=await api('/file-urls/batch',{files:[{name,data_id:dataId,is_ocr:true,page_ranges:pageRanges(range)}],model_version:'vlm',language:'ch',enable_formula:true,enable_table:true},signal);
  if(!id(data.batch_id)||!Array.isArray(data.file_urls)||data.file_urls.length!==1)reject();allowedURL(data.file_urls[0],'upload');return {batchId:data.batch_id,uploadURL:data.file_urls[0]};
 }
 async function upload(uploadURL,buffer,signal){
  if(!Buffer.isBuffer(buffer)||buffer.length<5||buffer.length>20*MiB||buffer.subarray(0,5).toString()!=='%PDF-')reject('mineru_input_invalid','请选择不超过 20MB 的有效 PDF 文件',400);
  await request(uploadURL,'upload',{method:'PUT',body:buffer},signal,limits.maxApiBytes);
 }
 async function poll(batchId,signal,{dataId}={}){
  if(!id(batchId)||dataId!==undefined&&!id(dataId))reject('mineru_input_invalid','文档解析任务编号或资料编号无效',400);
  const data=await api('/extract-results/batch/'+encodeURIComponent(batchId),undefined,signal),rows=data.extract_result;
  if(!Array.isArray(rows)||rows.length!==1||!plain(rows[0]))reject();const row=rows[0],state=row.state;
  if(dataId!==undefined&&row.data_id!==dataId)reject('mineru_response_mismatch','文档解析结果与提交的资料不一致');
  if(row.data_id!==undefined&&!id(row.data_id))reject();const identity=row.data_id?{providerDataId:row.data_id}:{};
  if(!['waiting-file','pending','running','converting','done','failed'].includes(state))reject();
  const progress={extractedPages:null,totalPages:null};for(const [key,source]of [['extractedPages','extracted_pages'],['totalPages','total_pages']])if(row.extract_progress?.[source]!==undefined){const count=row.extract_progress[source];if(!Number.isSafeInteger(count)||count<0||count>100)reject('mineru_page_limit','文档解析页数超出支持范围');progress[key]=count;}
  if(progress.extractedPages!==null&&progress.totalPages!==null&&progress.extractedPages>progress.totalPages)reject();
  if(state==='done'){allowedURL(row.full_zip_url,'result');return {state,progress,zipURL:row.full_zip_url,...identity};}
  return {state,progress,zipURL:null,...identity,...(state==='failed'?{errCode:'mineru_parse_failed'}:{})};
 }
 async function downloadResult(zipURL,signal){
  const {bytes:rawZip}=await request(zipURL,'result',{},signal,limits.maxZipBytes),entryCount=centralDirectory(rawZip,limits);
  let zip;try{zip=await JSZip.loadAsync(rawZip,{checkCRC32:false,createFolders:false});}catch{reject('mineru_zip_invalid','文档解析压缩包无效');}
  const entries=Object.values(zip.files);if(entries.length!==entryCount||entries.length>limits.maxEntries)reject('mineru_zip_invalid','文档解析压缩包条目数量不一致');
  let inflated=0,markdown,contentList,layout;const jsonFiles=[];
  for(const entry of entries){
   if(!safePath(entry.name)||entry.unsafeOriginalName&&!safePath(entry.unsafeOriginalName)||typeof entry.unixPermissions==='number'&&(entry.unixPermissions&0o170000)===0o120000)reject('mineru_zip_invalid','文档解析压缩包含有不安全路径或链接');
   if(entry.dir)continue;
   const declared=entry._data?.uncompressedSize,isMd=/(?:^|\/)(?:full|markdown)\.md$/i.test(entry.name),isJson=/\.json$/i.test(entry.name),maximum=isMd?limits.maxMarkdownBytes:isJson?limits.maxJsonBytes:limits.maxEntryBytes;
   if(!Number.isSafeInteger(declared)||declared<0||declared>maximum)reject('mineru_zip_invalid','文档解析文件超过安全大小限制');
   const parts=[];let length=0;const source=entry.nodeStream('nodebuffer'),stream=Readable.wrap(source);
   try{for await(const chunk of stream){if(signal?.aborted)throw error('mineru_cancelled','文档解析已取消',499);length+=chunk.length;inflated+=chunk.length;if(length>maximum||inflated>limits.maxUncompressedBytes)reject('mineru_zip_invalid','文档解析解压内容超过安全限制');if(isMd||isJson)parts.push(Buffer.from(chunk));}}catch(err){if(err?.mineruSafe)throw err;reject('mineru_zip_invalid','文档解析压缩包无法完整读取');}finally{source.pause();source._helper?.pause();stream.destroy();source.destroy();}
   if(length!==declared)reject('mineru_zip_invalid','文档解析压缩包长度不一致');
   if(isMd||isJson){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,length));}catch{reject('mineru_zip_invalid','文档解析内容编码无效');}if(isMd){if(markdown!==undefined)reject('mineru_zip_invalid','文档解析包含重复正文');markdown=text;}else{let value;try{value=JSON.parse(text);}catch{reject('mineru_zip_invalid','文档解析结构不是有效 JSON');}validateTree(value);jsonFiles.push({name:entry.name,value});}}
  }
  const content=jsonFiles.find(row=>/(?:^|\/)[^/]*content_list\.json$/i.test(row.name)),contentV2=jsonFiles.find(row=>/(?:^|\/)[^/]*content_list_v2\.json$/i.test(row.name));
  if(content){if(!Array.isArray(content.value))reject('mineru_zip_invalid','文档解析段落列表无效');contentList=content.value;}
  // Model detector output is not the semantic layout contract. Only return
  // explicitly named layout/middle documents, never *_model.json.
  layout=jsonFiles.find(row=>/(?:^|\/)(?:[^/]*_)?(?:layout|middle|middle_json)\.json$/i.test(row.name))?.value;
  const pageTexts=new Map();const addPage=(index,text='')=>{if(!Number.isSafeInteger(index)||index<0||index>=100)reject('mineru_page_limit','文档解析页数超出支持范围');if(!pageTexts.has(index))pageTexts.set(index,[]);if(text)pageTexts.get(index).push(text);};
  if(contentV2){
   if(!Array.isArray(contentV2.value))reject('mineru_zip_invalid','文档解析新版段落列表无效');
   const normalized=[];
   if(contentV2.value.every(Array.isArray)){
    if(contentV2.value.length>100)reject('mineru_page_limit','文档解析页数超出支持范围');
    contentV2.value.forEach((rows,index)=>{addPage(index);for(const row of rows){if(!plain(row)||row.page_idx!==undefined&&row.page_idx!==index)reject('mineru_zip_invalid','文档解析新版段落页码无效');normalized.push({...row,page_idx:index,text:structuredText(row.content??row)});}});
   }else{
    for(const row of contentV2.value){if(!plain(row)||!Number.isSafeInteger(row.page_idx))reject('mineru_zip_invalid','文档解析新版段落缺少有效页码');addPage(row.page_idx);normalized.push({...row,text:structuredText(row.content??row)});}
   }
   if(!contentList)contentList=normalized;
  }
  for(const row of contentList||[]){if(!plain(row)||!Number.isSafeInteger(row.page_idx))reject('mineru_zip_invalid','文档解析段落缺少有效页码');const parts=[];for(const key of ['text','table_body','table_caption','table_footnote','image_caption','image_footnote']){const value=row[key];if(typeof value==='string')parts.push(value);else if(Array.isArray(value)&&value.every(s=>typeof s==='string'))parts.push(...value);}addPage(row.page_idx,plainMarkdown(parts.join('\n')));}
  const stack=layout?[layout]:[];while(stack.length){const value=stack.pop();if(!value||typeof value!=='object')continue;if(Number.isSafeInteger(value.page_idx))addPage(value.page_idx);if(Array.isArray(value.pdf_info)){if(value.pdf_info.length>100)reject('mineru_page_limit','文档解析页数超出支持范围');value.pdf_info.forEach((row,index)=>addPage(row?.page_idx??index));}for(const child of Object.values(value))if(child&&typeof child==='object')stack.push(child);}
  if(typeof markdown!=='string'||!markdown.trim()||!pageTexts.size)reject('mineru_zip_invalid','文档解析缺少正文或可核对的页码');
  const indices=[...pageTexts.keys()].sort((a,b)=>a-b);if(indices.some((index,position)=>index!==position))reject('mineru_zip_invalid','文档解析页码不完整，未采用缺页结果');
  const text=plainMarkdown(markdown);if(!text||text.length>limits.maxTextCharacters)reject('mineru_text_limit','文档解析正文为空或超出字符限制');
  const pages=[...pageTexts].sort(([a],[b])=>a-b).map(([pageIndex,parts])=>({pageIndex,text:parts.join('\n\n')}));
  return {text,markdown,pages,pageCount:pages.length,...(contentList?{contentList}:{}),...(layout?{layout}:{}),rawZip};
 }
 return {createUpload,upload,poll,downloadResult};
}
