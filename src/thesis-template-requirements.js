// Interpret only declarative typography facts. Template prose is untrusted
// data: it cannot grant tools, change content, fetch links or execute code.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const cm=n=>Math.round(n*1440/2.54);
const sizes={'初号':84,'小初':72,'一号':52,'小一':48,'二号':44,'小二':36,'三号':32,'小三':30,'四号':28,'小四':24,'五号':21,'小五':18,'六号':15};
const text=node=>[...node.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('');
function typography(value){
 const result={},s=value.replace(/\s/g,'');
 const face=s.match(/新宋体|宋体|黑体|楷体(?:_GB2312)?|仿宋/);if(face)result.eastAsia=face[0];
 const size=s.match(/小初|初号|小[一二三四五六]|[一二三四五六]号/);if(size&&sizes[size[0]])result.size=sizes[size[0]];
 if(/TimesNewRoman/i.test(s))result.ascii='Times New Roman';
 if(/粗体|加粗/.test(s))result.bold=true;
 if(/居中/.test(s))result.alignment='center';else if(/靠左|左对齐|顶格/.test(s))result.alignment='left';
 if(/顶格|取消.*缩进/.test(s))Object.assign(result,{firstLine:0,firstLineChars:0,hanging:0});
 const indent=s.match(/首行缩进([0-4两二])(?:个)?字符/);if(indent)Object.assign(result,{firstLine:0,firstLineChars:(/[两二]/.test(indent[1])?2:Number(indent[1]))*100,hanging:0});
 const spacing=s.match(/段前[、,，]?段后([0-9.]+)行/);if(spacing){result.beforeLines=Math.round(Number(spacing[1])*100);result.afterLines=result.beforeLines;result.before=0;result.after=0;}
 return result;
}
export function readExplicitThesisRequirements(document){
 const facts=[],ambiguities=[];
 const add=(scope,values,evidence)=>{for(const [field,value]of Object.entries(values)){const path=scope+'.'+field,existing=facts.find(row=>row.path===path);if(existing&&existing.value!==value){ambiguities.push({path,message:'模板中的文字规范存在冲突，请核对。',evidence:[existing.evidence,evidence].map(s=>s.slice(0,220))});continue;}if(!existing)facts.push({path,value,evidence:evidence.slice(0,220)});}};
 const paragraphs=[...document.getElementsByTagNameNS(W,'p')].map(text);
 for(const value of paragraphs){const s=value.replace(/\s/g,'');
  if(/^页面设置[:：]/.test(s)){
   const combined=s.match(/左[、,，]右[、,，]下边距为([0-9.]+)(?:cm|厘米)/i);if(combined)add('page',{left:cm(Number(combined[1])),right:cm(Number(combined[1])),bottom:cm(Number(combined[1]))},value);
   for(const [label,key]of [['上','top'],['下','bottom'],['左','left'],['右','right']]){const m=s.match(new RegExp(label+'边距(?:为|[:：])?([0-9.]+)(?:cm|厘米)','i'));if(m)add('page',{[key]:cm(Number(m[1]))},value);}
  }
  if(/^(?:字符间距|行间距|正文格式|正文要求)[:：]/.test(s)){
   const line=s.match(/行间距[:：]?(?:为)?固定值([0-9.]+)磅/);if(line)for(const role of ['Normal','Abstract','References','TOC'])add('styles.'+role,{line:Math.round(Number(line[1])*20),lineRule:'exact'},value);
   if(/段前距与段后距均为0磅/.test(s))for(const role of ['Normal','Abstract','References','TOC'])add('styles.'+role,{before:0,after:0,beforeLines:0,afterLines:0},value);
   if(/字符间距[:：]标准/.test(s))for(const role of ['Normal','Abstract','References','TOC'])add('styles.'+role,{characterSpacing:0,characterScale:100},value);
  }
  if(/^中文[:：]/.test(s)&&/西文|数字/.test(s)){const rule=typography(value);for(const role of ['Normal','Abstract','References','TOC','TableText'])add('styles.'+role,rule,value);if(!/粗体|加粗/.test(s))add('styles.Abstract',{bold:false},value);if(rule.ascii)for(const role of ['Heading1','Heading2','Heading3','Title'])add('styles.'+role,{ascii:rule.ascii},value);}
  if(/^页眉[:：]/.test(s)){add('styles.Header',typography(value),value);const m=value.match(/页眉内容为[:：]\s*([^。\n]+)/);if(m)add('furniture',{headerText:m[1].trim()},value);}
  if(/页码从正文开始编排/.test(s))add('furniture',{bodyOnly:true},value);
  if(/公式的编号右端对齐/.test(s))add('furniture',{numberedEquations:true},value);
  if(/目录标题/.test(s)&&/号|粗体/.test(s))add('styles.TOCTitle',typography(value),value);
  if(/目录内容/.test(s)&&/号/.test(s))add('styles.TOC',typography(value),value);
  if(/(?:图的编号和图题|图序.*图名|图题).*?(?:宋体|号)/.test(s))add('styles.FigureCaption',typography(value),value);
  if(/表的编号和表题.*?(?:宋体|号)/.test(s))add('styles.TableCaption',typography(value),value);
  if(/参[考\s]*文[\s]*献[（(]/.test(s)&&/宋体/.test(s))add('styles.ReferenceHeading',typography(value),value);
  if(/^致谢[（(]/.test(s)&&/宋体/.test(s))add('styles.AcknowledgementHeading',typography(value),value);
  if(/^附录[A-Za-z一二三0-9]*[（(]/.test(s)&&/宋体/.test(s))add('styles.AppendixHeading',typography(value),value);
  if(/首行缩进[两二2]个字符/.test(s)&&/宋体/.test(s)&&/×/.test(s))add('styles.Normal',{firstLine:0,firstLineChars:200,hanging:0},value);
  const title=s.match(/^([一二三四五六七八九十]+、|\d+\.\d+\.\d+\s*|\d+\.\d+\s*)题名[（(]([^）)]+)[）)]/);
  if(title){const role=title[1].includes('.')?(title[1].split('.').length===3?'Heading3':'Heading2'):'Heading1';add('styles.'+role,typography(value),value);}
 }
 // Requirement matrices carry the level in an adjacent cell. Their column
 // captions are excluded; only a row with an explicit level is interpreted.
 for(const table of document.getElementsByTagNameNS(W,'tbl')){
  const rows=[...table.childNodes].filter(n=>n.localName==='tr');
  const matrix=/字体及位置要求/.test(text(table));
  for(const [index,row]of rows.entries()){const cells=[...row.childNodes].filter(n=>n.localName==='tc').map(text),level=cells[0]?.replace(/\s/g,'').match(/^(?:第)?([一二三123])级/),number=level?({'一':1,'二':2,'三':3}[level[1]]||level[1]):matrix&&index>=1&&index<=3&&cells.length>=4?index:null;if(!number)continue;const role='Heading'+number,requirement=cells.findLast(s=>/宋体|黑体|磅|号/.test(s));if(requirement)add('styles.'+role,typography(requirement),cells.join(' | '));}
 }
 return {version:1,facts,ambiguities};
}
export function applyExplicitThesisRequirements(profile,contract){
 const baseline={...profile.rules.styles.Normal,...Object.fromEntries(contract.facts.filter(row=>row.path.startsWith('styles.Normal.')).map(row=>[row.path.split('.').at(-1),row.value]))};
 for(const role of ['TOC','TOCTitle','Header','FigureCaption','TableCaption','ReferenceHeading','AcknowledgementHeading','AppendixHeading'])if(contract.facts.some(row=>row.path.startsWith('styles.'+role+'.')))profile.rules.styles[role]={...baseline,firstLine:0,firstLineChars:0,hanging:0,...(['TOCTitle','ReferenceHeading','AcknowledgementHeading','AppendixHeading'].includes(role)?{alignment:'center',bold:true}:{})};
 for(const fact of contract.facts){const parts=fact.path.split('.');let target=profile.rules;if(parts[0]==='furniture'){target.furniture??={};}for(const key of parts.slice(0,-1))target=target[key];const key=parts.at(-1);fact.previous=target[key];target[key]=fact.value;profile.recognized.push(fact.path);profile.unresolved=profile.unresolved.filter(path=>path!==fact.path);}
 profile.recognized=[...new Set(profile.recognized)];
 profile.requirements=contract;
 if(contract.facts.length)profile.summary.push(`已读取 ${contract.facts.length} 项模板文字规范，文字要求优先于示例的残留格式。`);
 if(contract.ambiguities.length)profile.warnings.push('模板文字规范存在冲突，已保留待核对记录，不代表全部要求已确认。');
 return profile;
}
