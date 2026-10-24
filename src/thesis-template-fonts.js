import {decodeThesisTemplateXml} from './thesis-template-placement.js';
import fontkit from '@pdf-lib/fontkit';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const parse=s=>new DOMParser().parseFromString(s,'application/xml');
const xml=d=>new XMLSerializer().serializeToString(d).replace(/^(<\?xml[^?]*encoding\s*=\s*["'])utf-16(?:le|be)?(["'][^?]*\?>)/i,'$1UTF-8$2');
// A school sample often embeds only the few characters in that sample.
// Retaining that subset for new prose can render silent blanks. Never change
// the reference: detach incomplete bindings only in the generated package.
export async function repairIncompleteTemplateFonts(zip){
 const file=zip.file('word/fontTable.xml'),relsFile=zip.file('word/_rels/fontTable.xml.rels');if(!file||!relsFile)return [];
 const table=parse(decodeThesisTemplateXml(await file.async('uint8array'))),rels=parse(decodeThesisTemplateXml(await relsFile.async('uint8array'))),map=new Map([...rels.getElementsByTagName('*')].filter(n=>n.localName==='Relationship').map(n=>[n.getAttribute('Id'),n]));
 let text='';for(const entry of Object.values(zip.files))if(!entry.dir&&/^word\/(?:document|header\d*|footer\d*)\.xml$/.test(entry.name)){const doc=parse(decodeThesisTemplateXml(await entry.async('uint8array')));text+=[...doc.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('');}
 const needed=new Set([...text].map(c=>c.codePointAt(0)).filter(c=>c>=32&&c<=126||c>=0x3400&&c<=0x9fff)),removed=[];
 for(const font of table.getElementsByTagNameNS(W,'font'))for(const embed of [...font.childNodes].filter(n=>/^embed(?:Regular|Bold|Italic|BoldItalic)$/.test(n.localName))){
  const relation=map.get(embed.getAttributeNS(R,'id')),target=relation?.getAttribute('Target');if(!target||!/^(?:fonts\/)?[\w.-]+$/.test(target))continue;
  const part='word/'+target,entry=zip.file(part);if(!entry)continue;let bytes=await entry.async('uint8array');if(bytes.length<32||bytes.length>2*1024*1024)continue;
  const key=embed.getAttributeNS(W,'fontKey')?.replace(/[{}-]/g,'');if(/\.odttf$/i.test(part)){if(!/^[a-f\d]{32}$/i.test(key||''))continue;const mask=Uint8Array.from(key.match(/../g).reverse(),v=>parseInt(v,16));bytes=new Uint8Array(bytes);for(let i=0;i<32;i++)bytes[i]^=mask[i%16];}
  let coverage;try{coverage=fontkit.create(bytes).characterSet;}catch{continue;}if(!Array.isArray(coverage))continue;
  const set=new Set(coverage),hasCjk=coverage.some(c=>c>=0x3400&&c<=0x9fff),relevant=[...needed].filter(c=>hasCjk?c>=0x3400:c<127);
  if(!relevant.some(c=>!set.has(c)))continue;
  // Symbol fonts intentionally use a different character repertoire.
  if(/symbol|wingdings|webdings/i.test(font.getAttributeNS(W,'name')||''))continue;
  removed.push({font:font.getAttributeNS(W,'name'),reason:'embedded_subset_missing_characters'});font.removeChild(embed);
 }
 if(!removed.length)return [];
 // Remove only unreferenced font resources, never pictures/other package parts.
 const used=new Set([...table.getElementsByTagName('*')].flatMap(n=>[n.getAttributeNS(R,'id')]).filter(Boolean));
 for(const [id,relation]of map)if(!used.has(id)&&/\/font$/.test(relation.getAttribute('Type')||'')){const target=relation.getAttribute('Target');if(/^(?:fonts\/)?[\w.-]+$/.test(target))zip.remove('word/'+target);relation.parentNode.removeChild(relation);}
 zip.file('word/fontTable.xml',xml(table));zip.file('word/_rels/fontTable.xml.rels',xml(rels));
 const settings=zip.file('word/settings.xml');if(settings){const doc=parse(decodeThesisTemplateXml(await settings.async('uint8array')));for(const name of ['embedTrueTypeFonts','embedSystemFonts','saveSubsetFonts'])for(const n of [...doc.getElementsByTagNameNS(W,name)])n.parentNode.removeChild(n);zip.file('word/settings.xml',xml(doc));}
 const typesFile=zip.file('[Content_Types].xml');if(typesFile){const doc=parse(decodeThesisTemplateXml(await typesFile.async('uint8array')));for(const n of [...doc.getElementsByTagName('*')])if(n.localName==='Override'&&/font/i.test(n.getAttribute('ContentType')||'')&&!zip.file((n.getAttribute('PartName')||'').replace(/^\//,'')))n.parentNode.removeChild(n);zip.file('[Content_Types].xml',xml(doc));}
 return removed;
}
