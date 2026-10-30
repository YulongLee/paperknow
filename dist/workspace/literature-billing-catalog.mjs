// Keep historic operation keys for immutable purchase/usage records. New prices
// and allowances are managed as one literature-reading service.
export const literatureBillingKeys=Object.freeze(['literature-read','literature-answer','literature-translate']);
export const literaturePricingKey='literature-read';
export const isLiteratureBillingKey=key=>literatureBillingKeys.includes(key);
export const literatureBillingTitle=key=>isLiteratureBillingKey(key)?'文献研读':null;
