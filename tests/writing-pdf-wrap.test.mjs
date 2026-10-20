import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createWritingPdf} from '../src/writing-document.js';

test('real PDF wraps whole English words and preserves long identifiers and Chinese across bounded pages',async()=>{
 const sentence='This synthetic study includes complete English source descriptions and scientific observations without inventing research claims. Preserve every original character and measurement. ',english=sentence.repeat(14),identifier='ScientificIdentifier0123456789'.repeat(80),chinese='连续中文应当逐字完整保留并跨行分页，研究数据和引用顺序不能因导出而改变。'.repeat(110),source=['Scientific PDF wrapping verification','ENGLISHBEGIN',english,'ENGLISHEND','LONGTOKENBEGIN',identifier,'LONGTOKENEND','CHINESEBEGIN',chinese,'CHINESEEND'].join('\n'),words=new Set(english.match(/[A-Za-z]+/g)),font=await readFile(new URL('../dist/workspace/assets/fonts/NotoSansSC-Regular.otf',import.meta.url)),bytes=await createWritingPdf(source,font),task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false}),pdf=await task.promise;
 let extracted='',phase='',englishLines=0,identifierLines=0,chineseLines=0,maximumRight=0;
 try{
  assert.ok(pdf.numPages>=3,'actual long mixed content must paginate');
  for(let index=1;index<=pdf.numPages;index++){
   const page=await pdf.getPage(index),items=(await page.getTextContent()).items.filter(item=>item.str&&item.transform[5]>50),lines=new Map();
   for(const item of items){const [x,y]=item.transform.slice(4),key=Math.round(y*100);assert.ok(x>=62.9&&x+item.width<=533.5,`page ${index} exceeds horizontal margins`);assert.ok(y>=64&&y<=790,`page ${index} exceeds vertical margins`);maximumRight=Math.max(maximumRight,x+item.width);const row=lines.get(key)||[];row.push(item);lines.set(key,row);}
   for(const [,items]of [...lines].sort(([a],[b])=>b-a)){
    const line=items.sort((a,b)=>a.transform[4]-b.transform[4]).map(item=>item.str).join('');extracted+=line;
    if(line==='ENGLISHBEGIN'){phase='english';continue;}if(line==='LONGTOKENBEGIN'){phase='identifier';continue;}if(line==='CHINESEBEGIN'){phase='chinese';continue;}if(['ENGLISHEND','LONGTOKENEND','CHINESEEND'].includes(line)){phase='';continue;}
    if(phase==='english'){englishLines++;for(const word of line.match(/[A-Za-z]+/g)||[])assert.ok(words.has(word),`a word was split across PDF lines: ${word}`);}
    if(phase==='identifier')identifierLines++;if(phase==='chinese')chineseLines++;
   }
  }
  assert.equal(extracted.replace(/\s/gu,''),source.replace(/\s/gu,''),'extraction must preserve every nonwhitespace character in original order');assert.ok(englishLines>10);assert.ok(identifierLines>10,'a wider-than-page token must split rather than overflow');assert.ok(chineseLines>30,'continuous Chinese must retain character wrapping');
  const output=new URL('../outputs/revision-parity-20261020/pdf-wrap/',import.meta.url);await mkdir(output,{recursive:true});await writeFile(new URL('regression.pdf',output),bytes);await writeFile(new URL('verification.json',output),JSON.stringify({pages:pdf.numPages,englishLines,identifierLines,chineseLines,maximumRight,originalCharacters:source.replace(/\s/gu,'').length,extractedCharacters:extracted.replace(/\s/gu,'').length,allCharactersPreserved:true,englishWordsIntact:true,allTextInsideMargins:true},null,2)+'\n');
 }finally{await task.destroy();}
});
