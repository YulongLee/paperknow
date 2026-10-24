import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
const run=promisify(execFile),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const frequencies=value=>{const counts=new Map();for(const c of value)if(/[\u3400-\u9fff]/u.test(c))counts.set(c,(counts.get(c)||0)+1);return counts;};
export function compareRenderedThesisText(expected,actual){
 const source=frequencies(expected),rendered=frequencies(actual),total=[...source.values()].reduce((a,b)=>a+b,0),missing=[...source].reduce((sum,[c,count])=>sum+Math.max(0,count-(rendered.get(c)||0)),0);
 return {status:total>=50&&missing/total>0.015?'failed':'passed',sourceCharacters:total,missingCharacters:missing,textCoverage:total?Math.max(0,1-missing/total):1};
}
// Read only the locally generated PDF. Bounds/character checks are evidence,
// not a claim of visual approval. No page is sent to an external service.
export async function checkRenderedThesisPages({bytes,workspace,signal,extract=run}={}){
 const zip=await JSZip.loadAsync(bytes),document=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
 const expected=[...document.getElementsByTagNameNS(W,'t')].filter(node=>{for(let p=node.parentNode;p;p=p.parentNode)if(p.namespaceURI===W&&['del','moveFrom'].includes(p.localName))return false;return true;}).map(n=>n.textContent).join('');
 const {stdout}=await extract('/usr/bin/pdftotext',['-bbox-layout','-enc','UTF-8',workspace+'/output/document.pdf','-'],{cwd:workspace,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},shell:false,signal,timeout:15000,maxBuffer:10*1024*1024});
 const xml=new DOMParser({onError:()=>{throw Error('invalid page evidence');}}).parseFromString(stdout,'application/xml'),pages=[...xml.getElementsByTagName('page')];if(!pages.length||pages.length>1000)throw Error('invalid page evidence');
 let overflow=0;for(const page of pages){const width=Number(page.getAttribute('width')),height=Number(page.getAttribute('height'));if(!(width>0&&height>0))throw Error('invalid page size');for(const word of page.getElementsByTagName('word')){const [left,top,right,bottom]=['xMin','yMin','xMax','yMax'].map(k=>Number(word.getAttribute(k)));if([left,top,right,bottom].some(n=>!Number.isFinite(n))||left< -2||top< -2||right>width+2||bottom>height+2)overflow++;}}
 const text=pages.map(page=>[...page.getElementsByTagName('word')].map(n=>n.textContent).join('')).join(''),coverage=compareRenderedThesisText(expected,text);
 return {...coverage,status:overflow||coverage.status==='failed'?'failed':'passed',pages:pages.length,overflowItems:overflow};
}
