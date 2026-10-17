// Shared by the outline parser and editor so the requested length has one meaning.
// Parent budgets describe their children; callers must not count both as正文 words.
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finitePositive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=80000;
const headingText=value=>String(value??'').trim()
 .replace(/^(?:第\s*[一二三四五六七八九十百零〇\d]+\s*[章节篇部]\s*[、.．:：\-]?\s*|chapter\s+[\divxlcdm]+\s*[.:：\-]?\s*|[\d一二三四五六七八九十]+(?:[.．]\d+)*\s*[、.．:：)）\-]\s*|\d+(?:\.\d+)*\s+)/i,'').trim();

export function isOutlineReferenceTitle(title){return /^(?:参考文献|参考资料|references|bibliography)[.:：。]?(?:\s*[（(].*)?$/i.test(headingText(title));}
export function isOutlineReferenceChapter(chapter){return chapter?.kind==='references'||isOutlineReferenceTitle(chapter?.title);}

function roleWeight(title,section=false){
 const value=headingText(title);
 if(/结论|结语|总结与展望|研究展望|结束语|conclusions?|summary\s+and\s+(?:outlook|future)|future\s+(?:work|directions)/i.test(value))return section ? .8 : .65;
 if(/绪论|引言|导论|选题背景|研究背景|introduction|background|rationale|research\s+context/i.test(value))return section ? .85 : .8;
 if(/文献综述|相关研究|研究现状|理论基础|literature|related\s+(?:work|research)|theoretical\s+(?:basis|framework)/i.test(value))return section ? 1 : 1.15;
 if(/研究方法|研究设计|实验设计|方法论|技术路线|数据与方法|methods?|methodology|research\s+design|experimental\s+design|materials\s+and\s+methods/i.test(value))return section ? 1.15 : 1.3;
 if(/讨论|局限|discussion|limitations?/i.test(value))return section ? 1 : 1.4;
 if(/分析|实证|验证|实验|结果|论证|机制|优化|系统设计|系统实现|方案设计|案例研究|策略|模型构建|模型建立|analysis|analyses|empirical|results?|evaluation|implementation|findings|case\s+stud(?:y|ies)|model\s+(?:design|development)|framework\s+(?:design|development)/i.test(value))return section ? 1.25 : 1.9;
 return section ? 1 : 1.25;
}
function modelWeight(value){return typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<=10?value:null;}
function semanticWeights(rows,section=false){
 const hints=rows.map(row=>modelWeight(row.wordWeight)),valid=hints.filter(value=>value!==null),mean=valid.length?valid.reduce((sum,value)=>sum+value,0)/valid.length:1;
 return rows.map((row,i)=>roleWeight(row.title,section)*(hints[i]===null?1:clamp(hints[i]/mean,.65,1.35)));
}
function weightsFor(rows,preserveWeights,section=false){
 if(!preserveWeights)return semanticWeights(rows,section);
 const current=rows.map(row=>finitePositive(row.targetWords)?row.targetWords:(!section&&Array.isArray(row.sections)?row.sections.reduce((sum,child)=>sum+(finitePositive(child.targetWords)?child.targetWords:0),0):0));
 const present=current.filter(finitePositive);
 if(!present.length)return semanticWeights(rows,section);
 const typical=present.reduce((sum,value)=>sum+value,0)/present.length;
 return current.map(value=>finitePositive(value)?value:typical);
}
function apportioned(total,weights,minima){
 const allocated=Array(weights.length).fill(0),pending=new Set(weights.map((_,i)=>i));let remaining=total;
 // Protect every writable leaf before applying largest-remainder rounding.
 while(pending.size){
  const weightSum=[...pending].reduce((sum,i)=>sum+weights[i],0),under=[...pending].filter(i=>remaining*weights[i]/weightSum<minima[i]);
  if(!under.length)break;
  for(const i of under){allocated[i]=minima[i];remaining-=minima[i];pending.delete(i);}
 }
 if(!pending.size)return allocated;
 const weightSum=[...pending].reduce((sum,i)=>sum+weights[i],0),remainders=[];
 for(const i of pending){const exact=remaining*weights[i]/weightSum;allocated[i]=Math.floor(exact);remainders.push({i,fraction:exact-allocated[i]});}
 let residue=total-allocated.reduce((sum,value)=>sum+value,0);
 remainders.sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
 for(let i=0;i<residue;i++)allocated[remainders[i%remainders.length].i]++;
 return allocated;
}

export function allocateOutlineWordBudget(chapters,targetWords,{preserveWeights=false,minWords=20}={}){
 if(!Number.isInteger(targetWords)||targetWords<500||targetWords>80000)throw new RangeError('请填写 500～80000 的整数目标字数');
 if(!Array.isArray(chapters)||!chapters.length)throw new RangeError('请至少保留一个正文写作章节');
 if(!Number.isInteger(minWords)||minWords<1||minWords>targetWords)throw new RangeError('最小小节字数无效');
 const copy=chapters.map(chapter=>({...chapter,sections:(Array.isArray(chapter.sections)?chapter.sections:[]).map(section=>({...section}))}));
 const writing=copy.filter(chapter=>!isOutlineReferenceChapter(chapter));
 if(!writing.length)throw new RangeError('请至少保留一个正文写作章节，参考文献不计入目标字数');
 const minima=writing.map(chapter=>Math.max(1,chapter.sections.length)*minWords);
 if(minima.reduce((sum,value)=>sum+value,0)>targetWords)throw new RangeError('提纲小节过多，目标字数不足以分配每个小节，请减少小节或提高目标字数');
 const budgets=apportioned(targetWords,weightsFor(writing,preserveWeights),minima);
 for(const chapter of copy){if(isOutlineReferenceChapter(chapter)){chapter.targetWords=0;for(const section of chapter.sections)section.targetWords=0;}}
 writing.forEach((chapter,i)=>{chapter.targetWords=budgets[i];if(chapter.sections.length){const words=apportioned(budgets[i],weightsFor(chapter.sections,preserveWeights,true),chapter.sections.map(()=>minWords));chapter.sections.forEach((section,j)=>section.targetWords=words[j]);}});
 return copy;
}
