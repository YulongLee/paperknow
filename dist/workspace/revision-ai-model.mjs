import {editParagraph} from './revision-model.mjs';
const fingerprint=parts=>{let value=2166136261;for(const point of JSON.stringify(parts.map(p=>[p.id,p.suggestion,p.reason,p.comment,p.accepted,p.resolved]))){value=Math.imul(value^point.charCodeAt(0),16777619)>>>0;}return value.toString(16);};
export function revisionAiSnapshot(doc,{scope='current',index=0}={}){
 if(!doc?.paragraphs?.length)throw Error('请先导入或粘贴原文，创建修改稿。');
 const parts=scope==='all'?doc.paragraphs:[doc.paragraphs[index]];if(parts.some(p=>!p))throw Error('当前段落已变化，请重新选择。');
 if(parts.some(p=>p.original.length>3500))throw Error('单段原文超过 3,500 字符，请先按自然段拆分后创建修改稿。');
 const text=parts.map(p=>p.original.trim()).join('\n\n');if(text.length>32000)throw Error('整稿超过单次 32,000 字符，请按“当前段落”分次处理，不会截断原稿。');
 const requirement=[doc.requirements,doc.plan==='dual'?'同时梳理重复表达与模板化句式，保留真实研究内容。':'',doc.plan==='english'?'保持英文专业术语，输出英文修改稿。':'',...parts.filter(p=>p.comment).map(p=>`${p.id} 待核对意见：${p.comment}`)].filter(Boolean).join('\n');
 if(requirement.length>3000)throw Error('本次修改要求及段落意见合计超过 3,000 字符，请精简后生成；原内容仍保留。');return {title:doc.title,text,requirements:requirement,mode:doc.mode,language:doc.plan==='english'?'en':'zh-CN',materials:[],context:{revisionId:doc.id,plan:doc.plan||'strong',scope,paragraphIds:parts.map(p=>p.id),editFingerprint:fingerprint(parts)}};
}
export function applyRevisionAiOutput(doc,output,source){
 if(!output||!Array.isArray(output.paragraphs)||output.paragraphs.length!==source.context.paragraphIds.length)throw Error('修改结果缺少对应段落，不能覆盖当前稿。');
 const original=source.context.paragraphIds.map(id=>doc.paragraphs.find(p=>p.id===id)?.original.trim());if(original.join('\n\n')!==source.text)throw Error('原文已变化，请重新确认修改范围。');let next=doc;
 output.paragraphs.forEach((part,i)=>{const id=source.context.paragraphIds[i],at=doc.paragraphs.findIndex(p=>p.id===id);if(at<0||part.id!==id||part.original!==original[i]||doc.paragraphs[at].original.trim()!==part.original||typeof part.revised!=='string'||!part.revised.trim())throw Error('修改结果与原稿不一致，请保留原文并重新生成。');next=editParagraph(next,at,{suggestion:part.revised,accepted:false,reason:'AI 生成的候选修改，需核对事实、数据、术语与引用后再采纳。'});});return next;
}
