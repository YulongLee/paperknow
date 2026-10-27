import {createBillingService} from '../../backend/billing-service.mjs';
// Explicitly retain coverage for the administrator-controlled free trial mode.
export function enableFreeDetection(db,billing=createBillingService(db,{})){
 const rule=billing.toolRules();billing.saveToolRules({version:rule.version,services:rule.services.map(({key,mode,creditCost})=>({key,mode:key.startsWith('detection-')?'free':mode,creditCost:key.startsWith('detection-')?null:creditCost}))});
}
