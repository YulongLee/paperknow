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

// Store only an account artifact reference. Storage keys and signed URLs are never used by the editor.
export function presentationArtifact(output){
 const primary=output?.presentation,rows=Array.isArray(output?.artifacts)?output.artifacts:[];
 const candidates=[...(primary?[{id:primary.artifactId||primary.id,name:primary.fileName||primary.name,kind:'pptx',downloadUrl:primary.downloadUrl,pageCount:primary.pageCount}]:[]),...rows.filter(row=>row?.kind==='pptx'||/\.pptx$/i.test(row?.name||'')),...(Array.isArray(output?.artifactIds)?output.artifactIds.map(id=>({id,kind:'pptx'})):[])];
 for(const row of candidates){
  const id=String(row?.id||''),downloadUrl='/api/artifacts/'+id+'/download';
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(id)||row.downloadUrl&&row.downloadUrl!==downloadUrl)continue;
  const name=String(row.name||'演示文稿.pptx').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,180);
  const extras={};for(const [role,key]of [['preview','previewArtifactId'],['sources','sourcesArtifactId']]){const candidate=primary?.[key]||rows.find(value=>value?.role===role)?.id;if(typeof candidate==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(candidate))extras[key]=candidate;}
  return {artifactId:id,downloadUrl,fileName:/\.pptx$/i.test(name)?name:name+'.pptx',...(Number.isSafeInteger(row.pageCount)&&row.pageCount>0?{pageCount:row.pageCount}:{}),...extras};
 }
 return null;
}
export function presentationDownloads(output){
 const deck=presentationArtifact(output);if(!deck)return [];
 const files=[{...deck,role:'deck',label:'下载生成版 PPTX'}],rows=Array.isArray(output?.artifacts)?output.artifacts:[];
 for(const [role,key,label,name]of [['preview','previewArtifactId','下载版式预览','演示文稿-版式预览.html'],['sources','sourcesArtifactId','下载页面源稿','演示文稿-页面源稿.zip']]){
  const id=deck[key];if(!id)continue;const downloadUrl='/api/artifacts/'+id+'/download',row=rows.find(value=>value?.id===id);
  if(row?.downloadUrl&&row.downloadUrl!==downloadUrl)continue;
  files.push({artifactId:id,downloadUrl,fileName:String(row?.name||name).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,180),role,label});
 }
 return files;
}
export const presentationStages=Object.freeze([['planning','整理演示结构'],['authoring','制作演示页面'],['validating','核对页面与内容'],['exporting','导出 PPTX'],['storing','保存到账户']]);
export function presentationProgress(item){
 const progress=item?.progress||{},stage=progress.stage||item?.stage,index=presentationStages.findIndex(([id])=>id===stage),completed=item?.status==='completed',total=Number(completed?presentationArtifact(item.output)?.pageCount??progress.totalPages??item.output?.slides?.length:progress.totalPages),current=completed?total:Number(progress.currentPage??progress.completedPages);
 return {index,stage:index<0?null:stage,label:index<0?'':presentationStages[index][1],pageText:Number.isSafeInteger(current)&&current>=0&&Number.isSafeInteger(total)&&total>0&&current<=total?`${current} / ${total} 页`:''};
}
export function presentationPublicError(value){
 const message=String(value||'');
 return /ppt.?master|anthropic|claude|codex|openai|gemini|provider|api[ _-]?key|access[ _-]?token|oss[.:/ _-]|\/Users\/|\/tmp\/|traceback|stack trace|pptxgen/i.test(message)?'演示文稿暂未完成，原稿与任务仍保留。请读取最新状态后重试。':message;
}
export function restorePresentationSnapshot(snapshot,base={}){
 if(!snapshot||!['ai','proposal','thesis'].includes(snapshot.mode))throw Error('原任务资料暂不可恢复，请在任务中心查看结果。');
 const context=snapshot.context||{},premium='请为每页编写详细演讲备注，备注必须与页面和提供的材料一致。',basic='请提供简洁的演讲备注。',requirements=String(snapshot.requirements||''),suffix=requirements.endsWith(premium)?premium:requirements.endsWith(basic)?basic:'';
 const deck={...base,...Object.fromEntries(['pages','minutes','author','school','advisor','theme','degree','scenario'].filter(key=>context[key]!==undefined).map(key=>[key,context[key]])),title:String(snapshot.title||''),material:String(snapshot.text||''),prompt:suffix?requirements.slice(0,-suffix.length).trim():requirements,fileName:snapshot.materials?.[0]?.name||'',language:snapshot.language||'中文',slides:[],serviceMode:snapshot.mode,pptTier:suffix===premium?'premium':'basic'};
 presentationSnapshot(deck,deck.serviceMode,deck.pptTier);return deck;
}
