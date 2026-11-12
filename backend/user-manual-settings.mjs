import {isIP} from 'node:net';
export const defaultManualUrl='https://pwksrh0z1i6.feishu.cn/drive/folder/ZkQBfwsoslyrykd4wuhcs0XFncc';
export function validManualUrl(input){
 if(typeof input!=='string'||input.length>2048||/[\x00-\x20\x7f]/.test(input))return false;
 try{const u=new URL(input),h=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!isIP(h)&&h.includes('.')&&!h.endsWith('.local')&&!h.endsWith('.localhost')&&!h.endsWith('.internal');}catch{return false;}
}
export function readManualUrl(db){const row=db.prepare("SELECT value FROM service_settings WHERE name='user_manual_url'").get();return validManualUrl(row?.value)?row.value:defaultManualUrl;}
export function saveManualUrl(db,url,actor){if(!validManualUrl(url))throw Object.assign(new Error('请输入有效的 HTTPS 手册地址。'),{status:400});db.prepare("INSERT INTO service_settings(name,value,updated_by,updated_at) VALUES('user_manual_url',?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at").run(url,actor,new Date().toISOString());}
