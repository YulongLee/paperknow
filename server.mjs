import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,extname,sep,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {database} from './backend/database.mjs';
import {createAPI} from './backend/api.mjs';
import {environmentConfig,loadLocalEnvironment,modelSettings} from './backend/config.mjs';
import {createStorage} from './backend/storage.mjs';
import {createMonitoring} from './backend/monitoring.mjs';
import {startWorker} from './backend/worker.mjs';
import {createAgentSettings} from './backend/agent-settings.mjs';
import {startThesisWorker} from './backend/thesis-worker.mjs';
import {startThesisOutlineWorker} from './backend/thesis-outline-worker.mjs';
import {startToolRunWorker} from './backend/tool-run-worker.mjs';
import {startWritingWorker} from './backend/writing-worker.mjs';
import {startThesisMethodWorker} from './backend/thesis-method-worker.mjs';
import {startDocumentParseWorker} from './backend/document-parse-worker.mjs';
import {createContentModeration} from './backend/content-moderation.mjs';
import {createModeratedAgentRunner} from './backend/moderated-agent.mjs';
import {runAgentTask} from './backend/agent-runtime.mjs';
import {sessionUser} from './backend/auth.mjs';
import {accountDestination} from './dist/account-routes.mjs';
export function createServer({dbPath=resolve(process.env.PK_DATA_DIR||'.data','paperknow.sqlite'),config=environmentConfig()}={}){
if(config.aiURL){const u=new URL(config.aiURL);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('模型接口必须使用 HTTPS 或本地地址');}
const storage=createStorage(config,config.ossClient),db=database(dbPath),settings=modelSettings(db,config);
config={...config,storage,settings,getAI:()=>settings.get()};
config={...config,moderation:config.moderation||createContentModeration(config)};
const productionTree=process.cwd().startsWith('/opt/paperknow/');
const monitoring=createMonitoring(db,config,{databasePath:dbPath===':memory:'?null:dbPath,volumePath:dbPath===':memory:'?process.cwd():dirname(resolve(dbPath)),directorySummaryFile:productionTree?'/run/paperknow-ops/storage.json':null,directoryTargets:productionTree?{releases:'/opt/paperknow/releases',backups:'/opt/paperknow/backups',cache:'/opt/paperknow/build-home/npm-cache'}:{}});
config={...config,monitoring};
const agentSettings=createAgentSettings(db,config);config={...config,agentSettings,getAgentSettings:id=>id?agentSettings.version(id):agentSettings.get(),agentTaskRunner:createModeratedAgentRunner(config.agentTaskRunner||runAgentTask,config)};
const legacyWorker=startWorker(db,config),thesisWorker=startThesisWorker(db,config),outlineWorker=startThesisOutlineWorker(db,config),methodWorker=startThesisMethodWorker(db,config),writingWorker=startWritingWorker(db,config),toolWorker=startToolRunWorker(db,config),documentWorker=startDocumentParseWorker(db,config);
const worker={async tick(){await legacyWorker.tick();await thesisWorker.tick();await outlineWorker.tick();await methodWorker.tick();await writingWorker.tick();await toolWorker.tick();await documentWorker.tick();},cancel(id){legacyWorker.cancel(id);thesisWorker.cancel(id);outlineWorker.cancel(id);methodWorker.cancel(id);writingWorker.cancel(id);toolWorker.cancel(id);documentWorker.cancel(id);},async stop(){await Promise.all([legacyWorker.stop(),thesisWorker.stop(),outlineWorker.stop(),methodWorker.stop(),writingWorker.stop(),toolWorker.stop(),documentWorker.stop()]);}};
const api=createAPI(db,worker,config),root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.csv':'text/csv; charset=utf-8'};
const publicPages=new Map();
try{for(const page of JSON.parse(readFileSync(resolve(root,'public-pages.json'),'utf8')).pages||[]){if(/^\/(?:[a-z0-9-]+\/)+$/.test(page.slug)&&page.file===page.slug.slice(1)+'index.html')publicPages.set(page.slug,page.file);}}catch{/* A fresh checkout can still serve the workspace before the first build. */}
const privateHTML=new Set(['/workspace.html','/auth.html','/admin.html','/service.html','/brand-preview.html','/precheck','/precheck/','/precheck/index.html']);
const server=http.createServer(async(req,res)=>{
  const requestStarted=performance.now();
  res.once('finish',()=>monitoring.observeRequest({statusCode:res.statusCode,durationMs:performance.now()-requestStarted}));
  if(req.url?.split('?')[0]==='/api/payments/return/alipay'){
    const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex','Content-Type':'text/plain; charset=utf-8'};
    if(req.method!=='GET'){res.writeHead(405,{...headers,Allow:'GET'}).end('不支持的请求方式');return;}
    const values=new URL(req.url,'http://localhost').searchParams.getAll('order'),order=values[0];
    if(values.length!==1||typeof order!=='string'||!(/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/).test(order)){res.writeHead(400,headers).end('订单标识无效，请返回工作台查看订单');return;}
    // Browser return parameters are untrusted navigation hints. The account-owned
    // order endpoint and verified provider query/notification determine payment.
    res.writeHead(303,{...headers,Location:'/workspace.html#membership/pay?order='+encodeURIComponent(order)}).end();return;
  }
  if(req.url?.startsWith('/api/')){res.setHeader('X-Robots-Tag','noindex');await api(req,res);return;}
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
    if(privateHTML.has(path)||path==='/public-pages.json')headers['X-Robots-Tag']='noindex';
    if(path==='/index.html'){res.writeHead(308,{...headers,Location:'/'+url.search}).end();return;}
    const candidate=path.toLowerCase().replace(/\/index\.html$/,'/');
    const publicPath=publicPages.has(candidate)?candidate:publicPages.has(candidate+'/')?candidate+'/':null;
    if(publicPath&&path!==publicPath){res.writeHead(308,{...headers,Location:publicPath+url.search}).end();return;}
    const file=resolve(root,'.'+(path==='/'?'/index.html':publicPath?'/'+publicPages.get(publicPath):path==='/precheck'||path==='/precheck/'?'/precheck/index.html':path));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
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
    if(path==='/'||publicPath||['/robots.txt','/sitemap.xml','/llms.txt'].includes(path)||['.css','.js','.mjs','.svg','.woff2','.png','.jpg','.jpeg','.webp'].includes(extname(file))){
      headers['Cache-Control']='public, max-age=0, must-revalidate';
      headers.Vary='Accept-Encoding';
      headers.ETag='W/"'+createHash('sha256').update(body).digest('hex').slice(0,32)+'"';
      if(req.headers['if-none-match']?.split(',').some(value=>value.trim()===headers.ETag||value.trim()==='*')){res.writeHead(304,headers).end();return;}
    }
    headers['Content-Length']=body.length;
    res.writeHead(200,{...headers,'Content-Type':types[extname(file)]||'application/octet-stream'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('页面不存在');}
});
server.requestTimeout=120000;server.headersTimeout=15000;
monitoring.start();
let closePromise;
return {server,db,worker,monitoring,close(){return closePromise??=(async()=>{const connectionsClosed=new Promise(r=>server.close(r));await Promise.all([monitoring.stop(),worker.stop(),connectionsClosed]);db.close();})();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){loadLocalEnvironment();const app=createServer();const port=Number(process.env.PORT||5173);app.server.listen(port,'127.0.0.1',()=>console.log(`PaperKnow: http://127.0.0.1:${port}/workspace.html`));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));}
