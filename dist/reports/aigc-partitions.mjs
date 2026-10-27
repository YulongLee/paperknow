import {originalParagraphs} from './report-locations.mjs';
export const AIGC_PARAGRAPH_VERSION='paragraph-v2';
export const MAX_AIGC_PARAGRAPHS=300;
export const MAX_AIGC_PARTS=400;
export const effectiveAigcCharacters=text=>Array.from(String(text)).filter(char=>/[\p{L}\p{N}]/u.test(char)).length;

// Exact code-point offsets and original separators are preserved. A paragraph
// is split only if its UTF-16 length exceeds the provider's input bound.
export function paragraphAigcParts(text,maxUnits=5000,maxParagraphs=MAX_AIGC_PARAGRAPHS){
 const chars=Array.from(text),paragraphs=originalParagraphs(text),parts=[];
 if(paragraphs.length>maxParagraphs)throw Object.assign(Error(`正文超过 ${maxParagraphs} 段，请分章节提交。`),{status:413});
 for(const [index,paragraph] of paragraphs.entries()){
  let start=index?paragraph.start:0,content='',end=start;
  const stop=paragraphs[index+1]?.start??chars.length;
  const append=()=>{if(!content)return;if(parts.length>=MAX_AIGC_PARTS)throw Object.assign(Error('正文分段过多，请按章节提交。'),{status:413});parts.push({index:parts.length,start,end,characters:end-start,paragraphNumber:paragraph.number,effectiveCharacters:effectiveAigcCharacters(content),content});start=end;content='';};
  for(let at=start;at<stop;at++){
   const char=chars[at];if(char.length>maxUnits)throw Object.assign(Error('正文包含超出当前处理范围的字符。'),{status:400});if(content.length+char.length>maxUnits)append();
   content+=char;end=at+1;
  }
  append();
 }
 if(!parts.some(part=>part.effectiveCharacters>0))throw Object.assign(Error('请提供包含正文文字的论文内容。'),{status:400});
 return {paragraphs:paragraphs.length,parts};
}
