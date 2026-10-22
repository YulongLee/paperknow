// A File only gains cloud provenance after an authenticated, verified library read.
// Never persist this map or infer provenance from names / user-supplied properties.
const sources=new WeakMap();
export function bindStoredFile(file,source){sources.set(file,Object.freeze({...source}));return file;}
export const storedFileSource=file=>file&&sources.get(file)||null;
export async function reuseStoredOriginal(file,{api,expectedUserId,projectId}={}){
 const source=storedFileSource(file);if(!source)return null;
 if(source.ownerId!==expectedUserId)throw Error('登录账户已变化，请重新从文件管理选择文件。');
 const value=await api('/files/reuse',{expectedUserId,sourceType:source.sourceType,sourceId:source.id,expectedSha256:source.sha256,...(projectId?{projectId}:{})});
 if(typeof value?.id!=='string'||!value.id)throw Error('未确认文件复用，请重新选择文件。');
 return value;
}
