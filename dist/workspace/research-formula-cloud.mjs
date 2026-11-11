// Account draft save: retry ambiguous creates with the exact original request.
export async function saveFormulaAccount({api,ownerId,record,storage,storageKey,uuid=()=>crypto.randomUUID(),current=()=>true}){
 if(!ownerId||typeof api!=='function')throw Error('请登录后保存公式到云端。');
 const identity=await api('/auth/me');if(!current()||identity.user?.id!==ownerId)throw Error('登录账户已变化，未继续保存。');
 let state;try{state=JSON.parse(storage.getItem(storageKey)||'null')||{};}catch{throw Error('无法读取保存状态，请重试。');}
 if(state.ownerId&&state.ownerId!==ownerId)throw Error('账户已变化，请重新打开公式后保存。');
 const store=()=>{try{storage.setItem(storageKey,JSON.stringify(state));}catch{throw Error('无法保存恢复信息，已停止云端提交。');}};
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 async function verified(){const auth=await api('/auth/me');if(!current()||auth.user?.id!==ownerId)throw Error('登录账户已变化，请切回原账户查看结果。');}
 async function create(request){const response=await api('/workspace/drafts',request);if(!response?.item?.id||!Number.isInteger(response.item.version))throw Error('云端保存结果未能确认，请重试。');state={ownerId,id:response.item.id,version:response.item.version};store();await verified();}
 const payload={...record};delete payload.id;delete payload.projectId;
 const title=record.title;
 if(state.pending){const pending=state.pending;await create(pending);if(pending.title===title&&same(pending.payload,payload))return state;}
 if(!state.id){state={ownerId,pending:{title,tool:'research',projectId:'',payload,clientKey:uuid()}};store();await create(state.pending);return state;}
 const apply=async(request)=>{try{const response=await api('/workspace/drafts/'+encodeURIComponent(state.id),request);if(!response?.item?.id||!Number.isInteger(response.item.version))throw Error('云端保存结果未能确认，请重新打开账户草稿核对。');state.version=response.item.version;delete state.pendingUpdate;store();await verified();}catch(error){if(error.status!==409||error.code==='ACCOUNT_CHANGED')throw error;const response=await api('/workspace/drafts/'+encodeURIComponent(state.id));await verified();const item=response?.item;if(item&&item.title===request.title&&same(item.payload,request.payload)){state.version=item.version;delete state.pendingUpdate;store();return;}throw Error('账户中的公式已有更新，请重新打开账户版本；当前输入仍保留。');}};
 if(state.pendingUpdate){const pending=state.pendingUpdate;await apply(pending);if(pending.title===title&&same(pending.payload,payload))return state;}
 const request={version:state.version,title,payload};state.pendingUpdate=request;store();await apply(request);return state;
}
