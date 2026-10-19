import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {PDFDocument,PDFName} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createWritingDocx,createWritingPdf} from '../src/writing-document.js';

const wordNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main',mathNS='http://schemas.openxmlformats.org/officeDocument/2006/math';
const output=new URL('../outputs/writing-parity-20261019/native-export/',import.meta.url);
async function word(text){const bytes=await createWritingDocx(text),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser({onError:()=>assert.fail('invalid generated XML')}).parseFromString(xml,'application/xml');return{bytes,zip,xml,doc};}
const nodes=(doc,name,ns=wordNS)=>[...doc.getElementsByTagNameNS(ns,name)],words=doc=>nodes(doc,'t').map(node=>node.textContent).join('\n');
const fixture=String.raw`研究写作导出验收
第一章 模型与结果
正文中的可编辑公式 \(\frac{a+b}{\sqrt{x}}\) 和 $E=mc^2$ 应与文字共存。
| 指标 | 数值 | 解释 |
| :--- | ---: | :---: |
| 阅读频率 | 12.50 | 完整文字，不应截断。 |
| 绝对值 | $|x|$ | 转义管道 a\|b 与代码 ${'`a|b`'} |
| 比较关系 | $a<b$ | <script>文本应被转义</script> |

$$
\sum_{k=1}^{n}k=\frac{n(n+1)}{2}
$$
最终完整内容标记`;

test('generated Markdown tables become native editable Word cells with header, alignment and inline equations',async()=>{
 const value=await word(fixture),tables=nodes(value.doc,'tbl');assert.equal(tables.length,1);assert.equal(nodes(value.doc,'tr').length,4);assert.equal(nodes(value.doc,'tc').length,12);assert.equal(nodes(value.doc,'tblHeader').length,1);assert.equal(nodes(value.doc,'trHeight').length,0,'rows must grow to retain all text');assert.match(value.xml,/<w:jc w:val="right"/);assert.equal(nodes(value.doc,'oMath',mathNS).length,4);assert.ok(nodes(value.doc,'f',mathNS).length>=2);assert.equal(nodes(value.doc,'rad',mathNS).length,1);assert.equal(nodes(value.doc,'oMathPara',mathNS).length,1);assert.match(words(value.doc),/a\|b/);assert.match(words(value.doc),/\$\|x\|\$/,'unverified native fences retain their original TeX');assert.match(words(value.doc),/<script>文本应被转义<\/script>/);assert.match(words(value.doc),/最终完整内容标记/);assert.equal(nodes(value.doc,'script').length,0);assert.equal(value.zip.file('word/media/image1.png'),null,'equations must be native OMML, not images');assert.doesNotMatch(value.xml,/w:val="exact"/);
 await mkdir(output,{recursive:true});await writeFile(new URL('native-structure.docx',output),value.bytes);
});

test('unrecognized tables, unsupported math, currency, and fenced code retain literal source without external resources',async()=>{
 const source=String.raw`原文保留验收
金额 $5 and $10，转义美元 \$20。
未闭合 $x+1 与 \(x+2。
| 字段 | 值 |
| -- | --- |
| 保留 | 不属于支持的表格 |
${'```text'}
| 代码 | 原样 |
| --- | --- |
| $x^2$ | \(a+b\) |
${'```'}
恶意公式 $\href{https://example.test/secret}{x}$ 保留源文本。
无效公式 $\frac{a}{$ 最后标记`;
 const value=await word(source);assert.equal(nodes(value.doc,'tbl').length,0);assert.equal(nodes(value.doc,'oMath',mathNS).length,0);assert.equal(nodes(value.doc,'p').map(p=>nodes(p,'t').map(node=>node.textContent).join('')).join('\n'),source);for(const name of Object.keys(value.zip.files).filter(name=>name.endsWith('.rels')))assert.doesNotMatch(await value.zip.file(name).async('string'),/TargetMode="External"|https:\/\/example/);
});

test('aligned display equations and matrix contents become editable Word math while adjacent prose survives',async()=>{
 const value=await word(String.raw`多行公式
\[
\begin{aligned}
x&=a+b\\
y&=\frac{1}{2}
\end{aligned}
\]
矩阵 $\begin{pmatrix}1&2\\3&4\end{pmatrix}$ 之后仍有说明。
最终标记`);assert.equal(nodes(value.doc,'oMath',mathNS).length,2);assert.equal(nodes(value.doc,'eqArr',mathNS).length,1);assert.equal(nodes(value.doc,'m',mathNS).length,1);assert.match(words(value.doc),/之后仍有说明。/);assert.match(words(value.doc),/最终标记/);await mkdir(output,{recursive:true});await writeFile(new URL('native-multiline.docx',output),value.bytes);
});

test('PDF tables paginate with repeating headers, split oversized rows without clipping, and keep complete TeX fallback',async()=>{
 const font=await readFile(new URL('../dist/workspace/assets/fonts/NotoSansSC-Regular.otf',import.meta.url)),rows=Array.from({length:65},(_,index)=>`| ROW-${String(index).padStart(3,'0')} | ${index}.25 | 真实记录说明 ${index}，保留完整内容。 |`),long='长单元格内容'.repeat(400),formula=String.raw`\[\sum_{k=1}^{n}k=\frac{n(n+1)}{2}\]`,source=['分页表格验收','| RECORD | VALUE | DESCRIPTION |','| --- | ---: | --- |',...rows,`| OVERSIZED-START | 99 | ${long} OVERSIZED-END |`,formula,'最终导出完整标记'].join('\n'),bytes=await createWritingPdf(source,font),task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false}),pdf=await task.promise;let extracted='',headers=0,longExtracted='',collectLong=false;
 try{assert.ok(pdf.numPages>=6);for(let index=1;index<=pdf.numPages;index++){const page=await pdf.getPage(index),items=(await page.getTextContent()).items;extracted+=items.map(item=>item.str).join('');for(const item of items){if(item.str==='OVERSIZED-START')collectLong=true;else if(collectLong&&/^[长单元格内容\s]*(?:OVERSIZED-END)?$/.test(item.str)){longExtracted+=item.str.replace('OVERSIZED-END','').replace(/\s/g,'');if(item.str.includes('OVERSIZED-END'))collectLong=false;}}headers+=items.filter(item=>item.str==='RECORD').length;for(const item of items)if(item.str&&item.transform[5]>50){assert.ok(item.transform[4]>=62&&item.transform[4]+item.width<=533.5,`text exceeds horizontal page margin: ${item.str}`);assert.ok(item.transform[5]>=64&&item.transform[5]<=790,`text exceeds vertical page margin: ${item.str}`);}}
 for(let index=0;index<65;index++)assert.equal(extracted.split('ROW-'+String(index).padStart(3,'0')).length-1,1,'every real row must appear exactly once');assert.ok(headers>=3,'table headers repeat across pages');assert.match(extracted,/OVERSIZED-START/);assert.match(extracted,/OVERSIZED-END/);assert.equal(longExtracted,long,'every character of the oversized cell must survive all page breaks');assert.ok(extracted.includes(formula));assert.match(extracted,/最终导出完整标记/);
 const parsed=await PDFDocument.load(bytes);assert.equal(parsed.catalog.has(PDFName.of('OpenAction')),false);assert.equal(parsed.catalog.has(PDFName.of('AA')),false);await mkdir(output,{recursive:true});await writeFile(new URL('native-table.pdf',output),bytes);
 }finally{await task.destroy();}
});
