import {isSimulationMaterial} from '../dist/workspace/simulation-data.mjs';
import {thesisChartKinds} from '../dist/workspace/thesis-figure-rich.mjs';
const fail=message=>{throw Object.assign(new Error(message),{status:502,code:'invalid_figure_evidence'});};
const fold=value=>String(value).normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const numbers=quote=>[...quote.normalize('NFKC').replace(/−/g,'-').matchAll(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map(match=>Number(match[0].replace(/,/g,''))).filter(Number.isFinite);
const includesNumber=(values,number)=>values.includes(number);

// A chart may present supplied measurements, never invent a result or compute
// an unstated percentage. The caller separately verifies real material reads
// and body citation markers for every source_ids member.
export function assertThesisChartEvidence(figures,body,snapshot){
 const simulated=new Set((snapshot.materials||[]).filter(isSimulationMaterial).map(row=>row.id));
 const sources=new Map([...(snapshot.materials||[]),...(snapshot.references||[])].filter(row=>row.confirmed&&!/格式|模板|导师意见|撰写要求/.test(row.purpose||'')&&typeof row.text==='string'&&row.text.trim()).map(row=>[row.id,row.text])),listed=new Set(body.source_ids||[]);
 for(const figure of figures)if(thesisChartKinds.includes(figure.kind))for(const series of figure.data.series)for(const point of series.points){
  if(simulated.has(point.sourceId)&&!/模拟|仿真|simulat|synthetic/i.test(figure.caption+' '+figure.title))fail('使用模拟数据的图题或图注必须明确标注模拟或仿真，不能作为实测结果图');
  const original=sources.get(point.sourceId);
  if(!original||!listed.has(point.sourceId))fail('统计图数据未关联本节已引用的真实资料，请补充原始数据依据');
  if(!original.includes(point.quote))fail('统计图的数据摘录不在已提供原始资料中，不能生成无依据的统计结果');
  const values=numbers(point.quote);
  if(!fold(original).includes(fold(series.name))||!includesNumber(values,point.y)||typeof point.x==='number'&&!includesNumber(values,point.x)||typeof point.x==='string'&&!fold(point.quote).includes(fold(point.x)))fail('统计图的横纵坐标与原始摘录不对应，请按原始记录保留类别、单位和数值');
 }
}
