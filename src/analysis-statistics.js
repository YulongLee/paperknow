// Algebra uses observed data; distribution tails/quantiles come from jStat 1.9.6.
import jstat from 'jstat';
import {analysisNumber,isAnalysisMissing,analyzeDataset,defaultAnalysisColumns,validateAnalysisInference} from '../dist/workspace/data-analysis-model.mjs';
const {jStat}=jstat;
const fail=message=>{throw Error(message);};
const sum=values=>{let total=0,c=0;for(const value of values){const y=value-c,t=total+y;c=(t-total)-y;total=t;}return total;};
const mean=values=>sum(values)/values.length;
const finite=(value,label)=>{if(!Number.isFinite(value))fail(label+'超出可计算的数值范围，请先缩放数据。');return value;};
function pTwoSided(t,df){const value=2*jStat.studentt.cdf(-Math.abs(t),df);if(!Number.isFinite(value)||value<0||value>1)fail('概率计算未收敛，请核对样本与数值范围。');return value;}
const interval=(estimate,se,df)=>{const q=jStat.studentt.inv(.975,df);return[finite(estimate-q*se,'置信区间'),finite(estimate+q*se,'置信区间')];};
export function pearsonInference(correlation){
 if(!correlation)return null;
 const note='双侧 Student t 检验，H₀：总体 Pearson 相关为 0；要求独立观测、线性关系及适用的近似双变量正态条件。p 值未做多重比较校正，不代表因果。';
 if(correlation.status!=='calculated')return{...correlation,pValue:null,df:null,inferenceNote:note};
 const df=correlation.n-2,absolute=Math.abs(correlation.r),t=absolute>=1?Infinity:absolute*Math.sqrt(df/((1-absolute)*(1+absolute)));
 return{...correlation,note:'仅反映有效成对样本的线性关联；双侧 p 值依赖检验假设，不代表因果。',df,pValue:absolute>=1?0:pTwoSided(t,df),inferenceNote:note};
}
export function welchAnalysis(dataset,{group,value}){
 const groups=new Map();let excluded=0;
 for(const row of dataset.rows){if(isAnalysisMissing(row[group])){excluded++;continue;}const label=row[group].trim();if(!groups.has(label))groups.set(label,[]);const number=analysisNumber(row[value]);if(number===null)excluded++;else groups.get(label).push(number);}
 if(groups.size!==2)fail('Welch 独立样本 t 检验要求分组列恰好包含两个非缺失组；请先整理或筛选数据。');
 const entries=[...groups];if(entries.some(([,values])=>values.length<2))fail('Welch 检验每组至少需要 2 个有效数值观测。');
 const scale=Math.max(...entries.flatMap(([,values])=>values.map(Math.abs)))||1;
 const stats=entries.map(([label,values])=>{const scaled=values.map(v=>v/scale),m=mean(scaled),variance=sum(scaled.map(v=>(v-m)**2))/(values.length-1);return{label,n:values.length,m,variance};});
 const [a,b]=stats,v1=a.variance/a.n,v2=b.variance/b.n,seScaled=Math.sqrt(v1+v2);if(!seScaled)fail('两组均无数值变异，无法计算 Welch 检验的标准误；未生成检验结果。');
 const df=(v1+v2)**2/(v1*v1/(a.n-1)+v2*v2/(b.n-1)),t=(a.m-b.m)/seScaled,difference=finite((a.m-b.m)*scale,'均值差'),se=finite(seScaled*scale,'标准误');
 return{method:'welch_independent_two_sided',group,value,groupName:dataset.headers[group],valueName:dataset.headers[value],groups:stats.map(s=>({label:s.label,n:s.n,mean:finite(s.m*scale,'组均值'),sampleSD:finite(Math.sqrt(s.variance)*scale,'组标准差')})),excludedRows:excluded,df:finite(df,'自由度'),t:finite(t,'t 值'),pValue:pTwoSided(t,df),difference,ci95:interval(difference,se,df),note:'组别按分组列非缺失的原始文本区分；均值差按第一组减第二组计算；双侧 Welch 检验及 95% 置信区间，不要求两组等方差。每行应是独立观测，组内分布应近似正态或具备足够样本；未作多重比较校正，不能据此断言因果。'};
}
export function linearRegression(dataset,{x,y}){
 const pairs=dataset.rows.flatMap(row=>{const a=analysisNumber(row[x]),b=analysisNumber(row[y]);return a===null||b===null?[]:[[a,b]];});const n=pairs.length;if(n<3)fail('一元线性回归至少需要 3 个有效成对观测。');
 const sx=Math.max(...pairs.map(p=>Math.abs(p[0])))||1,sy=Math.max(...pairs.map(p=>Math.abs(p[1])))||1,xs=pairs.map(p=>p[0]/sx),ys=pairs.map(p=>p[1]/sy),mx=mean(xs),my=mean(ys),dx=xs.map(v=>v-mx),dy=ys.map(v=>v-my),xx=sum(dx.map(v=>v*v)),yy=sum(dy.map(v=>v*v)),xy=sum(dx.map((v,i)=>v*dy[i]));
 if(!xx)fail('自变量 X 没有变异，无法拟合一元线性回归。');if(!yy)fail('因变量 Y 没有变异，无法检验回归关系。');
 const beta=xy/xx,alpha=my-beta*mx,df=n-2,residuals=ys.map((v,i)=>v-alpha-beta*xs[i]),sse=sum(residuals.map(v=>v*v)),variance=sse/df,ratio=sy/sx,slope=finite(beta*finite(ratio||NaN,'变量尺度比'),'回归斜率'),intercept=finite(alpha*sy,'回归截距'),perfectFit=sse<=Number.EPSILON**2*yy;
 const slopeSE=perfectFit?null:finite(Math.sqrt(variance/xx)*ratio,'斜率标准误'),interceptSE=perfectFit?null:finite(Math.sqrt(variance*(1/n+mx*mx/xx))*sy,'截距标准误'),slopeT=perfectFit?null:finite(beta/Math.sqrt(variance/xx),'斜率 t 值');
 return{method:'ols_simple_with_intercept',x,y,xName:dataset.headers[x],yName:dataset.headers[y],n,df,excludedRows:dataset.rows.length-n,slope,intercept,rSquared:Math.max(0,Math.min(1,1-sse/yy)),residualSD:finite(Math.sqrt(variance)*sy,'残差标准差'),slopeSE,interceptSE,slopeT,pValue:perfectFit?null:pTwoSided(slopeT,df),slopeCI95:perfectFit?null:interval(slope,slopeSE,df),interceptCI95:perfectFit?null:interval(intercept,interceptSE,df),perfectFit,note:'含截距的普通最小二乘一元回归，斜率双侧 t 检验及 95% 置信区间。推断依赖线性、独立观测、同方差及近似正态误差条件；不证明因果，不应外推到样本范围之外。'+(perfectFit?'当前数据完全线性拟合、残差近零，未报告可靠的标准误、p 值或区间。':'')};
}
export function applyAnalysisInference(dataset,{columns,correlation=null,welch=null,regression=null}={}){
 columns=columns??defaultAnalysisColumns(dataset);const selected=validateAnalysisInference({welch,regression},columns),base=analyzeDataset(dataset,{columns,correlation});
 return{...base,statisticsVersion:1,correlation:pearsonInference(base.correlation),welch:selected.welch?welchAnalysis(dataset,selected.welch):null,regression:selected.regression?linearRegression(dataset,selected.regression):null};
}
