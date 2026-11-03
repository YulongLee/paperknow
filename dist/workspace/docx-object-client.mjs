import {docxObjectIds} from './docx-object-markers.mjs';
export async function resolveDocxExportObjects(text,options,{signal}={}){
 if(!docxObjectIds(text).length)return options;
 const owner=options.docxObjectOwner;if(!owner?.id||!Number.isSafeInteger(owner.version))throw Error('原稿图片与公式未关联当前论文，请重新读取论文后导出。');
 const response=await fetch('/api/theses/'+encodeURIComponent(owner.id)+'/docx-objects/export',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:owner.version}),signal});let value;try{value=await response.json();}catch{throw Error('原稿图片与公式暂不可读取，请稍后重试。');}if(!response.ok)throw Error(value.error||'原稿图片与公式读取失败。');if(value.version!==owner.version||!Array.isArray(value.objects))throw Error('论文已更新，请重新导出。');return {...options,docxObjects:value.objects};
}
