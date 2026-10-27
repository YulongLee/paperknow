import {paragraphAigcParts,MAX_AIGC_PARAGRAPHS} from '../dist/reports/aigc-partitions.mjs';
import {randomUUID} from 'node:crypto';
import OpenAPI from '@alicloud/openapi-client';
import TeaUtil from '@alicloud/tea-util';

// Official Green 2022-03-02 / TextModerationPlus / text_aigc_detector.
// https://help.aliyun.com/zh/document_detail/2684669.html
// This adapter is independent of input/output safety moderation. Neither its
// verdict nor RiskLevel may grant permission to publish otherwise unsafe text.
const endpoints=Object.freeze({
 'green-cip.cn-shanghai.aliyuncs.com':'cn-shanghai',
 'green-cip.cn-beijing.aliyuncs.com':'cn-beijing',
 'green-cip.cn-hangzhou.aliyuncs.com':'cn-hangzhou',
 'green-cip.cn-shenzhen.aliyuncs.com':'cn-shenzhen',
 'green-cip.cn-chengdu.aliyuncs.com':'cn-chengdu',
});
export const aigcDetectionDefaults=Object.freeze({maxCharacters:50000,maxPartCharacters:5000,userDailyLimit:10,userDailyCharacters:100000,globalDailyCalls:200,globalDailyBillingUnits:1000,maxConcurrent:2,timeoutMs:15000,totalTimeoutMs:300000,maxParagraphs:MAX_AIGC_PARAGRAPHS});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const aigcDetectionError=(code,status,message)=>Object.assign(new Error(message),{code,status,aigcDetectionSafe:true});
const unavailable=()=>aigcDetectionError('aigc_detection_unavailable',503,'文本鉴别暂未完成，已保留处理记录，不会自动重复提交。');
const invalid=()=>aigcDetectionError('aigc_detection_input_invalid',400,'请输入有效文本后再提交鉴别。');
const credential=value=>typeof value==='string'&&value.length>=8&&value.length<=256&&!/[\s\x00-\x1f\x7f]/.test(value);
function endpointFor(config){
 const value=config.moderationEndpoint??'green-cip.cn-shanghai.aliyuncs.com';
 if(typeof value!=='string'||value.length>200)return null;
 const host=value.startsWith('https://')?value.slice(8):value;
 return Object.hasOwn(endpoints,host)&&(config.moderationRegion===undefined||config.moderationRegion===endpoints[host])?host:null;
}
export function aigcDetectionLimits(config={}){
 const limits={};
 for(const [name,ceiling]of Object.entries(aigcDetectionDefaults)){
  const key='aigcDetection'+name[0].toUpperCase()+name.slice(1),value=config[key]??ceiling;
  if(!Number.isSafeInteger(value)||value<1||value>ceiling)return null;
  limits[name]=value;
 }
 return limits;
}
export const aigcDetectionConfigured=(config={})=>Boolean(config.aigcDetectionEnabled===true&&credential(config.moderationAccessKeyId)&&credential(config.moderationAccessKeySecret)&&endpointFor(config)&&aigcDetectionLimits(config));

// No normalization, truncation, HTML stripping or trimming: offsets refer to
// exactly what the user submitted. UTF-16 units also stay <=5000 per request,
// a conservative bound for providers counting astral symbols differently.
export function prepareAigcText(text,limits=aigcDetectionDefaults){
 if(typeof text!=='string'||!text.trim()||text.length>limits.maxCharacters*2)throw invalid();
 let characters=0;
 for(const character of text){const code=character.charCodeAt(0);if(character.length===1&&code>=0xd800&&code<=0xdfff||code===0)throw invalid();characters++;if(characters>limits.maxCharacters)throw aigcDetectionError('aigc_detection_limit',413,'本次文本超过鉴别字数上限，请分段后提交。');if(character.length>limits.maxPartCharacters)throw invalid();}
 let partition;try{partition=paragraphAigcParts(text,limits.maxPartCharacters,limits.maxParagraphs??MAX_AIGC_PARAGRAPHS);}catch(error){if(error.status===400)throw invalid();throw aigcDetectionError('aigc_detection_limit',413,error.message);}
 const {parts}=partition;
 // Empty/whitespace-only segments carry no authorship evidence and incur no
 // paid call. They remain explicit undetermined segments in the final report.
 const calls=parts.filter(part=>part.effectiveCharacters>0).length;
 const billingUnits=parts.reduce((total,part)=>total+(part.effectiveCharacters>0?Math.ceil(part.content.length/1000):0),0);
 if(!calls)throw invalid();
 return{characters,parts,calls,billingUnits,paragraphs:partition.paragraphs};
}
const safeRequestId=value=>typeof value==='string'&&/^[-A-Za-z0-9_.]{1,150}$/.test(value)?value:null;
export function normalizeAigcResponse(response,{expectedDataId}={}){
 const requestId=safeRequestId(response?.body?.RequestId);
 const failed=(status=503)=>Object.assign(unavailable(),{status},requestId?{aigcRequestId:requestId}:{});
 if(!plain(response)||response.statusCode!==200||!plain(response.body)||response.body.Code!==200||!plain(response.body.Data))throw failed();
 // DataId is documented as optional. If returned, it must bind the response
 // to this exact partition rather than being silently applied to another text.
 if(expectedDataId!==undefined&&response.body.Data.DataId!==undefined&&response.body.Data.DataId!==expectedDataId)throw failed();
 const rows=response.body.Data.Result;
 if(!Array.isArray(rows)||rows.length!==1||!plain(rows[0]))throw failed(502);
 const row=rows[0];
 // The official schema explicitly allows nonLabel without a confidence field.
 // Keep that inconclusive result distinct from a malformed/empty response;
 // neither may become a human-authorship verdict or a charged full delivery.
 if(row.Label==='nonLabel'&&row.Confidence===undefined)return{label:'undetermined',confidence:null,requestId};
 if(!['aigc','ugc'].includes(row.Label)||typeof row.Confidence!=='number'||!Number.isFinite(row.Confidence)||row.Confidence<0||row.Confidence>100)throw failed(502);
 return{label:row.Label,confidence:row.Confidence,requestId};
}
export function createAigcDetectionClient(config={}, {client}={}){
 config={...config};const limits=aigcDetectionLimits(config),endpoint=endpointFor(config);
 const ready=aigcDetectionConfigured(config)&&(client===undefined||typeof client?.callApi==='function');
 let transport=client,inFlight=0;
 const getClient=()=>transport ||= new OpenAPI.default(new OpenAPI.Config({accessKeyId:config.moderationAccessKeyId,accessKeySecret:config.moderationAccessKeySecret,endpoint,regionId:endpoints[endpoint],protocol:'HTTPS',type:'access_key',connectTimeout:Math.min(limits.timeoutMs,5000),readTimeout:limits.timeoutMs,httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*'}));
 return{ready,async detect(content,{remainingMs=limits?.timeoutMs,dataId='pk-'+randomUUID()}={}){
  if(!ready)throw aigcDetectionError('aigc_detection_not_configured',503,'文本鉴别暂未开放，请稍后再试。');
  if(typeof content!=='string'||!content.trim()||content.length>limits.maxPartCharacters||!/^[-A-Za-z0-9_.]{1,64}$/.test(dataId))throw invalid();
  if(!Number.isSafeInteger(remainingMs)||remainingMs<1)throw aigcDetectionError('aigc_detection_timeout',504,'本次文本鉴别暂未完成，已保留记录，不会自动重复提交。');
  if(inFlight>=limits.maxConcurrent)throw aigcDetectionError('aigc_detection_busy',429,'文本鉴别当前繁忙，请稍后再试。');
  inFlight++;const timeout=Math.min(remainingMs,limits.timeoutMs);
  const params=new OpenAPI.Params({action:'TextModerationPlus',version:'2022-03-02',protocol:'HTTPS',pathname:'/',method:'POST',authType:'AK',style:'RPC',reqBodyType:'formData',bodyType:'json'});
  const request=new OpenAPI.OpenApiRequest({body:{Service:'text_aigc_detector',ServiceParameters:JSON.stringify({content,dataId})}});
  const runtime=new TeaUtil.RuntimeOptions({autoretry:false,maxAttempts:1,connectTimeout:Math.min(timeout,5000),readTimeout:timeout,ignoreSSL:false,httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*'});
  let pending;try{pending=Promise.resolve(getClient().callApi(params,request,runtime));}catch{inFlight--;throw unavailable();}
  let timer;
  try{return normalizeAigcResponse(await Promise.race([pending.finally(()=>{inFlight--;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(aigcDetectionError('aigc_detection_timeout',504,'本次文本鉴别暂未完成，已保留记录，不会自动重复提交。')),timeout);})]),{expectedDataId:dataId});}
  catch(error){if(error?.aigcDetectionSafe)throw error;const safe=unavailable(),requestId=safeRequestId(error?.requestId);if(requestId)safe.aigcRequestId=requestId;throw safe;}
  finally{clearTimeout(timer);}
 }};
}
