import {randomUUID} from 'node:crypto';
import {aiReady,publicModelSettings} from './config.mjs';
import {paymentCatalog,savePaymentProduct} from './payment-settings.mjs';
import {productDelivery} from './commerce-readiness.mjs';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const identityJoins=`LEFT JOIN auth_identities ue ON ue.user_id=u.id AND ue.channel='email'
  LEFT JOIN auth_identities up ON up.user_id=u.id AND up.channel='phone'`;
const ownerFields="u.name AS user_name,COALESCE(ue.address,u.email) AS user_email,up.address AS user_phone";
const sharedSearch=['u.name','COALESCE(ue.address,u.email)','up.address'];
const definitions={
  users:{
    from:`users u ${identityJoins}`,
    fields:`u.id,u.name,COALESCE(ue.address,u.email) AS email,up.address AS phone,u.role,u.created_at,
      ue.verified_at AS email_verified_at,up.verified_at AS phone_verified_at,
      (SELECT count(*) FROM projects p WHERE p.user_id=u.id) AS project_count,
      (SELECT count(*) FROM jobs j WHERE j.user_id=u.id) AS job_count`,
    search:['u.id',...sharedSearch],status:'u.role',statuses:['user','admin'],order:'u.created_at DESC,u.id DESC',
  },
  jobs:{from:`jobs t JOIN users u ON u.id=t.user_id ${identityJoins}`,
    fields:`t.id,t.user_id,t.project_id,t.type,t.status,t.stage,t.error,t.result_id,t.attempt,t.created_at,t.updated_at,${ownerFields}`,
    search:['t.id','t.type',...sharedSearch],status:'t.status',statuses:['queued','running','failed','completed','cancelled'],order:'t.created_at DESC,t.id DESC'},
  results:{from:`results t JOIN users u ON u.id=t.user_id ${identityJoins}`,
    fields:`t.id,t.user_id,t.project_id,t.job_id,t.type,t.title,t.created_at,${ownerFields}`,
    search:['t.id','t.title','t.type',...sharedSearch],statuses:[],order:'t.created_at DESC,t.id DESC'},
  feedback:{from:`feedback t JOIN users u ON u.id=t.user_id ${identityJoins} LEFT JOIN feedback_management m ON m.feedback_id=t.id`,
    fields:`t.id,t.user_id,t.category,t.body,t.created_at,COALESCE(m.status,'open') AS status,COALESCE(m.note,'') AS note,m.updated_at,m.updated_by,${ownerFields}`,
    search:['t.id','t.category','t.body',...sharedSearch],status:"COALESCE(m.status,'open')",statuses:['open','processing','resolved'],order:'t.created_at DESC,t.id DESC'},
  orders:{from:`orders t JOIN users u ON u.id=t.user_id ${identityJoins} JOIN products p ON p.id=t.product_id`,
    fields:`t.id,t.user_id,t.product_id,t.status,t.created_at,COALESCE((SELECT title FROM payment_orders WHERE order_id=t.id),p.title) AS product_title,(SELECT out_trade_no FROM payment_orders WHERE order_id=t.id) AS out_trade_no,(SELECT paid_at FROM payment_orders WHERE order_id=t.id) AS paid_at,(SELECT amount_cents FROM payment_orders WHERE order_id=t.id) AS amount_cents,(SELECT provider FROM payment_orders WHERE order_id=t.id) AS provider,(SELECT provider_trade_no FROM payment_orders WHERE order_id=t.id) AS provider_trade_no,${ownerFields}`,
    search:['t.id','p.title','(SELECT out_trade_no FROM payment_orders WHERE order_id=t.id)','(SELECT provider_trade_no FROM payment_orders WHERE order_id=t.id)',...sharedSearch],status:'t.status',statuses:['pending','paid','cancelled','refunded','failed','closed','expired'],order:'t.created_at DESC,t.id DESC'},
  usage:{from:`usage t JOIN users u ON u.id=t.user_id ${identityJoins}`,
    fields:`t.id,t.user_id,t.job_id,t.provider,t.model,t.input_tokens,t.output_tokens,t.billable,t.created_at,${ownerFields}`,
    search:['t.id','t.job_id','t.provider','t.model',...sharedSearch],status:'t.billable',statuses:['billable','unbilled'],statusValue:value=>value==='billable'?1:0,order:'t.created_at DESC,t.id DESC'},
  audit:{from:`admin_audit t JOIN users u ON u.id=t.actor_id ${identityJoins}`,
    fields:`t.id,t.actor_id,t.action,t.target_type,t.target_id,t.detail,t.created_at,${ownerFields}`,
    search:['t.id','t.action','t.target_id',...sharedSearch],statuses:[],order:'t.created_at DESC,t.id DESC'},
};

function parameters(query,allowed){
  for(const key of query.keys())if(!allowed.includes(key)||query.getAll(key).length!==1)fail(400,'筛选参数不正确');
}
function positiveInteger(raw,fallback){
  if(raw===null||raw==='')return fallback;
  if(!/^[1-9]\d{0,6}$/.test(raw))fail(400,'分页参数不正确');
  return Number(raw);
}

export function createAdminAPI(db,worker,config,auth){
  const modelConfig=()=>config.getAI?config.getAI():config;
  const secrets=[config.aiKey,config.authCodeSecret,config.emailSMTPPassword,config.smsAccessKeySecret,config.ossAccessKeySecret,config.paymentConfigKey].filter(value=>typeof value==='string'&&value.length>=4);
  const redact=value=>{
    if(typeof value!=='string')return value;
    let result=value;
    for(const secret of secrets)result=result.split(secret).join('[已隐藏]');
    return result.replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]');
  };
  const sanitize=item=>{
    const row={...item};
    for(const [key,value] of Object.entries(row))if(typeof value==='string')row[key]=redact(value);
    if('detail' in row){try{row.detail=JSON.parse(row.detail);}catch{row.detail={};}}
    return row;
  };
  const audit=(actor,action,targetType,targetId,detail)=>{
    db.prepare('INSERT INTO admin_audit(id,actor_id,action,target_type,target_id,detail,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(),actor.id,action,targetType,targetId,JSON.stringify(detail),new Date().toISOString());
  };
  const transaction=work=>{
    db.exec('BEGIN IMMEDIATE;');
    try{const result=work();db.exec('COMMIT;');return result;}
    catch(cause){db.exec('ROLLBACK;');throw cause;}
  };

  function list(name,query){
    parameters(query,['page','pageSize','q','status']);
    const spec=definitions[name];
    if(!spec)fail(404,'管理接口不存在');
    const page=positiveInteger(query.get('page'),1),pageSize=Math.min(positiveInteger(query.get('pageSize'),20),50);
    const search=(query.get('q')||'').trim(),status=query.get('status')||'';
    if(search.length>100||status&&!spec.statuses.includes(status))fail(400,'筛选参数不正确');
    const filters=[],values=[];
    if(search){
      filters.push(`(${spec.search.map(column=>`instr(lower(COALESCE(CAST(${column} AS TEXT),'')),lower(?))>0`).join(' OR ')})`);
      values.push(...spec.search.map(()=>search));
    }
    if(status){filters.push(`${spec.status}=?`);values.push(spec.statusValue?spec.statusValue(status):status);}
    const where=filters.length?' WHERE '+filters.join(' AND '):'';
    const total=db.prepare(`SELECT count(*) n FROM ${spec.from}${where}`).get(...values).n;
    const items=db.prepare(`SELECT ${spec.fields} FROM ${spec.from}${where} ORDER BY ${spec.order} LIMIT ? OFFSET ?`).all(...values,pageSize,(page-1)*pageSize).map(sanitize);
    return {items,total,page,pageSize};
  }

  function settings(){
    const available=auth.options();
    return {ai:publicModelSettings(modelConfig()),auth:{emailCode:available.emailCode,phoneCode:available.phoneCode},storage:{provider:config.storage?.provider||'local_server_sqlite'},payment:config.payments?.options().enabled||false};
  }

  function overview(query){
    parameters(query,['days']);
    const days=Number(query.get('days')||7);
    if(![7,30].includes(days))fail(400,'请选择最近 7 天或 30 天');
    const count=table=>db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
    const statusCounts=db.prepare('SELECT status,count(*) n FROM jobs GROUP BY status').all();
    const metrics={users:count('users'),projects:count('projects'),files:count('files'),storageBytes:db.prepare('SELECT COALESCE(sum(bytes),0) n FROM files').get().n,
      jobs:count('jobs'),queued:0,running:0,failed:0,completed:0,results:count('results'),
      feedbackOpen:db.prepare("SELECT count(*) n FROM feedback f LEFT JOIN feedback_management m ON m.feedback_id=f.id WHERE COALESCE(m.status,'open')!='resolved'").get().n,
      orders:count('orders')};
    for(const row of statusCounts)if(['queued','running','failed','completed'].includes(row.status))metrics[row.status]=row.n;
    const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
    const end=Date.parse(`${today}T00:00:00Z`);
    const daily=Array.from({length:days},(_,index)=>({date:new Date(end-(days-1-index)*86400000).toISOString().slice(0,10),users:0,jobs:0}));
    for(const table of ['users','jobs']){
      const counts=db.prepare(`SELECT date(created_at,'+8 hours') AS date,count(*) n FROM ${table} WHERE date(created_at,'+8 hours')>=? AND date(created_at,'+8 hours')<=? GROUP BY date(created_at,'+8 hours')`).all(daily[0].date,today);
      for(const row of counts){const day=daily.find(item=>item.date===row.date);if(day)day[table]=row.n;}
    }
    const available=auth.options();
    return {metrics,recentJobs:list('jobs',new URLSearchParams('pageSize=10')).items,daily,
      services:{ai:aiReady(modelConfig()),email:available.emailCode,sms:available.phoneCode,payment:config.payments?.options().enabled||false,storage:config.storage?.provider||'local_server_sqlite'}};
  }

  return async({path,method,query=new URLSearchParams(),readBody,user})=>{
    // Keep an independent authorization boundary even if a future caller skips
    // createAPI's routing guard. Re-read role instead of trusting a request body.
    if(!user?.id)fail(401,'请先登录');
    const actor=db.prepare('SELECT id,role FROM users WHERE id=?').get(user.id);
    if(!actor)fail(401,'请先登录');
    if(actor.role!=='admin')fail(403,'需要管理员权限');
    const paymentConfig=()=>({channels:['wechat','alipay'].map(p=>config.payments.settings.summary(p)),catalog:paymentCatalog(db,{all:true}).map(product=>({...product,...productDelivery(product,config.billing)})),encryptionReady:config.payments.settings.encryptionReady,billing:config.billing?.rules()});
    if(path==='/api/admin/payments'&&method==='GET'){parameters(query,[]);return paymentConfig();}
    if(path==='/api/admin/billing'&&method==='POST'){parameters(query,[]);const input=await readBody();return transaction(()=>{const billing=config.billing.saveRules(input);audit(actor,'billing.rules.update','setting','billing',{version:billing.version,services:billing.services.map(({key,mode,creditCost})=>({key,mode,creditCost}))});return {billing};});}
    const paymentProduct=path.match(/^\/api\/admin\/payments\/products\/([a-zA-Z0-9_-]+)$/);
    if(paymentProduct&&method==='POST'){parameters(query,[]);const input=await readBody();const item=transaction(()=>{const saved=savePaymentProduct(db,paymentProduct[1],input),delivery=productDelivery(saved,config.billing);if(saved.status==='active'&&!delivery.purchasable)fail(409,delivery.unavailableReason);audit(actor,'payment.product.update','product',saved.id,{status:saved.status,priceCents:saved.priceCents,durationDays:saved.durationDays,entitlementType:saved.entitlementType,creditAmount:saved.creditAmount,...(saved.entitlementType==='bundle'?{bundleItems:saved.bundleItems}:saved.entitlementType==='membership'?{membershipItems:saved.membershipItems}:{})});return {...saved,...delivery};});return {item};}
    const paymentChannel=path.match(/^\/api\/admin\/payments\/(wechat|alipay)(\/check)?$/);
    if(paymentChannel&&method==='POST'){
      parameters(query,[]);const provider=paymentChannel[1];
      if(paymentChannel[2]){const summary=config.payments.settings.summary(provider);return {ok:summary.configured,configured:summary.configured,ready:summary.ready,validation:summary.validation};}
      const input=await readBody();return transaction(()=>{const saved=config.payments.settings.save(provider,input,actor.id);audit(actor,'payment.channel.update','payment',provider,{enabled:saved.enabled,configured:saved.configured,changedFields:Object.keys(input).filter(k=>k!=='clearSecrets'),clearedFields:input.clearSecrets||[]});return saved;});
    }
    if(path==='/api/admin/overview'&&method==='GET')return overview(query);
    const listMatch=path.match(/^\/api\/admin\/(users|jobs|results|feedback|orders|usage|audit)$/);
    if(listMatch&&method==='GET')return list(listMatch[1],query);
    if(path==='/api/admin/settings'&&method==='GET'){parameters(query,[]);return settings();}
    if(path==='/api/admin/model'&&['GET','POST'].includes(method)){
      parameters(query,[]);
      if(method==='POST'){
        const input=await readBody();
        if(typeof input.model!=='string'||input.model.length>100||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(input.model)||typeof input.enabled!=='boolean')fail(400,'模型名称或启停状态无效');
        transaction(()=>{
          const before=publicModelSettings(modelConfig());
          config.settings.save(input.model,input.enabled,actor.id);
          audit(actor,'model.update','setting','ai',{from:{model:before.model,enabled:before.enabled},to:{model:input.model,enabled:input.enabled}});
        });
      }
      const current=settings();
      return {ai:current.ai,storage:current.storage};
    }
    const cancel=path.match(/^\/api\/admin\/jobs\/([^/]+)\/cancel$/);
    if(cancel&&method==='POST'){
      parameters(query,[]);
      transaction(()=>{
        const job=db.prepare('SELECT id,status FROM jobs WHERE id=?').get(cancel[1]);
        if(!job)fail(404,'任务不存在');
        if(!['queued','running'].includes(job.status))fail(409,'任务已结束，不能取消');
        const changed=db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE id=? AND status IN ('queued','running')").run(new Date().toISOString(),job.id);
        if(!changed.changes)fail(409,'任务状态已变化，请刷新后重试');
        config.billing?.release(job.id);
        audit(actor,'job.cancel','job',job.id,{from_status:job.status,to_status:'cancelled'});
      });
      worker.cancel(cancel[1]);
      return {ok:true};
    }
    const feedback=path.match(/^\/api\/admin\/feedback\/([^/]+)$/);
    if(feedback&&method==='POST'){
      parameters(query,[]);
      const input=await readBody();
      if(!['open','processing','resolved'].includes(input.status)||typeof input.note!=='string'||input.note.length>2000)fail(400,'请选择有效处理状态，备注最多 2000 字');
      transaction(()=>{
        const record=db.prepare("SELECT f.id,COALESCE(m.status,'open') status,COALESCE(m.note,'') note FROM feedback f LEFT JOIN feedback_management m ON m.feedback_id=f.id WHERE f.id=?").get(feedback[1]);
        if(!record)fail(404,'反馈不存在');
        db.prepare('INSERT INTO feedback_management(feedback_id,status,note,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(feedback_id) DO UPDATE SET status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
          .run(record.id,input.status,input.note.trim(),actor.id,new Date().toISOString());
        audit(actor,'feedback.update','feedback',record.id,{from_status:record.status,to_status:input.status,note_changed:record.note!==input.note.trim(),note_length:input.note.trim().length});
      });
      return {ok:true};
    }
    if(path==='/api/admin'&&method==='GET'){
      parameters(query,[]);
      const limited=new URLSearchParams('pageSize=50');
      return {users:list('users',limited).items,jobs:list('jobs',limited).items,feedback:list('feedback',limited).items,orders:list('orders',limited).items};
    }
    fail(404,'管理接口不存在');
  };
}
