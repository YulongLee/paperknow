import {Unzip,UnzipInflate} from 'fflate';
import {normalizeRevisionReportText} from '../dist/workspace/revision-report-model.mjs';
import {reportColorMarked,mergeReportMarks,detectRevisionReportKind} from '../dist/workspace/revision-marked-html.mjs';
const check=signal=>{if(signal?.aborted)throw Object.assign(Error('已停止读取检测报告。'),{name:'AbortError'});};
const error=()=>Error('报告标记无法与PDF文字精确对应，请改用HTML全文报告，或粘贴报告明确标注的原文摘录。');
function glyphText(value){if(Array.isArray(value))return value.map(glyphText).join('');return typeof value==='string'?value:typeof value?.unicode==='string'?value.unicode:'';}
function colorValue(args){if(typeof args[0]==='string')return args[0];if(args.length===1&&typeof args[0]==='number')return Array(3).fill(Math.round(args[0]*255));const values=args.slice(0,3);return values.length===3?values.map(v=>Math.round(v*(Math.max(...values)<=1?255:1))):null;}
export async function readReportPdfPage(page,OPS){
 const [content,operators,annotations]=await Promise.all([page.getTextContent(),page.getOperatorList(),page.getAnnotations? page.getAnnotations({intent:'display'}):[]]);
 let text='',lastY=null;const items=[];
 for(const item of content.items){if(typeof item.str!=='string')continue;const y=item.transform?.[5];if(lastY!==null&&Number.isFinite(y)&&Math.abs(y-lastY)>4&&!text.endsWith('\n'))text+='\n';const start=text.length;text+=item.str;items.push({...item,start,end:text.length});text+=item.hasEOL?'\n':' ';lastY=y;}
 let state={color:[0,0,0],alpha:1,render:0};const stack=[],segments=[];
 for(let i=0;i<operators.fnArray.length;i++){
  const op=operators.fnArray[i],args=operators.argsArray[i]||[];
  if(op===OPS.save)stack.push({...state});else if(op===OPS.restore)state=stack.pop()||{color:[0,0,0],alpha:1,render:0};
  else if([OPS.setFillRGBColor,OPS.setFillGray,OPS.setFillCMYKColor].filter(v=>v!==undefined).includes(op))state.color=op===OPS.setFillCMYKColor&&args.length===4?args.slice(0,3).map(v=>Math.round(255*(1-Math.min(1,v+args[3])))):colorValue(args);
  else if(op===OPS.setTextRenderingMode)state.render=args[0];
  else if(op===OPS.setGState){for(const [key,value]of args[0]||[])if(key==='ca')state.alpha=value;}
  else if([OPS.showText,OPS.showSpacedText,OPS.nextLineShowText,OPS.nextLineSetSpacingShowText].filter(v=>v!==undefined).includes(op)){
   const value=glyphText(args),marked=state.alpha>0&&state.render!==3&&reportColorMarked(state.color);if(!value)continue;const last=segments.at(-1);if(last&&last.marked===marked)last.text+=value;else segments.push({text:value,marked});
  }
 }
 const mapped=normalizeRevisionReportText(text),rendered=segments.map(s=>s.text).join(''),renderMap=normalizeRevisionReportText(rendered),marks=[];
 if(mapped.key===renderMap.key){const rawFlags=new Uint8Array(rendered.length);let at=0;for(const segment of segments){if(segment.marked)rawFlags.fill(1,at,at+segment.text.length);at+=segment.text.length;}
  for(let i=0;i<renderMap.spans.length;i++){const span=renderMap.spans[i];if(rawFlags.subarray(span.start,span.end).some(Boolean))marks.push({...mapped.spans[i]});}
 }else for(const segment of segments.filter(s=>s.marked)){
  const key=normalizeRevisionReportText(segment.text).key;if(key.length<20)continue;const at=mapped.key.indexOf(key);if(at<0||mapped.key.indexOf(key,at+1)>=0)throw error();marks.push({start:mapped.spans[at].start,end:mapped.spans[at+key.length-1].end});
 }
 for(const annotation of annotations||[]){if(annotation.subtype!=='Highlight'||!Array.isArray(annotation.rect)&&!(annotation.rect instanceof Float32Array))continue;const c=annotation.color,highlight=reportColorMarked(c)||c&&c[0]>180&&c[1]>150&&c[2]<120;if(!highlight)continue;
  const [x1,y1,x2,y2]=annotation.rect;let found=false;
  for(const item of items){const x=item.transform?.[4],y=item.transform?.[5],w=Math.abs(item.width||0),h=Math.abs(item.height||0);if(!w||!h)continue;const overlap=Math.max(0,Math.min(x+w,x2)-Math.max(x,x1))*Math.max(0,Math.min(y+h,y2)-Math.max(y,y1));if(overlap/(w*h)>=.85){marks.push({start:item.start,end:item.end});found=true;}else if(overlap>0)throw error();}
  if(!found)throw error();
 }
 return{text,explicitExcerpts:mergeReportMarks(text,marks)};
}
export async function extractReportPdf(bytes,{signal,onProgress=()=>{},pdfjs:provided}={}){
 check(signal);if(!(bytes instanceof Uint8Array)||bytes.length>20*1024*1024||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw Error('请选择20MB以内、可提取文字的PDF全文报告。');
 const pdfjs=provided||await import('pdfjs-dist/build/pdf.mjs');if(pdfjs.GlobalWorkerOptions)pdfjs.GlobalWorkerOptions.workerSrc='/precheck/assets/pdf.worker.min.mjs';
 const task=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true,disableAutoFetch:true,enableXfa:false}),abort=()=>task.destroy();signal?.addEventListener('abort',abort,{once:true});let document;
 try{document=await task.promise;check(signal);if(document.numPages>100)throw Error('报告最多100页，请使用所需章节的全文报告。');let text='';const explicitExcerpts=[];
  for(let n=1;n<=document.numPages;n++){check(signal);const page=await document.getPage(n);try{const result=await readReportPdfPage(page,pdfjs.OPS);const at=text.length;text+=result.text+'\n\n';explicitExcerpts.push(...result.explicitExcerpts.map(r=>({start:at+r.start,end:at+r.end})));if(text.length>100000)throw Error('报告文字超过100,000字符，请按章节处理。');if(!result.text.trim())throw Error('报告包含无法提取文字的扫描页，请使用文字版PDF或HTML全文报告。');onProgress(n,document.numPages);}finally{page.cleanup();}}
  if(!text.trim())throw Error('未读取到报告正文，请使用文字版PDF或HTML全文报告。');const marks=mergeReportMarks(text,explicitExcerpts);return{text,explicitExcerpts:marks,markedOnly:true,markState:marks.length?'marked':'unknown',kind:detectRevisionReportKind(text),warnings:[]};
 }catch(e){check(signal);if(e.name==='PasswordException')throw Error('报告已加密，请解密后重新选择。');throw e;}finally{signal?.removeEventListener('abort',abort);await task.destroy();}
}
export async function readReportZip(bytes,{signal}={}){
 check(signal);if(!(bytes instanceof Uint8Array)||bytes.length>30*1024*1024||bytes[0]!==80||bytes[1]!==75)throw Error('请选择30MB以内的有效报告压缩包。');
 const entries=[],active=[],names=new Set();let count=0,total=0,failure;
 const stop=e=>{failure=e;for(const f of active)f.terminate();};
 const unzip=new Unzip(file=>{
  const name=file.name;if(++count>256||typeof name!=='string'||name.length>300||/[\\\u0000-\u001f]/.test(name)||/^(?:\/|[a-z]:)|(?:^|\/)\.\.(?:\/|$)/i.test(name)||names.has(name.toLowerCase())){stop(Error('压缩包目录无效或文件过多，请仅保留需要的全文报告。'));return;}names.add(name.toLowerCase());
  if(!/\.(?:html?|pdf|txt|docx|css)$/i.test(name))return;const limit=/\.css$/i.test(name)?1024*1024:20*1024*1024;if(file.originalSize>limit){stop(Error('压缩包中的报告文件过大，请按章节处理。'));return;}
  const chunks=[];let size=0;active.push(file);file.ondata=(e,data,final)=>{if(failure)return;if(e){stop(Error('压缩包无法读取，请解压后选择全文报告。'));return;}size+=data?.length||0;total+=data?.length||0;if(size>limit||total>30*1024*1024){stop(Error('压缩包解压后的内容过大，请仅保留需要的全文报告。'));return;}if(data?.length)chunks.push(data);if(final){const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}entries.push({name,bytes:data});}};file.start();
 });unzip.register(UnzipInflate);
 try{for(let at=0;at<bytes.length;at+=1024){check(signal);if(failure)throw failure;unzip.push(bytes.subarray(at,at+1024),at+1024>=bytes.length);if(at%(64*1024)===0)await new Promise(resolve=>setTimeout(resolve,0));}if(failure)throw failure;
  const files=entries.filter(f=>/\.(?:html?|pdf|txt|docx)$/i.test(f.name));if(!files.length||files.length>20)throw Error('压缩包应包含1至20份HTML、PDF、TXT或DOCX报告，请选择全文报告。');return{files,styles:entries.filter(f=>/\.css$/i.test(f.name))};
 }catch(e){for(const file of active)file.terminate();if(e.name==='AbortError')throw e;if(failure)throw failure;throw e;}
}
