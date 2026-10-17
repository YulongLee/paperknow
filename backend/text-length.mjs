// Pure statistics for bounded writing tasks. No content is returned, persisted,
// executed, or sent anywhere by these helpers.
export function researchWordCount(text,language='中文'){
 if(typeof text!=='string')throw new TypeError('统计正文必须是文本');
 const prose=text.replace(/\[source:[^\]]+\]/g,'');
 return /english|英文|英语/i.test(language)?(prose.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)||[]).length:Array.from(prose.replace(/\s/g,'')).length;
}
export function normalizeTextLengthBudget(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!['target','min','max'].every(key=>Number.isSafeInteger(value[key]))||value.target<1||value.min<0||value.max>100000||value.min>value.target||value.target>value.max)throw new TypeError('正文篇幅范围无效');
 const language=value.language??'中文';if(typeof language!=='string'||language.length>40)throw new TypeError('正文计数语言无效');
 return {target:value.target,min:value.min,max:value.max,language};
}
export function checkTextLength(text,budget){
 if(typeof text!=='string'||text.length>60000)throw new TypeError('待统计正文必须是最多 60,000 字符的文本');
 const {target,min,max,language}=normalizeTextLengthBudget(budget),count=researchWordCount(text,language);
 const withinRange=count>=min&&count<=max;
 return {count,target,min,max,withinRange,delta:target-count,nextAction:withinRange?'finalize':'revise'};
}
