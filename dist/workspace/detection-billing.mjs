// Display the server tariff; never infer a price from a generic AI service.
export function detectionPriceReady(cap){return typeof cap.pointsCharged==='boolean'&&(!cap.pointsCharged||Number.isSafeInteger(cap.creditCost)&&cap.creditCost>0&&cap.creditCost<=100000&&Number.isSafeInteger(cap.pricingVersion));}
export function detectionPriceText(cap){return cap.pointsCharged?`${Number(cap.creditCost).toLocaleString('zh-CN')} 科研积分 / 次（¥${(cap.creditCost/10).toFixed(2)}）；有对应套餐时优先扣 1 次`:'当前免费；如有对应套餐，优先使用套餐 1 次';}
export function detectionPriceSnapshot(cap){return Number.isSafeInteger(cap.pricingVersion)?{pricingVersion:cap.pricingVersion,expectedCreditCost:cap.pointsCharged?cap.creditCost:0}:{};}
