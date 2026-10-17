import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {createFileService} from '../backend/file-service.mjs';
import {digest} from '../backend/auth.mjs';

function fixture(t,config){
 const db=database(':memory:');t.after(()=>db.close());
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('alice','alice@example.invalid','Alice',null,'user',new Date().toISOString());
 return {db,service:createFileService(db,config),user:{id:'alice'}};
}
test('production remote-storage policy refuses new original uploads before reading the request body',async t=>{
 const f=fixture(t,{requireRemoteStorage:true});let bodyReads=0;
 await assert.rejects(f.service({path:'/api/files',method:'POST',user:f.user,readBody:async()=>{bodyReads++;return {name:'a.txt',data:'YQ=='};}}),error=>error.status===503);
 assert.equal(bodyReads,0);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_file_uploads').get().n,0);
});
test('mandatory OSS affects new uploads without breaking access or deletion of historical local originals',async t=>{
 const f=fixture(t,{requireRemoteStorage:true}),buffer=Buffer.from('历史原件'),sha=digest(buffer);
 f.db.prepare('INSERT INTO files(id,user_id,name,kind,bytes,sha256,body,created_at,storage_provider) VALUES(?,?,?,?,?,?,?,?,?)').run('legacy','alice','历史.txt','txt',buffer.length,sha,buffer,new Date().toISOString(),'local_server_sqlite');
 const result=await f.service({path:'/api/files/legacy/download',method:'GET',user:f.user});assert.equal(result.body.toString(),'历史原件');
 const deletion=await f.service({path:'/api/files/legacy/delete',method:'POST',user:f.user,readBody:async()=>({expectedSha256:sha})});assert.equal(deletion.value.deleted,true);
});
test('mandatory OSS writes a zero-byte database body and leaves binary bytes exclusively to the storage adapter',async t=>{
 let uploaded;const f=fixture(t,{requireRemoteStorage:true,storage:{provider:'aliyun_oss',bucket:'test',async put(id,user,kind,buffer){uploaded=buffer;return `paperknow/users/${user}/originals/${id}.${kind}`;}}});
 const result=await f.service({path:'/api/files',method:'POST',user:f.user,readBody:async()=>({name:'a.txt',data:'YQ=='})});assert.equal(result.status,201);
 const row=f.db.prepare('SELECT * FROM files').get();assert.equal(Buffer.from(row.body).length,0);assert.equal(row.storage_provider,'aliyun_oss');assert.equal(uploaded.toString(),'a');
});
