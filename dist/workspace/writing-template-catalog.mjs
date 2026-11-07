import {proposalTemplateSource,proposalTemplateSections} from './proposal-standard.mjs';
import {writingAcademicSources} from './writing-template-academic-sources.mjs';
import {writingReportSources} from './writing-template-report-sources.mjs';
import {writingToolSources} from './writing-template-tool-sources.mjs';

// Guides belong to the blank Word templates. The user's confirmed outline controls the manuscript.
function template(kind,title,{fields,format,source,guide=[]},version=2){
 return Object.freeze({
  id:'paperknow-'+kind+'-v'+version,kind,title,name:'通用'+title+'模板',
  fields:Object.freeze(fields),
  format:Object.freeze({...format,...(format.page?{page:Object.freeze(format.page)}:{})}),
  ...(source?{source:Object.freeze(source)}:{}),
  guide:Object.freeze(guide.map(row=>Object.freeze(row)))
 });
}
export const writingDefaultTemplates=Object.freeze({
 writing:template('writing','学位论文',writingAcademicSources.writing),
 proposal:template('proposal','开题报告',{
  fields:['institution','college','major','author','studentId','supervisor'],
  format:{titleSize:52,titleFont:'宋体',bodySize:24,headingSize:24,subheadingSize:24,tableSize:24,page:{top:1440,bottom:1440,left:1800,right:1800,header:851,footer:992}},
  source:proposalTemplateSource,guide:proposalTemplateSections
 }),
 summary:template('summary','文献综述',writingAcademicSources.summary),
 taskbook:template('taskbook','任务书',writingAcademicSources.taskbook),
 article:template('article','期刊文章',writingToolSources.article),
 course:template('course','课程作业',writingReportSources.course),
 practice:template('practice','实践报告',writingReportSources.practice),
 idea:template('idea','课题思路',writingReportSources.idea),
 quick:template('quick','文章',{...writingToolSources.article,fields:['author']}),
 // Compatibility for older documents. The questionnaire interface exports instruments and data.
 questionnaire:template('questionnaire','问卷',{fields:['author'],format:{titleSize:32,line:320,firstLineChars:0,headingSize:26,margin:25}},1),
 analysis:template('analysis','数据分析报告',writingToolSources.analysis)
});
export function writingDefaultTemplateSpec(kind){const key=kind==='thesis'?'writing':kind==='topic'?'idea':kind;return typeof key==='string'&&Object.hasOwn(writingDefaultTemplates,key)?writingDefaultTemplates[key]:null;}
export function writingDefaultTemplateMetadata(kind){
 const spec=writingDefaultTemplateSpec(kind),placeholders={institution:'{{学校}}',college:'{{学院}}',author:'{{作者}}',studentId:'{{学号}}',major:'{{专业}}',supervisor:'{{指导教师}}'};
 return {title:spec?.kind==='writing'?'{{论文题目}}':'{{标题}}',...Object.fromEntries((spec?.fields||[]).map(key=>[key,key==='institution'&&['article','analysis','idea'].includes(spec?.kind)?'{{单位}}':placeholders[key]]))};
}
