import {isMineruConfigurationValid} from './mineru-client.mjs';
export function commerceResourceServices(billing,config={}){
 const services=[...(billing?.rules().services||[]),...(billing?.toolRules?.().services||[]).map(s=>({...s,mode:s.effectiveMode}))],paid=key=>services.some(s=>s.key===key&&s.available&&s.mode==='paid');
 return [
 {key:'light-ai',title:'轻量 AI 共用次数',available:['literature-read','literature-answer','polish'].every(paid)},
 {key:'translation-pages',title:'整篇翻译页数',available:['literature-document','literature-document-long'].every(paid)},
 {key:'parse-pages',title:'PDF 解析页数',available:config.mineruEnabled===true&&isMineruConfigurationValid({token:config.mineruToken,baseURL:config.mineruBaseURL})},
 {key:'cloud-mb',title:'云文件容量（MB）',available:config.storage?.provider==='aliyun_oss'&&typeof config.storage.read==='function'&&typeof config.storage.putArtifact==='function'}
 ];
}
// Sales follow executable services, never a descriptive feature list.
export function productDelivery(product,billing,config={}){
 if(!billing)return {purchasable:true};
 const services=[...billing.rules().services,...(billing.toolRules?.().services||[]).map(item=>({...item,mode:item.effectiveMode,creditCost:item.effectiveCreditCost}))];
 const included=new Set(['detection-similarity','detection-aigc']);
 // A detector with an executable paid tariff supports both credits and its
 // exact scoped package allowance. Explicit free configurations remain usable.
 const configured=services.filter(item=>item.mode==='paid');
 const paid=configured.filter(item=>item.available);
 if(product.entitlementType==='credits'){
  if(!configured.length)return {purchasable:false,unavailableCode:'credit_pricing_missing',unavailableReason:'尚未配置按积分计费的服务，当前暂停充值。'};
  return paid.length?{purchasable:true}:{purchasable:false,unavailableCode:'credit_services_unavailable',unavailableReason:'已配置的积分消费服务当前不可用，暂时无法充值。'};
 }
 const items=product.entitlementType==='bundle'?product.bundleItems:product.membershipItems;
 if(!Array.isArray(items)||!items.length)return {purchasable:false,unavailableCode:'entitlement_rules_missing',unavailableReason:'服务额度与交付规则尚未配置，当前不可购买。'};
 // Keep explicitly configured free detection allowances compatible with
 // mixed packages. Every other allowance still requires executable paid work.
 const deliverable=services.filter(service=>service.available&&(included.has(service.key)?['free','paid'].includes(service.mode):service.mode==='paid'));
 const resourceMap={'light-ai':['literature-read','literature-answer','polish'],'translation-pages':['literature-document','literature-document-long'],'parse-pages':[],'cloud-mb':[]};
 const resourceReady=item=>item.key==='cloud-mb'?config.storage?.provider==='aliyun_oss'&&typeof config.storage.read==='function'&&typeof config.storage.putArtifact==='function':item.key==='parse-pages'?config.mineruEnabled===true&&isMineruConfigurationValid({token:config.mineruToken,baseURL:config.mineruBaseURL}):Object.hasOwn(resourceMap,item.key)?resourceMap[item.key].every(key=>deliverable.some(s=>s.key===key)):deliverable.some(s=>s.key===item.key);
 if(!items.some(item=>paid.some(service=>service.key===item.key)||(resourceMap[item.key]||[]).some(key=>paid.some(service=>service.key===key)))||items.some(item=>!resourceReady(item)))return {purchasable:false,unavailableCode:'entitlement_services_unavailable',unavailableReason:'部分服务尚未接通或未开放计费，当前不可购买。'};
 return {purchasable:true};
}
