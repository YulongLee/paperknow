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
function questionnaireStatementConflict(field){throw Object.assign(Error('问卷说明包含需要核对的作答或用途表述，请重新生成并保留参与自愿及撤回说明。'),{validationCode:'questionnaire_statement_conflict',validationField:field});}
function cleanAIIntroduction(value,{removeMissingSkipOption=false,hasRequired=false,hasOptional=false,coursePurposeConfirmed=false}={}){
 const intro=text(value,2000,'问卷说明');
 if(/(?:问卷不支持自动跳题|结果为待人工核对的草稿数据)/u.test(intro))questionnaireStatementConflict('introduction');
 if(!coursePurposeConfirmed&&/(?:仅|只)用于(?:课程研究|课程作业|课程调研)/u.test(intro))questionnaireStatementConflict('introduction');
 if(hasOptional&&/(?:全部|所有|本问卷(?:的)?)(?:题目|问题)(?:均|都|全部)?(?:为|是)?必答/u.test(intro))questionnaireStatementConflict('introduction');
 if(hasRequired&&/(?:跳过(?:任何|所有)(?:不(?:想|愿)(?:回答|作答)的)?(?:题目|问题)|(?:任何|所有)(?:不(?:想|愿)(?:回答|作答)的)?(?:题目|问题)(?:均|都)?(?:可|可以)跳过)/u.test(intro))questionnaireStatementConflict('introduction');
 if(removeMissingSkipOption&&/(?:未使用|从未使用|没有使用).{0,35}(?:选择|勾选|请选择).{0,25}(?:未使用|未体验|不适用)|(?:选择|勾选|请选择).{0,20}(?:未使用|未体验|不适用).{0,25}(?:未使用|从未使用|没有使用)/u.test(intro))questionnaireStatementConflict('introduction');
 return intro;
}
// Clear none-of-the-above choices cannot coexist with affirmative answers.
// Restrict this to explicit whole-option wording; ordinary choices such as
// “其他” are not inherently exclusive.
export function isExclusiveQuestionnaireOption(value){
 const option=String(value??'').trim().normalize('NFKC');
 return /^(?:以上均无|以上都没有|以上都不符合|上述均无|上述都没有|none of the above)\s*[（(][^（）()]{1,100}[）)]$/iu.test(option)
  || /^(?:无|没有|都没有|以上均无|以上都没有|均不适用|不适用|none(?: of the above)?|not applicable)$/iu.test(option)
  ||/^(?:(?:以上|上述)(?:都|均)?(?:不符合|不使用|不选择|不属于|不存在)|(?:无|没有)(?:以上|上述)(?:问题|情况|选项|经历)|(?:以上|上述)(?:问题|情况|选项|经历)(?:都|均)?(?:没有|不存在))$/u.test(option)
  ||/^(?:(?:以上|上述)(?:均|都)?(?:未|不|没有)(?:使用|选择|接触|适用)(?:过)?(?:任何一项)?|(?:从未|未|没有)(?:使用|遇到|接触)(?:过)?(?:相关服务|问题|相关问题)?|(?:几乎)?没有固定渠道或(?:从未|未|没有)使用(?:过)?|(?:基本|几乎)?不使用上述服务|未遇到\s*[\/／或]\s*未使用)$/u.test(option)
  ||/^(?:(?:过去|最近|近)\s*\d+\s*(?:天|日|周|个月|月|年))?(?:(?:从未|未|没有)(?:使用|遇到|接触)(?:过)?(?:任何|明显|相关|该|此|本|数字阅读|的|服务|困难|问题|资源|方面|体验|评价|一项|一种|过|，|,|无法|\s)*|没有觉得.{0,20}(?:便捷|方便|好处|优势|满意).{0,15})$/u.test(option);
}
function neverUsedOption(q,value){const option=String(value||'').trim();return /^(?:几乎)?不使用[（(]0\s*天[）)]$/u.test(option)||/^(?:否|没有)$/u.test(option)&&/是否.{0,24}(?:使用|体验|接触)/u.test(String(q?.title||''))||/^(?:听说过但从未使用(?:过)?|从未使用(?:过)?|从不使用(?:过)?|没有使用(?:过)?|未使用(?:过)?|从未接触(?:过)?|从未购买(?:过)?|never used)$/i.test(option)||/(?:使用|阅读|访问).{0,80}(?:频率|次数)|(?:频率|次数).{0,80}(?:使用|阅读|访问)/u.test(String(q?.title||''))&&(/(?:从未|从不|未使用|没有使用)/u.test(option)||/^0\s*(?:次|天)$/u.test(option.normalize('NFKC')));}
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
  if(row.type==='scale'&&typeof row.title==='string'&&/^(?:我|您|你)(?:认为|觉得|相信).{0,100}(?:能够|可以|能|会|应该|有助|足以)/u.test(row.title)&&Array.isArray(row.options)&&row.options.some(option=>typeof option==='string'&&/满意/u.test(option)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'options',code:'scale_dimension_mismatch',expectedExact:points});
  if(row.type==='single'&&typeof row.title==='string'&&Array.isArray(row.options)){const lastChoice=/(?:未|从未|没有).{0,12}(?:使用|体验).{0,15}(?:选|选择)(?:择)?(?:最后|末尾)一项/u.test(row.title);const firstChoice=/(?:未|从未|没有).{0,12}(?:使用|体验).{0,15}(?:选|选择)(?:择)?(?:第一|首)项/u.test(row.title);const incorrect=(lastChoice&&!neverUsedOption(row,row.options.at(-1)))||(firstChoice&&!neverUsedOption(row,row.options[0]));if(incorrect||/跳(?:到|至|往).{0,12}(?:末尾|最后|结束)/u.test(row.title))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'title',code:'unsupported_branching'});}
  if(row.type==='single'&&Array.isArray(row.options)&&row.options.some(option=>typeof option==='string'&&/跳(?:到|至|往).{0,16}(?:第.{0,5}题|末尾|最后|结束)/u.test(option))&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='unsupported_branching'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'single',field:'options',code:'unsupported_branching'});
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:评价.{0,80}(?:程度|丰富|可获取)|(?:程度|丰富|可获取).{0,80}评价)/u.test(row.title)&&!/同意|赞同/u.test(row.title)&&Array.isArray(row.options)&&row.options.some(option=>typeof option==='string'&&/(?:不同意|不赞同|同意|赞同)/u.test(option))&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='scale_dimension_mismatch'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'options',code:'scale_dimension_mismatch',expectedExact:points});
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:丰富程度|种类|数量|覆盖程度).{0,20}(?:与|和|及).{0,10}(?:可获取性|获取难易|访问便利)/u.test(row.title))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'title',code:'multiple_dimensions'});
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:网络环境|网络条件).{0,12}(?:与|和|及).{0,8}设备条件/u.test(row.title))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'title',code:'multiple_dimensions'});
  // These are independently answerable dimensions, even when phrased as an
  // agreement statement instead of a satisfaction question. Do not split or
  // rewrite the author's questions: request a corrected candidate instead.
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:车辆状况|车辆状态).{0,12}(?:与|和|及).{0,12}(?:停放秩序|停车秩序)|(?:停放秩序|停车秩序).{0,12}(?:与|和|及).{0,12}(?:车辆状况|车辆状态)/u.test(row.title))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'title',code:'multiple_dimensions'});
  if(row.type==='multiple'&&Array.isArray(row.options)&&row.options.some(option=>typeof option==='string'&&/(?:费用|价格).{0,12}(?:或|与|和|及).{0,12}(?:流程|操作)|(?:卫生|清洁).{0,12}(?:或|与|和|及).{0,12}(?:车辆损坏|车辆故障)/u.test(option)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'multiple',field:'options',code:'multiple_reasons'});
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:时长|时间)/u.test(row.title)&&Array.isArray(row.options)&&row.options.some(option=>typeof option==='string'&&/[（(]\s*0\s*天\s*[）)]/u.test(option)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'options',code:'scale_dimension_mismatch',expectedExact:points});
  if(row.type==='single'&&typeof row.title==='string'&&/本科年级/u.test(row.title)&&/高校在校学生/u.test(String(requirements.instructions||''))&&!/(?:仅|只|限).{0,8}本科/u.test(String(requirements.instructions||'')))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'single',field:'options',code:'education_coverage'});
  // Only catch the unambiguous, unqualified "at least once" form. Do not
  // speculate about open-ended ranges or rewrite a respondent's selections.
  if(['single','scale'].includes(row.type)&&Array.isArray(row.options)){
   const units=new Set(row.options.map(option=>typeof option==='string'?option.trim().match(/^每(天|日|周|星期|月|年)(?:至少|最少|不少于)(?:一|1)次$/u)?.[1]:null).filter(Boolean).map(value=>value==='星期'?'周':value==='日'?'天':value));
   if(units.size>=2)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_overlap'});
   const ranges=weeklyIntervals(row.options).sort((a,b)=>a[0]-b[0]),never=row.options.some(option=>neverUsedOption(row,option)),belowOne=row.options.some(option=>typeof option==='string'&&/^每月(?:少于|不到|低于)\s*(?:1|一)次/u.test(option.trim())),overlap=ranges.some((value,i)=>i>0&&value[0]<=ranges[i-1][1])||never&&belowOne,hasWeeklyLowerBound=row.options.some(option=>typeof option==='string'&&/^每(?:周|星期)(?:至少|最少|不少于)\s*(?:\d+|[一二三四五六七])次/u.test(option.trim())),gap=ranges.some((value,i)=>i>0&&value[0]>ranges[i-1][1]+1)||ranges.length>=1&&ranges.at(-1)[1]<6&&!hasWeeklyLowerBound&&row.options.some(option=>typeof option==='string'&&/(?:几乎)?每天/.test(option));if(overlap&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='frequency_overlap'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_overlap'});if(gap)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_gap'});
   const ambiguousDaily=ranges.length>0&&ranges.at(-1)[1]>=6&&row.options.some(option=>typeof option==='string'&&/几乎每天/.test(option)),ambiguousLow=never&&row.options.some(option=>typeof option==='string'&&/^每(?:学期|年).{0,12}(?:几次|偶尔).{0,12}(?:或更少|及以下|以下)/u.test(option.trim())),ambiguousRelative=row.options.some(option=>typeof option==='string'&&/^每(?:周|月|学期|年).{0,8}(?:几次|偶尔|更少)/u.test(option.trim()))&&row.options.some(option=>typeof option==='string'&&/\d|[一二三四五六七八九]次/u.test(option));if(ambiguousDaily||ambiguousLow||ambiguousRelative)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_ambiguous'});
   if(row.options.some(option=>typeof option==='string'&&/\d+\s*(?:[-~～—至到])\s*\d+\s*天.{0,30}每周/u.test(option))&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='frequency_mixed_units'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_mixed_units'});
   const frequencyQuestion=typeof row.title==='string'&&/(?:频率|多久|多频繁|(?:使用|访问|阅读).{0,80}(?:次数|(?:几|多少)次))/u.test(row.title);if(frequencyQuestion){const reference=[row.title,output.introduction,requirements.instructions].filter(value=>typeof value==='string').join(' '),units=frequencyUnits(row.options),period=/(?:过去|最近|近|本|上一|上个|上)(?:\s*\d+\s*(?:天|日|周|个月|月|年)|[一二三四五六七八九十两]+(?:天|日|周|个月|月|年|学期)|(?:这|该)?(?:周|月|年|学期))/u.test(reference),countRanges=boundedCountIntervals(row.options);if(!period)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'title',code:'frequency_period'});if(units.size>1)optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_mixed_units'});if(countRanges){const countOverlap=countRanges.some((range,i)=>i>0&&range[0]<=countRanges[i-1][1]),countGap=countRanges[0][0]!==0||countRanges.at(-1)[1]!==Infinity||countRanges.some((range,i)=>i>0&&range[0]>countRanges[i-1][1]+1);if(countOverlap&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='frequency_overlap'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_overlap'});if(countGap&&!optionIssues.some(issue=>issue.questionIndex===index+1&&issue.code==='frequency_gap'))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'frequency_gap'});}}
   if(row.type==='single'&&row.options.some(option=>typeof option==='string'&&/[（(]\s*(?:结束|终止)(?:作答|填写|问卷)\s*[）)]/u.test(option)&&!/(?:自行|手动)/u.test(option)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'unsupported_branching'});
   if(row.type==='single'&&typeof row.title==='string'&&/高校.{0,12}(?:在读|在校)/u.test(row.title)&&row.options.some(option=>typeof option==='string'&&/本科/.test(option))&&row.options.some(option=>typeof option==='string'&&/(?:硕士|博士)/.test(option))&&!row.options.some(option=>typeof option==='string'&&/(?:专科|高职)/.test(option))&&!/(?:仅限|仅|只|不含|不包括|排除).{0,18}(?:本科|专科|高职)/u.test(String(requirements.instructions||'')))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:row.type,field:'options',code:'education_coverage'});
  }
  if(row.type==='scale'&&typeof row.title==='string'&&/(?:满意|评价)/u.test(row.title)&&((/(?:速度|速率)/u.test(row.title)&&/(?:校外|异地)/u.test(row.title)&&/(?:多设备|不同设备|多终端|不同终端)/u.test(row.title))||/(?:搜索|检索).{0,12}(?:速度|速率).{0,20}筛选.{0,20}(?:界面|操作)/u.test(row.title)||/能否找到.{0,30}(?:校外|异地)访问/u.test(row.title)||/(?:馆藏|资源).{0,12}(?:覆盖|范围).{0,20}(?:访问权限|权限).{0,20}(?:付费|费用)/u.test(row.title)))optionIssues.push({questionIndex:index+1,questionId:'q'+(index+1),questionType:'scale',field:'title',code:'multiple_dimensions'});
 }
 if(optionIssues.length){const first=optionIssues[0],message=first.code==='scale_dimension_mismatch'?'量表选项应与问题询问的体验或便利程度一致。':first.code==='frequency_overlap'?'使用频率选项存在重叠，请调整为互不重叠的区间。':first.code==='frequency_gap'?'使用频率区间可能存在遗漏，请补全并明确边界。':first.code==='frequency_ambiguous'?'使用频率选项的范围存在歧义，请明确互斥边界。':first.code==='frequency_period'?'使用频率题缺少统一的观察时间范围。':first.code==='frequency_mixed_units'?'频率选项混用不同时间单位，请按同一观察期划分次数。':first.code==='unsupported_branching'?'当前表单不能自动结束作答，请改为清晰的手动作答说明。':first.code==='education_coverage'?'高校在读选项缺少专科或高职，请核对调查范围。':first.code==='multiple_dimensions'?'同一问题包含多个不同维度，请分别明确。':first.code==='multiple_reasons'?'同一个选项包含多个不同原因，请分别列出。':first.questionType==='scale'?`本次量表须保留 ${points} 个分值与对应含义。`:first.questionType==='text'?'文本题不能附带预设答案。':'AI 选择题需要 2～10 个选项。';throw Object.assign(Error(message),{validationCode:'questionnaire_options',validationField:'questions',validationIssues:optionIssues.slice(0,10),validationIssueCount:optionIssues.length});}
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
 // A non-user must not be instructed to select a neutral rating: that would
 // turn missing experience into a genuine response and bias the statistics.
 // Remove only the explicit instruction, preserving any other explanation in
 // the same parenthesis; the skip hint below remains the supported path.
 const removeNeutralNonuserHint=title=>{if(/[（(][^（）()]{0,180}(?:未使用|没有使用|从未使用)[^（）()]{0,45}(?:选择|选|填写|填)[^（）()]{0,45}(?:中立|一般|居中|中间)[^（）()]{0,80}[）)]/u.test(title))questionnaireStatementConflict('questions');return title;};
 // Translate internal generated IDs used as question references to the actual
 // displayed order, but only when the ID is clearly used as a question reference.
 const questionStart=Number.isSafeInteger(requirements.questionStart)&&requirements.questionStart>=1?requirements.questionStart:1;
 const questionOrder=new Map(questions.map((q,index)=>[q.id.toLowerCase(),questionStart+index]));
 const readableRefs=title=>title.replace(/(?:第\s*(q\d+)\s*题|(?<![A-Za-z0-9_])(q\d+)\s*题|(?:题目|问题|题号)\s*(q\d+)(?![A-Za-z0-9_]))/giu,(whole,...args)=>{const id=args.slice(0,3).find(Boolean);return id&&questionOrder.has(id.toLowerCase())?'第'+questionOrder.get(id.toLowerCase())+'题':whole;}).replace(/((?:如果|若|当)\s*)(q\d+)(?=\s*(?:选择|选了|回答))/giu,(whole,prefix,id)=>questionOrder.has(id.toLowerCase())?prefix+'第'+questionOrder.get(id.toLowerCase())+'题':whole);
 const broadStudentAudience=/(?:目标人群|调查对象|受访者|面向)\s*[:：]?\s*(?:高校|大学|高等院校)(?:在校)?学生/u.test(String(requirements.instructions||''))&&!/(?:仅|只|限定|排除|不包括)/u.test(String(requirements.instructions||''));
 const removeExpectedNonuserHint=title=>/(?:未来|将来|预期).{0,25}(?:预期|期待|希望|使用体验)|(?:预期|期待).{0,25}(?:未来|将来)/u.test(title.split(/[（(]/u)[0])?title:!/(?:实际(?:使用|体验|经历)|使用(?:体验|经历|感受)|最近\s*\d+\s*(?:天|日|周|个月|月|年).{0,35}(?:经历|使用|体验))/u.test(title.split(/[（(]/u)[0])?title:title.replace(/[（(]\s*(?:若|如果|如)?(?:从未|未|没有)(?:使用|体验)(?:者|过者)?(?:可|可以|请|应|需)[^（）()]{0,60}(?:选择|选|填写|填)[^（）()]{0,40}(?:预期|想象|猜测)[^（）()]{0,100}[）)]/gu,()=>questionnaireStatementConflict('questions'));
 const suffix='（未使用者可跳过）',normalizedQuestions=questions.map(q=>{let title=readableRefs(removeExpectedNonuserHint(removeNeutralNonuserHint(q.title)));if(q.required&&q.options.some(option=>neverUsedOption(q,option))&&hasSkipHint(title))questionnaireStatementConflict('questions');const grade=q.type==='single'&&/(?:所在|目前|当前).{0,5}年级|年级.{0,8}(?:是|为)/u.test(title)&&['大一','大二','大三','大四'].every(label=>q.options.includes(label));const options=broadStudentAudience&&grade&&q.options.length<10&&!q.options.some(option=>/其他|以上均不|不适用/u.test(option))?[...q.options,'其他']:q.options;return title===q.title&&options===q.options?q:{...q,title,options};});
 const hasNonUsers=normalizedQuestions.some(q=>q.options.some(o=>neverUsedOption(q,o)));
 // If a screening question includes both non-users and users, a reason question
 // explicitly addressed to non-users / infrequent users must not force everyone
 // else to select an inaccurate reason. Keep the author's original options.
 const usageSubject=q=>{const matches=[...String(q.title||'').matchAll(/(?:使用|骑行|访问|阅读)((?:(?!使用|骑行|访问|阅读)[^的，。！？?；;（）()]){2,18})(?=的|次数|频率|[，。！？?；;（）()]|$)/gu)];return matches.at(-1)?.[1]?.trim()||'';};
 const explicitlyNonusersOnly=/(?:仅限|仅面向|仅调查|只面向|只调查|调查对象(?:仅|只)(?:为|是)?).{0,18}(?:未使用|没有使用|从未使用|不使用)/u.test(String(requirements.instructions||''));
 const usagePeriod=q=>String(q.title||'').match(/(?:最近|过去|近)\s*(\d+)\s*(天|日|周|个月|月|年)/u)?.slice(1).join('')||'';
 const mixedUsageScreens=normalizedQuestions.map((q,index)=>({q,index,subject:usageSubject(q),period:usagePeriod(q)})).filter(({q,subject})=>subject&&q.options.some(o=>neverUsedOption(q,o))&&q.options.some(o=>/(?:经常|频繁|每天|每周|每月|\d+\s*次(?:及|或)?以上|[1-9]\d*\s*(?:次|天))/u.test(o)));
 const restrictedNonuseReason=q=>/(?:未|没有|从未|较少|很少|不常).{0,10}(?:使用|骑行|访问|阅读).{0,30}(?:原因|理由)|(?:未|没有|从未).{0,10}(?:使用|骑行|访问|阅读).{0,12}(?:或|、|及).{0,10}(?:较少|很少|不常).{0,10}(?:使用|骑行|访问|阅读).{0,30}(?:原因|理由)/u.test(q.title);
 const unrestrictedAlternative=q=>q.options.some(o=>/(?:经常|频繁|正常|较多).{0,12}(?:使用|骑行|访问|阅读)|^(?:不适用|不符合本题|不属于以上人群)$/u.test(o));
 const safeQuestions=hasNonUsers?normalizedQuestions.map((q,index)=>{
  if(!explicitlyNonusersOnly&&mixedUsageScreens.some(screen=>screen.index<index&&screen.subject===usageSubject(q)&&(!screen.period||!usagePeriod(q)||screen.period===usagePeriod(q)))&&restrictedNonuseReason(q)&&!unrestrictedAlternative(q)){const hint='（不符合本题条件可跳过）';return {...q,required:false,title:q.title.includes(hint)||q.title.length+hint.length>500?q.title:q.title+hint};}
  if(/(?:未来|将来).{0,25}(?:预期|期待|希望)|(?:预期|期待).{0,25}(?:未来|将来)/u.test(q.title.split(/[（(]/u)[0]))return q;
  if(restrictedNonuseReason(q))return q; // Do not let the broad experience fallback override the specific population guard.
  if(!['single','multiple','scale','text'].includes(q.type)||q.options.some(o=>neverUsedOption(q,o)||/不适用|未使用|从未使用|无法评价|not applicable|never used/i.test(o)))return q;
  if(!/(?:使用|体验|满意|满足程度|满足.{0,20}(?:需求|要求)|便利|便捷|评价|服务质量|accessibility|satisfaction|experience)/i.test(q.title))return q;
  const hint=/[\u4e00-\u9fff]/.test(q.title)?'（未使用者可跳过）':' (Skip if you have not used this service)';
  const title=q.title;return {...q,required:false,title:hasSkipHint(title)||title.includes(hint)||title.length+hint.length>500?title:title+hint};
 }):normalizedQuestions;
 const missingSkipOption=hasNonUsers&&safeQuestions.some(q=>['single','multiple','scale'].includes(q.type)&&/(?:使用|体验|满意|满足程度|满足.{0,20}(?:需求|要求)|便利|便捷|评价|服务质量|accessibility|satisfaction|experience)/i.test(q.title)&&!q.options.some(o=>neverUsedOption(q,o)||/未使用|未体验|不适用|无法评价|never used|not applicable/i.test(o)));
 return{title:text(output.title,200,'问卷标题'),introduction:cleanAIIntroduction(output.introduction,{removeMissingSkipOption:missingSkipOption,hasRequired:safeQuestions.some(row=>row.required),hasOptional:safeQuestions.some(row=>!row.required),coursePurposeConfirmed:/(?:仅|只)(?:用于|供|作)(?:课程研究|课程作业|课程调研)(?!和|与|及|、)/u.test(String(requirements.instructions||''))&&!/(?:不是|并非|不属于|不用于|无关).{0,8}(?:课程研究|课程作业|课程调研)/u.test(String(requirements.instructions||''))}),questions:safeQuestions};
}

// A compact editor change detector only; it never authorizes access or verifies evidence.
export function questionnaireEditorKey(content){
 const questions=(content.questions||[]).map(q=>({id:q.id,type:q.type,title:q.title,options:q.options||[],required:q.required===true}));const text=JSON.stringify({questions,introduction:content.introduction||''});let left=2166136261,right=2654435769;
 for(let i=0;i<text.length;i++){const point=text.charCodeAt(i);left=Math.imul(left^point,16777619);right=Math.imul(right^point,2246822519);}
 return 'q1:'+text.length+':'+(left>>>0).toString(16)+':'+(right>>>0).toString(16);
}
