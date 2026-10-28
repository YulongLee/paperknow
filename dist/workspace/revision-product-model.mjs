const modes=new Set(['report','paragraph','dual']);
export function revisionProductSpec(kind,mode){
 if(!['aigc','similarity'].includes(kind)||!modes.has(mode))throw Error('请选择支持的修改功能。');
 const target=kind==='aigc'?'AI率':'重复率';
 return {title:mode==='dual'?'整篇 AIGC＋重复率双降':mode==='report'?'报告＋原文降'+target:'段落降'+target,plan:mode==='dual'?'dual':'strong',mode:kind==='aigc'?'reduce':'rewrite',report:mode==='report',paste:mode==='paragraph'};
}
export function normalizeRevisionProduct(value,{mode,plan}={}){
 if(!value||value.version!==1||Object.keys(value).some(key=>!['version','kind','mode'].includes(key)))throw Error('修改功能信息无效。');
 const spec=revisionProductSpec(value.kind,value.mode);
 if(mode!==undefined&&spec.mode!==mode||plan!==undefined&&spec.plan!==plan)throw Error('修改功能与本次处理方案不一致。');
 return {version:1,kind:value.kind,mode:value.mode};
}
