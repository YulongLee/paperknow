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
