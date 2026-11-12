import test from 'node:test';
import assert from 'node:assert/strict';
import {sameThesisCharge} from '../dist/workspace/thesis-online.mjs';
test('a replacement quote must retain the exact grant, cost, units and policy',()=>{
 const quote={source:'bundle',sourceOrderId:'order-one',creditCost:0,entitlementUnits:1,entitlementKey:'thesis-bachelor',policyVersion:1,serviceKey:'thesis-long',toolPolicyVersion:2};
 assert.equal(sameThesisCharge(quote,{...quote,token:'fresh-token'}),true);
 for(const [key,value] of Object.entries({source:'credits',sourceOrderId:'order-two',creditCost:100,entitlementUnits:2,entitlementKey:'thesis-master',policyVersion:3,serviceKey:'thesis-other',toolPolicyVersion:4}))assert.equal(sameThesisCharge(quote,{...quote,[key]:value}),false,key);
 assert.equal(sameThesisCharge(quote,null),false);
});
