const fail=message=>{throw Error(message);};
const allowed=new Set(['p','div','section','article','li','tr','td','th','blockquote','pre','h1','h2','h3','h4','h5','h6','mark','span','b','i','strong','em','u','s','table','tbody','thead','ul','ol','dl','dt','dd','br','title']);
export function reportColorMarked(value){
 if(typeof value==='string'){
  const text=value.trim().toLowerCase();if(['red','crimson','darkred','orangered','orange','firebrick'].includes(text))return true;
  const hex=text.match(/^#([a-f\d]{6}|[a-f\d]{3})$/i);if(hex){const h=hex[1].length===3?[...hex[1]].map(c=>c+c).join(''):hex[1];return reportColorMarked([0,2,4].map(at=>parseInt(h.slice(at,at+2),16)));}
  const rgb=text.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/);return rgb?reportColorMarked(rgb.slice(1).map(Number)):false;
 }
 if(!Array.isArray(value)&&!(value instanceof Uint8ClampedArray)&&!(value instanceof Uint8Array))return false;
 const [r,g,b]=value;return[r,g,b].every(n=>Number.isFinite(n)&&n>=0&&n<=255)&&r>=130&&r>g*1.2&&r>b*1.3&&g<215;
}
export function detectRevisionReportKind(text){
 const start=String(text||'').slice(0,1800),ai=/(?:AIGC|AI\s*率|AI\s*生成|人工智能生成)[^\n]{0,12}(?:报告|检测)|论文\s*AI\s*率检测报告/i.test(start),similar=/重复率检测报告|文本相似性检测报告|文字复制比|相似性检测报告|查重报告/i.test(start);
 return ai&&!similar?'aigc':similar&&!ai?'similarity':null;
}
export function extractMarkedRevisionHtml(html,{DOMParserClass=globalThis.DOMParser,css=''}={}){
 if(typeof html!=='string'||html.length>20*1024*1024||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(html)||typeof DOMParserClass!=='function')fail('请选择不超过20MB的HTML全文检测报告。');
 const colorRules=[],declaredColorClasses=new Set();let colorRulesTruncated=false,unsupportedColorRule=false;const cssText=String(css),cssTruncated=cssText.length>1024*1024,styles=cssText.slice(0,1024*1024)+'\n'+[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(m=>m[1]).join('\n');
 for(const rule of styles.matchAll(/([^{}]{1,500})\{([^{}]{1,2000})\}/g)){const color=rule[2].match(/(?:^|;)\s*color\s*:\s*([^;}!]+)/i)?.[1];if(!color)continue;for(const selector of rule[1].split(',')){const safeSelector=selector.trim();for(const match of safeSelector.matchAll(/\.([\w-]+)/g)){if(declaredColorClasses.size<2048)declaredColorClasses.add(match[1]);else colorRulesTruncated=true;}if(safeSelector.length<=200&&/^[a-zA-Z0-9_.\-\s>]+$/.test(safeSelector)&&/\.[\w-]+/.test(safeSelector)){if(colorRules.length<512)colorRules.push({selector:safeSelector,marked:reportColorMarked(color)});else colorRulesTruncated=true;}else if(reportColorMarked(color))unsupportedColorRule=true;}}
 const tokens=[],token=value=>{tokens.push(value);return'\u0000rr-'+(tokens.length-1)+'\u0000';};
 const safe=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template|iframe|object|svg|math|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<![^>]*>|<\/?([a-z][\w:-]*)\b([^>]*)>/gi,(all,name,attributes='')=>{
  const tag=(name||'').toLowerCase();if(!allowed.has(tag))return '';if(all.startsWith('</'))return token('</'+tag+'>');
  const classes=(attributes.match(/(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)||[]).slice(1).find(v=>v!==undefined)||'',list=classes.split(/\s+/),style=(attributes.match(/(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/i)||[]).slice(1).find(v=>v!==undefined)||'',color=style.match(/(?:^|;)\s*color\s*:\s*([^;}!]+)/i)?.[1],legacy=attributes.match(/(?:^|\s)color\s*=\s*["']?([^\s"'>]+)/i)?.[1];
  const zone=list.some(c=>['report-review-original','aigc-report-part'].includes(c))?'original':list.some(c=>['report-review-detail','report-paragraph-header','aigc-report-part-head','report-original-back'].includes(c))?'ignore':null;
  const explicit=tag==='mark'&&!list.includes('quoted'),hint=list.some(c=>c==='aigc-report-text-risk'||(['matched','red','red-text'].includes(c)&&!colorRulesTruncated&&!cssTruncated&&!declaredColorClasses.has(c))),directColor=color||legacy,risk=explicit||(!directColor&&hint)||reportColorMarked(directColor);
  const safeClasses=list.filter(c=>/^[\w-]{1,100}$/.test(c)).slice(0,30);return token('<'+tag+(safeClasses.length?' class="'+safeClasses.join(' ')+'"':'')+(zone?' data-rr-zone="'+zone+'"':'')+(list.includes('report-text')?' data-rr-text="true"':'')+(risk?' data-rr-mark="true"':'')+(explicit?' data-rr-explicit="true"':'')+(directColor?' data-rr-inline="'+(reportColorMarked(directColor)?'red':'other')+'"':'')+'>');
 }).replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\u0000rr-(\d+)\u0000/g,(_,index)=>tokens[Number(index)]);
 // Only generated text tags and controlled enums reach DOMParser; no original
 // URL, style, event handler, resource element or executable node survives.
 const doc=new DOMParserClass().parseFromString(safe,'text/html'),matchedColors=new Map();for(const rule of colorRules){try{for(const node of doc.querySelectorAll(rule.selector)){const seen=matchedColors.get(node)||{red:false,other:false};seen[rule.marked?'red':'other']=true;matchedColors.set(node,seen);}}catch{/* Unsupported selectors cannot identify a marked span. */}}let uncertainColor=false;for(const [node,seen] of matchedColors){if(node.getAttribute('data-rr-explicit')==='true'||node.getAttribute('data-rr-inline')==='red')continue;if(node.getAttribute('data-rr-inline')==='other'){node.removeAttribute('data-rr-mark');continue;}if(seen.red&&seen.other){uncertainColor=true;node.removeAttribute('data-rr-mark');}else if(seen.red)node.setAttribute('data-rr-mark','true');else if(seen.other)node.removeAttribute('data-rr-mark');}const descendantsWithOtherColor=new WeakSet(),nodes=[...doc.querySelectorAll('*')];for(let i=nodes.length-1;i>=0;i--){const node=nodes[i],descendantConflict=descendantsWithOtherColor.has(node);if(descendantConflict&&node.getAttribute('data-rr-mark')==='true'&&node.getAttribute('data-rr-explicit')!=='true'){node.removeAttribute('data-rr-mark');uncertainColor=true;}if(node.parentElement&&(descendantConflict||node.getAttribute('data-rr-inline')==='other'||matchedColors.get(node)?.other))descendantsWithOtherColor.add(node.parentElement);}const owned=[...doc.querySelectorAll('[data-rr-zone="original"]')],own=owned.length>0,heading=doc.querySelector('h1')?.textContent||'',kind=detectRevisionReportKind(heading)||detectRevisionReportKind(doc.body.textContent),explicitExcerpts=[];let text='';
 const visit=(node,inline=false)=>{
  if(node.nodeType===3){text+=node.nodeValue;return;}if(node.nodeType!==1||node.getAttribute('data-rr-zone')==='ignore')return;
  const tag=node.tagName.toLowerCase(),block=!inline&&/^(?:p|div|section|article|li|tr|blockquote|pre|h[1-6])$/.test(tag);if(tag==='br'){text+='\n';return;}
  if(block&&text&&!text.endsWith('\n'))text+='\n';const start=text.length;for(const child of node.childNodes)visit(child,inline);
  if(node.getAttribute('data-rr-mark')==='true'&&text.length>start)explicitExcerpts.push({start,end:text.length});if(block&&!text.endsWith('\n'))text+='\n';
 };
 if(own){for(const zone of owned){const body=zone.querySelector('[data-rr-text="true"]');if(body)visit(body,true);else visit(zone,true);if(kind==='similarity'&&!text.endsWith('\n\n'))text+='\n\n';}}
 else for(const node of doc.body.childNodes)visit(node);
 if(!text.trim()||text.length>100000)fail('报告未包含可读取正文，或报告文字超过100,000字符；请使用全文报告并按章节处理。');
 const unique=mergeReportMarks(text,explicitExcerpts);
 return{text,explicitExcerpts:unique,markedOnly:true,kind,markState:unique.length?'marked':own?'none':'unknown',...(own&&kind==='aigc'?{originalText:text}:{}),warnings:[...(uncertainColor?['部分标记颜色存在冲突，未自动选中；请人工核对原报告。']:[]),...(colorRulesTruncated?['报告颜色规则过多，仅检查前 512 条；请核对其余标记。']:[]),...(cssTruncated?['报告样式文件过大，仅检查前 1MB；请核对其余标记。']:[]),...(unsupportedColorRule?['部分报告颜色样式无法识别，请核对原报告标记。']:[])]};
}

export function mergeReportMarks(text,ranges){const output=[];for(const range of ranges.map(r=>({...r})).sort((a,b)=>a.start-b.start||a.end-b.end)){const previous=output.at(-1);if(previous&&(range.start<=previous.end||!text.slice(previous.end,range.start).trim()))previous.end=Math.max(previous.end,range.end);else output.push(range);}return output;}
