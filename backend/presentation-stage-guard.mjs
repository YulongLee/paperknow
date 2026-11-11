// Conservative checks for observed unsupported research-stage claims. These
// checks are deliberately narrow and do not prove the remaining content true.
const completion=/(?:已|已经|成功)?完成(?:了)?[^，。；;\n]{0,18}(?:设计|实验|测试|调查|验证|研发|开发|部署|研究)|(?:设计|实验|测试|调查|验证|研发|开发|部署|研究)[^，。；;\n]{0,12}(?:已完成|已经完成|已开展|已经开展)|(?:经|经过|通过)[^，。；;\n]{0,25}(?:测试|实验|调查|验证)[^，。；;\n]{0,15}(?:形成|获得|得出|完成)|(?:开展|进行了|实施了)[^，。；;\n]{0,25}(?:测试|实验|调查|验证|需求分析|系统设计)/u;
const planned=/(?:后续|下一步|未来|计划|拟|预计|将要|即将)[^。；;\n]{0,35}(?:开展|进行|实施|执行|验证|测试|调查|实验|开发|部署)/u;
function sentences(text){return String(text||'').split(/[。！？!?；;，,\n]+/u).map(s=>s.trim()).filter(Boolean);}
function positiveCompletion(text){return sentences(text).some(s=>{const m=completion.exec(s);if(!m)return false;return !/(?:未|尚未|未能|没有|未曾|不曾|无需|不必|不再|不应|不能|不可|避免|计划|拟|将|预计|准备|希望|建议|可以|可)\s*$/u.test(s.slice(0,m.index));});}
const activityGroups=[/设计/u,/需求分析/u,/(?:测试|验证)/u,/实验/u,/调查/u,/(?:开发|研发)/u,/部署/u,/研究/u];
function explicitPlan(text){return sentences(text).some(s=>planned.test(s)&&activityGroups.some(group=>group.test(s))&&!/(?:没有|未有|未制定|尚未制定|暂无|无)\s*(?:后续|下一步|未来|计划|安排)/u.test(s));}
function supported(source,asserted,predicate){
 const groups=activityGroups.filter(group=>group.test(asserted));
 return groups.length>0&&groups.every(group=>sentences(source).some(s=>group.test(s)&&predicate(s)));
}
export function unsupportedPresentationStage(slides,materials){
 if(!Array.isArray(materials)||!materials.length)return null;
 const sources=materials.map(m=>m.text||'').join('\n');
 for(const [index,slide] of slides.entries()){
  const text=[slide.title,slide.body,slide.notes].filter(Boolean).join('\n');
  for(const sentence of sentences(text)){
   if(explicitPlan(sentence)){if(!supported(sources,sentence,explicitPlan))return {code:'ppt_unsupported_stage',page:index+1,stage:'plan'};continue;}
   if(positiveCompletion(sentence)&&!supported(sources,sentence,positiveCompletion))return {code:'ppt_unsupported_stage',page:index+1,stage:'completion'};
  }
 }
 return null;
}
