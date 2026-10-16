// Sales follow executable services, never a descriptive feature list.
export function productDelivery(product,billing){
 if(!billing)return {purchasable:true};
 const paid=billing.rules().services.filter(item=>item.mode==='paid'&&item.available);
 if(product.entitlementType==='credits')return paid.length?{purchasable:true}:{purchasable:false,unavailableReason:'积分消费服务尚未开放，当前暂停充值。'};
 const items=product.entitlementType==='bundle'?product.bundleItems:product.membershipItems;
 if(!Array.isArray(items)||!items.length)return {purchasable:false,unavailableReason:'服务额度与交付规则尚未配置，当前不可购买。'};
 if(items.some(item=>!paid.some(service=>service.key===item.key)))return {purchasable:false,unavailableReason:'部分服务尚未接通或已暂停，当前不可购买。'};
 return {purchasable:true};
}
