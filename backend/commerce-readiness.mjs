// Sales follow executable services, never a descriptive feature list.
export function productDelivery(product,billing){
 if(!billing)return {purchasable:true};
 const services=[...billing.rules().services,...(billing.toolRules?.().services||[]).map(item=>({...item,mode:item.effectiveMode,creditCost:item.effectiveCreditCost}))];
 const configured=services.filter(item=>item.mode==='paid');
 const paid=configured.filter(item=>item.available);
 if(product.entitlementType==='credits'){
  if(!configured.length)return {purchasable:false,unavailableCode:'credit_pricing_missing',unavailableReason:'尚未配置按积分计费的服务，当前暂停充值。'};
  return paid.length?{purchasable:true}:{purchasable:false,unavailableCode:'credit_services_unavailable',unavailableReason:'已配置的积分消费服务当前不可用，暂时无法充值。'};
 }
 const items=product.entitlementType==='bundle'?product.bundleItems:product.membershipItems;
 if(!Array.isArray(items)||!items.length)return {purchasable:false,unavailableCode:'entitlement_rules_missing',unavailableReason:'服务额度与交付规则尚未配置，当前不可购买。'};
 if(items.some(item=>!paid.some(service=>service.key===item.key)))return {purchasable:false,unavailableCode:'entitlement_services_unavailable',unavailableReason:'部分服务尚未接通或未开放计费，当前不可购买。'};
 return {purchasable:true};
}
