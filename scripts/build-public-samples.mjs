import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
import {exampleChart,renderChart,csvText} from '../dist/workspace/research-model.mjs';

export async function buildPublicSamples(outDir){
 const directory=resolve(outDir,'samples');await mkdir(directory,{recursive:true});
 const shared='学习反馈应当结合具体任务、学习者已有知识和学习目标，帮助学习者理解当前表现与目标之间的差距。反馈内容需要提供可以执行的改进方向，并在后续任务中检查改进情况。';
 const paper=`自制演示论文片段\n\n第一章 研究背景\n本材料由 PaperKnow 为演示文本比对而编写，不来自真实用户论文，不代表真实研究结论。\n\n第二章 材料中的相似表达\n${shared}\n\n第三章 人工核对\n比对后需要回到对照材料，确认这段表达的来源和引用方式。本示例只演示两份给定文本之间的匹配，不代表全网查重结果。\n`;
 const reference=`自制对照材料\n\n本材料仅供 PaperKnow 本地文本匹配演示。\n${shared}\n这里的文字与另一份自制样本共享一个完整段落，用于观察匹配位置。\n`;
 const report=analyzeDocument(parseDocument(paper,'自制材料比对示例'),[{id:'selfmade-reference',title:'自制对照材料',text:reference,provider:'user_provided',refNo:'1'}],{mode:'user_materials',id:'paperknow-public-selfmade-sample'});
 if(!report.similarChars||!report.sourceCount)throw new Error('Public comparison sample did not produce actual matching passages');
 report.createdAt='2026-10-15T00:00:00.000Z';
 report.scope='仅与本次提供的自制对照材料比对，不是全网正式检测，也不代表任何真实用户论文。';
 report.sample=true;
 const chart={...exampleChart(),title:'自制示例数据：方案 A 与方案 B',width:1200,height:750,fontSize:16};
 const outline='PaperKnow 论文大纲结构示例\n\n说明：以下为自制结构示例，不是 AI 生成的论文正文，不包含真实研究结果。请依据自己的研究问题与材料调整。\n\n题目：课堂反馈方式的研究设计\n一、研究背景与研究问题\n  1.1 问题来源与研究意义\n  1.2 核心问题、对象和范围\n二、文献与概念\n  2.1 有依据的研究进展\n  2.2 概念界定与研究线索\n三、研究方法与材料\n  3.1 研究对象与材料来源\n  3.2 数据收集与分析计划\n四、研究结果与讨论\n  4.1 仅在完成研究后填写实际结果\n  4.2 对结果的解释、限制与其他可能性\n五、结论与后续工作\n参考文献：逐条核对真实来源后填写。\n';
 await Promise.all([
  writeFile(resolve(directory,'paper-outline.txt'),outline),
  writeFile(resolve(directory,'comparison-paper.txt'),paper),
  writeFile(resolve(directory,'comparison-reference.txt'),reference),
  writeFile(resolve(directory,'comparison-result.json'),JSON.stringify(report,null,2)+'\n'),
  writeFile(resolve(directory,'research-data.csv'),csvText(chart).replace(/\r\n/g,'\n')),
  writeFile(resolve(directory,'research-chart.svg'),renderChart(chart)),
  writeFile(resolve(directory,'README.txt'),'PaperKnow 自制公开示例，创建日期 2026-10-15。\n文本和数值均为自制演示材料，不来自用户研究。\n材料比对 JSON 使用网站同版本本地比对引擎计算；图形 SVG 使用同版本基础图表渲染函数生成。\n大纲仅为结构示例；所有下载文件可用于学习和复现，不构成正式检测或真实研究结果。\n')
 ]);
}
