import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import {environmentConfig} from '../backend/config.mjs';
import {createAPI} from '../backend/api.mjs';
import {database} from '../backend/database.mjs';

test('AMiner environment uses server credentials and a bounded conservative daily request limit',()=>{
 const config=environmentConfig({PK_AMINER_API_KEY:'synthetic-signing-secret',PK_AMINER_USER_ID:'synthetic-user-id',PK_AMINER_TOKEN:'synthetic-console-token'});
 assert.equal(config.aminerEnabled,false);assert.equal(config.aminerApiKey,'synthetic-signing-secret');assert.equal(config.aminerUserId,'synthetic-user-id');assert.equal(config.aminerToken,'synthetic-console-token');assert.equal(config.aminerDailyLimit,100);
 assert.equal(environmentConfig({PK_AMINER_ENABLED:'1'}).aminerEnabled,true);for(const value of [undefined,'','0','true','false',' 1'])assert.equal(environmentConfig({PK_AMINER_ENABLED:value}).aminerEnabled,false);
 for(const value of [undefined,'','-1','10001','Infinity','invalid','1.5',' 1'])assert.equal(environmentConfig({PK_AMINER_DAILY_LIMIT:value}).aminerDailyLimit,100);
 for(const value of ['0','1','100','10000'])assert.equal(environmentConfig({PK_AMINER_DAILY_LIMIT:value}).aminerDailyLimit,Number(value));
});

test('AMiner API uses an existing server-only token without requiring a signing secret',async t=>{
 const payload={user_id:'synthetic-console-user',exp:Math.floor(Date.now()/1000)+300},content=Buffer.from(JSON.stringify({alg:'HS256',sign_type:'SIGN'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url'),token=content+'.'+createHmac('sha256','synthetic-console-issuer').update(content).digest('base64url');let calls=0;
 const base=await apiServer(t,{...environmentConfig({PK_AMINER_ENABLED:'1',PK_AMINER_TOKEN:token}),literatureFetch:async(url,options)=>{
  calls++;assert.equal(new URL(url).hostname,'datacenter.aminer.cn');assert.equal(options.headers.Authorization,token);
  return new Response(JSON.stringify({code:200,success:true,data:[{id:'507f1f77bcf86cd799439011',title:'Console token search result'}],total:1}),{headers:{'content-type':'application/json'}});
 }});
 const capText=await(await fetch(base+'/api/capabilities')).text();assert.equal(JSON.parse(capText).academicSearchSources.includes('aminer'),true);
 const result=await fetch(base+'/api/literature/search?q=console%20search&source=aminer'),resultText=await result.text();assert.equal(result.status,200);assert.equal(JSON.parse(resultText).items[0].source,'aminer');assert.equal(calls,1);
 for(const text of [capText,resultText])for(const secret of [token,payload.user_id,'PK_AMINER_TOKEN'])assert.equal(text.includes(secret),false);
});

test('AMiner API keeps valid token configuration closed unless the publication switch is enabled',async t=>{
 const payload={user_id:'synthetic-console-user',exp:Math.floor(Date.now()/1000)+300},content=Buffer.from(JSON.stringify({alg:'HS256',sign_type:'SIGN'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url'),token=content+'.'+createHmac('sha256','synthetic-console-issuer').update(content).digest('base64url');let calls=0;
 const base=await apiServer(t,{...environmentConfig({PK_AMINER_TOKEN:token}),literatureFetch:async url=>{
  calls++;const host=new URL(url).hostname;assert.notEqual(host,'datacenter.aminer.cn');
  return host==='api.crossref.org'?new Response(JSON.stringify({message:{items:[]}}),{headers:{'content-type':'application/json'}}):new Response(JSON.stringify({resultList:{result:[]}}),{headers:{'content-type':'application/json'}});
 }});
 const cap=await(await fetch(base+'/api/capabilities')).json();assert.equal(cap.academicSearchSources.includes('aminer'),false);assert.equal(cap.academicSearchSourceStatus.find(row=>row.id==='aminer').configured,false);
 const direct=await fetch(base+'/api/literature/search?q=console%20search&source=aminer');assert.equal(direct.status,503);assert.equal((await direct.json()).sources[0].status,'not_configured');assert.equal(calls,0);
 const aggregate=await fetch(base+'/api/literature/search?q=console%20search&source=all');assert.equal(aggregate.status,200);assert.equal((await aggregate.json()).sources.some(row=>row.id==='aminer'),false);assert.equal(calls,2);
});

async function apiServer(t,config){
 const db=database(':memory:'),api=createAPI(db,{cancel(){}},{getAI:()=>({aiEnabled:false}),...config});
 const server=http.createServer((req,res)=>void api(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 return 'http://127.0.0.1:'+server.address().port;
}

test('AMiner public search passes server JWT auth while capabilities, results and budget failures remain private',async t=>{
 const apiKey='synthetic-server-aminer-secret',userId='synthetic-server-user';let calls=0,token;
 const base=await apiServer(t,{aminerEnabled:true,aminerApiKey:apiKey,aminerUserId:userId,aminerDailyLimit:1,literatureFetch:async(url,options)=>{
  calls++;assert.equal(new URL(url).hostname,'datacenter.aminer.cn');assert.equal(new URL(url).searchParams.get('page'),'1');assert.equal(new URL(url).searchParams.get('size'),'10');token=options.headers.Authorization;assert.doesNotMatch(token,/^Bearer /);assert.equal(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).user_id,userId);
  return new Response(JSON.stringify({code:200,success:true,data:[{id:'507f1f77bcf86cd799439011',title:'Public research metadata',year:2025,first_author:'Example Author',doi:'10.1234/public'}],total:1,diagnostics:apiKey}),{headers:{'content-type':'application/json'}});
 }});
 const capabilityText=await(await fetch(base+'/api/capabilities')).text(),cap=JSON.parse(capabilityText);assert.deepEqual(cap.academicSearchSources,['crossref','europepmc','aminer']);assert.equal(cap.academicSearchSourceStatus.find(row=>row.id==='aminer').configured,true);
 const result=await fetch(base+'/api/literature/search?q=public%20research&source=aminer'),text=await result.text(),value=JSON.parse(text);assert.equal(result.status,200);assert.equal(value.items[0].source,'aminer');assert.equal(value.items[0].url,'https://www.aminer.cn/pub/507f1f77bcf86cd799439011');assert.equal(value.items[0].doi,'10.1234/public');
 assert.equal((await fetch(base+'/api/literature/search?q=public%20research&source=aminer')).status,200);assert.equal(calls,1);
 const exhausted=await fetch(base+'/api/literature/search?q=another%20topic&source=aminer'),exhaustedText=await exhausted.text();assert.equal(exhausted.status,503);assert.equal(JSON.parse(exhaustedText).sources[0].status,'budget_exhausted');assert.equal(calls,1);
 for(const output of [capabilityText,text,exhaustedText])for(const secret of [apiKey,userId,token,'PK_AMINER_API_KEY','PK_AMINER_USER_ID'])assert.equal(output.includes(secret),false);
 assert.equal((await fetch(base+'/api/projects')).status,401);
});

test('AMiner missing configuration and unsupported access filters never call the provider',async t=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not call');};
 const base=await apiServer(t,{aminerEnabled:true,literatureFetch:fetchImpl});
 const cap=await(await fetch(base+'/api/capabilities')).json();assert.deepEqual(cap.academicSearchSources,['crossref','europepmc']);assert.equal(cap.academicSearchSourceStatus.find(row=>row.id==='aminer').configured,false);
 const result=await fetch(base+'/api/literature/search?q=public%20research&source=aminer');assert.equal(result.status,503);assert.equal((await result.json()).sources[0].status,'not_configured');
 const configured=await apiServer(t,{aminerEnabled:true,aminerApiKey:'synthetic-secret',aminerUserId:'synthetic-user',literatureFetch:fetchImpl});
 const unsupported=await fetch(configured+'/api/literature/search?q=public%20research&source=aminer&openAccess=true');assert.equal(unsupported.status,200);assert.equal((await unsupported.json()).sources[0].status,'unsupported_filter');assert.equal(calls,0);
});

test('AMiner HTTP-200 business errors surface as public failures without diagnostics or repeated calls',async t=>{
 let calls=0;const key='synthetic-error-secret',base=await apiServer(t,{aminerEnabled:true,aminerApiKey:key,aminerUserId:'synthetic-user',literatureFetch:async()=>{calls++;return new Response(JSON.stringify({code:40306,success:false,message:key+' private diagnostics'}),{headers:{'content-type':'application/json'}});}});
 const response=await fetch(base+'/api/literature/search?q=public%20research&source=aminer'),text=await response.text();assert.equal(response.status,503);assert.equal(JSON.parse(text).sources[0].status,'rate_limited');assert.doesNotMatch(text,/synthetic-error-secret|private diagnostics/);
 assert.equal((await fetch(base+'/api/literature/search?q=another%20topic&source=aminer')).status,503);assert.equal(calls,1);
});
