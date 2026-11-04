import {moderateTextOrFail} from './moderated-agent.mjs';
import {notifyLiteratureRun} from './literature-stream.mjs';

export function createLiteraturePreview({db,id,config,signal,isActive}){
 let pending='',last='',flight=null,closed=false,blocked=false,timer=null;
 const interval=config.literaturePreviewIntervalMs??250;
 const clear=()=>db.prepare('DELETE FROM tool_run_previews WHERE run_id=?').run(id);
 async function flush(){
  timer=null;if(closed||blocked||signal.aborted||!isActive())return;
  const text=pending;pending='';if(!text||text===last)return;
  flight=(async()=>{try{
   await moderateTextOrFail(config,text,{kind:'output',signal});
   if(closed||signal.aborted||!isActive())return;
   db.prepare('INSERT INTO tool_run_previews VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at').run(id,text,new Date().toISOString());last=text;notifyLiteratureRun(db,id);
  }catch{blocked=true;clear();}})();
  await flight;flight=null;if(pending&&!closed&&!blocked)schedule();
 }
 function schedule(){if(timer||flight)return;timer=setTimeout(()=>void flush(),interval);timer.unref?.();}
 return{write(text){if(closed||blocked||signal.aborted||typeof text!=='string')return;pending=text.slice(0,12000);schedule();},async close(){closed=true;pending='';clearTimeout(timer);if(flight)await flight;clear();notifyLiteratureRun(db,id);}};
}
