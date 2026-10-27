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
 }
 if(optionIssues.length){const first=optionIssues[0],message=first.questionType==='scale'?`本次量表须保留 ${points} 个分值与对应含义。`:first.questionType==='text'?'文本题不能附带预设答案。':'AI 选择题需要 2～10 个选项。';throw Object.assign(Error(message),{validationCode:'questionnaire_options',validationField:'questions',validationIssues:optionIssues.slice(0,10),validationIssueCount:optionIssues.length});}
 const ids=new Set(),questions=output.questions.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['id','type','title','options','required'].includes(key))||!['single','multiple','scale','text'].includes(row.type)||typeof row.required!=='boolean')throw Error('问卷题目类型、必填标记或字段无效。');
  const id=text(row.id,60,'题号');if(!/^[A-Za-z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||ids.has(id))throw Error('问卷题号重复或无效。');ids.add(id);
  const title=text(row.title,500,'问题'),raw=row.options;let options;
  if(row.type==='scale')options=normalizeScaleOptions(raw,{points});
  else if(row.type==='text'){if(!Array.isArray(raw)||raw.length)throw Error('文本题不能附带预设答案。');options=[];}
  else{if(!Array.isArray(raw)||raw.length<2||raw.length>10)throw Error('AI 选择题需要 2～10 个选项。');options=raw.map(option=>text(option,150,'选择题选项'));if(new Set(options.map(option=>option.normalize('NFKC').toLocaleLowerCase())).size!==options.length)throw Error('问卷选项不能重复。');}
  return{id,type:row.type,title,options,required:row.required};
 });
 return{title:text(output.title,200,'问卷标题'),introduction:text(output.introduction,2000,'问卷说明'),questions};
}

// A compact editor change detector only; it never authorizes access or verifies evidence.
export function questionnaireEditorKey(content){
 const questions=(content.questions||[]).map(q=>({id:q.id,type:q.type,title:q.title,options:q.options||[],required:q.required===true}));const text=JSON.stringify({questions,introduction:content.introduction||''});let left=2166136261,right=2654435769;
 for(let i=0;i<text.length;i++){const point=text.charCodeAt(i);left=Math.imul(left^point,16777619);right=Math.imul(right^point,2246822519);}
 return 'q1:'+text.length+':'+(left>>>0).toString(16)+':'+(right>>>0).toString(16);
}
