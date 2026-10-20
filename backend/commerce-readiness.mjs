// Sales follow executable services, never a descriptive feature list.
export function productDelivery(product,billing){
 if(!billing)return {purchasable:true};
 const services=[...billing.rules().services,...(billing.toolRules?.().services||[]).map(item=>({...item,mode:item.effectiveMode,creditCost:item.effectiveCreditCost}))];
 const included=new Set(['detection-similarity','detection-aigc']);
 // Detection currently has an explicitly free entry, without paid confirmation.
 // A paid detector policy closes that entry; it cannot justify package or credit sales.
 const configured=services.filter(item=>item.mode==='paid'&&!included.has(item.key));
 const paid=configured.filter(item=>item.available);
 if(product.entitlementType==='credits'){
  if(!configured.length)return {purchasable:false,unavailableCode:'credit_pricing_missing',unavailableReason:'尚未配置按积分计费的服务，当前暂停充值。'};
  return paid.length?{purchasable:true}:{purchasable:false,unavailableCode:'credit_services_unavailable',unavailableReason:'已配置的积分消费服务当前不可用，暂时无法充值。'};
 }
 const items=product.entitlementType==='bundle'?product.bundleItems:product.membershipItems;
 if(!Array.isArray(items)||!items.length)return {purchasable:false,unavailableCode:'entitlement_rules_missing',unavailableReason:'服务额度与交付规则尚未配置，当前不可购买。'};
 // These two self-operated checks are also available independently for free.
 // A package may include and account for their scoped allowances, but the
 // service still has to be executable. No other free/unknown key is sellable.
 const deliverable=services.filter(service=>service.available&&(included.has(service.key)?service.mode==='free':service.mode==='paid'));
 if(!items.some(item=>paid.some(service=>service.key===item.key))||items.some(item=>!deliverable.some(service=>service.key===item.key)))return {purchasable:false,unavailableCode:'entitlement_services_unavailable',unavailableReason:'部分服务尚未接通或未开放计费，当前不可购买。'};
 return {purchasable:true};
}
