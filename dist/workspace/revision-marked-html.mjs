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
 const coloredRules=[],styles=String(css).slice(0,1024*1024)+'\n'+[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(m=>m[1]).join('\n');
 for(const rule of styles.matchAll(/([^{}]{1,500})\{([^{}]{1,2000})\}/g)){const color=rule[2].match(/(?:^|;)\s*color\s*:\s*([^;}!]+)/i)?.[1];if(!reportColorMarked(color))continue;for(const selector of rule[1].split(',')){const compound=selector.trim().split(/\s+|>|~|\+/).filter(Boolean).at(-1)||'';if(compound.includes(':')||compound.includes('['))continue;const classes=[...compound.matchAll(/\.([\w-]+)/g)].map(m=>m[1]),tag=compound.match(/^[a-z][\w-]*/i)?.[0].toLowerCase();if(classes.length)coloredRules.push({classes,tag});}}
 const tokens=[],token=value=>{tokens.push(value);return'\u0000rr-'+(tokens.length-1)+'\u0000';};
 const safe=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template|iframe|object|svg|math|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<![^>]*>|<\/?([a-z][\w:-]*)\b([^>]*)>/gi,(all,name,attributes='')=>{
  const tag=(name||'').toLowerCase();if(!allowed.has(tag))return '';if(all.startsWith('</'))return token('</'+tag+'>');
  const classes=(attributes.match(/(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)||[]).slice(1).find(v=>v!==undefined)||'',list=classes.split(/\s+/),style=(attributes.match(/(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/i)||[]).slice(1).find(v=>v!==undefined)||'',color=style.match(/(?:^|;)\s*color\s*:\s*([^;}!]+)/i)?.[1],legacy=attributes.match(/(?:^|\s)color\s*=\s*["']?([^\s"'>]+)/i)?.[1];
  const zone=list.some(c=>['report-review-original','aigc-report-part'].includes(c))?'original':list.some(c=>['report-review-detail','report-paragraph-header','aigc-report-part-head','report-original-back'].includes(c))?'ignore':null;
  const risk=(tag==='mark'&&!list.includes('quoted'))||list.some(c=>c==='aigc-report-text-risk'||c==='matched'||c==='red'||c==='red-text')||coloredRules.some(rule=>(!rule.tag||rule.tag===tag)&&rule.classes.every(c=>list.includes(c)))||reportColorMarked(color)||reportColorMarked(legacy);
  return token('<'+tag+(zone?' data-rr-zone="'+zone+'"':'')+(list.includes('report-text')?' data-rr-text="true"':'')+(risk?' data-rr-mark="true"':'')+'>');
 }).replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\u0000rr-(\d+)\u0000/g,(_,index)=>tokens[Number(index)]);
 // Only generated text tags and controlled enums reach DOMParser; no original
 // URL, style, event handler, resource element or executable node survives.
 const doc=new DOMParserClass().parseFromString(safe,'text/html'),owned=[...doc.querySelectorAll('[data-rr-zone="original"]')],own=owned.length>0,heading=doc.querySelector('h1')?.textContent||'',kind=detectRevisionReportKind(heading)||detectRevisionReportKind(doc.body.textContent),explicitExcerpts=[];let text='';
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
 return{text,explicitExcerpts:unique,markedOnly:true,kind,markState:unique.length?'marked':own?'none':'unknown',...(own&&kind==='aigc'?{originalText:text}:{}),warnings:[]};
}

export function mergeReportMarks(text,ranges){const output=[];for(const range of ranges.map(r=>({...r})).sort((a,b)=>a.start-b.start||a.end-b.end)){const previous=output.at(-1);if(previous&&(range.start<=previous.end||!text.slice(previous.end,range.start).trim()))previous.end=Math.max(previous.end,range.end);else output.push(range);}return output;}
