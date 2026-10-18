import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {agentWorkspaceId,createAgentSettings} from '../backend/agent-settings.mjs';
import {environmentConfig} from '../backend/config.mjs';

const encryptionKey=Buffer.alloc(32,19),secret='workspace-settings-test-key';
const baseURL='https://dashscope.aliyuncs.com/apps/anthropic';
const workspaceId='ws-shhiuk23mwovlao8';
const valid={version:null,enabled:true,engine:'claude-agent-sdk',baseURL,model:'test-model',apiKey:secret,maxTurns:3,timeoutMs:15000,maxOutputTokens:512,maxCostUsd:0.12};
function fixture(t,extra={}){
 const db=database(':memory:');
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('admin','workspace-test@example.invalid','Admin',null,'admin',new Date().toISOString());
 t.after(()=>db.close());
 const config={agentConfigKey:encryptionKey.toString('base64'),aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',aiKey:secret,aiModel:'test-model',...extra};
 return {db,settings:createAgentSettings(db,config)};
}

test('workspace identifier is optional and restricted to the exact verified Aliyun host',()=>{
 assert.equal(agentWorkspaceId(undefined,'https://provider.example.com'), '');
 assert.equal(agentWorkspaceId('','https://provider.example.com'), '');
 for(const id of [workspaceId,'llm-project123','ws-'+ 'a'.repeat(64),'llm-'+ 'A'.repeat(64)]){
  assert.equal(agentWorkspaceId(id,baseURL),id);
  assert.equal(agentWorkspaceId(id,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),id);
 }
 for(const id of [null,3,{},'ws-','workspace-abc','ws-abc def','ws-abc\r\nX-Evil:1','ws-中文','ws-'+ 'a'.repeat(65),'llm-'+ 'a'.repeat(65)])assert.throws(()=>agentWorkspaceId(id,baseURL),error=>error.status===400);
 for(const url of ['http://dashscope.aliyuncs.com/apps/anthropic','https://dashscope.aliyuncs.com.evil.example/apps/anthropic','https://other.aliyuncs.com/apps/anthropic','https://ws-any.cn-shanghai.maas.aliyuncs.com/apps/anthropic','https://provider.example.com','https://user:pass@dashscope.aliyuncs.com/apps/anthropic','https://dashscope.aliyuncs.com:444/apps/anthropic','https://dashscope.aliyuncs.com/apps/anthropic?x=1','https://dashscope.aliyuncs.com/apps/anthropic#x','not-a-url'])assert.throws(()=>agentWorkspaceId(workspaceId,url),error=>error.status===400);
});

test('workspace-only saves retain model, credential, limits and immutable prior versions',t=>{
 const {db,settings}=fixture(t);
 const first=settings.save('admin',valid),previous=settings.get();
 assert.equal(previous.workspaceId,'');
 const updated=settings.save('admin',{version:first.version,workspaceId});
 const next=settings.get();
 assert.equal(next.workspaceId,workspaceId);
 assert.equal(updated.workspaceId,workspaceId);
 assert.equal('apiKey' in updated,false);
 assert.deepEqual({...next,workspaceId:'',version:previous.version},previous);
 assert.equal(settings.version(first.version).workspaceId,'');
 assert.equal(settings.version(first.version).apiKey,secret);
 assert.throws(()=>settings.save('admin',{version:first.version,workspaceId:'llm-stale'}),error=>error.status===409);
 assert.equal(db.prepare('SELECT count(*) n FROM agent_config_versions').get().n,2);
 const detail=JSON.parse(db.prepare('SELECT detail FROM admin_audit ORDER BY rowid DESC LIMIT 1').get().detail);
 assert.deepEqual(detail.changedFields,['workspaceId']);
 assert.equal(detail.credentialChanged,false);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM agent_config_versions').all()).includes(secret),false);
 const third=settings.save('admin',{version:updated.version,model:'test-model-next'});
 assert.equal(third.workspaceId,workspaceId);
 const cleared=settings.save('admin',{version:third.version,workspaceId:''});
 assert.equal(cleared.workspaceId,'');
 assert.equal(settings.get().apiKey,secret);
 assert.equal(settings.version(updated.version).workspaceId,workspaceId);
});

test('a configured workspace cannot be silently sent to a third-party base URL',t=>{
 const {settings}=fixture(t);
 const first=settings.save('admin',{...valid,workspaceId});
 assert.throws(()=>settings.save('admin',{version:first.version,baseURL:'https://provider.example.com'}),error=>error.status===400);
 assert.equal(settings.get().version,first.version);
 const cleared=settings.save('admin',{version:first.version,baseURL:'https://provider.example.com',workspaceId:''});
 assert.equal(cleared.workspaceId,'');
 assert.equal(cleared.baseURL,'https://provider.example.com');
});

test('pre-workspace encrypted configuration versions remain readable and default to an empty workspace',t=>{
 const {db,settings}=fixture(t),id='legacy-version-without-workspace';
 const {version,...legacy}=valid,iv=Buffer.alloc(12,7),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
 cipher.setAAD(Buffer.from('paperknow-agent:'+id));
 const data=Buffer.concat([cipher.update(JSON.stringify(legacy),'utf8'),cipher.final()]);
 const sealed=JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
 db.prepare('INSERT INTO agent_config_versions VALUES(?,?,?,?)').run(id,sealed,'admin',new Date().toISOString());
 db.prepare('INSERT INTO agent_config_current VALUES(1,?)').run(id);
 assert.equal(settings.get().workspaceId,'');
 assert.equal(settings.get().apiKey,secret);
 const changed=settings.save('admin',{version:id,workspaceId});
 assert.equal(changed.workspaceId,workspaceId);
 assert.equal(settings.version(id).workspaceId,'');
 assert.equal(db.prepare('SELECT sealed_settings FROM agent_config_versions WHERE id=?').get(id).sealed_settings,sealed);
});

test('environment configuration preserves separate optional AI and Agent workspace settings',()=>{
 const empty=environmentConfig({});
 assert.equal(empty.aiWorkspaceId,'');
 assert.equal(empty.agentWorkspaceId,undefined);
 const inherited=environmentConfig({PK_AI_WORKSPACE_ID:workspaceId});
 assert.equal(inherited.aiWorkspaceId,workspaceId);
 assert.equal(inherited.agentWorkspaceId,undefined);
 const overridden=environmentConfig({PK_AI_WORKSPACE_ID:workspaceId,PK_AGENT_WORKSPACE_ID:'llm-agent1'});
 assert.equal(overridden.aiWorkspaceId,workspaceId);
 assert.equal(overridden.agentWorkspaceId,'llm-agent1');
 assert.equal(environmentConfig({PK_AI_WORKSPACE_ID:workspaceId,PK_AGENT_WORKSPACE_ID:''}).agentWorkspaceId,'');
});

test('Agent inheritance uses the Aliyun AI workspace unless explicitly overridden or cleared',t=>{
 const inherited=fixture(t,{aiWorkspaceId:workspaceId}).settings;
 assert.equal(inherited.get().workspaceId,workspaceId);
 const override=fixture(t,{aiWorkspaceId:workspaceId,agentWorkspaceId:'llm-agent1'}).settings;
 assert.equal(override.get().workspaceId,'llm-agent1');
 const cleared=fixture(t,{aiWorkspaceId:workspaceId,agentWorkspaceId:''}).settings;
 assert.equal(cleared.get().workspaceId,'');
 const thirdParty=fixture(t,{agentBaseURL:'https://provider.example.com',aiWorkspaceId:workspaceId}).settings;
 assert.equal(thirdParty.get().baseURL,'https://provider.example.com');
 assert.equal(thirdParty.get().workspaceId,'');
 const unsafe=fixture(t,{agentBaseURL:'https://provider.example.com',agentWorkspaceId:workspaceId,agentRuntimeEnabled:true}).settings;
 assert.equal(unsafe.get().enabled,false);
 assert.equal(unsafe.get().workspaceId,'');
});
