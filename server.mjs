import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {database} from './backend/database.mjs';
import {createAPI} from './backend/api.mjs';
import {environmentConfig,loadLocalEnvironment,modelSettings} from './backend/config.mjs';
import {createStorage} from './backend/storage.mjs';
import {startWorker} from './backend/worker.mjs';
import {sessionUser} from './backend/auth.mjs';
import {accountDestination} from './dist/account-routes.mjs';
export function createServer({dbPath=resolve(process.env.PK_DATA_DIR||'.data','paperknow.sqlite'),config=environmentConfig()}={}){
if(config.aiURL){const u=new URL(config.aiURL);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('模型接口必须使用 HTTPS 或本地地址');}
const storage=createStorage(config,config.ossClient),db=database(dbPath),settings=modelSettings(db,config);config={...config,storage,settings,getAI:()=>settings.get()};const worker=startWorker(db,config),api=createAPI(db,worker,config),root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  if(req.url?.startsWith('/api/')){await api(req,res);return;}
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);
    const file=resolve(root,'.'+(path==='/'?'/index.html':path==='/precheck'||path==='/precheck/'?'/precheck/index.html':path));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
    if(file===resolve(root,'service.html')){
      let destination=accountDestination(url.searchParams.get('view'),url.searchParams.get('result'));
      if(url.searchParams.get('auth')==='register')destination='/auth.html?mode=register&next='+encodeURIComponent(destination);
      res.writeHead(302,{...headers,Location:destination}).end();return;
    }
    if(file.toLowerCase()===resolve(root,'admin.html').toLowerCase()){
      const user=sessionUser(db,req,config.ownerEmail);
      if(!user){res.writeHead(302,{...headers,Location:'/auth.html?mode=login&next=%2Fadmin.html'}).end();return;}
      if(user.role!=='admin'){
        const body='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无访问权限 · PaperKnow</title><link rel="stylesheet" href="/auth.css"><body><main style="max-width:560px;margin:12vh auto;padding:32px;background:#fff;border-radius:20px"><h1>此页面仅对管理员开放</h1><p>当前账户没有管理权限，请返回工作台继续使用。</p><p><a href="/workspace.html#home">返回工作台 →</a></p><p>如果你是指定管理员，请先完成邮箱验证。</p><a href="/auth.html?mode=login&method=code&verify=1&next=%2Fadmin.html">使用邮箱验证码登录</a></main></body></html>';
        res.writeHead(403,{...headers,'Content-Type':'text/html; charset=utf-8'}).end(req.method==='HEAD'?undefined:body);return;
      }
    }
    const body=await readFile(file);
    res.writeHead(200,{...headers,'Content-Type':types[extname(file)]||'application/octet-stream'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('页面不存在');}
});
server.requestTimeout=120000;server.headersTimeout=15000;
return {server,db,worker,async close(){await worker.stop();await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){loadLocalEnvironment();const app=createServer();const port=Number(process.env.PORT||5173);app.server.listen(port,'127.0.0.1',()=>console.log(`PaperKnow: http://127.0.0.1:${port}/workspace.html`));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));}
