// Deterministic, local analysis. No AI or network requests; inference requires explicit method selection.
export const analysisLimits=Object.freeze({bytes:10*1024*1024,characters:10*1024*1024,rows:10000,columns:60,cells:300000,cellCharacters:20000});
export const missingValueDescription='空白、NA、N/A、NULL、NaN（不区分大小写）';
const missingValues=new Set(['','na','n/a','null','nan']);
export const isAnalysisMissing=value=>missingValues.has(String(value??'').trim().toLowerCase());
export function analysisNumber(value){const text=String(value??'').trim();if(isAnalysisMissing(text)||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(text))return null;const number=Number(text);return Number.isFinite(number)?number:null;}
const headerKey=value=>value.normalize('NFKC').toLocaleLowerCase('en-US');
const error=message=>{throw new Error(message);};
function sniffDelimiter(text){let quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;}if(!quoted&&(c==='\n'||c==='\r'))break;if(!quoted&&c==='\t')return '\t';}return ',';}
export function parseAnalysisDelimited(input,{delimiter='auto',fileName=''}={}){
 if(typeof input!=='string')error('数据文件必须是 UTF-8 文本。');
 if(input.length>analysisLimits.characters)error('文件内容过长，请拆分后导入。');
 let text=input.replace(/^\uFEFF/,'');if(text.includes('\0')||text.includes('\uFFFD'))error('文件编码无法识别，请另存为 UTF-8 CSV 或 TSV 后重试。');
 if(!text.trim())error('文件为空，请上传包含列名和数据行的文件。');
 if(delimiter==='auto')delimiter=/\.tsv$/i.test(fileName)?'\t':sniffDelimiter(text);
 if(delimiter!==','&&delimiter!=='\t')error('仅支持逗号 CSV 或制表符 TSV。');
 const records=[];let row=[],cell='',state='plain',recordContent=false,line=1,recordLine=1;
 const append=()=>{if(cell.length>analysisLimits.cellCharacters)error(`第 ${recordLine} 行的单元格过长。`);row.push(cell);cell='';if(row.length>analysisLimits.columns)error(`最多支持 ${analysisLimits.columns} 列，请移除多余列。`);};
 const finish=()=>{append();if(recordContent||row.length>1||row[0].trim()){records.push({values:row,line:recordLine});if(records.length>analysisLimits.rows+1)error(`最多支持 ${analysisLimits.rows} 行数据，请拆分文件。`);if(records.length*row.length>analysisLimits.cells+analysisLimits.columns)error(`最多支持 ${analysisLimits.cells} 个数据单元格，请缩小文件。`);}row=[];cell='';recordContent=false;state='plain';recordLine=line+1;};
 for(let i=0;i<text.length;i++){
  const c=text[i];if(state==='quoted'){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else state='closed';}else{cell+=c;if(c==='\n')line++;else if(c==='\r'&&text[i+1]!=='\n')line++;}continue;}
  if(state==='closed'){if(c===delimiter){append();state='plain';recordContent=true;continue;}if(c==='\n'||c==='\r'){finish();if(c==='\r'&&text[i+1]==='\n')i++;line++;recordLine=line;continue;}if(c===' '||c==='\t'&&delimiter!==c)continue;error(`第 ${line} 行引号后有多余字符，请检查分隔符。`);}
  if(c==='"'){if(cell.length)error(`第 ${line} 行引号位置不正确；含引号或换行的单元格请使用双引号包围。`);state='quoted';recordContent=true;continue;}
  if(c===delimiter){append();recordContent=true;continue;}
  if(c==='\n'||c==='\r'){finish();if(c==='\r'&&text[i+1]==='\n')i++;line++;recordLine=line;continue;}
  cell+=c;if(c.trim())recordContent=true;
 }
 if(state==='quoted')error('文件中存在未闭合的双引号，请检查后重新上传。');
 if(cell.length||row.length||recordContent||state==='closed')finish();
 if(records.length<2)error('文件需要首行列名和至少 1 行有效数据。');
 const headers=records[0].values.map(value=>value.trim());if(headers.some(value=>!value))error('列名不能为空，请补齐首行列名。');
 const seen=new Set();for(const name of headers){const key=headerKey(name);if(seen.has(key))error(`列名“${name}”重复，请修改为不同列名后重新上传。`);seen.add(key);}
 const rows=records.slice(1).map(record=>{if(record.values.length!==headers.length)error(`第 ${record.line} 行有 ${record.values.length} 个单元格，列名有 ${headers.length} 列；请补齐缺失单元格或检查分隔符。`);return record.values;});
 if(rows.length*headers.length>analysisLimits.cells)error(`最多支持 ${analysisLimits.cells} 个数据单元格，请缩小文件。`);
 if(!rows.some(row=>row.some(value=>!isAnalysisMissing(value))))error('所有数据均为空或缺失值，无法生成统计结果。');
 return {version:1,headers,rows,delimiter,fileName:String(fileName).slice(0,255),rowCount:rows.length};
}
export function validateAnalysisDataset(dataset){
 if(!dataset||!Array.isArray(dataset.headers)||!Array.isArray(dataset.rows)||!dataset.headers.length||dataset.headers.length>analysisLimits.columns||!dataset.rows.length||dataset.rows.length>analysisLimits.rows||dataset.rows.length*dataset.headers.length>analysisLimits.cells)error('已保存的数据结构无效，请重新上传数据文件。');
 const headers=dataset.headers.map(name=>typeof name==='string'?name.trim():'');if(headers.some(name=>!name||name.length>analysisLimits.cellCharacters)||new Set(headers.map(headerKey)).size!==headers.length)error('已保存的列名无效，请重新上传数据文件。');
 let size=0,any=false;for(const row of dataset.rows){if(!Array.isArray(row)||row.length!==headers.length)error('已保存的数据列数不一致，请重新上传数据文件。');for(const value of row){if(typeof value!=='string'||value.length>analysisLimits.cellCharacters)error('已保存的单元格无效，请重新上传数据文件。');size+=value.length;if(size>analysisLimits.characters)error('已保存的数据过大，请重新上传较小的数据文件。');if(!isAnalysisMissing(value))any=true;}}
 if(!any)error('所有数据均为空或缺失值，无法生成统计结果。');return {...dataset,headers,rowCount:dataset.rows.length};
}
const identifierName=name=>/^(?:id|uuid|guid|index|record[_ -]?id|user[_ -]?id|student[_ -]?id|序号|编号|学号|工号|用户id|样本id|记录id|手机号|手机号码|电话|身份证号|邮箱|email|姓名)$/i.test(name.trim());
export function inspectAnalysisColumns(dataset){const data=validateAnalysisDataset(dataset);return data.headers.map((name,index)=>{let missing=0,numeric=0,nonNumeric=0;for(const row of data.rows){if(isAnalysisMissing(row[index]))missing++;else if(analysisNumber(row[index])!==null)numeric++;else nonNumeric++;}return {index,name,missing,numeric,nonNumeric,valid:data.rows.length-missing,type:numeric>0&&nonNumeric===0?'numeric':'category',exclude:identifierName(name),identifier:identifierName(name)};});}
export function defaultAnalysisColumns(dataset){return inspectAnalysisColumns(dataset).map(({index,type,exclude})=>({index,type,include:!exclude}));}
function normalizeSelection(dataset,columns){const inspected=inspectAnalysisColumns(dataset),selected=Array.isArray(columns)?columns:defaultAnalysisColumns(dataset),seen=new Set(),result=[];for(const column of selected){if(!Number.isSafeInteger(column?.index)||column.index<0||column.index>=dataset.headers.length||seen.has(column.index))error('所选列无效或重复，请重新选择分析列。');seen.add(column.index);if(!['numeric','category'].includes(column.type))error('请选择有效的列类型。');if(column.include!==false)result.push({...inspected[column.index],type:column.type});}if(!result.length)error('请至少选择 1 个非标识符数据列，或手动选择需要分析的列。');return result;}
function compensatedSum(values){let sum=0,c=0;for(const v of values){const y=v-c,t=sum+y;c=(t-sum)-y;sum=t;}return sum;}
const finiteOrNull=value=>Number.isFinite(value)?value:null;
export function descriptiveAnalysis(values){if(!values.length)return {n:0,mean:null,median:null,min:null,max:null,sampleSD:null};if(values.some(value=>!Number.isFinite(value)))error('数值列包含无法计算的值。');const sorted=values.slice().sort((a,b)=>a-b),n=sorted.length,maxAbs=Math.max(...sorted.map(Math.abs)),scaled=maxAbs?sorted.map(v=>v/maxAbs):sorted.map(()=>0),meanScaled=compensatedSum(scaled)/n,variance=n>1?compensatedSum(scaled.map(v=>(v-meanScaled)**2))/(n-1):null,mid=Math.floor(n/2),lower=sorted[mid-1],upper=sorted[mid],median=n%2?sorted[mid]:Number.isFinite(upper-lower)?lower+(upper-lower)/2:lower/2+upper/2;return {n,mean:finiteOrNull(meanScaled*maxAbs),median:finiteOrNull(median),min:sorted[0],max:sorted.at(-1),sampleSD:n>1?finiteOrNull(Math.sqrt(variance)*maxAbs):null};}
export function pearsonAnalysis(rows,xIndex,yIndex){const pairs=rows.flatMap(row=>{const x=analysisNumber(row[xIndex]),y=analysisNumber(row[yIndex]);return x===null||y===null?[]:[[x,y]];});const n=pairs.length;if(n<3)return {n,r:null,status:'insufficient',note:'有效成对样本少于 3，未计算 Pearson 相关。'};const sx=Math.max(...pairs.map(p=>Math.abs(p[0]))),sy=Math.max(...pairs.map(p=>Math.abs(p[1]))),xs=pairs.map(p=>sx?p[0]/sx:0),ys=pairs.map(p=>sy?p[1]/sy:0),mx=compensatedSum(xs)/n,my=compensatedSum(ys)/n,dx=xs.map(x=>x-mx),dy=ys.map(y=>y-my),xx=compensatedSum(dx.map(x=>x*x)),yy=compensatedSum(dy.map(y=>y*y));if(xx===0||yy===0)return {n,r:null,status:'constant',note:'至少一列在有效配对中没有变异，未计算 Pearson 相关。'};const r=compensatedSum(dx.map((x,i)=>x*dy[i]))/Math.sqrt(xx*yy);return {n,r:Math.max(-1,Math.min(1,r)),status:'calculated',note:'仅反映有效成对样本的线性关联，不代表因果；未计算 p 值。'};}
export function validateAnalysisCorrelation(correlation,columns){
 if(correlation===null||correlation===undefined)return null;
 const index=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
 const x=index(correlation?.x),y=index(correlation?.y);
 if(x===null||y===null)error('已启用 Pearson 相关，请分别选择 X 和 Y 两列数值变量。');
 if(x===y)error('Pearson 相关需要选择不同的两列。');
 if(![x,y].every(value=>columns.some(column=>column.index===value&&column.include!==false&&column.type==='numeric')))error('Pearson 相关只能选择已参与分析的两列数值变量；请重新选择 X 和 Y。');
 return {x,y};
}
export function validateAnalysisInference({welch=null,regression=null}={},columns){
 const pair=(config,label,xKey,yKey,group=false)=>{if(config===null||config===undefined)return null;const numeric=columns.filter(column=>column.include!==false&&column.type==='numeric'),all=columns.filter(column=>column.include!==false),check=(value,list)=>((typeof value==='number'&&Number.isSafeInteger(value))||(typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value)))&&list.some(column=>column.index===Number(value));if(!check(config?.[xKey],group?all:numeric)||!check(config?.[yKey],numeric))error(label+'需要选择已参与分析的有效'+(group?'分组列与数值列。':' X、Y 两列数值变量。'));const x=Number(config[xKey]),y=Number(config[yKey]);if(x===y)error(label+'需要选择不同的两列。');return{[xKey]:x,[yKey]:y};};
 return{welch:pair(welch,'Welch 检验','group','value',true),regression:pair(regression,'一元线性回归','x','y')};
}
export function analyzeDataset(dataset,{columns,correlation=null}={}){
 const data=validateAnalysisDataset(dataset),selected=normalizeSelection(data,columns),pair=validateAnalysisCorrelation(correlation,selected),n=data.rows.length;
 const summaries=selected.map(column=>{let missing=0,invalid=0;const numbers=[],counts=new Map();for(const row of data.rows){const raw=row[column.index];if(isAnalysisMissing(raw)){missing++;continue;}if(column.type==='numeric'){const number=analysisNumber(raw);if(number===null)invalid++;else numbers.push(number);}else{const label=raw.trim();counts.set(label,(counts.get(label)||0)+1);}}const base={index:column.index,name:column.name,type:column.type,total:n,missing,missingRate:missing/n,invalid};return column.type==='numeric'?{...base,...descriptiveAnalysis(numbers)}:{...base,n:n-missing,frequencies:[...counts].map(([value,count])=>({value,count,rate:count/(n-missing)})).sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value,'zh-CN')),distinct:counts.size};});
 let paired=null;if(pair){const {x,y}=pair;paired={x,y,xName:data.headers[x],yName:data.headers[y],...pearsonAnalysis(data.rows,x,y)};}
 const missing=summaries.reduce((sum,c)=>sum+c.missing,0),cells=n*summaries.length;
 return {version:1,rows:n,selectedColumns:summaries.length,excludedColumns:data.headers.length-summaries.length,missing,missingRate:missing/cells,columns:summaries,correlation:paired,missingDefinition:missingValueDescription};
}
export function formatAnalysisNumber(value){if(value===null||!Number.isFinite(value))return '未计算';if(value===0)return '0';return Number(value.toPrecision(8)).toString();}
const percent=value=>formatAnalysisNumber(value*100)+'%';
export function formatAnalysisP(value){if(value===null||value===undefined||!Number.isFinite(value))return '未计算';return value<1e-12?'<1e-12':formatAnalysisNumber(value);}
function contextLines({question='',source='',variables='',previousAnalysis='',expectedMethods='',fileName='',sheetName='',importNotes=''}={}){return [['研究问题',question],['用户填写的数据来源',source],['变量信息',variables],['已有探索性分析',previousAnalysis],['预期方法（用户说明，不代表已执行）',expectedMethods],['数据文件',fileName],['工作表',sheetName],['导入口径',importNotes]].filter(([,value])=>value).map(([label,value])=>label+'：'+value);}
export function analysisReportText(result,context={}){
 if(!result)return '';const lines=[context.title||'数据分析报告','描述与基础推断数据分析报告（本地真实计算）','',...contextLines(context),`数据行数：${result.rows}；参与分析列数：${result.selectedColumns}；排除列数：${result.excludedColumns}`,`参与分析单元格缺失率：${percent(result.missingRate)}（${result.missing} 个缺失单元格）`,`缺失值口径：${result.missingDefinition}`,'首行是列名；空白物理行跳过；含分隔符的全缺失记录保留。','数值使用有限十进制或科学记数法；数值列非数字值排除并单列计数；标准差为样本标准差（n−1），n < 2 时不计算。',''];
 for(const c of result.columns){lines.push(c.name+' · '+(c.type==='numeric'?'数值变量':'分类变量'),`原始行数 ${c.total}；缺失 ${c.missing}（${percent(c.missingRate)}）；有效 ${c.n}${c.type==='numeric'?`；非数字排除 ${c.invalid}`:''}`);if(c.type==='numeric')lines.push(`均值 ${formatAnalysisNumber(c.mean)}；中位数 ${formatAnalysisNumber(c.median)}；最小值 ${formatAnalysisNumber(c.min)}；最大值 ${formatAnalysisNumber(c.max)}；样本标准差 ${formatAnalysisNumber(c.sampleSD)}`);else lines.push(...c.frequencies.map(item=>`${item.value}：${item.count}（有效值占比 ${percent(item.rate)}）`));lines.push('');}
 if(result.correlation){const c=result.correlation;lines.push(`Pearson 相关：${c.xName} × ${c.yName}`,`有效成对样本 n = ${c.n}；r = ${formatAnalysisNumber(c.r)}`,c.note);if(Object.hasOwn(c,'pValue'))lines.push(`自由度 ${c.df??'未计算'}；双侧 p：${formatAnalysisP(c.pValue)}`,c.inferenceNote);lines.push('');}
 if(result.welch){const w=result.welch;lines.push(`Welch 独立样本 t 检验：${w.valueName} 按 ${w.groupName} 分组`,...w.groups.map(g=>`${g.label}：有效 n = ${g.n}；均值 ${formatAnalysisNumber(g.mean)}；样本标准差 ${formatAnalysisNumber(g.sampleSD)}`),`排除缺失或非数值记录 ${w.excludedRows}；t = ${formatAnalysisNumber(w.t)}；自由度 ${formatAnalysisNumber(w.df)}；双侧 p：${formatAnalysisP(w.pValue)}`,`第一组减第二组的均值差 ${formatAnalysisNumber(w.difference)}；95% 置信区间 [${w.ci95.map(formatAnalysisNumber).join(', ')}]`,w.note,'');}
 if(result.regression){const r=result.regression;lines.push(`OLS 一元线性回归：${r.yName} ~ ${r.xName}`,`有效成对样本 n = ${r.n}；排除 ${r.excludedRows}；自由度 ${r.df}`,`截距 ${formatAnalysisNumber(r.intercept)}；斜率 ${formatAnalysisNumber(r.slope)}；R² = ${formatAnalysisNumber(r.rSquared)}`,`斜率标准误 ${formatAnalysisNumber(r.slopeSE)}；斜率 t = ${formatAnalysisNumber(r.slopeT)}；双侧 p：${formatAnalysisP(r.pValue)}`,`斜率95%置信区间：${r.slopeCI95?'['+r.slopeCI95.map(formatAnalysisNumber).join(', ')+']':'未计算'}；截距95%置信区间：${r.interceptCI95?'['+r.interceptCI95.map(formatAnalysisNumber).join(', ')+']':'未计算'}`,r.note,'');}
 lines.push('结果边界：统计仅基于本次实际导入的数据与所选列；不验证采集真实性。推断结果依赖各检验所列假设，p 值不表示效果大小、实际重要性或因果关系；多次检验未做多重比较校正。极端数值若超出可表示范围会停止该次分析，不生成虚构结果。','本功能在浏览器中计算，不发送原始数据给 AI，不消耗 AI 积分。请在发布、投稿或用于决策前核对数据口径。');return lines.join('\n');
}
function csvCell(value){if(typeof value==='number')return Number.isFinite(value)?String(value):'';let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
export function analysisResultsCSV(result,context={}){
 if(!result)return '';const rows=[['变量','类型','指标','值','口径'],...contextLines(context).map(line=>['研究说明','文本','用户填写/导入口径',line,'不代表统计结论'])];
 for(const c of result.columns){for(const [label,value]of [['原始行数',c.total],['有效数',c.n],['缺失数',c.missing],['缺失率',c.missingRate]])rows.push([c.name,c.type==='numeric'?'数值':'分类',label,value,'缺失率以本列原始行数为分母']);if(c.type==='numeric'){rows.push([c.name,'数值','非数字排除',c.invalid,'非数字不并入缺失数']);for(const [label,key]of [['均值','mean'],['中位数','median'],['最小值','min'],['最大值','max'],['样本标准差','sampleSD']])rows.push([c.name,'数值',label,c[key]??'未计算',key==='sampleSD'?'分母 n−1；n<2 未计算':'仅有效有限数值']);}else for(const item of c.frequencies){rows.push([c.name,'分类','频数：'+item.value,item.count,'仅非缺失值']);rows.push([c.name,'分类','有效占比：'+item.value,item.rate,'分母为本列非缺失数']);}}
 if(result.correlation){const c=result.correlation;rows.push([c.xName+' × '+c.yName,'Pearson','有效成对数',c.n,c.note],[c.xName+' × '+c.yName,'Pearson','r',c.r??'未计算',c.note]);if(Object.hasOwn(c,'pValue'))rows.push([c.xName+' × '+c.yName,'Pearson','双侧p',formatAnalysisP(c.pValue),c.inferenceNote]);}
 if(result.welch){const w=result.welch,label=w.valueName+' 按 '+w.groupName;for(const g of w.groups)for(const [key,value]of [['n',g.n],['均值',g.mean],['样本标准差',g.sampleSD]])rows.push([label,'Welch',g.label+' '+key,value,w.note]);for(const [key,value]of [['t',w.t],['自由度',w.df],['双侧p',formatAnalysisP(w.pValue)],['均值差',w.difference],['95%区间下界',w.ci95[0]],['95%区间上界',w.ci95[1]],['排除行数',w.excludedRows]])rows.push([label,'Welch',key,value,w.note]);}
 if(result.regression){const r=result.regression,label=r.yName+' ~ '+r.xName;for(const [key,value]of [['有效成对数',r.n],['排除行数',r.excludedRows],['截距',r.intercept],['斜率',r.slope],['R²',r.rSquared],['自由度',r.df],['斜率标准误',r.slopeSE??'未计算'],['斜率t',r.slopeT??'未计算'],['斜率双侧p',formatAnalysisP(r.pValue)],['斜率95%区间下界',r.slopeCI95?.[0]??'未计算'],['斜率95%区间上界',r.slopeCI95?.[1]??'未计算']])rows.push([label,'OLS',key,value,r.note]);}
 return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
