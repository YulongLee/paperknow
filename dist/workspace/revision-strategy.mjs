// Shared, fixed generation strategies. User requirements supplement these
// profiles; they cannot replace preservation or completion requirements.
export const revisionStrategyModes=Object.freeze({
 review:Object.freeze({label:'导师意见修改',requirements:'围绕用户实际提供的导师意见逐段改进论证衔接和表达；没有具体意见时只提出保守的学术表达调整，不虚构导师意见，不增加研究结论。'}),
 polish:Object.freeze({label:'学术润色',requirements:'优先纠正语法、措辞、冗余和衔接，保留原有论点、证据强度及段落功能；不为追求变化而改换研究含义。'}),
 rewrite:Object.freeze({label:'论文表达改写',requirements:'在不改变原文含义、论证关系与证据边界的前提下重组句式和论述衔接，减少机械复述；不能只是逐词替换，不能通过删去研究信息完成改写。'}),
 reduce:Object.freeze({label:'自然学术表达',requirements:'减少空泛套话、重复总结与整齐机械句式，以具体、克制、可核对的学术表达改善自然度；不得编造个人经历、实验细节或事实，不能承诺降低任何AI检测分数。'})
});
export const revisionStrategyPlans=Object.freeze({
 strong:Object.freeze({label:'深度表达优化',requirements:'针对每段实际存在的表达问题进行充分但保守的重写，清楚保留原有研究立场、限制条件和证据层级。'}),
 dual:Object.freeze({label:'双重表达优化',requirements:'同时改善重复表述与机械语言风格，兼顾论证连贯和自然学术表达；这是同次表达优化，不代表已调用相似度或AI检测服务，也不能声称任何检测结果。'}),
 bundle:Object.freeze({label:'改写与复核衔接',requirements:'提供便于用户后续逐段复核的完整候选及修改理由；当前步骤仅负责表达优化，不虚构查重、AI检测、复测报告或分数。'}),
 english:Object.freeze({label:'英文学术优化',requirements:'使用准确、自然、克制的英文学术表达呈现候选；保留专业术语、全部受保护原串和原有证据强度，不补写未知事实。'})
});
export function revisionStrategy(mode,plan){
 // Frozen legacy snapshots used an empty mode and omitted the plan. Resolve
 // defaults without mutating the original snapshot or its input hash.
 const effectiveMode=mode===undefined||mode===''?'review':mode,effectivePlan=plan===undefined?'strong':plan;
 if(typeof effectiveMode!=='string'||!Object.hasOwn(revisionStrategyModes,effectiveMode))throw new TypeError('请选择导师意见、学术润色、论文改写或自然学术表达模式');
 if(typeof effectivePlan!=='string'||!Object.hasOwn(revisionStrategyPlans,effectivePlan))throw new TypeError('请选择支持的表达优化方案');
 const profile=revisionStrategyModes[effectiveMode],packageProfile=revisionStrategyPlans[effectivePlan];
 return Object.freeze({mode:effectiveMode,plan:effectivePlan,label:profile.label,planLabel:packageProfile.label,language:effectivePlan==='english'?'English':null,billingKey:effectivePlan==='dual'?'revision-dual':effectiveMode==='reduce'?'revision-aigc':'revision-reduce',requirements:profile.requirements+' '+packageProfile.requirements});
}
