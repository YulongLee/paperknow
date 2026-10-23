import {XMLSerializer} from '@xmldom/xmldom';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P='http://schemas.openxmlformats.org/package/2006/relationships';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const V='urn:schemas-microsoft-com:vml';
const elements=node=>[...node.childNodes].filter(child=>child.nodeType===1);
const isWord=(node,name)=>node?.namespaceURI===W&&node.localName===name;

function pictureInstruction(instruction){
 if(typeof instruction!=='string'||instruction.length>8192)return false;
 const tokens=[];let end=0;
 for(const match of instruction.matchAll(/"((?:[^"\\]|\\.)*)"|([^\s"]+)/g)){
  if(instruction.slice(end,match.index).trim())return false;
  tokens.push(match[1]===undefined?match[2]:match[1]);end=match.index+match[0].length;
 }
 if(instruction.slice(end).trim()||tokens.shift()?.toUpperCase()!=='INCLUDEPICTURE')return false;
 let target;
 for(let index=0;index<tokens.length;index++){
  const token=tokens[index],flag=token.toLowerCase();
  if(flag==='\\d')continue;
  if(flag==='\\*'){
   if(!/^(?:MERGEFORMAT|MERGEFORMATINET|CHARFORMAT)$/i.test(tokens[++index]||''))return false;
   continue;
  }
  if(flag==='\\c'){
   if(!/^[\p{L}\p{N} ._-]{1,100}$/u.test(tokens[++index]||''))return false;
   continue;
  }
  if(token.startsWith('\\')||target!==undefined)return false;target=token;
 }
 return Boolean(target&&target.length<=2000&&!/[\u0000-\u001f\u007f]/.test(target));
}

function internalPart(part,target){
 if(!target||/[\\?#\u0000-\u001f\u007f]|^[a-z][a-z\d+.-]*:|^\/\//i.test(target))return '';
 const pieces=target.startsWith('/')?[]:part.split('/').slice(0,-1);
 for(const piece of target.split('/')){
  if(!piece||piece==='.')continue;
  if(piece==='..'){if(!pieces.length)return '';pieces.pop();}else pieces.push(piece);
 }
 return pieces.join('/');
}

function cachedImage(nodes,part,docs,zip){
 const split=part.lastIndexOf('/'),relationPart=(split<0?'':part.slice(0,split+1))+'_rels/'+part.slice(split+1)+'.rels';
 const relations=docs.get(relationPart);if(!relations)return false;
 const map=new Map();
 for(const node of relations.getElementsByTagNameNS(P,'Relationship')){
  const id=node.getAttribute('Id');if(map.has(id))return false;map.set(id,node);
 }
 let images=0;
 for(const root of nodes){
  const descendants=root.nodeType===1?[root,...root.getElementsByTagName('*')]:[];
  for(const node of descendants){
   if(node.namespaceURI===W&&['fldChar','instrText','fldSimple','object','altChunk','subDoc'].includes(node.localName))return false;
   // Reject raw image URLs as well as relationship-backed external image links.
   if([...node.attributes].some(attribute=>['src','href'].includes(attribute.localName.toLowerCase())||attribute.namespaceURI===R&&attribute.localName==='link'))return false;
   const drawing=node.namespaceURI===A&&node.localName==='blip',vml=node.namespaceURI===V&&node.localName==='imagedata';
   if(!drawing&&!vml)continue;
   const id=node.getAttributeNS(R,drawing?'embed':'id'),relation=map.get(id);
   if(!id||!relation||relation.getAttribute('Type')!==R+'/image'||relation.getAttribute('TargetMode')==='External')return false;
   const target=internalPart(part,relation.getAttribute('Target'));
   if(!/\.(?:png|jpe?g|gif|bmp|tiff?|emf|wmf)$/i.test(target)||!zip.file(target))return false;
   images++;
  }
 }
 return images>0;
}

function marker(node){
 if(!isWord(node,'r'))return null;
 const children=elements(node),fields=children.filter(child=>isWord(child,'fldChar'));
 if(fields.length!==1||children.some(child=>!isWord(child,'rPr')&&!isWord(child,'fldChar')))return null;
 const type=fields[0].getAttributeNS(W,'fldCharType');return ['begin','separate','end'].includes(type)?type:null;
}
function instructionRun(node){
 if(!isWord(node,'r'))return null;
 const children=elements(node),instructions=children.filter(child=>isWord(child,'instrText'));
 if(!instructions.length||children.some(child=>!isWord(child,'rPr')&&!isWord(child,'instrText')))return null;
 return instructions.map(child=>child.textContent).join('');
}
function unambiguousParagraph(paragraph){
 const children=elements(paragraph),types=children.map(marker),seen=types.filter(Boolean).length;
 if(seen!==paragraph.getElementsByTagNameNS(W,'fldChar').length)return false;
 const stack=[];
 for(const type of types){
  if(type==='begin')stack.push(false);
  else if(type==='separate'){if(!stack.length||stack.at(-1))return false;stack[stack.length-1]=true;}
  else if(type==='end'){if(!stack.length)return false;stack.pop();}
 }
 return stack.length===0;
}
function nestedSimple(field){
 for(let parent=field.parentNode;parent;parent=parent.parentNode){
  if(isWord(parent,'fldSimple'))return true;
  if(isWord(parent,'p')&&parent.getElementsByTagNameNS(W,'fldChar').length)return true;
 }
 return false;
}
function crossFieldParagraphs(document){
 const blocked=new Set(),stack=[];
 for(const node of document.getElementsByTagName('*')){
  if(isWord(node,'p')&&stack.length)blocked.add(node);
  if(!isWord(node,'fldChar'))continue;
  const type=node.getAttributeNS(W,'fldCharType');
  if(type==='begin')stack.push(node);else if(type==='end'&&stack.length)stack.pop();
 }
 return blocked;
}

/**
 * Called only after package paths, relationships and XML have been validated.
 * Retain the already embedded result of a simple, complete INCLUDEPICTURE field;
 * never resolve or fetch its old source path. Ambiguous fields remain unchanged.
 */
export function staticizeCachedPictureFields(docs,zip){
 let total=0;
 for(const [part,document]of docs){
  if(!part.endsWith('.xml'))continue;let changed=0;const crossed=crossFieldParagraphs(document);
  for(const field of [...document.getElementsByTagNameNS(W,'fldSimple')]){
   if(!isWord(field.parentNode,'p')||crossed.has(field.parentNode)||nestedSimple(field)||!pictureInstruction(field.getAttributeNS(W,'instr')))continue;
   const children=[...field.childNodes];if(!cachedImage(children,part,docs,zip))continue;
   while(field.firstChild)field.parentNode.insertBefore(field.firstChild,field);
   field.parentNode.removeChild(field);changed++;
  }
  for(const paragraph of [...document.getElementsByTagNameNS(W,'p')]){
   if(crossed.has(paragraph)||!unambiguousParagraph(paragraph))continue;
   const children=elements(paragraph);let field=null,depth=0;
   for(let index=0;index<children.length;index++){
    const node=children[index],type=marker(node);
    if(type==='begin'){
     if(field){field.ambiguous=true;depth++;}else{field={begin:index,separate:null,ambiguous:false};depth=1;}
    }else if(type==='separate'&&field){
     if(depth!==1||field.separate!==null)field.ambiguous=true;else field.separate=index;
    }else if(type==='end'&&field){
     if(--depth!==0)continue;
     const current=field;field=null;
     if(current.ambiguous||current.separate===null)continue;
     const code=children.slice(current.begin+1,current.separate),instructions=code.map(instructionRun);
     if(instructions.some(value=>value===null)||!pictureInstruction(instructions.join('')))continue;
     const result=children.slice(current.separate+1,index);
     if(!cachedImage(result,part,docs,zip))continue;
     for(const removed of [children[current.begin],...code,children[current.separate],node])paragraph.removeChild(removed);
     changed++;
    }else if(field&&node.getElementsByTagNameNS(W,'fldChar').length){field.ambiguous=true;}
   }
  }
  if(changed){
   // DOM serialization is UTF-8 in the new ZIP, including originally UTF-16 parts.
   const serialized=new XMLSerializer().serializeToString(document).replace(/^\uFEFF/,'').replace(/^(<\?xml\b[^?]*?)\bencoding\s*=\s*(["'])[^"']+\2/i,'$1encoding="UTF-8"');
   zip.file(part,serialized);total+=changed;
  }
 }
 return total;
}
