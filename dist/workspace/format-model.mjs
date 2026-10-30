export const defaultRules=()=>({font:'宋体',size:12,line:1.5,indent:2,top:2.5,bottom:2.5,left:2.5,right:2.5,body:true,headings:true,margins:true,h1:16,h2:14,h3:12});
export function validateRules(r){if(!['宋体','黑体','仿宋','Times New Roman'].includes(r.font))throw new Error('请选择支持的字体。');for(const k of ['size','h1','h2','h3'])if(![10.5,12,14,16,18].includes(Number(r[k])))throw new Error('字号必须使用提供的选项。');if(![1,1.25,1.5,2].includes(Number(r.line)))throw new Error('行距设置不正确。');if(![0,2].includes(Number(r.indent)))throw new Error('首行缩进设置不正确。');for(const k of ['top','bottom','left','right'])if(!Number.isFinite(Number(r[k]))||r[k]<1||r[k]>5)throw new Error('页边距需要在 1–5 cm 之间。');if(!r.body&&!r.headings&&!r.margins)throw new Error('请至少选择一个应用范围。');return r;}
export function headingLevel(text,styleLevel){if([1,2,3].includes(Number(styleLevel)))return Number(styleLevel);if(/^第[一二三四五六七八九十百\d]+[章节]/.test(text.trim()))return 1;if(/^\d+\.\d+\.\d+\s+/.test(text.trim()))return 3;if(/^\d+\.\d+\s+/.test(text.trim()))return 2;return 0;}
export function checkFormatting(doc,rules){validateRules(rules);const issues=[];for(const [i,p] of doc.paragraphs.entries()){if(p.excluded===true)continue;const heading=p.level>0,enabled=heading?rules.headings:rules.body;if(!enabled)continue;const targetSize=heading?Number(rules['h'+Math.min(p.level,3)]):Number(rules.size),targetFont=heading?'黑体':rules.font;for(const [key,label,target] of [['font','字体',targetFont],['size','字号',targetSize],...(!heading?[['line','行距',Number(rules.line)],['indent','首行缩进',Number(rules.indent)]]:[])]){const values=p.format[key];if(!values?.length){issues.push({index:i,key,label,status:'unknown',current:'未能确定（可能继承其他设置）',target});}else if(values.some(v=>typeof target==='number'?Math.abs(Number(v)-target)>.02:v!==target))issues.push({index:i,key,label,status:'fix',current:[...new Set(values)].join(' / '),target});}}
if(rules.margins)for(const [i,m]of (doc.sections.length?doc.sections:[{}]).entries())for(const key of ['top','bottom','left','right'])if(m[key]==null||Math.abs(m[key]-Number(rules[key]))>.02)issues.push({section:i,key,label:'页边距',status:m[key]==null?'unknown':'fix',current:m[key]??'未能确定',target:Number(rules[key])});return issues;}
export const cmToTwips=v=>Math.round(Number(v)/2.54*1440);

export function rulesFromTemplate(doc,current=defaultRules()){
 const rules={...current},imported=[],unresolved=[];
 const frequent=values=>{const count=new Map();for(const v of values)count.set(v,(count.get(v)||0)+1);return [...count].sort((a,b)=>b[1]-a[1])[0]?.[0];};
 const body=doc.paragraphs.filter(p=>!p.level);
 for(const [key,allowed]of [['font',['宋体','黑体','仿宋','Times New Roman']],['size',[10.5,12,14,16,18]],['line',[1,1.25,1.5,2]],['indent',[0,2]]]){
  const value=frequent(body.flatMap(p=>p.format[key]||[]));
  if(allowed.includes(value)){rules[key]=value;imported.push(key);}else unresolved.push(key);
 }
 for(const n of [1,2,3]){const value=frequent(doc.paragraphs.filter(p=>p.level===n).flatMap(p=>p.format.size||[]));if([10.5,12,14,16,18].includes(value)){rules['h'+n]=value;imported.push('h'+n);}}
 for(const key of ['top','bottom','left','right']){const value=frequent((doc.sections||[]).map(s=>s[key]).filter(Number.isFinite));if(value>=1&&value<=5){rules[key]=Math.round(value*100)/100;imported.push(key);}else unresolved.push(key);}
 validateRules(rules);return {rules,imported,unresolved};
}

export function formatAdviceSnapshot(item,doc,rules,service='smart'){
 const issues=checkFormatting(doc,rules),paragraphs=doc.paragraphs.slice(0,12).map((p,index)=>({paragraph:index+1,role:p.level>0?p.level+'级标题':'正文',text:p.text.slice(0,400),excerpt:p.text.length>400}));
 const units={size:'pt',h1:'pt',h2:'pt',h3:'pt',line:'倍',indent:'字符',top:'cm',bottom:'cm',left:'cm',right:'cm'},marginNames={top:'上页边距',bottom:'下页边距',left:'左页边距',right:'右页边距'};
 const measured=(value,unit)=>unit&&/^[\d.\s/+-]+$/.test(String(value))?String(value)+' '+unit:value;
 const displayedRules=Object.fromEntries(Object.entries(rules).map(([key,value])=>[key,measured(value,units[key])]));
 const displayedIssues=issues.slice(0,80).map(issue=>({location:issue.index!=null?'段落 '+(issue.index+1):'第 '+(issue.section+1)+' 节',...(issue.index!=null?{paragraph:issue.index+1}:{section:issue.section+1}),key:issue.key,label:issue.section!=null?marginNames[issue.key]:issue.label,status:issue.status,unit:units[issue.key]||'',current:measured(issue.current,units[issue.key]),target:measured(issue.target,units[issue.key])}));
 const issueSummary={total:issues.length,selected:displayedIssues.length,groups:[{name:'标题',count:issues.filter(i=>i.index!=null&&doc.paragraphs[i.index].level>0).length},{name:'正文',count:issues.filter(i=>i.index!=null&&!doc.paragraphs[i.index].level).length},{name:'分节页边距',count:issues.filter(i=>i.section!=null).length}]};
 const review={document:item.title||'排版文档',example:item.example===true,rules:displayedRules,issues:displayedIssues,totalIssues:issues.length,issueSummary,paragraphs,totalParagraphs:doc.paragraphs.length,warnings:doc.warnings||[],scope:'仅正文顶层段落和分节页边距；最多80项问题、前12段各400字符。问题总数及分组数由检测器提供，每项差异计1项。不是完整分页复核。'};
 const text=JSON.stringify(review,null,2);if(text.length>40000)throw Error('当前检查说明过长，请精简后重试。');
 return {title:(item.title||'文档')+' · 格式问题解读',text,language:'中文',requirements:'依据当前真实检查清单与规则，按优先级解释问题、定位和可执行的修改建议。总数与分组数只采用 issueSummary 的权威数量，不得重新分组计数或推算其他分组数量。逐字使用 issues.location 定位，段落与分节编号均从1开始，不得声称存在未提供的问题或段落。字号单位是pt，页边距单位是cm，行距是倍数，缩进是字符；不得将16pt说成16号或改变任何单位。未给出正文的段落只能解释已列格式问题，不能假称已读其正文。仅针对本次节选，不能声称检查全文、官方格式认证或已经修改DOCX。不要修改或补写研究内容。',mode:service,materials:[{id:'format-review',name:'当前排版规则与检查节选',text}],context:{service,documentCharacters:doc.paragraphs.reduce((n,p)=>n+Array.from(p.text||'').length,0),totalIssues:issues.length,selectedIssues:displayedIssues.length,selectedParagraphs:paragraphs.map(p=>p.paragraph),totalParagraphs:doc.paragraphs.length}};
}
