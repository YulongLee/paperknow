import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const engine='claude-agent-sdk';
const defaults={enabled:false,engine,baseURL:'',model:'',apiKey:'',maxTurns:6,timeoutMs:180000,maxOutputTokens:4096,maxCostUsd:0.5};
const limits={maxTurns:[1,12],timeoutMs:[5000,300000],maxOutputTokens:[32,16384],maxCostUsd:[0.01,5]};
export function agentBaseURL(value){
  if(value==='')return '';
  if(typeof value!=='string'||value.length>500)fail(400,'Agent 接口地址格式或长度无效');
  let url;try{url=new URL(value);}catch{fail(400,'Agent 接口地址无效');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443'||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)||host.endsWith('.localhost'))fail(400,'Agent 接口须使用不含凭据的公网 HTTPS 域名');
  if(/\/(chat\/completions|messages)\/?$/.test(url.pathname))fail(400,'请填写 Anthropic 协议的 Base URL，不含 messages 或 chat/completions');
  return url.toString().replace(/\/$/,'');
}
function inheritedBase(config){
  if(config.agentBaseURL)return agentBaseURL(config.agentBaseURL);
  try{const u=new URL(config.aiURL);if(u.hostname==='dashscope.aliyuncs.com'&&u.protocol==='https:'&&/^\/compatible-mode\/v1(?:\/chat\/completions)?\/?$/.test(u.pathname)&&!u.username&&!u.password)return 'https://dashscope.aliyuncs.com/apps/anthropic';}catch{}
  return '';
}
export const agentSettingsReady=value=>Boolean(value?.enabled===true&&value.engine===engine&&value.baseURL&&value.model&&value.apiKey);
export function createAgentSettings(db,config={},hooks={}){
  let key;try{const raw=config.agentConfigKey||config.paymentConfigKey;if(typeof raw==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(raw)){const parsed=Buffer.from(raw,'base64');if(parsed.length===32&&parsed.toString('base64')===raw)key=parsed;}}catch{}
  db.exec(`CREATE TABLE IF NOT EXISTS agent_config_versions(id TEXT PRIMARY KEY,sealed_settings TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_config_current(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version_id TEXT NOT NULL REFERENCES agent_config_versions(id));
    CREATE TRIGGER IF NOT EXISTS agent_config_versions_no_update BEFORE UPDATE ON agent_config_versions BEGIN SELECT RAISE(ABORT,'Agent versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS agent_config_versions_no_delete BEFORE DELETE ON agent_config_versions BEGIN SELECT RAISE(ABORT,'Agent versions are immutable'); END;`);
  const validate=value=>{
    if(typeof value.enabled!=='boolean'||value.engine!==engine||typeof value.model!=='string'||value.model.length>120||value.model&&!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value.model)||typeof value.apiKey!=='string'||value.apiKey.length>4096||/[\x00-\x20\x7f]/.test(value.apiKey))fail(400,'Agent 模型或密钥格式无效');
    value.baseURL=agentBaseURL(value.baseURL);
    for(const [name,[min,max]] of Object.entries(limits))if(typeof value[name]!=='number'||!Number.isFinite(value[name])||value[name]<min||value[name]>max||name!=='maxCostUsd'&&!Number.isSafeInteger(value[name]))fail(400,`Agent ${name} 超出允许范围`);
    if(value.enabled&&!agentSettingsReady(value))fail(400,'启用前请补齐 Anthropic 兼容接口、模型和密钥');
    return value;
  };
  const initial=()=>{const current=config.getAI?.()||config;let baseURL='';try{baseURL=inheritedBase({...config,...current});}catch{}const value={...defaults,baseURL,model:config.agentModel||current.aiModel||'',apiKey:config.agentKey||current.aiKey||'',...Object.fromEntries(Object.keys(limits).filter(name=>Number.isFinite(config['agent'+name[0].toUpperCase()+name.slice(1)])).map(name=>[name,config['agent'+name[0].toUpperCase()+name.slice(1)]])),version:null};try{validate(value);}catch{return {...defaults,version:null};}value.enabled=config.agentRuntimeEnabled===true&&Boolean(value.baseURL&&value.model&&value.apiKey);return value;};
  function seal(value,id){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('paperknow-agent:'+id));const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});}
  function version(id){const row=db.prepare('SELECT * FROM agent_config_versions WHERE id=?').get(id);if(!row)fail(409,'原 Agent 配置版本不存在，请重新确认任务');if(!key)fail(503,'Agent 配置加密密钥未就绪，无法恢复原配置');try{const payload=JSON.parse(row.sealed_settings);if(payload.v!==1)throw 0;const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(payload.iv,'base64'));decipher.setAAD(Buffer.from('paperknow-agent:'+id));decipher.setAuthTag(Buffer.from(payload.tag,'base64'));const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data,'base64')),decipher.final()]).toString());return {...validate(value),version:id};}catch{fail(503,'原 Agent 配置无法解密或校验，请管理员检查后重新确认任务');}}
  function get(){const row=db.prepare('SELECT version_id FROM agent_config_current WHERE singleton=1').get();return row?version(row.version_id):initial();}
  function publicSettings(){try{const value=get();const {apiKey,...safe}=value;return {...safe,credentialConfigured:Boolean(apiKey),credentialSource:safe.version?'saved':config.agentKey?'agent_environment':apiKey?'inherited_ai':'none',encryptionReady:Boolean(key),configured:Boolean(value.baseURL&&value.model&&apiKey),ready:agentSettingsReady(value),compatibilityVerified:false};}catch{const {apiKey,...safe}=defaults;return {...safe,version:null,credentialConfigured:false,encryptionReady:Boolean(key),configured:false,ready:false,configurationError:'已保存的 Agent 配置无法读取',compatibilityVerified:false};}}
  function save(user,input){
    const actor=typeof user==='string'?user:user?.id;if(!actor||db.prepare('SELECT role FROM users WHERE id=?').get(actor)?.role!=='admin')fail(403,'需要管理员权限');if(!key)fail(503,'服务器 Agent 配置加密密钥未就绪');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['version',...Object.keys(defaults)].includes(name)))fail(400,'Agent 配置字段不正确');
    const previous=get();if(!Object.hasOwn(input,'version')||input.version!==previous.version)fail(409,'Agent 配置已变化，请刷新后重新保存');
    const next={...previous,...input,apiKey:typeof input.apiKey==='string'&&!input.apiKey.trim()?previous.apiKey:input.apiKey??previous.apiKey};delete next.version;validate(next);
    const id=randomUUID(),at=new Date().toISOString(),ownsTransaction=!db.isTransaction;if(ownsTransaction)db.exec('BEGIN IMMEDIATE');
    try{const latest=db.prepare('SELECT version_id FROM agent_config_current WHERE singleton=1').get()?.version_id??null;if(latest!==previous.version)fail(409,'Agent 配置已变化，请刷新后重新保存');db.prepare('INSERT INTO agent_config_versions VALUES(?,?,?,?)').run(id,seal(next,id),actor,at);db.prepare('INSERT INTO agent_config_current VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET version_id=excluded.version_id').run(id);const detail={version:id,previousVersion:previous.version,enabled:next.enabled,engine:next.engine,model:next.model,changedFields:Object.keys(input).filter(name=>name!=='apiKey'&&name!=='version'),credentialChanged:Boolean(input.apiKey?.trim())};
      if(hooks.audit)hooks.audit({id:actor},'agent.config.update','setting','agent',detail);else db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),actor,'agent.config.update','setting','agent',JSON.stringify(detail),at);
      if(ownsTransaction)db.exec('COMMIT');return publicSettings();
    }catch(error){if(ownsTransaction)db.exec('ROLLBACK');throw error;}
  }
  return {get,public:publicSettings,save,version,encryptionReady:Boolean(key)};
}
