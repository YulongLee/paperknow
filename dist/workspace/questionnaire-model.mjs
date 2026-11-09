const numberToken='(?:[0-9]{1,3}|[零一二三四五六七八九十两]{1,3}|(?:twenty|thirty|forty|fifty|sixty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)';
function number(value){if(/^\d+$/.test(value))return Number(value);const digits={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};if(value.includes('十')){const [tens,ones]=value.split('十');return (tens?digits[tens]:1)*10+(ones?digits[ones]:0);}if(digits[value]!==undefined)return digits[value];const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60},parts=value.toLowerCase().split(/[- ]/);return words[parts[0]]+(parts[1]?words[parts[1]]:0);}
function requested(requirements,key,patterns,{min,max,fallback,label}){
 const explicit=requirements?.[key];if(explicit!==undefined&&explicit!==null&&explicit!==''){if(!Number.isSafeInteger(explicit)||explicit<min||explicit>max)throw Error(`${label}应为 ${min}～${max} 的整数。`);return explicit;}
 const instructions=String(requirements?.instructions||'').normalize('NFKC'),values=[];
 // Server/UI boilerplate describes defaults after the user's own requirement.
 const clauses=instructions.split(/[。；;\n]/).map(value=>value.replace(/(?:用户)?(?:未指定|没有指定|未明确|默认|by default|default to)[\s\S]*$/i,''));
 for(const clause of clauses)for(const pattern of patterns)for(const match of clause.matchAll(new RegExp(pattern,'giu'))){const value=number(match[1]);if(Number.isSafeInteger(value))values.push(value);}
 const unique=[...new Set(values)];if(unique.length>1)throw Error(`${label}要求不一致，请填写一个明确的总数。`);
 const value=unique[0]??fallback;if(value<min||value>max)throw Error(`${label}应为 ${min}～${max}，请调整要求后再生成。`);return value;
}
export function requestedIdeaCount(requirements){return requested(requirements,'outputCount',[
 `(${numberToken})\\s*(?:个|项|条|组)?\\s*(?:候选(?:题目|选题|课题|思路|方案)?|题目|选题|课题|研究思路|ideas?\\b|topics?\\b)`,
 `(?:题目|选题|候选|idea|topic)(?:数量|数|count)?\\s*[:：=为是]?\\s*(${numberToken})`
 ],{min:3,max:5,fallback:3,label:'候选题目数量'});}
export function requestedQuestionCount(requirements){return requested(requirements,'outputCount',[
 `(${numberToken})\\s*(?:道|个|项|条)?\\s*(?:问题|题目|题(?!型|材|数)|questions?\\b)`,
 `(?:总题数|题数|问题数量|question count)\\s*[:：=为是]?\\s*(${numberToken})`
 ],{min:3,max:60,fallback:6,label:'问卷题数'});}
export function requestedScalePoints(requirements){return requested(requirements,'scalePoints',[
 `(${numberToken})\\s*[- ]?(?:级|点|分)\\s*(?:李克特|Likert)?\\s*(?:量表|评分)`,
 `(${numberToken})\\s*[- ]?point\\s+(?:Likert\\s+)?scale`,
 `(?:量表级数|量表点数|scale points)\\s*[:：=为是]?\\s*(${numberToken})`
 ],{min:2,max:10,fallback:5,label:'量表级数'});}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||/<\/?(?:script|iframe|html|body|style|img|div|p|a|svg)\b/i.test(value))throw Error(`${label}为空、过长或包含不支持的内容。`);return value.trim();}
export function normalizeScaleOptions(value,{legacyDefault=false,points}={}){
 if(legacyDefault&&(value===undefined||Array.isArray(value)&&value.length===0))value=['1','2','3','4','5'];
 if(!Array.isArray(value)||value.length<2||value.length>10||points!==undefined&&value.length!==points)throw Error(points?`本次量表须保留 ${points} 个分值与对应含义。`:'量表需要 2～10 个有序选项。');
 const options=value.map(option=>text(option,150,'量表选项')),keys=options.map(option=>option.normalize('NFKC').toLocaleLowerCase());if(new Set(keys).size!==options.length)throw Error('量表选项不能重复。');
 if(options.every(option=>/^[-+]?\d+(?:\.\d+)?$/.test(option))&&!options.every((option,index)=>option===String(index+1)))throw Error('数值量表应从 1 开始连续排列；文字量表按选项顺序计分。');
 return options;
}
// Strip only isolated model process messages from an AI-authored introduction.
// Never replace or synthesize the participant-facing consent and privacy text.
function cleanAIIntroduction(value,{removeMissingSkipOption=false,hasRequired=false}={}){
 const intro=text(value,2000,'问卷说明').replace(hasRequired?/(?:或|、|和)\s*跳过(?:任何|所有)不(?:想|愿)回答的(?:题目|问题)/gu:/(?!)/g,'').replace(/(?:当前|本次|本)?问卷(?:暂时|暂|目前)?不支持自动跳题(?:逻辑|功能)?[，,]\s*(?=约需|预计|作答约需)/gu,'');
 const stripped=intro.split(/(?<=[。！？!?\n])/u).filter(sentence=>{
  const s=sentence.trim();
  if(hasRequired&&/^(?:(?:任何|所有)(?:不(?:想|愿)回答的)?(?:题目|问题)(?:均|都)?(?:可|可以)跳过|(?:你|您)?(?:可|可以)跳过(?:任何|所有)不(?:想|愿)回答的(?:题目|问题))[。！？!?]?$/u.test(s))return false;
  if(removeMissingSkipOption&&/(?:未使用|从未使用|没有使用).{0,35}(?:选择|勾选|请选择).{0,25}(?:未使用|未体验|不适用)|(?:选择|勾选|请选择).{0,20}(?:未使用|未体验|不适用).{0,25}(?:未使用|从未使用|没有使用)/u.test(s))return false;
  return !/^(?:当前|本次|本)?问卷(?:暂时|暂|目前)?不支持自动跳题(?:逻辑|功能)?(?:[，,]请自行判断作答)?[。！？!?]?$/u.test(s)&&
   !/^(?:所有|本次|本问卷的?)?(?:结果|数据)(?:均|都)?为待人工核对的草稿数据[。！？!?]?$/u.test(s);
 }).join('').trim();
 if(!stripped)throw Error('AI 问卷缺少受访者说明，请重新生成。');
 return stripped;
}
function neverUsedOption(q,value){const option=String(value||'').trim();return /^(?:从未使用(?:过)?|从不使用(?:过)?|没有使用(?:过)?|未使用(?:过)?|从未接触(?:过)?|从未购买(?:过)?|never used)$/i.test(option)||/(?:使用|阅读|访问).{0,80}(?:频率|次数)|(?:频率|次数).{0,80}(?:使用|阅读|访问)/u.test(String(q?.title||''))&&(/(?:从未|从不|未使用|没有使用)/u.test(option)||/^0\s*次$/u.test(option.normalize('NFKC')));}
function weeklyIntervals(options){return options.flatMap(value=>{const m=String(value||'').normalize('NFKC').trim().match(/^每(?:周|星期)\s*(\d+|[一二三四五六七])\s*(?:至|到|[-~～])\s*(\d+|[一二三四五六七])\s*次$/u);if(!m)return [];const a=number(m[1]),b=number(m[2]);return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=1&&b<=7&&a<=b?[[a,b]]:[];});}
// Frequency categories must share a defined observation window. We never
// approximate months or semesters as a fixed number of weeks.
function frequencyUnits(options){return new Set(options.flatMap(value=>{const option=String(value||'').trim(),match=option.match(/^(?:几乎)?每天|^每(天|日|周|星期|月|学期|年)/u);if(!match)return [];return [!match[1]?'day':({天:'day',日:'day',周:'week',星期:'week',月:'month',学期:'semester',年:'year'})[match[1]]];}));}
function boundedCountIntervals(options){const rows=[];for(const value of options){const option=String(value||'').normalize('NFKC').trim().replace(/\s*[（(][^（）()]*[）)]\s*$/u,''),range=option.match(/^(\d+)\s*(?:至|到|[-~～])\s*(\d+)\s*次$/u),above=option.match(/^(\d+)\s*次(?:及|或)?以上$/u),exact=option.match(/^(\d+)\s*次$/u);if(range){const a=Number(range[1]),b=Number(range[2]);if(a>b)return null;rows.push([a,b]);}else if(above)rows.push([Number(above[1]),Infinity]);else if(exact){const n=Number(exact[1]);rows.push([n,n]);}else if(/^(?:不确定|不愿回答)$/u.test(option))continue;else return null;}return rows.length?rows.sort((a,b)=>a[0]-b[0]):null;}
export function normalizeAIQuestionnaire(output,requirements={}){
 const count=requestedQuestionCount(requirements),points=requestedScalePoints(requirements);
 if(!output||!Array.isArray(output.questions)||output.questions.length!==count)throw Error(`本次要求 ${count} 道题，生成数量不一致，未替换现有问卷。`);
 // Report bounded structural facts, never candidate titles, labels or IDs. A
 // collapsed "a / b / c" string is still one option; it is not split or guessed.
 const optionIssues=[];
 for(const [index,row]of output.questions.entries()){
  if(!row||!['single','multiple','scale','text'].includes(row.type))continue;
  const expectedMin=row.type==='scale'?points:row.type==='text'?0:2,expectedMax=row.type==='scale'?points:row.type==='text'?0:10,actualOptionsCount=Array.isArray(row.options)?row.options.length:null;
  if(actualOptionsCount===null||actualOptionsCount<expectedMin||actualOptionsCount>expectedMax)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'option_count',actualOptionsCount,expectedMin,expectedMax,...(row.type==='scale'?{expectedExact:points}:{})});
  // Ask the model to repair only an unambiguous dimension mismatch. Agree/
  // disagree is valid for statements, but not for a direct convenience rating.
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:便利|便捷)程度|评价.{0,40}(?:便利|便捷)|评价.{0,60}体验[：:，,]?.{0,60}能否/.test(row.title)&&!/同意|赞同/.test(row.title)&&Array.isArray(row.options)&&row.options.some(option=>typeof option==='string'&&/不同意|不赞同|同意|赞同/.test(option)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'options',code:'scale_dimension_mismatch',expectedExact:points});
  // Only catch the unambiguous, unqualified "at least once" form. Do not
  // speculate about open-ended ranges or rewrite a respondent's selections.
  if(['single','scale'].includes(row.type)&&Array.isArray(row.options)){
   const units=new Set(row.options.map(option=>typeof option==='string'?option.trim().match(/^每(天|日|周|星期|月|年)(?:至少|最少|不少于)(?:一|1)次$/u)?.[1]:null).filter(Boolean).map(value=>value==='星期'?'周':value==='日'?'天':value));
   if(units.size>=2)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_overlap'});
   const ranges=weeklyIntervals(row.options).sort((a,b)=>a[0]-b[0]),never=row.options.some(option=>neverUsedOption(row,option)),belowOne=row.options.some(option=>typeof option==='string'&&/^每月(?:少于|不到|低于)\s*(?:1|一)次/u.test(option.trim())),overlap=ranges.some((value,i)=>i>0&&value[0]<=ranges[i-1][1])||never&&belowOne,hasWeeklyLowerBound=row.options.some(option=>typeof option==='string'&&/^每(?:周|星期)(?:至少|最少|不少于)\s*(?:\d+|[一二三四五六七])次/u.test(option.trim())),gap=ranges.some((value,i)=>i>0&&value[0]>ranges[i-1][1]+1)||ranges.length>=1&&ranges.at(-1)[1]<6&&!hasWeeklyLowerBound&&row.options.some(option=>typeof option==='string'&&/(?:几乎)?每天/.test(option));if(overlap&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='frequency_overlap'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_overlap'});if(gap)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_gap'});
   const ambiguousDaily=ranges.length>0&&ranges.at(-1)[1]>=6&&row.options.some(option=>typeof option==='string'&&/几乎每天/.test(option)),ambiguousLow=never&&row.options.some(option=>typeof option==='string'&&/^每(?:学期|年).{0,12}(?:几次|偶尔).{0,12}(?:或更少|及以下|以下)/u.test(option.trim())),ambiguousRelative=row.options.some(option=>typeof option==='string'&&/^每(?:周|月|学期|年).{0,8}(?:几次|偶尔|更少)/u.test(option.trim()))&&row.options.some(option=>typeof option==='string'&&/\d|[一二三四五六七八九]次/u.test(option));if(ambiguousDaily||ambiguousLow||ambiguousRelative)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_ambiguous'});
   const frequencyQuestion=typeof row.title==='string'&&/(?:频率|多久|多频繁|(?:使用|访问|阅读).{0,80}(?:次数|(?:几|多少)次))/u.test(row.title);if(frequencyQuestion){const reference=[row.title,output.introduction,requirements.instructions].filter(value=>typeof value==='string').join(' '),units=frequencyUnits(row.options),period=/(?:过去|最近|近|本|上一|上个|上)(?:\s*\d+\s*(?:天|日|周|个月|月|年)|[一二三四五六七八九十两]+(?:天|日|周|个月|月|年|学期)|(?:这|该)?(?:周|月|年|学期))/u.test(reference),countRanges=boundedCountIntervals(row.options);if(!period)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'title',code:'frequency_period'});if(units.size>1)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_mixed_units'});if(countRanges){const countOverlap=countRanges.some((range,i)=>i>0&&range[0]<=countRanges[i-1][1]),countGap=countRanges[0][0]!==0||countRanges.at(-1)[1]!==Infinity||countRanges.some((range,i)=>i>0&&range[0]>countRanges[i-1][1]+1);if(countOverlap&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='frequency_overlap'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_overlap'});if(countGap&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='frequency_gap'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_gap'});}}
   if(row.type==='single'&&row.options.some(option=>typeof option==='string'&&/[（(]\s*(?:结束|终止)(?:作答|填写|问卷)\s*[）)]/u.test(option)&&!/(?:自行|手动)/u.test(option)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'unsupported_branching'});
   if(row.type==='single'&&typeof row.title==='string'&&/高校.{0,12}(?:在读|在校)/u.test(row.title)&&row.options.some(option=>typeof option==='string'&&/本科/.test(option))&&row.options.some(option=>typeof option==='string'&&/(?:硕士|博士)/.test(option))&&!row.options.some(option=>typeof option==='string'&&/(?:专科|高职)/.test(option))&&!/(?:仅限|仅|只|不含|不包括|排除).{0,18}(?:本科|专科|高职)/u.test(String(requirements.instructions||'')))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'education_coverage'});
  }
  if(row.type==='multiple'&&Array.isArray(row.options)&&row.options.some(option=>typeof option==='string'&&/^(?:(?:以上|上述)(?:均|都)?(?:未|不|没有)(?:使用|选择|接触|适用)(?:过)?(?:任何一项)?|(?:从未|未|没有)(?:使用|遇到|接触)(?:过)?(?:相关服务|问题|相关问题)?|(?:几乎)?没有固定渠道或(?:从未|未|没有)使用(?:过)?|(?:基本|几乎)?不使用上述服务|未遇到\s*[\/／或]\s*未使用)$/u.test(option.trim())))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'multiple',field:'options',code:'exclusive_multiple_option'});
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:满意|评价)/u.test(row.title)&&((/(?:速度|速率)/u.test(row.title)&&/(?:校外|异地)/u.test(row.title)&&/(?:多设备|不同设备|多终端|不同终端)/u.test(row.title))||/(?:搜索|检索).{0,12}(?:速度|速率).{0,20}筛选.{0,20}(?:界面|操作)/u.test(row.title)||/能否找到.{0,30}(?:校外|异地)访问/u.test(row.title)||/(?:馆藏|资源).{0,12}(?:覆盖|范围).{0,20}(?:访问权限|权限).{0,20}(?:付费|费用)/u.test(row.title)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'title',code:'multiple_dimensions'});
 }
 if(optionIssues.length){const first=optionIssues[0],message=first.code==='scale_dimension_mismatch'?'量表选项应与问题询问的体验或便利程度一致。':first.code==='frequency_overlap'?'使用频率选项存在重叠，请调整为互不重叠的区间。':first.code==='frequency_gap'?'使用频率区间可能存在遗漏，请补全并明确边界。':first.code==='frequency_ambiguous'?'使用频率选项的范围存在歧义，请明确互斥边界。':first.code==='frequency_period'?'使用频率题缺少统一的观察时间范围。':first.code==='frequency_mixed_units'?'频率选项混用不同时间单位，请按同一观察期划分次数。':first.code==='unsupported_branching'?'当前表单不能自动结束作答，请改为清晰的手动作答说明。':first.code==='education_coverage'?'高校在读选项缺少专科或高职，请核对调查范围。':first.code==='exclusive_multiple_option'?'多选题的“均未使用”选项不能与其他选项同时选择，请调整题目。':first.code==='multiple_dimensions'?'同一满意度问题包含多个不同维度，请分别明确。':first.questionType==='scale'?`本次量表须保留 ${points} 个分值与对应含义。`:first.questionType==='text'?'文本题不能附带预设答案。':'AI 选择题需要 2～10 个选项。';throw Object.assign(Error(message),{validationCode:'questionnaire_options',validationField:'questions',validationIssues:optionIssues.slice(0,10),validationIssueCount:optionIssues.length});}
 const ids=new Set(),questions=output.questions.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['id','type','title','options','required'].includes(key))||!['single','multiple','scale','text'].includes(row.type)||typeof row.required!=='boolean')throw Error('问卷题目类型、必填标记或字段无效。');
  const id=text(row.id,60,'题号');if(!/^[A-Za-z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||ids.has(id))throw Error('问卷题号重复或无效。');ids.add(id);
  const title=text(row.title,500,'问题'),raw=row.options;let options;
  if(row.type==='scale')options=normalizeScaleOptions(raw,{points});
  else if(row.type==='text'){if(!Array.isArray(raw)||raw.length)throw Error('文本题不能附带预设答案。');options=[];}
  else{if(!Array.isArray(raw)||raw.length<2||raw.length>10)throw Error('AI 选择题需要 2～10 个选项。');options=raw.map(option=>text(option,150,'选择题选项'));if(new Set(options.map(option=>option.normalize('NFKC').toLocaleLowerCase())).size!==options.length)throw Error('问卷选项不能重复。');}
  return{id,type:row.type,title,options,required:row.required};
 });
 // Published forms currently have no branching. When a screening option
 // explicitly includes non-users, don't force them to invent an experience.
 // Keep the scale intact and let respondents skip only clearly experience-
 // specific questions; authors can still revise the result before publishing.
 const hasSkipHint=value=>/(?:从未|未曾|未|没有).{0,12}(?:使用|体验|接触).{0,20}(?:(?<!不)可|可以|请|无需|不必).{0,8}(?:跳过|不作答|不回答)/iu.test(value)||/(?:skip.{0,25}(?:not|never).{0,10}(?:used|use)|(?:not|never).{0,10}(?:used|use).{0,25}skip)/iu.test(value);
 const suffix='（未使用者可跳过）',normalizedQuestions=questions.map(q=>{let title=q.title;if(title.endsWith(suffix)){const prior=title.slice(0,-suffix.length);if(hasSkipHint(prior))title=prior;}if(q.required&&q.options.some(option=>neverUsedOption(q,option)))title=title.replace(/[（(]([^（）()]{1,60})[）)]/gu,(whole,inside)=>hasSkipHint(inside)?'':whole).trim();return title===q.title?q:{...q,title};});
 const hasNonUsers=normalizedQuestions.some(q=>q.options.some(o=>neverUsedOption(q,o)));
 const safeQuestions=hasNonUsers?normalizedQuestions.map(q=>{
  if(!['single','multiple','scale'].includes(q.type)||q.options.some(o=>neverUsedOption(q,o)||/不适用|未使用|从未使用|无法评价|not applicable|never used/i.test(o)))return q;
  if(!/(?:使用|体验|满意|便利|便捷|评价|服务质量|accessibility|satisfaction|experience)/i.test(q.title))return q;
  const hint=/[\u4e00-\u9fff]/.test(q.title)?'（未使用者可跳过）':' (Skip if you have not used this service)';
  const title=q.title;return {...q,required:false,title:hasSkipHint(title)||title.includes(hint)||title.length+hint.length>500?title:title+hint};
 }):normalizedQuestions;
 const missingSkipOption=hasNonUsers&&safeQuestions.some(q=>['single','multiple','scale'].includes(q.type)&&/(?:使用|体验|满意|便利|便捷|评价|服务质量|accessibility|satisfaction|experience)/i.test(q.title)&&!q.options.some(o=>neverUsedOption(q,o)||/未使用|未体验|不适用|无法评价|never used|not applicable/i.test(o)));
 return{title:text(output.title,200,'问卷标题'),introduction:cleanAIIntroduction(output.introduction,{removeMissingSkipOption:missingSkipOption,hasRequired:safeQuestions.some(row=>row.required)}),questions:safeQuestions};
}

// A compact editor change detector only; it never authorizes access or verifies evidence.
export function questionnaireEditorKey(content){
 const questions=(content.questions||[]).map(q=>({id:q.id,type:q.type,title:q.title,options:q.options||[],required:q.required===true}));const text=JSON.stringify({questions,introduction:content.introduction||''});let left=2166136261,right=2654435769;
 for(let i=0;i<text.length;i++){const point=text.charCodeAt(i);left=Math.imul(left^point,16777619);right=Math.imul(right^point,2246822519);}
 return 'q1:'+text.length+':'+(left>>>0).toString(16)+':'+(right>>>0).toString(16);
}
