import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {connect} from 'node:tls';
import {createAgentRelay} from '../backend/agent-runtime.mjs';
const settings={baseURL:'https://provider.example.com/anthropic',model:'fixture',apiKey:'not-a-real-key',maxTurns:12,maxOutputTokens:256};
const addresses=[{address:'8.8.8.8',family:4},{address:'1.1.1.1',family:4}];
async function fixture(t,{trusted=true,wrongName=false,failFirst=false,interrupt=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'paperknow-tls-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=provider.example.com','-addext',wrongName?'subjectAltName=DNS:wrong.example.com':'subjectAltName=DNS:provider.example.com'],{stdio:'ignore'});
 const cert=await readFile(join(dir,'cert.pem')),key=await readFile(join(dir,'key.pem'));let received=0,connections=0;
 const server=createServer({key,cert},(req,res)=>{received++;if(interrupt){req.socket.destroy();return;}req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'message-'+received,type:'message',stop_reason:'end_turn',content:[],usage:{input_tokens:1,output_tokens:1}}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const connector=options=>{connections++;assert.equal(options.servername,'provider.example.com');assert.equal(options.rejectUnauthorized,true);return connect({...options,host:'127.0.0.1',port:failFirst&&connections===1?1:server.address().port,...(trusted?{ca:cert}:{})});};
 const relay=await createAgentRelay(settings,{resolver:async()=>addresses,connectTls:connector});t.after(()=>relay.close());
 const send=()=>fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':relay.token},body:JSON.stringify({model:'fixture',max_tokens:32})});
 return {send,relay,get received(){return received;},get connections(){return connections;}};
}
test('trusted matching TLS socket is reused for one request and failed address is safe to skip',async t=>{const f=await fixture(t,{failFirst:true});const r=await f.send();assert.equal(r.status,200);await r.text();assert.equal(f.received,1);assert.equal(f.connections,2);assert.equal(f.relay.providerUsage.requests,1);assert.equal(f.relay.providerUsage.complete,true);});
for(const config of [{trusted:false},{wrongName:true}])test('invalid TLS trust or hostname sends no model request '+JSON.stringify(config),async t=>{const f=await fixture(t,config);const r=await f.send();assert.equal(r.status,503);assert.equal(f.received,0);assert.equal(f.connections,2);assert.equal(f.relay.providerUsage.requests,0);});
test('request interruption after TLS is not replayed and usage remains unknown',async t=>{const f=await fixture(t,{interrupt:true});const r=await f.send();assert.equal(r.status,502);assert.equal(f.received,1);assert.equal(f.connections,1);assert.equal(f.relay.providerUsage.complete,false);assert.equal(f.relay.networkFailure.phase,'request');});
test('concurrent requests use separate verified connections',async t=>{const f=await fixture(t);const out=await Promise.all([f.send(),f.send()]);for(const r of out){assert.equal(r.status,200);await r.text();}assert.equal(f.connections,2);assert.equal(f.received,2);assert.equal(f.relay.providerUsage.requests,2);});
test('cancellation while negotiating TLS sends no model request or usage',async t=>{
 const {createServer:createTcp}=await import('node:net'),controller=new AbortController();let accept;const accepted=new Promise(resolve=>accept=resolve),sockets=[];
 const server=createTcp(socket=>{sockets.push(socket);socket.on('error',()=>{});accept();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const s of sockets)s.destroy();return new Promise(resolve=>server.close(resolve));});
 const relay=await createAgentRelay(settings,{signal:controller.signal,resolver:async()=>addresses,connectTls:options=>connect({...options,host:'127.0.0.1',port:server.address().port})});t.after(()=>relay.close());
 const pending=fetch(relay.baseURL+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':relay.token},body:JSON.stringify({model:'fixture',max_tokens:32})});await accepted;controller.abort();const response=await pending;assert.equal(response.status,499);assert.equal(relay.providerUsage.requests,0);assert.equal(relay.reservedTokens,0);
});
test('client disconnect cancels pending TLS and releases reservation without sending',async t=>{
 const {createServer:createTcp}=await import('node:net');let accept;const accepted=new Promise(resolve=>accept=resolve),sockets=[];let connections=0;
 const server=createTcp(socket=>{sockets.push(socket);socket.on('error',()=>{});accept();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const s of sockets)s.destroy();return new Promise(resolve=>server.close(resolve));});
 const relay=await createAgentRelay({...settings,maxTotalTokens:100000},{resolver:async()=>addresses,connectTls:options=>{connections++;return connect({...options,host:'127.0.0.1',port:server.address().port});}});t.after(()=>relay.close());
 const controller=new AbortController();const pending=fetch(relay.baseURL+'/v1/messages',{signal:controller.signal,method:'POST',headers:{'Content-Type':'application/json','x-api-key':relay.token},body:JSON.stringify({model:'fixture',max_tokens:32})});await accepted;controller.abort();await assert.rejects(pending);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(connections,1);assert.equal(relay.providerUsage.requests,0);assert.equal(relay.reservedTokens,0);
});
test('TLS handshake timeout moves to next address before any HTTP request',async t=>{
 const {connectVerifiedAgentSocket}=await import('../backend/agent-runtime.mjs');const {EventEmitter}=await import('node:events');let attempts=0,destroyed=0;
 const fake=()=>{attempts++;const socket=new EventEmitter();socket.destroy=()=>{destroyed++;};socket.authorized=true;if(attempts===2)queueMicrotask(()=>socket.emit('secureConnect'));return socket;};
 const selected=await connectVerifiedAgentSocket(addresses,'provider.example.com',{connect:fake,timeoutMs:10});assert.equal(attempts,2);assert.equal(destroyed,1);assert.deepEqual(selected.address,addresses[1]);selected.socket.destroy();
});
