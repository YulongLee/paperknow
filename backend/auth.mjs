import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const digest=v=>createHash('sha256').update(v).digest('hex');
export async function hashPassword(password){const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64);return `${salt}:${hash.toString('hex')}`;}
export async function verifyPassword(password,stored){const [salt,hex]=stored.split(':');const hash=await scrypt(password,salt,64);const target=Buffer.from(hex,'hex');return target.length===hash.length&&timingSafeEqual(hash,target);}
export function createSession(db,userId){db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),userId,Date.now()+7*86400000);return token;}
export function sessionUser(db,req){const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('pk_session='))?.slice(11);if(!token)return null;return db.prepare('SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now())||null;}
export function sessionCookie(token,secure=false){return `pk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?604800:0}${secure?'; Secure':''}`;}
