import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createQuestionnaireService,normalizeQuestionnaireContent} from '../backend/questionnaire-service.mjs';

const content=()=>({title:'数字阅读服务问卷',audience:'匿名参与者',purpose:'合成验收资料，不代表真实研究',introduction:'自愿匿名参与，请勿填写敏感信息。',questions:[{id:'reading-entry',type:'single',title:'您偏好的服务入口？',options:['网页','客户端'],required:false}]});
function fixture(t){
 const db=database(':memory:'),at=new Date().toISOString();for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.test',id,null,'user',at);
 const service=createQuestionnaireService(db);t.after(()=>db.close());
 const request=(path,data,userId='alice')=>service.handle({path:'/api/questionnaires'+path,method:data===undefined?'GET':'POST',user:{id:userId},readBody:async()=>data});
 const project=(owner='alice')=>{const id=randomUUID();db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(id,owner,'问卷所属项目','本科','教育学',at,at);return id;};
 return{db,service,request,project};
}

test('questionnaire AI recovery preserves bounded projectRef and projectId through save, reload and listing',async t=>{
 const f=fixture(t),projectId=f.project(),projectRef='account:alice:'+projectId;
 const aiState={commandKey:randomUUID(),itemId:randomUUID(),ownerId:'alice',projectRef,projectId,snapshot:{title:'数字阅读服务问卷',profile:{level:'本科'},requirements:{outputCount:3},materials:[],references:[],outline:[]}};
 const created=await f.request('',{content:{...content(),aiState},projectId,expectedUserId:'alice'});assert.equal(created.status,201);assert.deepEqual(created.value.item.content.aiState,aiState);
 const id=created.value.item.id,recovered=(await f.request('/'+id)).value.item;assert.equal(recovered.projectId,projectId);assert.deepEqual(recovered.content.aiState,aiState);
 const nextState={...aiState,resumeFromJobId:randomUUID()},saved=await f.request('/'+id,{version:recovered.version,content:{...recovered.content,aiState:nextState},projectId,expectedUserId:'alice'});
 assert.equal(saved.status,200);assert.deepEqual(saved.value.item.content.aiState,nextState);
 assert.deepEqual((await f.request('')).value.items[0].content.aiState,nextState);assert.deepEqual(f.service.get(id,{id:'alice'}).content.aiState,nextState);
 const published=(await f.request('/'+id+'/publish',{version:saved.value.item.version,expectedUserId:'alice'})).value.item,pub=published.publications[0];
 const publicRead=await f.request('/public/'+pub.token);assert.equal(publicRead.status,200);assert.equal(Object.hasOwn(publicRead.value.questionnaire,'aiState'),false);assert.doesNotMatch(JSON.stringify(publicRead.value),/account:alice|projectRef|projectId|ownerId/);
});

test('AI recovery project fields accept string boundaries, omit empty values and reject invalid types or lengths',()=>{
 const normalized=normalizeQuestionnaireContent({...content(),aiState:{projectRef:'r'.repeat(300),projectId:'p'.repeat(100)}});assert.equal(normalized.aiState.projectRef.length,300);assert.equal(normalized.aiState.projectId.length,100);
 for(const value of [undefined,null,'','  ']){const state=normalizeQuestionnaireContent({...content(),aiState:{projectRef:value,projectId:value}}).aiState;assert.equal(Object.hasOwn(state,'projectRef'),false);assert.equal(Object.hasOwn(state,'projectId'),false);}
 for(const [key,value] of [['projectRef','r'.repeat(301)],['projectId','p'.repeat(101)],['projectRef',false],['projectId',0],['projectRef',{}],['projectId',[]],['projectRef','bad\u0000ref']])assert.throws(()=>normalizeQuestionnaireContent({...content(),aiState:{[key]:value}}),{status:400});
});

test('questionnaire updates can attach, move, preserve and explicitly clear an owned project',async t=>{
 const f=fixture(t),first=f.project(),second=f.project();let item=(await f.request('',{content:content(),projectId:first})).value.item;
 item=(await f.request('/'+item.id,{version:item.version,content:item.content,expectedUserId:'alice'})).value.item;assert.equal(item.projectId,first,'omitting projectId retains existing association');
 item=(await f.request('/'+item.id,{version:item.version,content:item.content,projectId:second,expectedUserId:'alice'})).value.item;assert.equal(item.projectId,second);assert.equal(f.db.prepare('SELECT project_id FROM questionnaires WHERE id=?').get(item.id).project_id,second);
 for(const empty of [null,'']){item=(await f.request('/'+item.id,{version:item.version,content:item.content,projectId:empty})).value.item;assert.equal(item.projectId,'');assert.equal(f.db.prepare('SELECT project_id FROM questionnaires WHERE id=?').get(item.id).project_id,null);item=(await f.request('/'+item.id,{version:item.version,content:item.content,projectId:first})).value.item;assert.equal(item.projectId,first);}
});

test('foreign and local-only project IDs cannot create or reassign a questionnaire or bypass version and owner checks',async t=>{
 const f=fixture(t),projectId=f.project(),foreign=f.project('bob'),item=(await f.request('',{content:content(),projectId})).value.item;
 for(const value of [foreign,'browser-local-project']){await assert.rejects(()=>f.request('',{content:content(),projectId:value}),{status:404});await assert.rejects(()=>f.request('/'+item.id,{version:item.version,content:{...item.content,title:'拒绝的修改'},projectId:value}),{status:404});}
 for(const value of [false,0,{}]){await assert.rejects(()=>f.request('',{content:content(),projectId:value}),{status:400});await assert.rejects(()=>f.request('/'+item.id,{version:item.version,content:item.content,projectId:value}),{status:400});}
 await assert.rejects(()=>f.request('/'+item.id,{version:item.version,content:item.content,projectId,expectedUserId:'alice'},'bob'),{status:404});
 await assert.rejects(()=>f.request('/'+item.id,{version:item.version,content:item.content,projectId,expectedUserId:'bob'}),{status:409});
 const saved=(await f.request('/'+item.id,{version:item.version,content:item.content,projectId:null})).value.item;
 await assert.rejects(()=>f.request('/'+item.id,{version:item.version,content:{...item.content,title:'过期写入'},projectId}),{status:409});
 const after=f.service.get(item.id,{id:'alice'});assert.equal(after.version,saved.version);assert.equal(after.projectId,'');assert.equal(after.content.title,item.content.title);assert.equal(f.db.prepare('SELECT count(*) n FROM questionnaires').get().n,1);
});

test('AI recovery metadata alone cannot move the questionnaire project and invalid state does not overwrite saved content',async t=>{
 const f=fixture(t),projectId=f.project(),other=f.project(),item=(await f.request('',{content:content(),projectId})).value.item;
 const recovered=(await f.request('/'+item.id,{version:item.version,content:{...item.content,aiState:{projectRef:'account:alice:'+other,projectId:other}}})).value.item;
 assert.equal(recovered.projectId,projectId,'only the top-level owned project selection changes questionnaire association');
 await assert.rejects(()=>f.request('/'+item.id,{version:recovered.version,projectId:other,content:{...item.content,aiState:{projectId:'x'.repeat(101)}}}),{status:400});
 assert.equal(f.service.get(item.id,{id:'alice'}).projectId,projectId);assert.equal(f.service.get(item.id,{id:'alice'}).version,recovered.version);
});
