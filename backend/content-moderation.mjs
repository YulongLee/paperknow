import {randomUUID} from 'node:crypto';
import OpenAPI from '@alicloud/openapi-client';
import TeaUtil from '@alicloud/tea-util';

// Official contract: Green 2022-03-02 / TextModerationPlus (RPC POST).
// https://help.aliyun.com/zh/document_detail/2671445.html
// Only explicit moderation credentials are accepted. A model key, SMS key or
// process-wide credential chain must never silently enable this service.
const endpoints=Object.freeze({
 'green-cip.cn-shanghai.aliyuncs.com':'cn-shanghai',
 'green-cip.cn-beijing.aliyuncs.com':'cn-beijing',
 'green-cip.cn-hangzhou.aliyuncs.com':'cn-hangzhou',
 'green-cip.cn-shenzhen.aliyuncs.com':'cn-shenzhen',
 'green-cip.cn-chengdu.aliyuncs.com':'cn-chengdu',
});
const defaults=Object.freeze({maxCharacters:200000,maxCalls:100,timeoutMs:10000,totalTimeoutMs:60000,maxConcurrent:2});
const scenes=Object.freeze({input:{service:'llm_query_moderation',characters:2000},output:{service:'llm_response_moderation',characters:5000}});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeError=(code,status,message)=>Object.assign(new Error(message),{code,status,moderationSafe:true});
const invalid=()=>safeError('moderation_input_invalid',400,'安全审核内容或参数无效，请核对后重试');
const unavailable=()=>safeError('moderation_unavailable',503,'安全审核服务暂不可用，请稍后重试');
const cancelled=()=>safeError('moderation_cancelled',499,'本次安全审核已取消');
const timedOut=()=>safeError('moderation_timeout',504,'安全审核暂未完成，请稍后重试');
const credential=value=>typeof value==='string'&&value.length>=8&&value.length<=256&&!/[\s\x00-\x1f\x7f]/.test(value);

function endpointFor(config){
 const value=config.moderationEndpoint??'green-cip.cn-shanghai.aliyuncs.com';
 if(typeof value!=='string'||value.length>200)return null;
 const host=value.startsWith('https://')?value.slice(8):value;
 if(!Object.hasOwn(endpoints,host)||config.moderationRegion!==undefined&&config.moderationRegion!==endpoints[host])return null;
 return host;
}
function limitsFor(config){
 const result={};
 for(const [name,maximum] of Object.entries(defaults)){
  const key='moderation'+name[0].toUpperCase()+name.slice(1),value=config[key]??maximum;
  // Operators can tighten the hard ceilings; they cannot accidentally remove
  // them by using zero, Infinity, NaN or an overly large configuration value.
  if(!Number.isSafeInteger(value)||value<1||value>maximum)return null;
  result[name]=value;
 }
 return result;
}
function checkedParts(text,scene,limits){
 if(typeof text!=='string'||!text.trim())throw invalid();
 if(text.length>limits.maxCharacters*2)throw safeError('moderation_limit',413,'本次内容超过安全审核处理上限，请分段后重试');
 const characters=[];
 for(const character of text){
  const code=character.charCodeAt(0);
  if(character.length===1&&code>=0xd800&&code<=0xdfff||code===0)throw invalid();
  characters.push(character);
  if(characters.length>limits.maxCharacters)throw safeError('moderation_limit',413,'本次内容超过安全审核处理上限，请分段后重试');
 }
 // Check every code point without truncation. At the 200,000-character hard
 // ceiling this is at most 100 input calls or 40 output calls. Preflight the
 // entire call count before any paid request.
 const parts=[];
 for(let start=0;start<characters.length;start+=scene.characters){
  const end=Math.min(start+scene.characters,characters.length),part=characters.slice(start,end).join('');
  if(part.trim())parts.push(part);
  if(parts.length>limits.maxCalls)throw safeError('moderation_limit',413,'本次内容超过安全审核处理上限，请分段后重试');
 }
 return parts;
}
function decision(response){
 // callApi returns the unmodified, capitalized OpenAPI JSON inside body. Do not
 // accept legacy Suggestion/pass schemas or a truthy HTTP-only success as pass.
 if(!plain(response)||response.statusCode!==200||!plain(response.body)||response.body.Code!==200||!plain(response.body.Data))throw unavailable();
 const data=response.body.Data;
 if(['high','medium','low'].includes(data.RiskLevel))return false;
 if(data.RiskLevel!=='none'||!Array.isArray(data.Result)||data.Result.length===0||data.Result.length>200)throw unavailable();
 if(data.Result.some(row=>!plain(row)||row.Label!=='nonLabel'))throw unavailable();
 // An alternative response is provider intervention, not permission to publish
 // the original text. It must not silently override a passing-looking label.
 if(data.Advice!==undefined&&(!Array.isArray(data.Advice)||data.Advice.length>0))return false;
 return true;
}

export function createContentModeration(config={}, {client}={}){
 config={...config};
 const endpoint=endpointFor(config),limits=limitsFor(config);
 const ready=config.moderationEnabled===true&&credential(config.moderationAccessKeyId)&&credential(config.moderationAccessKeySecret)&&Boolean(endpoint&&limits)&&(client===undefined||typeof client?.callApi==='function');
 let transport=client,inFlight=0;
 function getClient(){
  transport ||= new OpenAPI.default(new OpenAPI.Config({
   accessKeyId:config.moderationAccessKeyId,accessKeySecret:config.moderationAccessKeySecret,
   endpoint,regionId:endpoints[endpoint],protocol:'HTTPS',type:'access_key',
   connectTimeout:Math.min(limits.timeoutMs,5000),readTimeout:limits.timeoutMs,
   httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*',
  }));
  return transport;
 }
 async function call(content,scene,{signal,remaining}){
  if(signal?.aborted)throw cancelled();
  if(inFlight>=limits.maxConcurrent)throw safeError('moderation_busy',429,'安全审核当前繁忙，请稍后重试');
  inFlight++;
  const params=new OpenAPI.Params({action:'TextModerationPlus',version:'2022-03-02',protocol:'HTTPS',pathname:'/',method:'POST',authType:'AK',style:'RPC',reqBodyType:'formData',bodyType:'json'});
  const request=new OpenAPI.OpenApiRequest({body:{Service:scene.service,ServiceParameters:JSON.stringify({content,dataId:'pk-'+randomUUID()})}});
  const timeout=Math.max(1,Math.min(limits.timeoutMs,remaining));
  const runtime=new TeaUtil.RuntimeOptions({autoretry:false,maxAttempts:1,connectTimeout:Math.min(timeout,5000),readTimeout:timeout,ignoreSSL:false,httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*'});
  let pending;
  try{pending=Promise.resolve(getClient().callApi(params,request,runtime));}catch{inFlight--;throw unavailable();}
  // The installed generic SDK has no AbortSignal transport hook. Stop waiting
  // immediately on cancellation and never start another part; retain the slot
  // until the bounded SDK request actually settles so cancelled callers cannot
  // create an unbounded backlog of still-running upstream requests.
  const settled=pending.finally(()=>{inFlight--;});
  let timer,abort;
  try{
   return await Promise.race([settled,new Promise((_,reject)=>{timer=setTimeout(()=>reject(timedOut()),timeout);}),new Promise((_,reject)=>{
    if(!signal)return;
    abort=()=>reject(cancelled());
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
   })]);
  }catch(error){
   if(signal?.aborted)throw cancelled();
   if(error?.moderationSafe)throw error;
   throw unavailable();
  }finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);}
 }
 return {ready,async checkText(text,options={}){
  if(!ready)throw safeError('moderation_not_configured',503,'安全审核服务暂未就绪，请稍后重试');
  if(!plain(options))throw invalid();
  const {kind='input',signal}=options;
  if(!Object.hasOwn(scenes,kind)||signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw invalid();
  if(signal?.aborted)throw cancelled();
  const scene=scenes[kind],parts=checkedParts(text,scene,limits),started=Date.now();
  for(const part of parts){
   if(signal?.aborted)throw cancelled();
   const remaining=limits.totalTimeoutMs-(Date.now()-started);if(remaining<=0)throw timedOut();
   const response=await call(part,scene,{signal,remaining});
   if(signal?.aborted)throw cancelled();
   if(Date.now()-started>=limits.totalTimeoutMs)throw timedOut();
   if(!decision(response))return {allowed:false,code:'content_rejected'};
  }
  return {allowed:true};
 }};
}
