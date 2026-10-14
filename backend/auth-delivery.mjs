import nodemailer from 'nodemailer';
import SMS from '@alicloud/dysmsapi20170525';
import OpenAPI from '@alicloud/openapi-client';
import TeaUtil from '@alicloud/tea-util';

const unavailable = message => Object.assign(new Error(message), {status:503});
function senderAddress(value='') {
  const address=value.match(/<([^<>]+)>\s*$/)?.[1]||value;
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)?address:'';
}

// Only delivery credentials are shared with the other product. Content, codes and
// account records belong to PaperKnow. Never enable transport debug logging.
export function createAuthDelivery(config={}, dependencies={}) {
  const from=senderAddress(config.emailFrom);
  const ready={
    email:Boolean(config.emailSMTPHost&&config.emailSMTPUser&&config.emailSMTPPassword&&from&&[465,587,25,80].includes(config.emailSMTPPort)),
    phone:Boolean(config.smsAccessKeyId&&config.smsAccessKeySecret&&config.smsSignName&&/^SMS_\d+$/.test(config.smsTemplateCode||'')),
  };
  let transport, sms;
  return {ready, async send({channel,address,code,purpose}) {
    if(!/^\d{6}$/.test(code)||!['login','register','reset'].includes(purpose))throw unavailable('验证码发送参数无效');
    if(channel==='email') {
      if(typeof address!=='string'||!address||address.length>254||/[\s<>(),;:"\\\r\n]/.test(address)||!senderAddress(address))throw unavailable('邮件收件地址无效');
      if(!ready.email)throw unavailable('邮箱验证码服务暂未开通，请使用密码登录');
      try {
        transport ||= (dependencies.createTransport||nodemailer.createTransport)({
          host:config.emailSMTPHost, port:config.emailSMTPPort, secure:config.emailSMTPSecure,
          requireTLS:!config.emailSMTPSecure, tls:{minVersion:'TLSv1.2'},
          auth:{user:config.emailSMTPUser,pass:config.emailSMTPPassword},
          connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,
        });
        const action={login:'登录',register:'注册',reset:'重置密码'}[purpose];
        const info=await transport.sendMail({from:{name:'PaperKnow',address:from},to:address,
          subject:`PaperKnow · ${action}验证码`,
          text:`你正在${action} PaperKnow 账户。\n\n验证码：${code}\n\n5 分钟内有效，请勿转发。若非本人操作，请忽略本邮件。`,
          html:`<div style="max-width:520px;margin:auto;padding:32px;font-family:Arial,sans-serif;color:#182b4b"><h2 style="color:#2864ff">PaperKnow</h2><h3>${action}验证</h3><p>请在 PaperKnow 页面输入以下验证码：</p><div style="padding:22px;background:#f0f5ff;border-radius:12px;font-size:32px;letter-spacing:8px;color:#2864ff;text-align:center">${code}</div><p>5 分钟内有效，请勿转发。若非本人操作，请忽略本邮件。</p></div>`,
        });
        if(!info.accepted?.length||info.rejected?.length)throw new Error('Recipient rejected');
      } catch {throw unavailable('邮件暂时发送失败，请稍后重试');}
      return;
    }
    if(channel==='phone') {
      if(typeof address!=='string'||!/^\+861[3-9]\d{9}$/.test(address))throw unavailable('短信收件号码无效');
      if(!ready.phone)throw unavailable('短信验证码服务暂未开通，请使用邮箱或密码登录');
      try {
        sms ||= dependencies.smsClient||new SMS.default(new OpenAPI.Config({
          accessKeyId:config.smsAccessKeyId,accessKeySecret:config.smsAccessKeySecret,
          endpoint:'dysmsapi.aliyuncs.com',protocol:'HTTPS',
        }));
        const response=await sms.sendSmsWithOptions(new SMS.SendSmsRequest({
          phoneNumbers:address.replace(/^\+86/,''),signName:config.smsSignName,
          templateCode:config.smsTemplateCode,
          templateParam:JSON.stringify({[config.smsCodeParam||'code']:code}),
        }),new TeaUtil.RuntimeOptions({autoretry:false,maxAttempts:1,connectTimeout:10000,readTimeout:10000}));
        if(response.body?.code!=='OK')throw new Error('Provider rejected');
      } catch {throw unavailable('短信暂时发送失败，请稍后重试或使用邮箱登录');}
      return;
    }
    throw unavailable('不支持此验证码发送方式');
  }};
}
