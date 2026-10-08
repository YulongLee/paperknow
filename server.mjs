import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {database} from './backend/database.mjs';
import {createAPI} from './backend/api.mjs';
import {startWorker} from './backend/worker.mjs';
export function createServer({dbPath=resolve(process.env.PK_DATA_DIR||'.data','paperknow.sqlite'),config={aiURL:process.env.PK_AI_URL,aiKey:process.env.PK_AI_KEY,aiModel:process.env.PK_AI_MODEL,secure:process.env.PK_SECURE_COOKIE==='1'}}={}){
if(config.aiURL){const u=new URL(config.aiURL);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('模型接口必须使用 HTTPS 或本地地址');}
const db=database(dbPath),worker=startWorker(db,config),api=createAPI(db,worker,config),root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{if(req.url?.startsWith('/api/')){await api(req,res);return;}try{if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(root,'.'+(path==='/'?'/index.html':path==='/precheck'||path==='/precheck/'?'/precheck/index.html':path));if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('页面不存在');}});
server.requestTimeout=120000;server.headersTimeout=15000;
return {server,db,worker,async close(){await worker.stop();await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const app=createServer();const port=Number(process.env.PORT||5173);app.server.listen(port,'127.0.0.1',()=>console.log(`PaperKnow: http://127.0.0.1:${port}/service.html`));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));}
