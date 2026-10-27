import {extractMarkedRevisionHtml,detectRevisionReportKind} from './revision-marked-html.mjs';
import {importWorkspaceDocument} from './document-import.mjs';
const check=signal=>{if(signal?.aborted)throw Object.assign(Error('已停止读取检测报告。'),{name:'AbortError'});};
export function reportTextDecode(bytes){
 const head=new TextDecoder().decode(bytes.subarray(0,1000)),charset=head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase();
 if(charset&&/^(?:gbk|gb2312|gb18030)$/.test(charset))return new TextDecoder('gb18030',{fatal:true}).decode(bytes);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('报告文字编码无法读取，请另存为UTF-8格式后重试。');}
}
export async function readRevisionReportFile(file,{signal,onProgress=()=>{},status,kind,styles=[]}={}){
 check(signal);if(!file||!file.name||!file.size||file.size>30*1024*1024)throw Error('请选择30MB以内的检测报告。');const extension=file.name.split('.').at(-1).toLowerCase();let result;
 if(extension==='zip'){onProgress('正在读取报告压缩包…');const parser=await import('./assets/revision-report-parser.js'),archive=await parser.readReportZip(new Uint8Array(await file.arrayBuffer()),{signal});check(signal);return{archive,fileName:file.name};}
 if(['html','htm'].includes(extension)){if(file.size>20*1024*1024)throw Error('HTML全文报告最大20MB。');onProgress('正在读取全文报告与标记位置…');const css=styles.map(f=>reportTextDecode(f.bytes)).join('\n');result=extractMarkedRevisionHtml(reportTextDecode(new Uint8Array(await file.arrayBuffer())),{DOMParserClass:status?.ownerDocument?.defaultView?.DOMParser||globalThis.DOMParser,css});}
 else if(extension==='pdf'){onProgress('正在读取PDF全文报告…');const parser=await import('./assets/revision-report-parser.js');result=await parser.extractReportPdf(new Uint8Array(await file.arrayBuffer()),{signal,onProgress:(page,pages)=>onProgress(`正在读取检测报告 · ${page} / ${pages} 页`)});}
 else if(['txt','docx'].includes(extension)){result=await importWorkspaceDocument(file,status,{signal});result={...result,kind:detectRevisionReportKind(result.text),markedOnly:true,explicitExcerpts:[]};}
 else throw Error('请选择PDF、HTML或ZIP全文报告，也可导入TXT、DOCX标注摘录。');
 check(signal);if(result.kind&&kind&&result.kind!==kind)throw Error(kind==='aigc'?'这份文件是重复率报告，请选择AI检测全文报告。':'这份文件是AI检测报告，请选择重复率全文报告。');
 return{...result,fileName:file.name,format:['html','htm'].includes(extension)?'html':extension};
}
