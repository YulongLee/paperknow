import {revisionStrategy} from './revision-strategy.mjs';

// The requested operation determines the price and matching purchased allowance.
// Legacy snapshots without an explicit revision mode retain their old service.
export function toolBillingIdentity({kind,operation,snapshot={}}){
 if(kind==='revision'){
  const strategy=revisionStrategy(snapshot.mode,snapshot.context?.plan);
  if(strategy.plan!=='dual'&&['polish','review'].includes(snapshot.mode))return {type:snapshot.mode,serviceKey:null};
  return {type:'agent',serviceKey:strategy.billingKey};
 }
 return {type:'agent',serviceKey:kind==='presentation'?'presentation-'+snapshot.mode:kind==='format'?'format-advice':kind+'-'+operation};
}
