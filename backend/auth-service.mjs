import {createHmac,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {createSession,hashPassword,safeUser,verifyPassword} from './auth.mjs';

const MINUTE=60000;
const HOUR=60*MINUTE;
const DAY=24*HOUR;
const CODE_LIFETIME=5*MINUTE;
const MAX_CODE_ATTEMPTS=5;
const codeMessage='验证码无效或已过期，请重新获取';
const loginMessage='账号或登录凭据不正确';

function error(status,message){return Object.assign(new Error(message),{status});}
function fail(status,message){throw error(status,message);}
function passwordValue(value){
  if(typeof value!=='string'||value.length<10||value.length>128||!value.trim())fail(400,'密码需为 10～128 位字符');
  return value;
}
function normalizeAddress(channel,value){
  if(typeof value!=='string'||value.length>254)fail(400,'请输入有效的邮箱或手机号');
  const address=value.trim();
  if(channel==='email'){
    const parts=address.split('@');
    const local=parts[0],domain=parts[1];
    // Accept one plain mailbox only. Never pass recipient lists, display names
    // or quoted/control-character syntax into a mail transport's parser.
    if(parts.length!==2||!local||local.length>64||!domain||!domain.includes('.')
      ||!/^[a-zA-Z0-9_%+-]+(?:\.[a-zA-Z0-9_%+-]+)*$/.test(local)
      ||domain.split('.').some(label=>!label.length||label.length>63||!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))){
      fail(400,'邮箱格式不正确');
    }
    return address.toLowerCase();
  }
  if(channel==='phone'){
    const phone=address.replace(/^\+86[ -]?/,'');
    if(!/^1[3-9]\d{9}$/.test(phone))fail(400,'请输入中国大陆 11 位手机号');
    return `+86${phone}`;
  }
  fail(400,'请选择邮箱或手机号');
}

function passwordIdentifier(channel,value){
  // Legacy registrations allowed wider mailbox syntax. A password lookup never
  // sends mail, so preserve those users' access without relaxing delivery input.
  if(channel==='email'){
    if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))fail(400,'邮箱格式不正确');
    return value.trim().toLowerCase();
  }
  return normalizeAddress(channel,value);
}

export function createAuthService(db,{secret,delivery,clock=Date.now,dailyLimit=100}={}){
  const secretReady=typeof secret==='string'&&Buffer.byteLength(secret)>=32;
  const now=()=>Number(clock());
  const stamp=at=>new Date(at).toISOString();
  const mac=value=>createHmac('sha256',secretReady?secret:'unconfigured-auth').update(JSON.stringify(value)).digest('hex');
  const codeHash=(challenge,code)=>mac(['code',challenge.id,challenge.channel,challenge.address,challenge.purpose,code]);
  const ready=channel=>secretReady&&delivery?.ready?.[channel]===true&&typeof delivery.send==='function';
  const globalDailyLimit=Number.isSafeInteger(dailyLimit)&&dailyLimit>0&&dailyLimit<=10000?dailyLimit:100;
  const options=()=>({password:true,emailCode:ready('email'),phoneCode:ready('phone'),registration:{email:ready('email'),phone:ready('phone')},codeLength:6,retryAfter:60});

  function transaction(work){
    db.exec('BEGIN IMMEDIATE;');
    try{const result=work();db.exec('COMMIT;');return result;}
    catch(cause){db.exec('ROLLBACK;');throw cause;}
  }

  function reserveLimits(limits,at){
    const records=limits.map(([kind,value,max,duration])=>{
      const bucket=mac(['limit',kind,value]);
      const previous=db.prepare('SELECT count,reset_at FROM auth_rate_limits WHERE bucket=?').get(bucket);
      const count=previous&&previous.reset_at>at?previous.count:0;
      if(count>=max)fail(429,'请求过于频繁，请稍后重试');
      return {bucket,count:count+1,reset:previous&&previous.reset_at>at?previous.reset_at:at+duration};
    });
    for(const item of records){
      db.prepare('INSERT INTO auth_rate_limits(bucket,count,reset_at) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at').run(item.bucket,item.count,item.reset);
    }
  }

  function findUser(channel,address){
    return db.prepare('SELECT u.*,i.verified_at FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.channel=? AND i.address=?').get(channel,address)
      ||(channel==='email'?db.prepare('SELECT *,NULL AS verified_at FROM users WHERE lower(email)=?').get(address):null);
  }

  function markVerified(row,challenge,at){
    db.prepare('INSERT INTO auth_identities(channel,address,user_id,verified_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(channel,address) DO UPDATE SET verified_at=COALESCE(auth_identities.verified_at,excluded.verified_at)').run(challenge.channel,challenge.address,row.id,stamp(at),stamp(at));
  }

  function inspectChallenge({challengeId,code}={},purpose,at){
    if(!secretReady||typeof challengeId!=='string'||challengeId.length>100||typeof code!=='string'||!/^\d{6}$/.test(code))return {failure:error(401,codeMessage)};
    const challenge=db.prepare('SELECT * FROM auth_challenges WHERE id=?').get(challengeId);
    if(!challenge||challenge.purpose!==purpose||challenge.status!=='sent'||challenge.expires_at<=at||challenge.attempts>=MAX_CODE_ATTEMPTS)return {failure:error(401,codeMessage)};
    const expected=Buffer.from(challenge.code_hash,'hex');
    const actual=Buffer.from(codeHash(challenge,code),'hex');
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual)){
      db.prepare("UPDATE auth_challenges SET attempts=attempts+1,status=CASE WHEN attempts+1>=? THEN 'locked' ELSE status END WHERE id=?").run(MAX_CODE_ATTEMPTS,challenge.id);
      return {failure:error(401,codeMessage)};
    }
    return {challenge};
  }

  function checked(outcome){if(outcome.failure)throw outcome.failure;return outcome.value??outcome.challenge;}

  function preflight(input,purpose){
    // Commit failed-attempt counts even when the public operation rejects.
    return checked(transaction(()=>inspectChallenge(input,purpose,now())));
  }

  function consume(input,purpose,work){
    return checked(transaction(()=>{
      const at=now();
      const outcome=inspectChallenge(input,purpose,at);
      if(outcome.failure)return outcome;
      db.prepare("UPDATE auth_challenges SET status='consumed',consumed_at=? WHERE id=? AND status='sent'").run(at,outcome.challenge.id);
      return work(outcome.challenge,at);
    }));
  }

  function signedIn(row,at){return {user:safeUser(db,row.id),token:createSession(db,row.id,at)};}

  async function sendCode({channel,address:rawAddress,purpose}={},ip){
    if(!['login','register','reset'].includes(purpose))fail(400,'验证码用途不正确');
    const address=normalizeAddress(channel,rawAddress);
    if(!ready(channel))fail(503,channel==='email'?'邮箱验证码服务暂未开通':'短信验证码服务暂未开通');
    const at=now();
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    const challenge={id:randomUUID(),channel,address,purpose};
    transaction(()=>{
      db.prepare('DELETE FROM auth_rate_limits WHERE reset_at<=?').run(at);
      db.prepare('DELETE FROM auth_challenges WHERE expires_at<?').run(at-DAY);
      const recent=db.prepare('SELECT created_at FROM auth_challenges WHERE channel=? AND address=? ORDER BY created_at DESC LIMIT 1').get(channel,address);
      if(recent&&recent.created_at+MINUTE>at)fail(429,'请等待 60 秒后重新获取验证码');
      reserveLimits([
        ['send-address-hour',[channel,address],6,HOUR],
        ['send-address-day',[channel,address],20,DAY],
        ['send-ip-hour',String(ip||'unknown'),20,HOUR],
        ['send-ip-day',String(ip||'unknown'),100,DAY],
        ['send-global-day','all',globalDailyLimit,DAY],
      ],at);
      db.prepare("UPDATE auth_challenges SET status='superseded' WHERE channel=? AND address=? AND status IN ('pending','sent')").run(channel,address);
      db.prepare("INSERT INTO auth_challenges(id,channel,address,purpose,code_hash,status,created_at,expires_at) VALUES(?,?,?,?,?,'pending',?,?)").run(challenge.id,channel,address,purpose,codeHash(challenge,code),at,at+CODE_LIFETIME);
    });
    try{
      await delivery.send({channel,address,code,purpose});
    }catch{
      db.prepare("UPDATE auth_challenges SET status='failed' WHERE id=? AND status='pending'").run(challenge.id);
      fail(503,'验证码发送失败，请稍后重试');
    }
    const delivered=now();
    const result=db.prepare("UPDATE auth_challenges SET status='sent',delivered_at=?,expires_at=? WHERE id=? AND status='pending' AND expires_at>?").run(delivered,delivered+CODE_LIFETIME,challenge.id,delivered);
    if(!result.changes)fail(409,'此次验证码已失效，请重新获取');
    return {challengeId:challenge.id,retryAfter:60,expiresIn:300};
  }

  async function passwordLogin({identifier,email,password}={},ip){
    const supplied=identifier??email;
    const channel=typeof supplied==='string'&&supplied.includes('@')?'email':'phone';
    const address=passwordIdentifier(channel,supplied);
    // Existing accounts retain their original password semantics, including spaces.
    const value=passwordValue(password);
    transaction(()=>{
      const at=now();
      db.prepare('DELETE FROM auth_rate_limits WHERE reset_at<=?').run(at);
      reserveLimits([
        ['password-account',[channel,address],20,10*MINUTE],
        ...(ip?[['password-ip',String(ip),50,10*MINUTE]]:[]),
      ],at);
    });
    const row=findUser(channel,address);
    const verified=await verifyPassword(value,row?.password_hash);
    if(!row||!verified)fail(401,loginMessage);
    return transaction(()=>{
      const current=db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
      // A password reset/first mailbox verification may complete during scrypt.
      if(!current||current.password_hash!==row.password_hash)fail(401,loginMessage);
      return signedIn(current,now());
    });
  }

  async function codeLogin(input={}){
    return consume(input,'login',(challenge,at)=>{
      const row=findUser(challenge.channel,challenge.address);
      if(!row)return {failure:error(401,loginMessage)};
      // Legacy email registration did not prove ownership. A verified owner must
      // not inherit a password or surviving sessions chosen by a prior registrant.
      if(!row.verified_at){
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
        db.prepare('UPDATE users SET password_hash=NULL WHERE id=?').run(row.id);
      }
      markVerified(row,challenge,at);
      return {value:signedIn(row,at)};
    });
  }

  async function register(input={}){
    const password=passwordValue(input.password);
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>30)fail(400,'昵称需为 1～30 位字符');
    preflight(input,'register');
    const hash=await hashPassword(password);
    return consume(input,'register',(challenge,at)=>{
      if(findUser(challenge.channel,challenge.address))return {failure:error(409,'该账号已注册，请直接登录或找回密码')};
      const id=randomUUID();
      db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id,challenge.channel==='email'?challenge.address:null,input.name.trim(),hash,'user',stamp(at));
      const row={id};
      markVerified(row,challenge,at);
      return {value:signedIn(row,at)};
    });
  }

  async function resetPassword(input={}){
    const password=passwordValue(input.password);
    preflight(input,'reset');
    const hash=await hashPassword(password);
    return consume(input,'reset',(challenge,at)=>{
      const row=findUser(challenge.channel,challenge.address);
      if(!row)return {failure:error(401,loginMessage)};
      markVerified(row,challenge,at);
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,row.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
      // Previously sent credentials should not create a new session after reset.
      db.prepare("UPDATE auth_challenges SET status='superseded' WHERE status IN ('sent','pending') AND EXISTS (SELECT 1 FROM auth_identities i WHERE i.user_id=? AND i.channel=auth_challenges.channel AND i.address=auth_challenges.address)").run(row.id);
      return {value:{ok:true}};
    });
  }

  return {options,sendCode,passwordLogin,codeLogin,register,resetPassword};
}
