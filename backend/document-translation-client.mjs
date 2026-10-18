import OpenAPI from '@alicloud/openapi-client';
import TeaUtil from '@alicloud/tea-util';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';

// alimt 2018-10-12: creation is POST, status is GET. Automatic SDK retries
// are disabled: ClientToken only protects a three-minute provider window.
const safe=(code,message,status=503)=>Object.assign(new Error(message),{code,status,documentTranslationSafe:true});
const unavailable=()=>safe('document_translation_unavailable','文档翻译服务暂不可用，请稍后查看任务');
const invalid=()=>safe('document_translation_invalid_response','文档翻译结果未通过安全校验，请联系支持');
const credential=v=>typeof v==='string'&&v.length>=8&&v.length<=256&&!/[\s\x00-\x1f\x7f]/.test(v);
const taskId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
const ossHost=host=>/^[a-z0-9][a-z0-9-]{1,62}\.oss-(?:[a-z]{2}-[a-z0-9-]+|accelerate)\.aliyuncs\.com$/.test(host);
export function checkedTranslationURL(value,{original=false}={}){
 if(typeof value!=='string'||value.length>12000)throw invalid();
 let url;try{url=new URL(value);}catch{throw invalid();}
 // Older responses may contain an HTTP OSS URL. Upgrade the fixed allowlisted
 // hostname to TLS; never make a plaintext request or follow a redirect.
 if(!original&&url.protocol==='http:'&&ossHost(url.hostname)&&!url.port)url.protocol='https:';
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||!ossHost(url.hostname)||isIP(url.hostname))throw invalid();
 return url;
}
function publicIP(address){
 if(isIP(address)===4){const [a,b,c]=address.split('.').map(Number);return a>0&&a<224&&![10,127].includes(a)&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&[0,168].includes(b))&&!(a===192&&b===2)&&!(a===198&&[18,19].includes(b))&&!(a===198&&b===51&&c===100)&&!(a===203&&b===0&&c===113);}
 if(isIP(address)!==6||address.includes('.'))return false;const first=parseInt(address.split(':')[0],16);return first>=0x2000&&first<=0x3fff&&!/^2001:(?:0:|db8:|0?10:|0?20:)/i.test(address)&&!/^2002:|^3fff:/i.test(address);
}
export function createDocumentTranslationClient(config={}, {client,lookupImpl=lookup,requestImpl=httpsRequest}={}){
 const region=config.documentTranslationRegion??'cn-hangzhou';
 if(!credential(config.documentTranslationAccessKeyId)||!credential(config.documentTranslationAccessKeySecret)||region!=='cn-hangzhou')throw safe('document_translation_not_configured','文档翻译服务暂未配置');
 const endpoint='mt.cn-hangzhou.aliyuncs.com';
 const transport=client||new OpenAPI.default(new OpenAPI.Config({accessKeyId:config.documentTranslationAccessKeyId,accessKeySecret:config.documentTranslationAccessKeySecret,endpoint,regionId:region,protocol:'HTTPS',type:'access_key',connectTimeout:5000,readTimeout:30000,httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*'}));
 let inFlight=0;
 async function call(action,fields,signal){
  if(signal?.aborted)throw safe('document_translation_cancelled','本次文档翻译已停止',499);
  if(inFlight>=2)throw safe('document_translation_busy','文档翻译服务繁忙，请稍后查看',429);
  const method=action==='CreateDocTranslateTask'?'POST':'GET';
  const params=new OpenAPI.Params({action,version:'2018-10-12',protocol:'HTTPS',pathname:'/',method,authType:'AK',style:'RPC',reqBodyType:'formData',bodyType:'json'});
  const request=new OpenAPI.OpenApiRequest(method==='POST'?{body:fields}:{query:fields});
  const runtime=new TeaUtil.RuntimeOptions({autoretry:false,maxAttempts:1,connectTimeout:5000,readTimeout:30000,ignoreSSL:false,httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*'});
  inFlight++;let pending,timer,abort;
  try{pending=Promise.resolve(transport.callApi(params,request,runtime)).finally(()=>inFlight--);}catch{inFlight--;throw unavailable();}
  try{
   const response=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(safe('document_translation_timeout','文档翻译连接超时，请稍后查看任务')),32000);}),new Promise((_,reject)=>{if(!signal)return;abort=()=>reject(safe('document_translation_cancelled','本次文档翻译已停止',499));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});})]);
   if(response?.statusCode!==200||!response.body||typeof response.body!=='object'||Array.isArray(response.body))throw invalid();
   return response.body;
  }catch(error){if(error?.documentTranslationSafe)throw error;const code=String(error?.code??'');if(/InvalidAccountStatus|Forbidden|AccessDenied|10009|10010|10013/.test(code))throw safe('document_translation_permission','文档翻译服务权限或额度暂不可用，请联系管理员');if(/Throttl|OVER.LIMIT|10029/.test(code))throw safe('document_translation_busy','文档翻译服务繁忙，请稍后查看',429);throw unavailable();}
  finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
 }
 return{
  async create({fileURL,sourceLanguage,targetLanguage,clientToken},signal){
   const url=checkedTranslationURL(fileURL,{original:true});
   if(!['zh','en'].includes(sourceLanguage)||!['zh','en'].includes(targetLanguage)||sourceLanguage===targetLanguage||!taskId(clientToken))throw safe('document_translation_input_invalid','请选择不同的原文和译文语言',400);
   const body=await call('CreateDocTranslateTask',{SourceLanguage:sourceLanguage,TargetLanguage:targetLanguage,FileUrl:url.href,Scene:'general',ClientToken:clientToken},signal);
   if(!taskId(body.TaskId)||!['ready','translating','translated'].includes(body.Status))throw invalid();
   return{taskId:body.TaskId,state:body.Status};
  },
  async poll(id,signal){
   if(!taskId(id))throw invalid();const body=await call('GetDocTranslateTask',{TaskId:id},signal);
   if(body.TaskId!==id||!['ready','translating','translated','error'].includes(body.Status))throw invalid();
   const pageCount=body.PageCount===undefined||body.PageCount===null?null:Number(body.PageCount);
   if(pageCount!==null&&(!Number.isSafeInteger(pageCount)||pageCount<0||pageCount>10000))throw invalid();
   return{state:body.Status,pageCount,...(body.Status==='translated'?{downloadURL:checkedTranslationURL(body.TranslateFileUrl).href}:{})};
  },
  async downloadResult(value,signal){
   const url=checkedTranslationURL(value),combined=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);let timer,abort;
   let addresses;
   try{addresses=await Promise.race([lookupImpl(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),5000);}),new Promise((_,reject)=>{abort=()=>reject(safe('document_translation_cancelled','本次文档翻译已停止',499));if(combined.aborted)abort();else combined.addEventListener('abort',abort,{once:true});})]);}catch(error){throw error.documentTranslationSafe?error:unavailable();}finally{clearTimeout(timer);if(abort)combined.removeEventListener('abort',abort);}
   if(!Array.isArray(addresses)||!addresses.length||addresses.some(x=>!publicIP(x?.address)))throw invalid();
   try{return await new Promise((resolve,reject)=>{
    const address=addresses[0],maximum=20*1024*1024;
    const req=requestImpl({protocol:'https:',hostname:url.hostname,port:443,path:url.pathname+url.search,method:'GET',servername:url.hostname,agent:false,signal:combined,headers:{Accept:'application/octet-stream'},lookup:(_h,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family||isIP(address.address))},res=>{
     if(res.statusCode!==200){res.resume?.();reject(unavailable());return;}
     const declared=res.headers?.['content-length'];if(declared&&/^\d+$/.test(declared)&&Number(declared)>maximum){res.destroy();reject(safe('document_translation_result_large','译文超过20MB，请分章节翻译'));return;}
     let length=0;const chunks=[];res.on('data',chunk=>{length+=chunk.length;if(length>maximum){res.destroy();req.destroy();reject(safe('document_translation_result_large','译文超过20MB，请分章节翻译'));return;}chunks.push(Buffer.from(chunk));});
     res.once('end',()=>{const bytes=Buffer.concat(chunks,length);bytes.length>=4&&bytes.subarray(0,2).equals(Buffer.from('PK'))?resolve(bytes):reject(invalid());});res.once('error',reject);res.once('aborted',()=>reject(unavailable()));
    });req.once('error',reject);req.end();
   });}catch(error){throw error.documentTranslationSafe?error:unavailable();}
  },
 };
}
