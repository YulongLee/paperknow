import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCallback);
export const digest=value=>createHash('sha256').update(value).digest('hex');

export async function hashPassword(password){
  const salt=randomBytes(16).toString('hex');
  const hash=await scrypt(password,salt,64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password,stored){
  // Code-only accounts have no password. Still perform the same expensive work.
  const valid=typeof stored==='string'&&/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored);
  const [salt,hex]=(valid?stored:`${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const hash=await scrypt(password,salt,64);
  return valid&&timingSafeEqual(hash,Buffer.from(hex,'hex'));
}

export function safeUser(db,userOrId){
  const row=typeof userOrId==='string'?db.prepare('SELECT * FROM users WHERE id=?').get(userOrId):userOrId;
  if(!row)return null;
  const identities=db.prepare('SELECT channel,address,verified_at FROM auth_identities WHERE user_id=?').all(row.id);
  const email=identities.find(identity=>identity.channel==='email');
  const phone=identities.find(identity=>identity.channel==='phone');
  return {id:row.id,email:email?.address||row.email||null,phone:phone?.address||null,name:row.name,role:row.role,
    emailVerifiedAt:email?.verified_at||null,phoneVerifiedAt:phone?.verified_at||null,hasPassword:Boolean(row.password_hash)};
}

export function createSession(db,userId,at=Date.now()){
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(at);
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),userId,at+7*86400000);
  return token;
}

export function sessionUser(db,req){
  const token=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('pk_session='))?.slice(11);
  if(!token)return null;
  const row=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now());
  return safeUser(db,row);
}

export function sessionCookie(token,secure=false){
  return `pk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?604800:0}${secure?'; Secure':''}`;
}
