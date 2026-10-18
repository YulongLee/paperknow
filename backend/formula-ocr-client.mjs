import {Readable} from 'node:stream';
import OpenAPI from '@alicloud/openapi-client';
import TeaUtil from '@alicloud/tea-util';
import {formulaSvgMarkup} from '../src/research-formula-core.js';

// Official binary-body contract, not a model or an arbitrary image URL proxy:
// https://help.aliyun.com/zh/ocr/developer-reference/api-ocr-api-2021-07-07-recognizeeduformula
export const formulaOcrLimits=Object.freeze({maxFileBytes:2*1024*1024,maxDimension:1000,maxCharacters:2000,userDaily:20,globalDaily:200,maxConcurrent:2,timeoutMs:25000});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const formulaOcrError=(code,status,message)=>Object.assign(new Error(message),{code,status,formulaOcrSafe:true});
const invalid=()=>formulaOcrError('formula_image_invalid',400,'请上传清晰的 PNG、JPEG 或 WebP 公式图片，单张不超过 2MB、长宽不超过 1000 像素');
const unavailable=()=>formulaOcrError('formula_ocr_unavailable',503,'公式识别服务暂不可用，请稍后查看或联系支持');
const providerFailure=code=>typeof code==='string'&&/nopermission|forbidden|accessdenied|notopened|notactivate|invalidaccesskey|unauthorized/i.test(code)?formulaOcrError('formula_ocr_permission',503,'公式识别服务权限暂不可用，请联系管理员核验服务开通与授权'):typeof code==='string'&&/throttl|quota|limitexceed/i.test(code)?formulaOcrError('formula_ocr_busy',429,'公式识别服务额度或并发暂不可用，请稍后再试'):unavailable();
const credential=value=>typeof value==='string'&&value.length>=8&&value.length<=256&&!/[\s\x00-\x1f\x7f]/.test(value);
const crcTable=Uint32Array.from({length:256},(_,i)=>{let value=i;for(let j=0;j<8;j++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;};

export function validateFormulaImage(bytes,mime){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>formulaOcrLimits.maxFileBytes)throw invalid();
 let width,height;
 if(mime==='image/png'){
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw invalid();
  let at=8,seenHeader=false,seenData=false,ended=false;
  while(at+12<=bytes.length){
   const size=bytes.readUInt32BE(at);if(size>bytes.length-at-12)throw invalid();
   const type=bytes.toString('ascii',at+4,at+8),end=at+12+size;
   if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(at+4,at+8+size))!==bytes.readUInt32BE(at+8+size))throw invalid();
   if(!seenHeader){if(type!=='IHDR'||size!==13)throw invalid();width=bytes.readUInt32BE(at+8);height=bytes.readUInt32BE(at+12);seenHeader=true;}
   else if(type==='IHDR'||type==='acTL')throw invalid();
   if(type==='IDAT'){if(!size)throw invalid();seenData=true;}
   if(type==='IEND'){if(size||!seenData||end!==bytes.length)throw invalid();ended=true;break;}
   at=end;
  }
  if(!ended)throw invalid();
 }else if(mime==='image/jpeg'){
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw invalid();
  let at=2,scan=false;
  while(at<bytes.length-2){
   if(bytes[at++]!==255)throw invalid();while(bytes[at]===255)at++;const marker=bytes[at++];
   if(marker===217)break;if(marker===216||marker===0)throw invalid();
   if(marker===1||marker>=208&&marker<=215)continue;
   if(at+2>bytes.length)throw invalid();const size=bytes.readUInt16BE(at);if(size<2||at+size>bytes.length)throw invalid();
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(size<8||width!==undefined)throw invalid();height=bytes.readUInt16BE(at+3);width=bytes.readUInt16BE(at+5);
   }
   if(marker===218){scan=true;break;}at+=size;
  }
  if(!scan)throw invalid();
 }else if(mime==='image/webp'){
  if(bytes.length<26||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)!==bytes.length-8)throw invalid();
  let at=12,seenImage=false;
  while(at+8<=bytes.length){
   const type=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8,end=start+size;
   if(end>bytes.length)throw invalid();
   if(type==='ANIM'||type==='ANMF')throw invalid();
   if(type==='VP8X'){if(at!==12||size!==10||(bytes[start]&2)!==0)throw invalid();width=1+bytes.readUIntLE(start+4,3);height=1+bytes.readUIntLE(start+7,3);}
   else if(type==='VP8 '){
    if(seenImage||size<10||!bytes.subarray(start+3,start+6).equals(Buffer.from([157,1,42])))throw invalid();
    const w=bytes.readUInt16LE(start+6)&0x3fff,h=bytes.readUInt16LE(start+8)&0x3fff;
    if(width!==undefined&&(width!==w||height!==h))throw invalid();width=w;height=h;seenImage=true;
   }else if(type==='VP8L'){
    if(seenImage||size<5||bytes[start]!==47)throw invalid();const bits=bytes.readUInt32LE(start+1);if(bits>>>29)throw invalid();const w=1+(bits&0x3fff),h=1+((bits>>>14)&0x3fff);
    if(width!==undefined&&(width!==w||height!==h))throw invalid();width=w;height=h;seenImage=true;
   }
   at=end+(size%2);
  }
  if(at!==bytes.length||!seenImage)throw invalid();
 }else throw invalid();
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>formulaOcrLimits.maxDimension||height>formulaOcrLimits.maxDimension)throw invalid();
 return{width,height,bytes:bytes.length,mime};
}

export function normalizeRecognizedFormula(value){
 if(typeof value!=='string'||value.length>formulaOcrLimits.maxCharacters+16)throw formulaOcrError('formula_ocr_result_invalid',422,'识别结果为空、过长或无法排版，请裁剪为单个公式后重新识别');
 let latex=value.trim();
 for(const [open,close]of [['$$','$$'],['\\[','\\]'],['\\(','\\)'],['$','$']])if(latex.startsWith(open)&&latex.endsWith(close)&&latex.length>=open.length+close.length){latex=latex.slice(open.length,-close.length).trim();break;}
 if(/<\/?[A-Za-z][^>]*>|\u007f/.test(latex)||/https?:|javascript:|data:/i.test(latex))throw formulaOcrError('formula_ocr_result_invalid',422,'识别结果包含不支持的内容，请裁剪为单个数学公式后重试');
 // Comparison characters are mathematics, not HTML. Use explicit TeX commands
 // before passing them to the existing strict mathematical renderer.
 latex=latex.replace(/</g,'\\lt ').replace(/>/g,'\\gt ');
 try{return formulaSvgMarkup(latex).latex;}catch{throw formulaOcrError('formula_ocr_result_invalid',422,'识别结果暂不能安全排版，请裁剪为单个公式，或在编辑器中手动输入');}
}

export const formulaOcrConfigured=config=>config.formulaOcrEnabled===true&&credential(config.formulaOcrAccessKeyId)&&credential(config.formulaOcrAccessKeySecret)&&(config.formulaOcrRegion??'cn-hangzhou')==='cn-hangzhou';

export function createFormulaOcrClient(config={}, {client}={}){
 config={...config};
 const ready=formulaOcrConfigured(config)&&(client===undefined||typeof client?.callApi==='function');
 const timeout=Number.isSafeInteger(config.formulaOcrTimeoutMs)&&config.formulaOcrTimeoutMs>0&&config.formulaOcrTimeoutMs<=formulaOcrLimits.timeoutMs?config.formulaOcrTimeoutMs:formulaOcrLimits.timeoutMs;
 let transport=client,inFlight=0;
 const getClient=()=>transport||=new OpenAPI.default(new OpenAPI.Config({accessKeyId:config.formulaOcrAccessKeyId,accessKeySecret:config.formulaOcrAccessKeySecret,endpoint:'ocr-api.cn-hangzhou.aliyuncs.com',regionId:'cn-hangzhou',protocol:'HTTPS',type:'access_key',connectTimeout:Math.min(timeout,5000),readTimeout:timeout,httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*'}));
 return{ready,async recognize(bytes,mime){
  if(!ready)throw formulaOcrError('formula_ocr_not_configured',503,'公式图片识别暂未开放，可继续使用公式编辑器');
  validateFormulaImage(bytes,mime);
  if(inFlight>=formulaOcrLimits.maxConcurrent)throw formulaOcrError('formula_ocr_busy',429,'公式识别当前繁忙，请稍后再试');
  inFlight++;
  const params=new OpenAPI.Params({action:'RecognizeEduFormula',version:'2021-07-07',protocol:'HTTPS',pathname:'/',method:'POST',authType:'AK',style:'RPC',reqBodyType:'binary',bodyType:'json'});
  const request=new OpenAPI.OpenApiRequest({stream:Readable.from([bytes])});
  const runtime=new TeaUtil.RuntimeOptions({autoretry:false,maxAttempts:1,connectTimeout:Math.min(timeout,5000),readTimeout:timeout,ignoreSSL:false,httpProxy:'',httpsProxy:'',socks5Proxy:'',noProxy:'*'});
  let timer;
  try{
   const pending=Promise.resolve().then(()=>getClient().callApi(params,request,runtime)).finally(()=>{inFlight--;});
   const result=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(formulaOcrError('formula_ocr_timeout',504,'公式识别暂未完成，本次请求不会自动重复提交，请稍后查看记录')),timeout);})]);
   if(!plain(result)||result.statusCode!==200||!plain(result.body))throw unavailable();
   if(result.body.Code!==undefined&&result.body.Code!==''&&result.body.Code!==null)throw providerFailure(result.body.Code);
   const raw=result.body.Data;
   if(typeof raw!=='string'||raw.length>4*1024*1024)throw unavailable();
   let data;try{data=JSON.parse(raw);}catch{throw unavailable();}
   if(!plain(data))throw unavailable();
   return{latex:normalizeRecognizedFormula(data.content)};
  }catch(error){if(error?.formulaOcrSafe)throw error;throw providerFailure(error?.code);}
  finally{clearTimeout(timer);}
 }};
}
