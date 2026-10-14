import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthDelivery} from '../backend/auth-delivery.mjs';
import {environmentConfig} from '../backend/config.mjs';
const config={emailSMTPHost:'smtpdm.aliyun.com',emailSMTPPort:465,emailSMTPSecure:true,emailSMTPUser:'sender@example.com',emailSMTPPassword:'private-smtp-test-secret',emailFrom:'Other Brand <sender@example.com>',smsAccessKeyId:'test-id',smsAccessKeySecret:'private-sms-test-secret',smsSignName:'测试签名',smsTemplateCode:'SMS_123456'};

test('delivery readiness fails closed without complete configuration',async()=>{
  const d=createAuthDelivery({});assert.deepEqual(d.ready,{email:false,phone:false});
  for(const channel of ['email','phone'])await assert.rejects(d.send({channel,address:'test@example.com',code:'123456',purpose:'login'}),{status:503});
});
test('email uses TLS, PaperKnow branding and a single explicit recipient',async()=>{
  let options,mail;const d=createAuthDelivery(config,{createTransport:o=>{options=o;return {sendMail:async m=>{mail=m;return {accepted:[m.to]};}};}});
  await d.send({channel:'email',address:'recipient@example.com',code:'056712',purpose:'reset'});
  assert.equal(options.secure,true);assert.equal(options.tls.minVersion,'TLSv1.2');
  assert.deepEqual(mail.from,{name:'PaperKnow',address:'sender@example.com'});assert.equal(mail.to,'recipient@example.com');
  assert.match(mail.subject,/重置密码/);assert.match(mail.text,/056712/);assert.match(mail.text,/5 分钟/);
  assert.ok(!JSON.stringify(mail).includes(config.emailSMTPPassword));
});
test('non-implicit SMTP TLS must upgrade securely',async()=>{
  let options;const d=createAuthDelivery({...config,emailSMTPPort:587,emailSMTPSecure:false},{createTransport:o=>{options=o;return {sendMail:async()=>({accepted:['a@example.com']})};}});
  await d.send({channel:'email',address:'a@example.com',code:'123456',purpose:'register'});assert.equal(options.requireTLS,true);
});
test('Aliyun SMS uses approved template, normalized mainland number and no automatic resend',async()=>{
  let req,runtime;const d=createAuthDelivery(config,{smsClient:{async sendSmsWithOptions(r,o){req=r;runtime=o;return {body:{code:'OK'}};}}});
  await d.send({channel:'phone',address:'+8613800000000',code:'057891',purpose:'login'});
  assert.equal(req.phoneNumbers,'13800000000');assert.equal(req.templateCode,'SMS_123456');assert.equal(req.signName,'测试签名');assert.deepEqual(JSON.parse(req.templateParam),{code:'057891'});
  assert.equal(runtime.autoretry,false);assert.equal(runtime.maxAttempts,1);
});
test('provider rejections and transport errors never leak secrets or claim delivery',async()=>{
  for(const body of [{code:'isv.BUSINESS_LIMIT_CONTROL'},{code:'INVALID'}]){
    const d=createAuthDelivery(config,{smsClient:{sendSmsWithOptions:async()=>({body})}});
    await assert.rejects(d.send({channel:'phone',address:'+8613800000000',code:'123456',purpose:'login'}),e=>e.status===503&&!e.message.includes('isv.'));
  }
  const d=createAuthDelivery(config,{createTransport:()=>({async sendMail(){throw new Error(config.emailSMTPPassword);}})});
  await assert.rejects(d.send({channel:'email',address:'a@example.com',code:'123456',purpose:'register'}),e=>e.status===503&&!e.message.includes(config.emailSMTPPassword));
});
test('authentication config uses dedicated variables and does not inherit another app namespace',()=>{
  assert.equal(environmentConfig({EMAIL_SMTP_PASSWORD:'other-secret'}).emailSMTPPassword,undefined);
  const c=environmentConfig({PK_EMAIL_SMTP_PORT:'587',PK_EMAIL_SMTP_SECURE:'0',PK_AUTH_CODE_SECRET:'dedicated'});
  assert.equal(c.emailSMTPPort,587);assert.equal(c.emailSMTPSecure,false);assert.equal(c.authCodeSecret,'dedicated');
});
