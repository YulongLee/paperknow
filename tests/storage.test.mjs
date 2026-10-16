import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorage,fileBytes} from '../backend/storage.mjs';
const settings={ossBucket:'test-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'id',ossAccessKeySecret:'secret'};
test('OSS incomplete settings and invalid project prefixes fail closed',()=>{
 assert.equal(createStorage({}),null);
 assert.throws(()=>createStorage({ossBucket:'test-bucket'}),/配置不完整/);
 assert.throws(()=>createStorage({...settings,ossPrefix:'../other/'},{}),/项目目录无效/);
 assert.throws(()=>createStorage({...settings,ossEndpoint:'http://oss-cn-shanghai.aliyuncs.com'},{}),/HTTPS/);
});
test('local originals remain readable with OSS enabled and foreign object paths cannot be fetched',async()=>{
 let reads=0;const store=createStorage(settings,{async get(){reads++;}});
 assert.equal((await fileBytes({body:Buffer.from('旧原件'),storage_provider:'local_server_sqlite'},store)).toString(),'旧原件');
 await assert.rejects(store.read({storage_bucket:'test-bucket',storage_key:'other/users/u/originals/a.txt',user_id:'u'}),/不匹配/);
 await assert.rejects(store.read({storage_bucket:'foreign-bucket',storage_key:'paperknow/users/u/originals/a.txt',user_id:'u'}),/不匹配/);
 assert.equal(reads,0);
 await assert.rejects(fileBytes({storage_provider:'aliyun_oss'},null),/请配置存储/);
});

test('OSS removal accepts only the exact owned project object and hides provider failure details',async()=>{
 const keys=[];let unavailable=false;const store=createStorage(settings,{async delete(key){keys.push(key);if(unavailable)throw new Error('secret-provider-trace');}});
 const row={id:'file-1',user_id:'user-1',kind:'txt',storage_bucket:'test-bucket',storage_key:'paperknow/users/user-1/originals/file-1.txt'};
 for(const change of [{id:'other'},{user_id:'other'},{kind:'html'},{storage_bucket:'other'},{storage_key:'paperknow/users/user-1/originals/other.txt'},{storage_key:'other/users/user-1/originals/file-1.txt'}])await assert.rejects(store.remove({...row,...change}),/不匹配/);
 assert.equal(keys.length,0);await store.remove(row);assert.deepEqual(keys,[row.storage_key]);unavailable=true;
 await assert.rejects(store.remove(row),error=>error.message==='OSS 原件删除未完成，请稍后重试'&&!error.message.includes('secret'));
});

test('an ambiguous OSS upload failure attempts cleanup of its exact newly allocated object',async()=>{
 const deleted=[];const store=createStorage(settings,{async put(){throw new Error('ambiguous-timeout-secret');},async delete(key){deleted.push(key);}});
 await assert.rejects(store.put('new-file','owner','txt',Buffer.from('original')),error=>error.message==='OSS 文件保存失败，请稍后重试');assert.deepEqual(deleted,['paperknow/users/owner/originals/new-file.txt']);
});
