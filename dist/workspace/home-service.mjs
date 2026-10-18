// Only authenticated, read-only endpoints are used by the overview.
export async function readHomeService(fetcher=fetch){
 const get=async(path,owner)=>{const response=await fetcher('/api'+path,{cache:'no-store',...(owner?{headers:{'X-PaperKnow-User':owner}}:{})});if(!response.ok){const error=new Error('服务数据暂不可用');error.status=response.status;throw error;}return response.json();};
 const cap=await get('/capabilities');let user=null;
 try{user=(await get('/auth/me')).user;}catch(error){if(error.status!==401)throw error;}
 if(!user)return {cap,user:null};
 const [jobs,files,usage,projects,drafts,results,summary,theses]=await Promise.all(['/jobs','/files','/usage','/projects','/workspace/drafts','/results','/workspace/summary','/theses'].map(path=>get(path,user.id)));
 const confirmed=await get('/auth/me',user.id);if(confirmed.user?.id!==user.id)throw Object.assign(new Error('登录账户已变化，请刷新工作台'),{status:409,code:'ACCOUNT_CHANGED'});
 return {cap,user,jobs:jobs.items,files:files.items,usage:usage.items,projects:projects.items,drafts:drafts.items,results:results.items,summary,theses:theses.items};
}
