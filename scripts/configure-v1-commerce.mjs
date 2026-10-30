import {DatabaseSync} from 'node:sqlite';
import {existsSync,chmodSync} from 'node:fs';
import {planV1Commerce,applyV1Commerce} from '../backend/v1-commercial-launch.mjs';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(!args.includes('--database'))throw Error('Required --database /absolute/path');
const path=value('--database');if(!path.startsWith('/')||!existsSync(path))throw Error('Existing absolute database path required');
const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
try{const plan=planV1Commerce(db);if(!args.includes('--apply'))console.log(JSON.stringify(plan,null,2));else{
 if(value('--expected')!==plan.expected)throw Error('Expected preview hash does not match');
 const backup=path+'.v1-'+Date.now()+'.bak';db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);
 const applied=applyV1Commerce(db,plan.expected);console.log(JSON.stringify({version:applied.version,expected:applied.expected,backup,changedProducts:applied.products.map(p=>p.id)},null,2));
}}finally{db.close();}
