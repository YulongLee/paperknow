import test,{after} from 'node:test';
import {database} from '../backend/database.mjs';
const databases=[];after(()=>databases.forEach(db=>db.close()));
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAPI} from '../backend/api.mjs';
import {environmentConfig} from '../backend/config.mjs';

function authRequests(config={}){
  // Initialization prepares billing tables; invalid credentials still consume the IP quota.
  const db=database(':memory:');databases.push(db);const api=createAPI(db,null,config);
  return async(remoteAddress,headers={},path='/api/auth/login')=>{
    const req=Object.assign(Readable.from([Buffer.from('{}')]),{
      method:'POST',url:path,socket:{remoteAddress},
      headers:{host:'paperknow.test',origin:'http://paperknow.test','content-type':'application/json',...headers},
    });
    let status;
    await api(req,{writeHead(value){status=value;},end(){}});
    return status;
  };
}

test('proxy trust is disabled by default and enabled only by an explicit environment value',()=>{
  assert.equal(environmentConfig({}).trustProxy,false);
  for(const value of ['0','true','yes','',true,1])assert.equal(environmentConfig({PK_TRUST_PROXY:value}).trustProxy,false);
  assert.equal(environmentConfig({PK_TRUST_PROXY:'1'}).trustProxy,true);
});

test('trusted loopback proxies give independent IPv4 and IPv6 clients separate auth quotas',async()=>{
  for(const proxy of ['127.0.0.1','::1','::ffff:127.0.0.1']){
    const request=authRequests({trustProxy:true});
    for(let i=0;i<30;i++)assert.equal(await request(proxy,{'x-real-ip':'198.51.100.10'}),400);
    assert.equal(await request(proxy,{'x-real-ip':'198.51.100.10'}),429);
    assert.equal(await request(proxy,{'x-real-ip':'198.51.100.11'}),400);
    assert.equal(await request(proxy,{'x-real-ip':'2001:db8::10'}),400);
    // Register and login retain their shared quota for the same client.
    assert.equal(await request(proxy,{'x-real-ip':'198.51.100.10'},'/api/auth/register'),429);
  }
});

test('disabled or non-boolean proxy trust cannot be bypassed with changing forwarded headers',async()=>{
  for(const config of [{},{trustProxy:false},{trustProxy:'true'},{trustProxy:1}]){
    const request=authRequests(config);
    for(let i=0;i<30;i++)assert.equal(await request('127.0.0.1',{'x-real-ip':`198.51.100.${i+1}`}),400);
    assert.equal(await request('127.0.0.1',{'x-real-ip':'203.0.113.1'}),429);
  }
});

test('connections outside the trusted loopback list cannot spoof a fresh client quota',async()=>{
  for(const remoteAddress of ['198.51.100.20','::ffff:198.51.100.20','127.0.0.2','10.0.0.1']){
    const request=authRequests({trustProxy:true});
    for(let i=0;i<30;i++)assert.equal(await request(remoteAddress,{'x-real-ip':`203.0.113.${i+1}`}),400);
    assert.equal(await request(remoteAddress,{'x-real-ip':'203.0.113.100'}),429);
    assert.equal(await request(remoteAddress,{'x-forwarded-for':'203.0.113.101'}),429);
  }
});

test('missing, invalid and multiple client IP headers fall back to the socket quota',async()=>{
  const request=authRequests({trustProxy:true});
  for(let i=0;i<30;i++)assert.equal(await request('127.0.0.1'),400);
  for(const forwarded of [undefined,'','not-an-ip','999.1.1.1','198.51.100.1:443','[2001:db8::1]',
    '198.51.100.1, 198.51.100.2',['198.51.100.1','198.51.100.2'],['198.51.100.1'],' 198.51.100.1']){
    assert.equal(await request('127.0.0.1',{'x-real-ip':forwarded}),429);
  }
  assert.equal(await request('127.0.0.1',{'x-forwarded-for':'198.51.100.1'}),429);
  assert.equal(await request('127.0.0.1',{'x-real-ip':'198.51.100.1'}),400);
});
