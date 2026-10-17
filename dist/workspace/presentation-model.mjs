export const scenarios=['毕业论文答辩','开题报告','课题汇报','文献汇报','通用汇报'];
export const themes={academic:{name:'学术简洁',accent:'286AFF',dark:'18345B'},formal:{name:'正式答辩',accent:'1C4668',dark:'112F45'},focus:{name:'科研清新',accent:'168B89',dark:'173E48'}};
const structures=[['研究背景与问题','文献回顾与理论基础','研究设计与方法','研究结果与分析','结论与研究贡献','研究局限与展望'],['选题背景与研究意义','文献回顾','研究目标与问题','研究内容与方法','技术路线与可行性','研究计划与预期成果'],['研究问题','研究进展','方法与数据','阶段结果','问题与讨论','下一步计划'],['文献来源与研究问题','理论与研究背景','研究方法','主要发现','研究局限','评述与启示'],['汇报背景与目标','核心概念与范围','主要内容与方案','实施步骤与资源','风险与应对','总结与下一步']];
export function validateMaterial(text){const t=String(text||'').trim();if(!t)throw new Error('请先导入或填写材料。');if(t.length>80000)throw new Error('材料最多 80,000 字符，请选择关键章节。');return t;}
export function buildSlides(v){validateMaterial(v.material);if(!v.title?.trim())throw new Error('请填写演示标题。');const n=Number(v.pages);if(!Number.isInteger(n)||n<6||n>30)throw new Error('目标页数应为 6–30 页。');const index=Math.max(0,scenarios.indexOf(v.scenario));const compact=[['研究背景与问题','研究设计与方法','研究结果与分析','结论与研究贡献'],['选题背景与研究意义','研究目标与方法','技术路线与可行性','研究计划与预期成果'],['研究问题','方法与数据','阶段结果','下一步计划'],['文献来源与研究问题','研究方法','主要发现','评述与启示'],['汇报目标','核心内容','实施计划','总结与下一步']];const topics=n<8?compact[index]:structures[index];return Array.from({length:n},(_,i)=>({id:crypto.randomUUID(),title:i===0?v.title:i===n-1?'致谢与问答':topics[Math.min(topics.length-1,Math.floor((i-1)*topics.length/(n-2)))],body:i===0?[v.scenario,[v.author,v.school,v.advisor&&'导师：'+v.advisor].filter(Boolean).join(' · ')].filter(Boolean).join('\n'):i===n-1?'请填写致谢内容与联系方式。':'待补充：请依据实际材料填写本页要点。',notes:'',layout:i===0?'cover':'content'}));}
export function deckText(deck){return [deck.title,`${deck.scenario} · ${deck.degree} · ${deck.language}`,deck.fileName&&'材料：'+deck.fileName,...deck.slides.flatMap((s,i)=>['',`${i+1}. ${s.title}`,s.body,s.notes&&'演讲备注：'+s.notes])].filter(v=>v!==false&&v!=null).join('\n');}
export function validateDeck(deck){if(!deck.title.trim())throw new Error('请填写演示标题。');if(!deck.slides.length)throw new Error('请先创建大纲。');if(deck.slides.length>30)throw new Error('最多 30 页。');for(const s of deck.slides){if(!s.title.trim())throw new Error('每页需要一个标题。');if(s.title.length>120||s.body.length>1400||s.notes.length>3000)throw new Error('单页标题最多 120 字，正文 1,400 字，备注 3,000 字。');}return deck;}

export function presentationSnapshot(deck,mode='ai',tier='basic'){
 const title=String(deck.title||'').trim(),text=String(deck.material||'').trim(),requirements=String(deck.prompt||'').trim();
 if(!title)throw new Error('请先填写演示标题。');if(title.length>120)throw new Error('演示标题最多 120 字。');if(requirements.length>2800)throw new Error('制作要求最多 2,800 字符，请精简要求后再生成。');
 if(!Number.isInteger(Number(deck.pages))||deck.pages<6||deck.pages>30)throw new Error('目标页数应为 6–30 页。');
 if(text.length>40000)throw new Error('AI 创作最多读取 40,000 字符，请保留与本次汇报相关的关键材料。原文不会被截断。');
 if(mode!=='ai'&&!text)throw new Error(mode==='proposal'?'请先导入或粘贴开题报告正文。':'请先导入或粘贴毕业论文正文。');
 if(!text&&!requirements)throw new Error('请描述演示主题、听众与重点，或导入参考材料。');
 return {title,text,requirements:[requirements,tier==='premium'?'请为每页编写详细演讲备注，备注必须与页面和提供的材料一致。':'请提供简洁的演讲备注。'].filter(Boolean).join('\n'),language:deck.language||'中文',mode,materials:text?[{id:'presentation-source',name:deck.fileName||'用户参考材料',text}]:[],context:{pages:Number(deck.pages),minutes:Number(deck.minutes)||10,author:deck.author||'',school:deck.school||'',advisor:deck.advisor||'',theme:deck.theme||'academic',degree:deck.degree||'本科',scenario:deck.scenario||''}};
}
export function adoptPresentationOutput(output,deck){
 if(!Array.isArray(output?.slides)||output.slides.length!==Number(deck.pages))throw new Error('生成页数与要求不一致，请重新核对后生成。');
 const slides=output.slides.map((s,i)=>({id:crypto.randomUUID(),title:String(s.title||'').trim(),body:Array.isArray(s.body)?s.body.map(String).join('\n'):String(s.body||''),notes:String(s.notes||''),layout:['cover','content','twoColumn','closing'].includes(s.layout)?s.layout:i===0?'cover':'content'}));
 validateDeck({...deck,slides});return slides;
}
