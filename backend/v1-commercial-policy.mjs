import {writingBillingKey} from '../dist/workspace/writing-billing-catalog.mjs';
import {toolBillingIdentity} from '../dist/workspace/tool-billing-identity.mjs';
import {v1CommercialVersion} from '../dist/workspace/v1-pricing.mjs';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function v1CommercialEnabled(db){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commercial_launches'").get()&&db.prepare('SELECT 1 FROM commercial_launches WHERE version=?').get(v1CommercialVersion));}
export function commercialWritingKey(db,kind,operation,snapshot){
 if(!v1CommercialEnabled(db))return writingBillingKey(kind,operation,snapshot);
 if(['method','outline'].includes(operation))return 'writing-planning';
 const words=snapshot.profile?.targetWords||0,english=/english|英文|英语/i.test(snapshot.profile?.language||''),scale=english?2:1;
 // Existing unscoped purchases keep their original delivery range; new sales are checked against scope in the quote ledger.
 if(kind==='thesis'&&words*scale>12000&&words*scale<=30000)return 'thesis-long';
 return writingBillingKey(kind,operation,snapshot)||({'article':'writing-article',course:'writing-course',practice:'writing-practice',idea:'writing-idea',questionnaire:'writing-questionnaire'})[kind]||null;
}
export function commercialToolIdentity(db,value){
 const base=toolBillingIdentity(value);if(!v1CommercialEnabled(db))return base;
 const {kind,operation,snapshot:s}=value,c=s.context||{},chars=Array.from(s.text||'').length;
 if(kind==='revision'){
  const mode=c.revisionProduct?.mode;
  if(mode==='paragraph'){if(chars>1000)fail('段落优化每次最多 1,000 字符，请分段提交；尚未扣费。');return {type:'agent',serviceKey:'revision-paragraph'};}
  if(['polish','review'].includes(base.type)){if(chars>3000)fail('局部修改每次最多 3,000 字符；整篇文稿请使用整篇优化功能，尚未扣费。');return base;}
  if(chars>10000)fail('整篇优化每次最多 10,000 字符，请分章节提交；尚未扣费。');
  if(mode==='report')return{type:'agent',serviceKey:'revision-targeted'};
 }
 if(kind==='presentation'&&c.pages>20)return{type:'agent',serviceKey:'presentation-enhanced'};
 if(kind==='literature'&&['read','answer'].includes(operation)&&(s.materials||[]).reduce((n,m)=>n+Array.from(m.text||'').length,0)>3000)fail('单次研读选取正文最多 3,000 字符，请缩小原文范围；尚未扣费。');
 if(kind==='literature'&&operation==='translate'&&chars>3000)fail('片段翻译每次最多 3,000 字符；整篇 PDF 请使用整篇翻译，尚未扣费。');
 if(kind==='format'&&Number(c.documentCharacters||0)>20000)fail('智能排版每次最多 20,000 字符，请分文档处理；尚未扣费。');
 return base;
}
export function commercialWorkContext(value){
 const s=value.snapshot||{},c=s.context||{};
 return {kind:value.kind,operation:value.operation,characters:value.kind==='format'?Number(c.documentCharacters||0):value.kind==='literature'&&s.materials?.length?s.materials.reduce((n,m)=>n+Array.from(m.text||'').length,0):Math.max(Array.from(s.text||'').length,(s.materials||[]).reduce((n,m)=>n+Array.from(m.text||'').length,0)),targetWords:(s.profile?.targetWords||0)*(/english|英文|英语/i.test(s.profile?.language||'')?2:1),level:s.profile?.level||'',pages:c.pages||0,legacyPresentationKey:value.kind==='presentation'?toolBillingIdentity(value).serviceKey:null,revisionKind:c.revisionProduct?.kind||''};
}
