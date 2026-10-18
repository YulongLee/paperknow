/** arXiv links are derived from an identifier, never trusted provider HTML. */
export function arxivIdentifier(value){
 const id=String(value??'').trim().replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i,'').replace(/\.pdf$/i,'');
 return /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v[1-9]\d*)?$/i.test(id)?id:'';
}
export const arxivBaseIdentifier=value=>arxivIdentifier(value).replace(/v[1-9]\d*$/i,'');
function date(value){
 const text=String(value??'');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text))return '';
 const time=Date.parse(text);if(!Number.isFinite(time))return '';const iso=new Date(time).toISOString();return iso.slice(0,10)===text.slice(0,10)?iso:'';
}
export function arxivMetadata(input={}){
 if(input.source!=='arxiv')return {};
 const arxivId=arxivIdentifier(input.arxivId||input.sourceId),base=arxivBaseIdentifier(arxivId),url=arxivId?'https://arxiv.org/abs/'+arxivId:'',pdfUrl=arxivId?'https://arxiv.org/pdf/'+arxivId:'';
 return {source:'arxiv',sourceId:base,arxivId,url,pdfUrl,fullTextUrl:pdfUrl,type:'preprint',openAccess:true,publishedDate:date(input.publishedDate),updatedDate:date(input.updatedDate),categories:[...new Set((Array.isArray(input.categories)?input.categories:[]).filter(value=>typeof value==='string'&&/^[a-z][a-z0-9.-]{0,40}$/i.test(value)))].slice(0,12)};
}
