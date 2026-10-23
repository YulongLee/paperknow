import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {environmentConfig} from '../backend/config.mjs';
import {createAPI} from '../backend/api.mjs';
import {database} from '../backend/database.mjs';

test('OpenAlex environment keeps credentials server-side and bounds daily request settings',()=>{
 const key='synthetic-openalex-key';
 assert.equal(environmentConfig({PK_OPENALEX_API_KEY:key}).openAlexApiKey,key);
 for(const value of [undefined,'','-1','10001','Infinity','invalid','1.5',' 1'])assert.equal(environmentConfig({PK_OPENALEX_DAILY_LIMIT:value}).openAlexDailyLimit,500);
 for(const value of ['0','1','500','10000'])assert.equal(environmentConfig({PK_OPENALEX_DAILY_LIMIT:value}).openAlexDailyLimit,Number(value));
});

async function apiServer(t,config){
 const db=database(':memory:');
 const api=createAPI(db,{cancel(){}},{getAI:()=>({aiEnabled:false}),...config});
 const server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 return 'http://127.0.0.1:'+server.address().port;
}

test('public OpenAlex search receives configured auth while capabilities and results never disclose it',async t=>{
 const key='synthetic-server-only-openalex-key';let calls=0;
 const base=await apiServer(t,{openAlexApiKey:key,openAlexDailyLimit:1,literatureFetch:async(url,options)=>{
  calls++;assert.equal(new URL(url).hostname,'api.openalex.org');
  assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(new URL(url).searchParams.has('api_key'),false);
  return new Response(JSON.stringify({meta:{count:1},results:[{id:'https://openalex.org/W123',title:'Graph research',publication_year:2025,doi:'https://doi.org/10.1234/graph',authorships:[{author:{display_name:'Example Author'}}],open_access:{is_oa:true,oa_url:'https://example.org/paper'},best_oa_location:{is_oa:true,landing_page_url:'https://example.org/paper'}}]}),{headers:{'content-type':'application/json'}});
 }});
 const capText=await(await fetch(base+'/api/capabilities')).text(),cap=JSON.parse(capText);
 assert.deepEqual(cap.academicSearchSources,['crossref','europepmc','openalex','arxiv','pubmed']);
 assert.equal(cap.academicSearchSourceStatus.find(x=>x.id==='openalex').configured,true);
 assert.equal(capText.includes(key),false);assert.equal(capText.includes('PK_OPENALEX_API_KEY'),false);
 const res=await fetch(base+'/api/literature/search?q=graph%20research&source=openalex'),text=await res.text(),value=JSON.parse(text);
 assert.equal(res.status,200);assert.equal(value.items[0].source,'openalex');assert.equal(value.items[0].doi,'10.1234/graph');assert.equal(text.includes(key),false);
 const cached=await fetch(base+'/api/literature/search?q=graph%20research&source=openalex');assert.equal(cached.status,200);assert.equal(calls,1);
 const exhausted=await fetch(base+'/api/literature/search?q=different%20research&source=openalex');assert.equal(exhausted.status,503);assert.equal(calls,1);
 assert.match((await exhausted.json()).sources[0].reason,/额度/);
 assert.equal((await fetch(base+'/api/projects')).status,401);
});

test('missing OpenAlex configuration is visible without making an unauthenticated upstream request',async t=>{
 let calls=0;const base=await apiServer(t,{literatureFetch:async()=>{calls++;throw Error('Unexpected provider call');}});
 const cap=await(await fetch(base+'/api/capabilities')).json();
 assert.deepEqual(cap.academicSearchSources,['crossref','europepmc','arxiv','pubmed']);
 assert.equal(cap.academicSearchSourceStatus.find(x=>x.id==='openalex').configured,false);
 const res=await fetch(base+'/api/literature/search?q=public%20research&source=openalex');
 assert.equal(res.status,503);assert.equal((await res.json()).sources[0].status,'not_configured');assert.equal(calls,0);
});
