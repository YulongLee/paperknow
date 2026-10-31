import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {inflateSync} from 'node:zlib';
import {researchFigureSelection} from './research-figure-selection.mjs';
import {scientificFigureStyle} from './research-image-scientific-style.mjs';

const endpoint='https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const maximum=20*1024*1024;
const models=new Set(['qwen-image-2.0','qwen-image-2.0-pro','qwen-image-2.0-turbo','qwen-image-2.1','qwen-image-2.1-pro','qwen-image-2.1-turbo','qwen-image-3.0','qwen-image-3.0-pro']);
const sizes=Object.freeze({'16:9':'1536*864','4:3':'1536*1152','1:1':'1280*1280','3:4':'1152*1536'});
// Both Qwen Image 3 models support the 2048² pixel budget. Use native
// resolution: changing DPI metadata or upscaling cannot restore figure detail.
// Older configured models retain their existing resolution profile.
const highResolutionSizes=Object.freeze({'16:9':'2688*1512','4:3':'2304*1728','1:1':'2048*2048','3:4':'1728*2304'});
const palettes=Object.freeze({academic:'白色背景，克制的蓝灰色学术配色',blue:'蓝色与青色，清晰的白底科技风格',nature:'绿色与蓝绿色，干净自然的学术配色',warm:'橙色与暖红色，柔和白底配色'});
const failure=(code,message,status=502)=>Object.assign(new Error(message),{code:'research_image_'+code,status,researchImageSafe:true});
const fail=(code,message,status)=>{throw failure(code,message,status);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function assertResearchImageSettings(s){
 if(!plain(s)||s.enabled!==true||!models.has(s.model)||typeof s.apiKey!=='string'||s.apiKey.length<8||s.apiKey.length>16384||/[\x00-\x20\x7f]/.test(s.apiKey)||!['https://dashscope.aliyuncs.com','https://dashscope.aliyuncs.com/'].includes(s.baseURL)||typeof s.version!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(s.version)||s.workspaceId!==undefined&&s.workspaceId!==''&&(typeof s.workspaceId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(s.workspaceId)))fail('not_configured','科研绘图服务暂未就绪，请稍后重试',503);
 const timeoutMs=s.timeoutMs??120000;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>180000)fail('not_configured','科研绘图服务暂未就绪，请稍后重试',503);
 return{...s,timeoutMs};
}
function publicIP(value){
 if(isIP(value)===4){const[a,b,c]=value.split('.').map(Number);return a>0&&a<224&&![10,127].includes(a)&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===0||b===2||b===168||b===88&&c===99))&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);}
 if(isIP(value)!==6||value.includes('.')||value.includes('%'))return false;
 const[left,right]=value.toLowerCase().split('::'),a=left?left.split(':'):[],b=right?right.split(':'):[],w=right!==undefined?[...a,...Array(8-a.length-b.length).fill('0'),...b].map(x=>parseInt(x,16)):a.map(x=>parseInt(x,16));
 return w.length===8&&!w.some(x=>!Number.isInteger(x))&&w[0]>=0x2000&&w[0]<=0x3fff&&!(w[0]===0x2001&&(w[1]<0x0200||w[1]===0x0db8))&&w[0]!==0x2002&&w[0]!==0x3ffe&&!(w[0]===0x3fff&&w[1]<0x1000);
}
export function researchImageResultURL(value){
 if(typeof value!=='string'||value.length>12000||/[\x00-\x20\x7f\\]/.test(value))fail('url_invalid','绘图结果地址未通过安全检查');
 let u;try{u=new URL(value);}catch{fail('url_invalid','绘图结果地址未通过安全检查');}
 const allowed=new Set(['dashscope-a717.oss-accelerate.aliyuncs.com','dashscope-result-sh.oss-cn-shanghai.aliyuncs.com','dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com','dashscope-result-bj.oss-cn-beijing.aliyuncs.com','dashscope-result-hz.oss-cn-hangzhou.aliyuncs.com']);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||!allowed.has(u.hostname)||!/^\/[A-Za-z0-9_./%+@=-]+$/.test(u.pathname)||u.pathname.includes('/../'))fail('url_invalid','绘图结果地址未通过安全检查');return u;
}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function validateResearchImage(buffer){
 const invalid=()=>fail('image_invalid','绘图结果未通过图片完整性校验，请重试');
 if(!Buffer.isBuffer(buffer)||buffer.length<32||buffer.length>maximum)invalid();let width,height,kind;
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  kind='png';let at=8,ihdr=false,end=false,idat=[],total=0,depth,color,interlace;
  while(at<buffer.length){if(at+12>buffer.length)invalid();const n=buffer.readUInt32BE(at),name=buffer.toString('ascii',at+4,at+8);if(n>maximum||at+12+n>buffer.length||!/^[A-Za-z]{4}$/.test(name)||buffer.readUInt32BE(at+8+n)!==crc32(buffer.subarray(at+4,at+8+n)))invalid();
   const bytes=buffer.subarray(at+8,at+8+n);if(!ihdr&&name!=='IHDR')invalid();
   if(name==='IHDR'){if(ihdr||n!==13)invalid();ihdr=true;width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);depth=bytes[8];color=bytes[9];interlace=bytes[12];if(![0,2,3,4,6].includes(color)||depth!==8||bytes[10]!==0||bytes[11]!==0||interlace!==0)invalid();}
   if(name==='IDAT'){idat.push(bytes);total+=n;}if(name==='IEND'){if(n!==0||at+12!==buffer.length)invalid();end=true;break;}at+=12+n;
  }
  if(!ihdr||!end||!idat.length||!total||width<256||height<256||width>4096||height>4096||width*height>12*1024*1024)invalid();
  const channels={0:1,2:3,3:1,4:2,6:4}[color],expected=(width*channels+1)*height;let pixels;try{pixels=inflateSync(Buffer.concat(idat,total),{maxOutputLength:expected});}catch{invalid();}if(pixels.length!==expected)invalid();for(let y=0;y<height;y++)if(pixels[y*(width*channels+1)]>4)invalid();
 }else invalid();
 return{buffer,width,height,kind,mimeType:kind==='png'?'image/png':'image/jpeg'};
}
export function researchImagePrompt(snapshot){
 const choice=researchFigureSelection(snapshot);if(!choice)fail('input_invalid','科研绘图类别与所选领域不匹配，请重新选择图表类型',400);
 const c=snapshot.context,english=snapshot.language!=='中文',scene=choice.sceneLabel||choice.label;
 return [
  'Create ONE scientific figure, on a pure white background, with clean readable typography and precise geometry.',
  `Figure kind: ${scene}. ${choice.description}.`,
  english?'Use English for all labels.':'图中标注仅使用简体中文（作者指定的符号除外）。',
  palettes[c.palette]||palettes.academic,
  scientificFigureStyle(choice),
  'AUTHOR BRIEF — authoritative facts and required labels:',
  snapshot.text,
  snapshot.requirements||'',
  'OUTPUT ONLY THE FIGURE. Do not print the brief, instructions, metadata, file name, language name, figure type, software brand, title, caption, commentary, notes or legend unless the author explicitly requested it. The words above are instructions, not text to put on the image. Use only the labels requested by the author. Do not add objects, relationships, measurements or results absent from the brief.',
  'Technical plots must reproduce every supplied value and connection exactly. This is a static explanatory figure, not evidence that any simulation or experiment has been performed.'
 ].filter(Boolean).join('\n');
}
// The image model receives a visual composition, never the planner's source
// document, schema headings or review transcript: these can become visible text.
export function researchIllustrationPrompt(snapshot,plan,{repairKeys=[]}={}){
 if(!researchFigureSelection(snapshot)||plan?.kind!=='illustration')fail('input_invalid','科研插图内容无效',400);
 const repair=new Set(repairKeys);
 return [
  'Draw one precise scientific illustration on a pure white canvas. Use a clean explanatory style, clear geometry and generous empty margins.',
  plan.artworkDescription||plan.description,
  'Depict these objects and preserve their stated counts and relationships: '+plan.requiredObjects.join('; ')+'.',
  palettes[snapshot.context.palette]||palettes.academic,
  'Render only the objects, geometry and necessary motion/relationship arrows. ALL text labels are added later by a separate typesetting program. Ignore any request in the composition to write or label anything.',
  'The artwork must contain ZERO text, letters, digits, labels, panel headings, captions, callout lines, branding or watermarks. Keep the background completely blank white. Do not draw placeholder text or pretend lettering.',
  repair.has('labels_legible')||repair.has('figure_grammar')?'Remove ALL lettering. Even a single visible word or garbled character is forbidden. Keep only the illustration and meaningful arrows.':'',
  repair.has('no_overlap_or_clipping')?'Space the objects and labels farther apart, with no cropping or overlap.':''
 ].filter(Boolean).join('\n');
}
export function createResearchImageClient(settings,{requestImpl=httpsRequest,lookupImpl=lookup}={}){
 const runtime=assertResearchImageSettings(settings);
 async function request(url,{body,signal,api=false}={}){
  if(signal?.aborted)throw failure('cancelled','科研绘图任务已停止',499);
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(runtime.timeoutMs)]):AbortSignal.timeout(runtime.timeoutMs);let addresses;
  let dnsAbort;try{addresses=await Promise.race([lookupImpl(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{dnsAbort=()=>reject(failure(signal?.aborted?'cancelled':'timeout',signal?.aborted?'科研绘图任务已停止':'科研绘图服务响应超时',signal?.aborted?499:504));if(combined.aborted)dnsAbort();else combined.addEventListener('abort',dnsAbort,{once:true});})]);}catch(e){if(e?.researchImageSafe)throw e;throw failure('dns_failed','科研绘图服务暂时无法连接');}finally{if(dnsAbort)combined.removeEventListener('abort',dnsAbort);}
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(r=>!r||!publicIP(r.address)))fail('dns_invalid','科研绘图地址未通过安全检查');
  const pinned=addresses[0],headers={Accept:api?'application/json':'image/png','Accept-Encoding':'identity',...(api?{Authorization:'Bearer '+runtime.apiKey,'Content-Type':'application/json',...(runtime.workspaceId?{'X-DashScope-WorkSpace':runtime.workspaceId}:{})}:{}),...(body?{'Content-Length':Buffer.byteLength(body)}:{})};
  return await new Promise((resolve,reject)=>{let res,req,settled=false;const done=(err,result)=>{if(settled)return;settled=true;combined.removeEventListener('abort',abort);if(err){res?.destroy?.();req?.destroy?.();reject(err);}else resolve(result);};const abort=()=>done(failure(signal?.aborted?'cancelled':'timeout',signal?.aborted?'科研绘图任务已停止':'科研绘图服务响应超时，请稍后重试',signal?.aborted?499:504));combined.addEventListener('abort',abort,{once:true});
   try{req=requestImpl({protocol:'https:',hostname:url.hostname,port:443,path:url.pathname+url.search,method:api?'POST':'GET',servername:url.hostname,rejectUnauthorized:true,agent:false,autoSelectFamily:false,family:pinned.family||isIP(pinned.address),lookup:(_host,options,cb)=>options?.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family||isIP(pinned.address)),signal:combined,headers},response=>{res=response;
    if(response.statusCode!==200){const code=response.statusCode;done(failure(code===429?'busy':'provider_rejected',code===429?'科研绘图服务繁忙，请稍后重试':code===400?'本次绘图请求未被服务接受，请调整描述后重试':'科研绘图服务暂不可用，请联系支持',code===429?429:502));return;}
    const type=response.headers?.['content-type']||'',length=response.headers?.['content-length'];if(api?!/\bjson\b/i.test(type):!/^image\/png(?:;|$)/i.test(type)){done(failure('response_invalid','科研绘图服务返回了不支持的内容'));return;}
    if(length&&(!/^\d+$/.test(length)||Number(length)>maximum)){done(failure('response_large','绘图结果超过大小限制'));return;}let size=0;const chunks=[];
    response.on('data',chunk=>{const b=Buffer.from(chunk);if((size+=b.length)>maximum){done(failure('response_large','绘图结果超过大小限制'));return;}chunks.push(b);});response.once('end',()=>done(null,Buffer.concat(chunks,size)));response.once('aborted',()=>done(failure('response_incomplete','绘图结果传输未完成')));response.once('error',()=>done(failure('transport','科研绘图服务暂时无法连接')));
   });req.once('error',()=>done(failure('transport','科研绘图服务暂时无法连接')));if(combined.aborted){abort();return;}req.end(body);}catch{done(failure('transport','科研绘图服务暂时无法连接'));}
  });
 }
 return{async json(messages,{signal,maxTokens=6000}={}){
  const body=JSON.stringify({model:'qwen3.6-flash',messages,enable_thinking:false,temperature:0,max_tokens:maxTokens,response_format:{type:'json_object'}});
  const bytes=await request(new URL('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),{body,signal,api:true});
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('response_invalid','绘图内容检查未返回完整结果');}
  const choice=data?.choices?.[0];if(data.error||data.choices?.length!==1||choice.finish_reason!=='stop'||typeof choice.message?.content!=='string'||choice.message.content.length>100000)fail('response_invalid','绘图内容检查未完成，请稍后重试');
  let value;try{value=JSON.parse(choice.message.content);}catch{fail('response_invalid','绘图内容检查格式不完整');}
  return{value,usage:data.usage||{},model:'qwen3.6-flash'};
 },async generate(snapshot,{signal,prompt}={}){
  if(!sizes[snapshot.context?.aspectRatio])fail('input_invalid','请选择支持的图片比例',400);
  const size=(['qwen-image-3.0','qwen-image-3.0-pro'].includes(runtime.model)?highResolutionSizes:sizes)[snapshot.context.aspectRatio];
  const body=JSON.stringify({model:runtime.model,input:{messages:[{role:'user',content:[{text:prompt||researchImagePrompt(snapshot)}]}]},parameters:{size,n:1,prompt_extend:false,enable_thinking:false,watermark:false}});
  const bytes=await request(new URL(endpoint),{body,signal,api:true});let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('response_invalid','绘图服务未返回完整结果');}
  const choices=result?.output?.choices,content=choices?.[0]?.message?.content;
  if(result.code||!Array.isArray(choices)||choices.length!==1||!Array.isArray(content)||content.length!==1||!plain(content[0])||Object.keys(content[0]).some(k=>!['image','type'].includes(k))||content[0].type!==undefined&&content[0].type!=='image'||typeof content[0].image!=='string')fail('response_invalid','绘图服务未返回可采用的图片，请调整描述后重试');
  let image;if(content[0].image.startsWith('data:')){const m=content[0].image.match(/^data:image\/(png);base64,([A-Za-z0-9+/]+={0,2})$/);if(!m||m[2].length%4!==0||m[2].length>4*Math.ceil(maximum/3))fail('response_invalid','绘图服务图片编码无效');const b=Buffer.from(m[2],'base64');if(b.toString('base64')!==m[2])fail('response_invalid','绘图服务图片编码无效');image=validateResearchImage(b);}else{const u=researchImageResultURL(content[0].image);image=validateResearchImage(await request(u,{signal}));}
  const counts=[result.usage?.image_count,result.usage?.output_image_count];if(counts.some(count=>count!==undefined&&count!==1))fail('usage_invalid','绘图服务图片数量与本次确认不一致');
  return{...image,imageCount:1};
 }};
}
