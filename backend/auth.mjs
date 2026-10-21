import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCallback);
export const digest=value=>createHash('sha256').update(value).digest('hex');
const managementSchemas=new WeakSet();

export const accountBannedError=()=>Object.assign(new Error('账号已被封禁，请联系人工支持'),{status:403,code:'ACCOUNT_BANNED'});
export function accountIsBanned(db,userId){
  // Older, standalone authentication databases predate user management. Do not
  // cache absence: a migration may create the table on this same connection.
  if(!managementSchemas.has(db)){
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_management'").get())return false;
    managementSchemas.add(db);
  }
  return db.prepare('SELECT status FROM user_management WHERE user_id=?').get(userId)?.status==='banned';
}
export function assertAccountActive(db,userId){if(accountIsBanned(db,userId))throw accountBannedError();}

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

export function ensureOwnerAdmin(db,userOrId,ownerEmail,at=Date.now()){
  const userId=typeof userOrId==='string'?userOrId:userOrId?.id;
  const email=typeof ownerEmail==='string'?ownerEmail.trim().toLowerCase():'';
  if(!userId)return null;
  assertAccountActive(db,userId);
  if(!email)return safeUser(db,userId);
  // Only a persisted, verified identity grants ownership. Neither the legacy
  // users.email field nor any request-provided role/name can elevate a user.
  db.exec('SAVEPOINT verified_owner_role;');
  try{
    const updated=db.prepare(`UPDATE users SET role='admin' WHERE id=? AND role!='admin'
      AND EXISTS(SELECT 1 FROM auth_identities i WHERE i.user_id=users.id AND i.channel='email'
        AND lower(i.address)=? AND i.verified_at IS NOT NULL AND length(trim(i.verified_at))>0)`).run(userId,email);
    if(updated.changes){
      db.prepare('INSERT INTO admin_audit(id,actor_id,action,target_type,target_id,detail,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(),userId,'owner.verified','user',userId,JSON.stringify({method:'verified_email'}),new Date(at).toISOString());
    }
    db.exec('RELEASE verified_owner_role;');
  }catch(cause){
    db.exec('ROLLBACK TO verified_owner_role; RELEASE verified_owner_role;');
    throw cause;
  }
  return safeUser(db,userId);
}
export const ensureOwnerRole=ensureOwnerAdmin;

export function createSession(db,userId,at=Date.now()){
  assertAccountActive(db,userId);
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(at);
  const token=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),userId,at+7*86400000);
  return token;
}

export function sessionUser(db,req,ownerEmail){
  const token=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('pk_session='))?.slice(11);
  if(!token)return null;
  const row=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now());
  if(!row)return null;
  if(accountIsBanned(db,row.id))return null;
  return ensureOwnerAdmin(db,row.id,ownerEmail);
}

export function sessionCookie(token,secure=false){
  return `pk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?604800:0}${secure?'; Secure':''}`;
}
