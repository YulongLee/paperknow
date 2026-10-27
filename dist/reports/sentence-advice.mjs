// Editorial checks are derived only from the submitted wording. They do not
// assert sentence-level authorship, verify research facts or make network calls.
const protectedPatterns=[/```[\s\S]*?```|~~~[\s\S]*?~~~/g,/`[^`\r\n]+`/g,/\$\$[\s\S]*?\$\$|\$[^$\r\n]+\$/g,/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g,/https?:\/\/[^\s<>"“”]+/gi,/\b10\.\d{4,9}\/[^\s<>"“”]+/gi,/“[^”]*”|「[^」]*」|『[^』]*』/g,/"[^"\r\n]+"/g];
function protectedUnits(text){
 const mask=new Uint8Array(text.length);
 for(const pattern of protectedPatterns){pattern.lastIndex=0;for(const match of text.matchAll(pattern)){let end=match.index+match[0].length;if(/^(?:https?:|10\.)/i.test(match[0]))while(end>match.index&&/[。！？.!?,;，；)]/.test(text[end-1]))end--;mask.fill(1,match.index,end);}}
 return mask;
}
export function reportSentences(text,{literal=false}={}){
 text=String(text);if(!text.trim())return[];const chars=Array.from(text),rows=[];
 if(literal)return[{index:1,start:0,end:chars.length,text}];
 const units=protectedUnits(text),offsets=[];let unit=0;for(const char of chars){offsets.push(unit);unit+=char.length;}
 let start=0;
 const append=end=>{if(chars.slice(start,end).join('').trim()){rows.push({index:rows.length+1,start,end,text:chars.slice(start,end).join('')});start=end;}};
 for(let at=0;at<chars.length;at++){
  const char=chars[at];if(!/[。！？.!?]/.test(char)||units[offsets[at]])continue;
  if(char==='.'){
   if(/\d/.test(chars[at-1]||'')&&/\d/.test(chars[at+1]||''))continue;
   const before=chars.slice(Math.max(start,at-12),at+1).join('');
   if(/(?:\b(?:e\.g|i\.e|et al|Fig|Eq|Dr|Mr|Mrs|Ms|Prof|No|vs|approx|cf)|\b[A-Z])\.$/i.test(before))continue;
   if(chars[at+1]&&!/[\s”’"')\]】]/.test(chars[at+1]))continue;
  }
  let end=at+1;while(/[。！？.!?\u201d\u2019"'）)\]】]/.test(chars[end]||'\0'))end++;
  while(end<chars.length&&/\s/.test(chars[end]))end++;
  append(end);at=end-1;
 }
 append(chars.length);if(start<chars.length&&rows.length){rows.at(-1).text+=chars.slice(start).join('');rows.at(-1).end=chars.length;}return rows;
}
const simplifications=[
 [/^\s*(?:值得注意的是|需要指出的是|不难发现|众所周知|毋庸置疑|综上所述)[，,：:]\s*/u,''],
 [/进行进一步的分析/gu,'进一步分析'],[/进行详细的分析/gu,'详细分析'],[/进行深入的分析/gu,'深入分析'],[/进行深入的探讨/gu,'深入探讨'],[/进行系统的分析/gu,'系统分析'],[/开展相关的研究/gu,'开展研究'],[/进行综合性的分析/gu,'综合分析'],
 [/\bin order to\b/gi,'to'],[/\bdue to the fact that\b/gi,'because'],[/\bat the present time\b/gi,'currently']
];
function simplified(text){
 let value=text;
 for(const [pattern,replacement]of simplifications){const mask=protectedUnits(value);pattern.lastIndex=0;value=value.replace(pattern,(match,...args)=>{const start=args.at(-2);if(mask.subarray(start,start+match.length).some(Boolean))return match;return start===0&&/^[A-Z]/.test(match)&&/^[a-z]/.test(replacement)?replacement[0].toUpperCase()+replacement.slice(1):replacement;});}
 return value.trim()===text.trim()?null:value.trim();
}
export function sentenceEditAdvice(text,{literal=false}={}){
 text=String(text);const trimmed=text.trim(),issues=[],add=(title,detail)=>{if(issues.length<3)issues.push({title,detail});};
 if(/^\s*\[\d+\]\s*\S/.test(text))return{kind:'verify',issues:[{title:'核对参考文献信息',detail:'逐项核对作者、题名、年份、出版信息及 DOI；保留引用编号，与正文引用对应，不改写文献题名。'}],revised:null};
 if(literal||/^\s*\|.+\|\s*$/.test(text)||/^\s*(?:\\begin\{|\$\$|\\\[)/.test(text))return{kind:'verify',issues:[{title:'保留结构与符号',detail:'保留代码、公式或表格的原始结构；核对符号、变量说明及正文中的引用位置，不作同义替换。'}],revised:null};
 const has=(pattern)=>pattern.test(trimmed),hasCitation=has(/\[\s*\d+(?:\s*[-–,，]\s*\d+)*\s*\]|[（(][^()（）]{0,90}(?:19|20)\d{2}[a-z]?[^()（）]{0,30}[）)]/);
 const opening=trimmed.match(/^(?:值得注意的是|需要指出的是|不难发现|众所周知|毋庸置疑|综上所述)[，,：:]/);
 if(opening)add('精简引导语',`“${opening[0]}”可酌情删去，直接陈述后面的具体内容；若承担段落归纳作用，可保留。`);
 if(has(/显著|大幅|极大|十分重要|巨大|卓越|非常有效|\b(?:significant|dramatic|remarkable|substantial)\b/i))add('核对程度与结论依据','本句含程度或效果判断。核对其对应的评价指标、比较对象及证据；“显著”等统计表述应有适当检验依据。');
 if(has(/\d+(?:\.\d+)?\s*(?:%|％|个|例|份|次|倍|ms\b|s\b|GB\b|MB\b|mm\b|cm\b|kg\b)|[Pp]\s*[<=>≤≥]\s*0\.\d+/)){
  const token=trimmed.match(/\d+(?:\.\d+)?\s*(?:%|％|个|例|份|次|倍|ms\b|s\b|GB\b|MB\b|mm\b|cm\b|kg\b)|[Pp]\s*[<=>≤≥]\s*0\.\d+/)?.[0];
  add('保留数值并核对口径',`保留“${token}”等原始数值；核对数据来源、样本范围、计算方法与单位，不能仅为修改表达而调整数据。`);
 }
 if(!hasCitation&&has(/研究表明|研究发现|已有研究|相关研究指出|有学者|文献表明|实验证明|\b(?:studies show|research suggests|previous studies|has been shown)\b/i))add('补全可核对的依据','本句引用研究或实验结论，但句中未见明确引文标记；核对附近引文，缺少时补充真实来源，并说明适用范围。');
 if(has(/导致|由此证明|必然|一定会|毫无疑问|\b(?:causes?|always|guarantees?)\b/i))add('核对推论强度','区分观察到的关联、可能解释与因果结论；核对研究设计及适用条件，不把相关关系直接写为因果关系。');
 const words=trimmed.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[],han=(trimmed.match(/\p{Script=Han}/gu)||[]).length;
 if(han>=100||words.length>=45)add('拆分长句','本句承载的信息较多。可按研究对象、方法或结果拆成两至三句，保留原有逻辑、限定条件与引用对应关系。');
 if(has(/^(?:这|其|该方法|该结果|此种方式|这种情况)|^(?:This|These|It|They)\b/i))add('明确指代','核对句首指代在前文是否有唯一、清楚的对象；若存在多个可能对象，改为具体的研究对象或方法名称。');
 if(has(/拟开展|拟采用|计划|将开展|将采用|\b(?:plan to|will conduct|will adopt)\b/i))add('核对研究状态','核对本句描述的是研究计划还是已完成工作；仅在已有真实实施材料支持时调整时态，不把计划改写成已完成的事实。');
 const revised=simplified(text);
 if(revised&&!issues.length)add('精简冗余表达','可将名词化或迂回表达改为直接的动词表达，保留研究对象、条件和原意。');
 if(!issues.length){
  if(has(/\$|\\\(|\\\[|`/))add('核对符号与术语','保留本句中的公式、代码、变量及专有名词；核对符号释义与正文说明是否一致。');
  else if(has(/是指|定义为|\b(?:defined as|refers to)\b/i))add('核对概念边界','本句给出概念或定义。核对其来源、适用范围及与后文术语的一致性，避免仅为换词改变概念含义。');
  else if(has(/采用|使用|通过|\b(?:using|used|method|procedure)\b/i))add('核对方法说明','本句涉及方法。结合相邻正文核对对象、关键参数与操作条件是否完整；已有说明时保留原句，不重复堆砌。');
  else add('建议保留原句','未发现明确的句式精简点。可保留本句，结合上下文核对术语、事实与衔接，不必强行替换同义词。');
 }
 return{kind:revised?'edit':issues[0].title==='建议保留原句'?'retain':'verify',issues,revised};
}
