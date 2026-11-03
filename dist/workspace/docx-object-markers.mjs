const marker=/\[docx:(obj-[a-f0-9]{24})\]/g;
export const docxObjectIds=text=>[...String(text||'').matchAll(marker)].map(row=>row[1]);
export const withoutDocxObjects=text=>String(text||'').replace(marker,'');
export function assertDocxObjectMarkers(text,allowed=[]){
 const ids=docxObjectIds(text),known=new Set(allowed),reserved=String(text||'').match(/\[docx\b/gi)||[];
 if(reserved.length!==ids.length||new Set(ids).size!==ids.length||ids.some(id=>!known.has(id)))throw Error('原稿图片或公式的位置关联无效，请保留原位置标记后重试。');
 return ids;
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function docxObjectHTML(object,thesisId){
 if(!object)return '<span class="thesis-error">原稿内容暂不可读取，请重新读取论文状态。</span>';
 if(object.kind==='formula')return '<span class="thesis-imported-formula" aria-label="原稿公式">'+object.mathML+'</span>';
 return '<span class="thesis-imported-image"><img loading="lazy" src="/api/theses/'+encodeURIComponent(thesisId)+'/docx-objects/'+encodeURIComponent(object.id)+'/preview" alt="'+esc(object.label||'原稿图片')+'"></span>';
}
