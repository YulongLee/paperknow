import {resolve} from 'node:path';
import {database} from './database.mjs';
const email=process.argv[2]?.toLowerCase();if(!email)throw new Error('用法：node backend/admin.mjs 已注册邮箱');const db=database(resolve(process.env.PK_DATA_DIR||'.data','paperknow.sqlite'));const result=db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email);db.close();if(!result.changes)throw new Error('该邮箱未注册');console.log('已为指定本地账户授予管理权限');
