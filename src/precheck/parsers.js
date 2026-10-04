import mammoth from 'mammoth/mammoth.browser.js';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/precheck/assets/pdf.worker.min.mjs';
export async function extractFile(file,onProgress=()=>{}){
 const ext=file.name.split('.').at(-1).toLowerCase(),data=await file.arrayBuffer();
 if(ext==='txt'){return{text:new TextDecoder('utf-8',{fatal:true}).decode(data),warnings:[],pages:null};}
 if(ext==='docx'){const signature=new Uint8Array(data,0,Math.min(data.byteLength,4));if(signature[0]!==0x50||signature[1]!==0x4b)throw new Error('文件内容不是有效的 DOCX 文档。');const result=await mammoth.extractRawText({arrayBuffer:data});return{text:result.value,warnings:result.messages.filter(m=>m.type==='warning').map(m=>m.message),pages:null};}
 if(ext==='pdf'){const magic=new TextDecoder().decode(data.slice(0,5));if(magic!=='%PDF-')throw new Error('文件内容不是有效的 PDF 文档。');let document;const loadingTask=pdfjs.getDocument({data:new Uint8Array(data),isEvalSupported:false,useSystemFonts:true});try{document=await loadingTask.promise;}catch(e){if(e.name==='PasswordException')throw new Error('暂不支持加密 PDF，请解密后重新选择。');throw new Error('PDF 无法读取，请检查文件是否完整。');}try{if(document.numPages>150)throw new Error('本地体验最多解析 150 页 PDF，请选择部分章节。');const pages=[],warnings=[];for(let n=1;n<=document.numPages;n++){const page=await document.getPage(n),content=await page.getTextContent();let text='',lastY=null;for(const item of content.items){if(!('str'in item))continue;const y=item.transform[5];if(lastY!==null&&Math.abs(y-lastY)>4)text+='\n';text+=item.str+(item.hasEOL?'\n':' ');lastY=y;}if(text.replace(/\s/g,'').length<20)warnings.push(`第 ${n} 页文本较少，可能是扫描页或图片页。`);pages.push(text);onProgress(n,document.numPages);page.cleanup();}return{text:pages.join('\n\n'),warnings,pages:document.numPages};}finally{await loadingTask.destroy();}}
 throw new Error('请选择 DOCX、PDF 或 UTF-8 TXT。旧 DOC 请先另存为 DOCX。');
}
