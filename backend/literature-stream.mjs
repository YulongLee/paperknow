const channels=new WeakMap();
function channel(db){if(!channels.has(db))channels.set(db,new Map());return channels.get(db);}
export function notifyLiteratureRun(db,id){for(const listener of channel(db).get(id)||[])listener();}
function subscribe(db,id,listener){const map=channel(db),listeners=map.get(id)||new Set();listeners.add(listener);map.set(id,listeners);return()=>{listeners.delete(listener);if(!listeners.size)map.delete(id);};}

// Read-only SSE: reconnecting never submits a model job or reserves credits.
export function createLiteratureStreamService(db,{getUser,serialize,sanitize=value=>value,pollMs=400,heartbeatMs=15000,maxMs=300000}={}){
 const clients=new Map(),connections=new Set();let total=0;
 const open=function(req,res,user,id,publicValue=sanitize){
  const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
  const row=db.prepare('SELECT * FROM tool_runs WHERE id=? AND user_id=?').get(id,user.id);
  if(!row||row.kind!=='literature'||!['read','answer'].includes(row.operation))fail(404,'文献回答不存在');
  if(req.headers['x-paperknow-user']!==user.id)fail(409,'账户已变化，请重新打开文献');
  if(total>=100||(clients.get(user.id)||0)>=6)fail(429,'回答窗口较多，请关闭重复页面后重试');
  clients.set(user.id,(clients.get(user.id)||0)+1);total++;
  let closed=false,last='',poll,heartbeat,deadline,off=()=>{};
  function close(){if(closed)return;closed=true;connections.delete(close);clearInterval(poll);clearInterval(heartbeat);clearTimeout(deadline);off();req.removeListener('aborted',close);res.removeListener('close',close);const n=(clients.get(user.id)||1)-1;if(n)clients.set(user.id,n);else clients.delete(user.id);total--;if(!res.writableEnded)res.end();}
  function send(event,value){if(closed||res.destroyed)return close();if(res.writableLength>65536)return close();res.write('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n');}
  function flush(){if(closed)return;try{
   if(getUser(req)?.id!==user.id){send('unavailable',{message:'登录状态已变化，请重新登录后查看。'});return close();}
   const current=db.prepare('SELECT * FROM tool_runs WHERE id=? AND user_id=?').get(id,user.id);if(!current){send('unavailable',{message:'这条回答已不存在，请返回文献查看。'});return close();}
   if(!['queued','running'].includes(current.status)){send('result',publicValue({item:serialize(db,current)}));return close();}
   const preview=db.prepare('SELECT text FROM tool_run_previews WHERE run_id=?').get(id)?.text||'';
   if(preview&&preview!==last){last=preview;send('answer',publicValue({text:preview}));}
  }catch{send('unavailable',{message:'连接暂时中断，回答仍在保存，可重新查看。'});close();}}
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});res.flushHeaders?.();res.write(': connected\n\n');
  connections.add(close);req.once('aborted',close);res.once('close',close);off=subscribe(db,id,flush);
  poll=setInterval(flush,pollMs);poll.unref?.();heartbeat=setInterval(()=>{if(!closed)res.write(': keep-alive\n\n');},heartbeatMs);heartbeat.unref?.();deadline=setTimeout(close,maxMs);deadline.unref?.();flush();
 };open.close=()=>{for(const close of [...connections])close();};return open;
}
