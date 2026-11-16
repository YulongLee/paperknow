import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverAlerts,monitoringSignals,createAlertMailer} from '../deploy/ops-watch.mjs';

test('independent alerts require consecutive failures, deduplicate and send one recovery',async()=>{
 let previous={},now=1_000_000;const messages=[],send=async m=>messages.push(m);
 const step=async signals=>{const r=await deliverAlerts({previous,signals,now,send});previous=r.state;now+=120000;return r;};
 await step({health:true});assert.equal(messages.length,0);
 await step({health:true});assert.deepEqual(messages.map(v=>v.status),['active']);
 for(let i=0;i<4;i++)await step({health:true});assert.equal(messages.length,1);
 await step({health:false});assert.equal(messages.length,1);
 await step({health:false});assert.deepEqual(messages.map(v=>v.status),['active','resolved']);
 await step({health:false});assert.equal(messages.length,2);
});
test('failed mail remains pending for retry and does not create a false recovery',async()=>{
 let previous={},now=1_000_000,calls=0;
 const step=async signals=>{const r=await deliverAlerts({previous,signals,now,send:async()=>{calls++;throw Error('SMTP secret details');}});previous=r.state;return r;};
 await step({health:true});now+=120000;await step({health:true});assert.equal(calls,1);assert.equal(previous.alerts.health.delivery,'failed');
 now+=120000;await step({health:true});assert.equal(calls,1);
 now+=600000;await step({health:true});assert.equal(calls,2);
 now+=600000;await step({});now+=600000;await step({});assert.equal(calls,2);
 assert.doesNotMatch(JSON.stringify(previous),/SMTP|secret/);
});
test('persisted attempt prevents rapid duplicate send after a crash and active alerts get a six-hour reminder',async()=>{
 const now=Date.now(),before={alerts:{health:{failures:3,notified:true,lastSent:now-3600000,lastAttempt:now-3600000}}};let calls=0;
 assert.equal((await deliverAlerts({previous:before,signals:{health:true},now,send:async()=>calls++})).sent.length,0);
 const writes=[];const r=await deliverAlerts({previous:before,signals:{health:true},now:now+6*3600000,send:async()=>{assert.equal(writes[0].alerts.health.delivery,'pending');calls++;},persist:async s=>writes.push(structuredClone(s))});
 assert.equal(calls,1);assert.equal(r.state.alerts.health.notified,true);
 const restarted=await deliverAlerts({previous:writes[0],signals:{health:true},now:now+6*3600000+120000,send:async()=>calls++});assert.equal(calls,1);assert.equal(restarted.sent.length,0);
});
test('monitor signals use actual metric keys and do not forward free-form details',()=>{
 const at=Date.now(),r=monitoringSignals({created_at:new Date(at).toISOString(),payload:{alerts:[{key:'oss',title:'private-paper'},{key:'stale-jobs'},{key:'held-reservations'},{key:'artifact-failures'}]}},at);
 assert.deepEqual(r,{sampler:false,storage:true,queue:true,billing:true,exports:true});assert.doesNotMatch(JSON.stringify(r),/private-paper/);
 assert.equal(monitoringSignals(null,at).sampler,true);
});
test('mail uses TLS, checks accepted recipient and contains no arbitrary diagnostics',async()=>{
 const env={PK_OPS_ALERT_EMAIL:'contact@example.test',PK_EMAIL_FROM:'service@example.test',PK_EMAIL_SMTP_HOST:'smtp.example.test',PK_EMAIL_SMTP_USER:'private-user',PK_EMAIL_SMTP_PASSWORD:'private-key',PK_EMAIL_SMTP_PORT:'587',PK_EMAIL_SMTP_SECURE:'0'};
 let message;const send=createAlertMailer(env,options=>{assert.equal(options.requireTLS,true);assert.equal(options.tls.minVersion,'TLSv1.2');return{sendMail:async m=>{message=m;return{accepted:['contact@example.test'],rejected:[]};}};});
 await send({key:'health',title:'网站服务不可用',status:'active',at:new Date().toISOString()});assert.match(message.subject,/故障告警/);assert.doesNotMatch(JSON.stringify(message),/private-key|private-user/);
 await send({test:true,at:new Date().toISOString()});assert.match(message.text,/不表示线上发生故障/);
 assert.throws(()=>createAlertMailer({...env,PK_OPS_ALERT_EMAIL:'x@example.test\nBcc:y@example.test'}));
 const rejected=createAlertMailer(env,()=>({sendMail:async()=>({accepted:[],rejected:['contact@example.test']})}));await assert.rejects(rejected({test:true,at:new Date().toISOString()}));
});
