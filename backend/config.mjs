import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

export function loadLocalEnvironment(){
  const file=resolve('.env');
  if(existsSync(file))process.loadEnvFile(file);
}
export function environmentConfig(env=process.env){
  return {agentEnabled:env.PK_AGENT_ENABLED==='1',aiURL:env.PK_AI_URL,aiKey:env.PK_AI_KEY,aiModel:env.PK_AI_MODEL,secure:env.PK_SECURE_COOKIE==='1',trustProxy:env.PK_TRUST_PROXY==='1',
    ownerEmail:String(env.PK_OWNER_EMAIL||'').trim().toLowerCase(),paymentConfigKey:env.PK_PAYMENT_CONFIG_KEY,
    authCodeSecret:env.PK_AUTH_CODE_SECRET,authDailyLimit:/^[1-9]\d{0,3}$/.test(env.PK_AUTH_DAILY_SEND_LIMIT||'')?Number(env.PK_AUTH_DAILY_SEND_LIMIT):100,
    emailSMTPHost:env.PK_EMAIL_SMTP_HOST,emailSMTPPort:Number(env.PK_EMAIL_SMTP_PORT||465),emailSMTPSecure:env.PK_EMAIL_SMTP_SECURE!=='0',
    emailSMTPUser:env.PK_EMAIL_SMTP_USER,emailSMTPPassword:env.PK_EMAIL_SMTP_PASSWORD,emailFrom:env.PK_EMAIL_FROM,
    smsAccessKeyId:env.PK_SMS_ACCESS_KEY_ID,smsAccessKeySecret:env.PK_SMS_ACCESS_KEY_SECRET,smsSignName:env.PK_SMS_SIGN_NAME,
    smsTemplateCode:env.PK_SMS_TEMPLATE_CODE,smsCodeParam:env.PK_SMS_CODE_PARAM||'code',
    ossBucket:env.PK_OSS_BUCKET,ossEndpoint:env.PK_OSS_ENDPOINT,ossRegion:env.PK_OSS_REGION,
    ossPrefix:env.PK_OSS_PREFIX||'paperknow/',ossAccessKeyId:env.PK_OSS_ACCESS_KEY_ID,ossAccessKeySecret:env.PK_OSS_ACCESS_KEY_SECRET};
}
export function modelSettings(db,config){
  return {get(){
    const row=db.prepare("SELECT value FROM service_settings WHERE name='ai'").get();
    const saved=row?JSON.parse(row.value):{};
    return {...config,aiModel:saved.model??config.aiModel,aiEnabled:saved.enabled??true};
  },save(model,enabled,actor){
    db.prepare("INSERT INTO service_settings(name,value,updated_by,updated_at) VALUES('ai',?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at").run(JSON.stringify({model,enabled}),actor,new Date().toISOString());
  }};
}
export const aiReady=config=>Boolean(config.aiEnabled!==false&&config.aiURL&&config.aiKey&&config.aiModel);
export function publicModelSettings(config){
  return {model:config.aiModel||'',enabled:config.aiEnabled!==false,configured:Boolean(config.aiURL&&config.aiKey),ready:aiReady(config),provider:config.aiURL?new URL(config.aiURL).hostname:null};
}
