// Only authenticated, read-only endpoints are used by the overview.
export async function readHomeService(fetcher=fetch){
 const get=async path=>{const response=await fetcher('/api'+path,{cache:'no-store'});if(!response.ok){const error=new Error('服务数据暂不可用');error.status=response.status;throw error;}return response.json();};
 const cap=await get('/capabilities');let user=null;
 try{user=(await get('/auth/me')).user;}catch(error){if(error.status!==401)throw error;}
 if(!user)return {cap,user:null};
 const [jobs,files,usage,projects,drafts,results,summary]=await Promise.all([get('/jobs'),get('/files'),get('/usage'),get('/projects'),get('/workspace/drafts'),get('/results'),get('/workspace/summary')]);
 return {cap,user,jobs:jobs.items,files:files.items,usage:usage.items,projects:projects.items,drafts:drafts.items,results:results.items,summary};
}
