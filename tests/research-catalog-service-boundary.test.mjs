import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {createToolRunService} from '../backend/tool-run-service.mjs';
import {researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';

test('forged or cross-domain selections are rejected by both quote and submission before config, billing, budget or provider access',async t=>{
 const db=database(':memory:');t.after(()=>db.close());const at=new Date().toISOString();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('alice','alice@example.test','Alice',null,'user',at);
 const calls={settings:0,quote:0,reserve:0,budget:0,provider:0},service=createToolRunService(db,{getResearchImageSettings:()=>{calls.settings++;throw Error('invalid catalog must not access credentials');},billing:{quote(){calls.quote++;throw Error('invalid catalog must not reach billing');},reserve(){calls.reserve++;throw Error('invalid catalog must not reserve credits');}},modelBudget:{check(){calls.budget++;}},researchImageRunner(){calls.provider++;throw Error('invalid catalog must not dispatch');}});
 const pro=researchFigureChoices('professional').find(row=>row.familyLabel),base={title:'明确的科研图',text:'请按真实资料绘制结构和关系，不增加实验数据。',language:'中文',mode:'professional',materials:[],context:{categoryId:pro.categoryId,figureType:pro.id,aspectRatio:'16:9',palette:'academic'}};
 const mismatches=[{...base,context:{...base.context,figureType:'unknown-scene'}},{...base,context:{...base.context,categoryId:'basic'}},{...base,mode:'basic'},{...base,context:{...base.context,figureType:'flowchart'}},{...base,context:{...base.context,familyId:'forged-family'}}];
 for(const snapshot of mismatches)for(const endpoint of ['/quote','/jobs']){
  const body={kind:'research',operation:'image',snapshot,...(endpoint==='/jobs'?{consent:true,clientKey:'invalid-selection-fixture',billingToken:'invalid-fixture-token'}:{})};
  await assert.rejects(()=>service.handle({path:'/api/tool-runs'+endpoint,method:'POST',user:{id:'alice'},readBody:async()=>body}),{status:400});
 }
 assert.deepEqual(calls,{settings:0,quote:0,reserve:0,budget:0,provider:0});assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM tool_runs').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM tool_quotes').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM research_image_usage').get().n,0);
});
