import {parseDocument,countChars} from '../dist/precheck/engine.mjs';
import {publicWebQueryPlan} from '../dist/precheck/web-query-plan.mjs';

export const webSimilarityLimits=Object.freeze({maxCharacters:20000,maxQueries:3,maxSources:8,userDailyLimit:3,globalDailyLimit:40,maxQueued:10});
export const webSimilarityVersion='public-web-exact-1.0';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status,webSimilaritySafe:true});};
export function webSimilarityInput(input,user){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['text','title','expectedUserId','consent','idempotencyKey'].includes(k)))fail(400,'查重请求包含不支持的字段。');
 if(input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后重新确认正文。');
 if(input.consent!==true)fail(400,'请先确认将选取的正文片段发送至联网检索服务。');
 if(typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_]{8,100}$/.test(input.idempotencyKey))fail(400,'请求编号无效，请刷新页面。');
 if(typeof input.text!=='string'||input.text.length>40000||Array.from(input.text).length>webSimilarityLimits.maxCharacters||/[\x00\ud800-\udfff]/u.test(input.text))fail(400,'联网查重最多支持 20,000 个字符，请按章节提交。');
 const text=input.text.trim(),title=typeof input.title==='string'?input.title.trim():'未命名论文';
 if(!title||title.length>200||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(title))fail(400,'请填写不超过 200 字符的文稿名称。');
 let parsed;try{parsed=parseDocument(text,title);}catch{fail(400,'未找到可比对的正文，请核对上传或粘贴的内容。');}
 const paragraphs=parsed.sections.filter(s=>!s.excluded).flatMap(s=>s.paragraphs);
 const characters=paragraphs.reduce((sum,p)=>sum+countChars(p.text),0);
 if(characters<40)fail(400,'请提供至少 40 个有效正文字符，不含参考文献等排除章节。');
 if(paragraphs.length>300)fail(400,'本次正文段落过多，请分章节提交。');
 return{text,title,parsed,characters,idempotencyKey:input.idempotencyKey};
}

// Search selection is deterministic and auditable. It is sampling, never a
// claim that every sentence or every public page was searched.
export function planWebQueries(parsed){
 const plan=publicWebQueryPlan(parsed,webSimilarityLimits.maxQueries);
 if(!plan.queries.length)fail(400,'正文片段过短，暂不能进行联网检索，请合并为完整段落。');
 return plan;
}

export function webSimilarityDay(at=Date.now()){
 const start=Math.floor((at+8*3600000)/86400000)*86400000-8*3600000;
 return{start:new Date(start).toISOString(),end:new Date(start+86400000).toISOString()};
}
export function webSimilarityFileName(title,suffix){
 return(title.replace(/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/g,'_').slice(0,90)||'论文')+suffix;
}
export const webSimilarityFail=fail;
