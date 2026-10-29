export const readingModes=Object.freeze({
 keypoints:Object.freeze({label:'归纳知识点',requirements:'归纳所选原文中的核心概念与术语、关键知识点及其联系、研究方法与主要观点；结合原文说明概念含义、方法用途、关键依据与适用边界。每个知识点应有可定位的原文依据；原文未说明的事项明确标注未提供，不补造定义、数据或结论。'}),
 summary:Object.freeze({label:'总结论文内容',requirements:'按研究背景与问题、方法、结果、结论整理所选原文的结构概要；准确保留重要数字与条件，缺项明确标注原文未提供，不把所选节选称为已读全文。'}),
 deep:Object.freeze({label:'深入阅读论文',requirements:'深入梳理所选原文的研究问题、设计与方法、证据及推论、局限和适用条件、需要进一步核验的问题；区分原文事实与阅读解读，给出可定位的原文依据，不补造数据或发现。'})
});
export function readingChatHistory(paper,materials,{enabled=false}={}){
 if(!enabled)return {history:[],notice:''};
 const fingerprint=JSON.stringify(materials),candidates=(paper.aiResults||[]).filter(result=>result.operation==='answer'&&result.sourceScope===paper.scope&&!Object.hasOwn(result,'editedAt')&&JSON.stringify(result.materials)===fingerprint).map((result,index)=>({result,index})).sort((a,b)=>(Date.parse(b.result.createdAt)||0)-(Date.parse(a.result.createdAt)||0)||b.index-a.index).slice(0,3);
 const history=[];let characters=0,omitted=0;
 for(const {result}of candidates){const question=result.question,answer=result.output?.text;if(typeof question!=='string'||!question.trim()||question.length>1500||typeof answer!=='string'||!answer.trim()||answer.length>6000||characters+question.length+answer.length>12000){omitted++;continue;}history.push({question,answer});characters+=question.length+answer.length;}
 history.reverse();return {history,notice:omitted?'有 '+omitted+' 轮对话超出完整上下文范围，未加入，也未截断。':history.length?'将带上同一选区最近 '+history.length+' 轮问答；已标记手工修改的记录不带入，旧问答仍需核对，事实依据仅来自本次原文。':'没有符合当前完整选区、材料范围和修改标记条件的问答，本次不带历史对话。'};
}
