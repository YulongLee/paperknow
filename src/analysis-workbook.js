// Browser-local XLSX reader. ExcelJS reads cached values and never evaluates formulas.
import ExcelJS from 'exceljs';
import {Unzip,UnzipInflate} from 'fflate';
import {analysisLimits,validateAnalysisDataset} from '../dist/workspace/data-analysis-model.mjs';
const fail=message=>{throw Error(message);};
const workbookLimits={expanded:40*1024*1024,entry:16*1024*1024,parts:1000,sheets:30};
function preflight(bytes){
 if(bytes.length>analysisLimits.bytes)fail('数据文件不能超过 10 MB，请拆分后上传。');
 if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)fail('不是有效的 XLSX 工作簿；旧版 XLS 请另存为 XLSX 或 UTF-8 CSV。');
 let expanded=0,parts=0,totalCells=0;const seen=new Set(),xmls=[];
 const unzip=new Unzip(file=>{
  if(++parts>workbookLimits.parts)fail('工作簿内部文件过多，请移除无关内容后重试。');
  const name=file.name.replaceAll('\\','/');if(name.startsWith('/')||name.split('/').includes('..')||seen.has(name))fail('工作簿内部结构无效或重复。');seen.add(name);
  if(/vbaProject\.bin|^xl\/(?:macrosheets|activeX)\//i.test(name))fail('不支持含宏或 ActiveX 的工作簿；请另存为不含宏的 XLSX。');
  if(file.originalSize>workbookLimits.entry)fail('工作簿内部内容过大，请拆分后重试。');
  const keep=/^(?:\[Content_Types\]\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(name),chunks=[];let size=0;
  file.ondata=(error,data,final)=>{if(error)throw error;size+=data.length;expanded+=data.length;if(size>workbookLimits.entry||expanded>workbookLimits.expanded){file.terminate();fail('工作簿解压内容超过安全读取上限，请拆分或移除无关内容。');}if(keep)chunks.push(data);if(final&&keep){const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}xmls.push([name,new TextDecoder('utf-8',{fatal:true}).decode(all)]);}};file.start();
 });unzip.register(UnzipInflate);
 for(let offset=0;offset<bytes.length;offset+=4096)unzip.push(bytes.subarray(offset,offset+4096),offset+4096>=bytes.length);
 if(!seen.has('[Content_Types].xml')||!seen.has('xl/workbook.xml'))fail('工作簿缺少必要的 XLSX 内容。');
 for(const [name,xml]of xmls){if(name==='[Content_Types].xml'){if(/macroEnabled|vbaProject/i.test(xml))fail('不支持含宏的工作簿。');continue;}
  for(const match of xml.matchAll(/<row\b[^>]*\br=["'](\d+)["']/g))if(Number(match[1])>analysisLimits.rows+1)fail('工作簿任一工作表最多支持 10,000 行数据，请移除多余行或格式。');
  for(const match of xml.matchAll(/<c\b[^>]*\br=["']([A-Za-z]+)(\d+)["']/g)){let column=0;for(const c of match[1].toUpperCase())column=column*26+c.charCodeAt(0)-64;if(column>analysisLimits.columns||Number(match[2])>analysisLimits.rows+1)fail('工作簿任一工作表最多支持 10,000 行、60 列，请拆分后上传。');if(++totalCells>analysisLimits.cells+analysisLimits.columns*workbookLimits.sheets)fail('工作簿单元格总数过多，请仅保留需要分析的工作表。');}
 }
}
function cellText(cell){
 let value=cell.value;
 if(value&&typeof value==='object'&&('formula'in value||'sharedFormula'in value)){if(cell.result===undefined||cell.result===null)fail(`单元格 ${cell.address} 的公式没有缓存结果；请在 Excel 中重新计算并保存后导入。`);value=cell.result;}
 if(value===null||value===undefined)return '';
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))fail(`单元格 ${cell.address} 的日期无效。`);return value.toISOString();}
 if(typeof value==='number'){if(!Number.isFinite(value))fail(`单元格 ${cell.address} 不是有限数值。`);return String(value);}
 if(typeof value==='boolean')return value?'TRUE':'FALSE';
 if(typeof value==='string')return value;
 if(value?.error)fail(`单元格 ${cell.address} 含有 Excel 错误 ${value.error}，请修正后导入。`);
 if(Array.isArray(value?.richText))return value.richText.map(part=>part.text||'').join('');
 if(typeof value?.text==='string')return value.text; // Hyperlink labels only; never open links.
 fail(`单元格 ${cell.address} 的类型不支持，请转换为普通文本或数值。`);
}
export async function readAnalysisWorkbook(buffer,{fileName='数据.xlsx'}={}){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);if(!/\.xlsx$/i.test(fileName))fail('仅支持不含宏的 XLSX；XLS/XLSM 请另存为 XLSX 或 CSV。');
 try{preflight(bytes);}catch(error){if(error.message?.includes('工作簿')||error.message?.includes('XLSX')||error.message?.includes('10 MB'))throw error;fail('工作簿压缩内容损坏或编码不受支持，请另存为新的 XLSX。');}
 const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(bytes);}catch{fail('工作簿无法读取，请确认未加密并另存为标准 XLSX。');}
 if(!workbook.worksheets.length||workbook.worksheets.length>workbookLimits.sheets)fail('工作簿需包含 1～30 个工作表。');
 const sheets=workbook.worksheets.map(sheet=>({id:String(sheet.id),name:sheet.name,hidden:sheet.state!=='visible',rows:Math.max(0,sheet.rowCount-1),columns:sheet.columnCount}));
 return{sheets,select(sheetId){const sheet=workbook.worksheets.find(item=>String(item.id)===String(sheetId));if(!sheet)fail('请选择工作簿中的一个工作表。');if(sheet.model.merges?.length)fail('所选工作表包含合并单元格，请先取消合并并补齐每行数据。');if(sheet.rowCount>analysisLimits.rows+1||sheet.columnCount>analysisLimits.columns)fail('所选工作表超过 10,000 行或 60 列上限。');if(sheet.rowCount<2)fail('工作表需要首行列名和至少 1 行数据。');
  const width=sheet.columnCount,headers=Array.from({length:width},(_,i)=>cellText(sheet.getRow(1).getCell(i+1)).trim()),rows=[];let skipped=0;
  for(let r=2;r<=sheet.rowCount;r++){const row=sheet.getRow(r);if(!row.hasValues){skipped++;continue;}rows.push(Array.from({length:width},(_,i)=>cellText(row.getCell(i+1))));}
  const dataset=validateAnalysisDataset({version:1,headers,rows,fileName:String(fileName).slice(0,255),sheetName:sheet.name,delimiter:'xlsx',importNotes:'XLSX：首行列名；数值使用底层值，不保留显示格式或前导零；日期转换为 UTC ISO 文本，布尔值为 TRUE/FALSE 分类文本；公式仅使用文件内缓存值，不重新计算；隐藏行列照常导入；跳过 '+skipped+' 个空白行。'});return dataset;
 }};
}
