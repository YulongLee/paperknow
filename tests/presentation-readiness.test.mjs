import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {productDelivery} from '../backend/commerce-readiness.mjs';
import {presentationGenerationStatus} from '../backend/presentation-readiness.mjs';
import {presentationGenerationStatus as executionStatus} from '../backend/presentation-generation.mjs';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.example.test',model:'fixture-only-model',apiKey:'fixture-only-secret',version:'readiness-fixture',maxTurns:6,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const storage=()=>({provider:'aliyun_oss',bucket:'fixture-private',prefix:'paperknow/',putArtifact(){assert.fail('readiness must not upload');},readArtifact(){assert.fail('readiness must not download');},removeArtifact(){assert.fail('readiness must not delete');}});
const config=()=>({getAgentSettings:()=>({...runtime}),storage:storage(),pptMasterEnabled:true,pptMasterRenderer(){assert.fail('readiness must not render');}});
const presentationKeys=['presentation-ai','presentation-proposal','presentation-thesis'];
const product={entitlementType:'bundle',bundleItems:[{key:'presentation-thesis',title:'毕业 PPT',quantity:1}]};

test('catalogue and execution share one presentation readiness check without invoking rendering or storage',()=>{
 assert.equal(executionStatus,presentationGenerationStatus);assert.deepEqual(presentationGenerationStatus(config()),{ready:true,reason:null});
 for(const patch of [{pptMasterEnabled:false},{pptMasterRenderer:null,pptMasterRuntimeRoot:'/nonexistent/paperknow-ppt-readiness'}]){
  const status=presentationGenerationStatus({...config(),...patch});assert.equal(status.ready,false);assert.match(status.reason,/演示生成服务/);
 }
 for(const patch of [{provider:'local_server_sqlite'},{putArtifact:null},{readArtifact:null},{removeArtifact:null},{bucket:undefined},{prefix:undefined}]){
  const status=presentationGenerationStatus({...config(),storage:{...storage(),...patch}});assert.equal(status.ready,false);assert.match(status.reason,/云存储/);
 }
});

test('PPT packages are not saleable with a text model alone, unavailable compiler, or incomplete private storage',t=>{
 for(const patch of [{pptMasterEnabled:false},{pptMasterRenderer:null,pptMasterRuntimeRoot:'/nonexistent/paperknow-ppt-readiness'},{storage:{provider:'aliyun_oss'}},{storage:undefined}]){
  const db=database(':memory:');t.after(()=>db.close());const billing=createBillingService(db,{...config(),...patch});
  billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
  for(const key of presentationKeys)assert.equal(billing.toolRules().services.find(service=>service.key===key).available,false,key);
  assert.equal(productDelivery(product,billing).purchasable,false);
 }
});

test('enabled renderer and complete private storage make executable PPT packages saleable',t=>{
 const db=database(':memory:');t.after(()=>db.close());const billing=createBillingService(db,config());
 billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 for(const key of presentationKeys)assert.equal(billing.toolRules().services.find(service=>service.key===key).available,true,key);
 assert.equal(productDelivery(product,billing).purchasable,true);
});
