// Product defaults describe document presentation, never a compulsory outline.
const template=(kind,title,fields,format={})=>Object.freeze({id:'paperknow-'+kind+'-v1',kind,title,name:'通用'+title+'模板',fields:Object.freeze(fields),format:Object.freeze(format)});
export const writingDefaultTemplates=Object.freeze({
 writing:template('writing','学位论文',['institution','author','major','supervisor']),
 proposal:template('proposal','开题报告',['institution','author','major','supervisor']),
 summary:template('summary','文献综述',['institution','author','major','supervisor'],{referencesSize:21}),
 taskbook:template('taskbook','任务书',['institution','author','major','supervisor'],{headingSize:28,tableSize:24}),
 article:template('article','期刊文章',['institution','author'],{titleSize:32,bodySize:21,line:300,headingSize:24,subheadingSize:21,referencesSize:21,margin:25}),
 course:template('course','课程作业',['institution','author','major'],{margin:25}),
 practice:template('practice','实践报告',['institution','author','major','supervisor'],{margin:25}),
 idea:template('idea','课题思路',['author'],{headingSize:28,margin:25}),
 quick:template('quick','文章',['author'],{headingSize:28,margin:25}),
 questionnaire:template('questionnaire','问卷',['author'],{titleSize:32,line:320,firstLineChars:0,headingSize:26,margin:25}),
 analysis:template('analysis','数据分析报告',['author'],{headingSize:28,margin:25})
});
export function writingDefaultTemplateSpec(kind){const key=kind==='thesis'?'writing':kind==='topic'?'idea':kind;return typeof key==='string'&&Object.hasOwn(writingDefaultTemplates,key)?writingDefaultTemplates[key]:null;}
export function writingDefaultTemplateMetadata(kind){
 const spec=writingDefaultTemplateSpec(kind),placeholders={institution:'{{学校}}',author:'{{作者}}',major:'{{专业}}',supervisor:'{{指导教师}}'};
 return {title:spec?.kind==='writing'?'{{论文题目}}':'{{标题}}',...Object.fromEntries((spec?.fields||[]).map(key=>[key,key==='institution'&&spec?.kind==='article'?'{{单位}}':placeholders[key]]))};
}
