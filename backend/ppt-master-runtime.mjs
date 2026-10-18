import {spawn} from 'node:child_process';
import {accessSync, constants, readFileSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DOMParser, XMLSerializer} from '@xmldom/xmldom';
import JSZip from 'jszip';

const here=path.dirname(fileURLToPath(import.meta.url));
export const PPT_MASTER_COMMIT='b113d23720260c411ee47b2b05a73615f954deeb';
export const PPT_MASTER_REVISION=PPT_MASTER_COMMIT;
export const PPT_MASTER_MAX_OUTPUT_BYTES=20*1024*1024;
const vendorRoot=path.join(here,'vendor/ppt-master');
const helperPath=path.join(here,'ppt-master-compile.py');
const SVG_NS='http://www.w3.org/2000/svg';
const DML_NS='http://schemas.openxmlformats.org/drawingml/2006/main';
const PML_NS='http://schemas.openxmlformats.org/presentationml/2006/main';
const REL_NS='http://schemas.openxmlformats.org/package/2006/relationships';
const tags=new Set(['svg','g','rect','circle','ellipse','line','polyline','polygon','path','text','tspan']);
const common=new Set(['id','fill','stroke','fill-opacity','stroke-opacity','opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline','xml:space','data-pptx-role']);
const geometry={svg:new Set(['xmlns','width','height','viewBox','data-pptx-page-role']),g:new Set(['data-pptx-bounds','data-pptx-role']),rect:new Set(['x','y','width','height','rx','ry']),circle:new Set(['cx','cy','r']),ellipse:new Set(['cx','cy','rx','ry']),line:new Set(['x1','y1','x2','y2']),polyline:new Set(['points']),polygon:new Set(['points']),path:new Set(['d']),text:new Set(['x','y','dx','dy']),tspan:new Set(['x','y','dx','dy'])};
const fontFamilies=new Set(['Arial','Calibri','Aptos','Microsoft YaHei','Noto Sans CJK SC','Noto Sans SC','sans-serif']);
const numberPattern=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status,pptMasterSafe:true});
const svgPublicMessage='演示页面未通过安全校验，请重新生成';
// Diagnostic names are constants, never arbitrary model-supplied identifiers.
const diagnosticTags=new Set([...tags,'script','image','foreignObject','use','defs','style','a','filter','clipPath','mask','pattern','linearGradient','radialGradient','animate','symbol','title','desc']);
const diagnosticAttributes=new Set([...common,...Object.values(geometry).flatMap(value=>[...value]),'style','transform','class','href','xlink:href','xmlns:xlink','filter','clip-path','mask','visibility','display','stroke-miterlimit','letter-spacing','preserveAspectRatio','alignment-baseline','aria-label','role']);
const svgRules={
  input_type:'svg 必须是完整的 SVG 字符串。',svg_size:'单页 SVG 不得超过 256 KiB；减少装饰或路径节点。',
  xml_declaration:'只提交 SVG 根元素；删除 XML 声明、DOCTYPE、实体声明和处理指令。',xml_syntax:'SVG 必须是可解析的严格 XML；检查标签闭合、重复属性和字符转义。',xml_control:'删除 XML 不允许的控制字符。',
  root_tag:'根元素必须是 svg，且整页只能有一个根元素。',canvas:'根 svg 必须含 viewBox="0 0 1280 720"。',namespace:'所有元素必须使用默认 SVG 命名空间；不要命名空间前缀或外来命名空间。',
  node_depth:'SVG 嵌套深度不得超过 24；减少嵌套分组。',node_count:'单页最多 1800 个节点（含空白文本节点）；精简元素和空白。',
  text_placement:'可见文字只能放在 text 或 tspan 元素内。',text_size:'单页全部文本节点合计不得超过 20000 个字符。',
  node_kind:'只允许 SVG 元素与普通文本节点；删除注释、CDATA 和其他节点。',nested_svg:'仅根元素可为 svg；内部使用 g 分组。',
  tspan_placement:'tspan 必须位于 text 或另一个 tspan 内。',text_child:'text 和 tspan 内部只能包含普通文本或 tspan。',
  unsupported_element:'只可使用 svg/g/rect/circle/ellipse/line/polyline/polygon/path/text/tspan；删除其他元素。',
  unsupported_attribute:'此元素不支持该属性；使用受支持的显式 SVG 属性，删除 CSS、变换、链接和外部资源属性。',
  attribute_size:'单个属性值不得超过 24000 个字符；路径 d 另有 20000 字符上限。',
  attribute_value:'属性值不符合受支持的 SVG 子集。',duplicate_id:'id 必须全页唯一；修改重复的 id，勿改动文字内容。',
  root_siblings:'根 svg 外不能有声明、注释、其他元素或非空白文本。',editable_text_required:'页面必须包含至少一个可编辑的 text 元素。',
};
function attributeConstraint(tag,name){
  if(name==='xmlns')return 'xmlns 必须是标准的默认 SVG 命名空间。';
  if(name==='viewBox')return svgRules.canvas;
  if(name==='data-pptx-page-role')return '只能为 cover/toc/section/content/ending。';
  if(name==='data-pptx-role')return '只能为 background/decoration/footer/page-number/header。';
  if(name==='data-pptx-bounds')return '仅可放在 g 上；必须是 4 个不带单位的有限数值，绝对值不超过 10000。';
  if(name==='id')return '必须以英文字母开头，仅含英文字母、数字、下划线或连字符，长度 1～96。';
  if(name==='fill'||name==='stroke')return '只接受 #RGB、#RRGGBB 或 none；不能用颜色名称、rgb()、rgba() 或 url()。';
  if(['fill-opacity','stroke-opacity','opacity'].includes(name))return '必须是不带单位的 0～1 有限数值，不能用百分比。';
  if(name==='stroke-width')return '必须是不带单位的 0～80 有限数值。';
  if(name==='stroke-linecap')return '只能为 butt/round/square。';
  if(name==='stroke-linejoin')return '只能为 miter/round/bevel。';
  if(name==='stroke-dasharray')return '只能为 none 或最多 32 个 0～1000 的有限数值。';
  if(name==='font-family')return '只能填写一个受支持字体：'+[...fontFamilies].join(' / ')+'；不能填写字体列表或字体地址。';
  if(name==='font-size')return '必须是不带 px、pt 或百分号的 8～160 有限数值。';
  if(name==='font-weight')return '只能为 normal/bold，或 100～900 的整百数。';
  if(name==='font-style')return '只能为 normal/italic。';
  if(name==='text-anchor')return '只能为 start/middle/end。';
  if(name==='dominant-baseline')return '只能为 auto/middle/central/hanging/alphabetic。';
  if(name==='xml:space')return '只能为 preserve。';
  if(name==='points')return '必须是偶数个坐标数值，最多 600 个，均为绝对值不超过 10000 的有限数值。';
  if(name==='d')return '路径须以 M/m 开始，仅用 M/L/H/V/C/S/Q/T/A/Z 及数字；参数数量须正确，数值绝对值≤10000，弧线标志只能为 0/1，最多 3000 个标记及 20000 个字符。';
  if(tag==='svg'&&(name==='width'||name==='height'))return '根 svg 的 width 如有填写必须为 1280，height 必须为 720，均不带单位。';
  if(['width','height','rx','ry','r'].includes(name))return '必须是不带单位的 0～2560 有限数值。';
  return '必须是不带单位且绝对值不超过 10000 的有限数值。';
}
const invalid=(category='generic',{tag,attribute}={})=>{
  const rule=svgRules[category];
  const safeTag=diagnosticTags.has(tag)?tag:undefined,safeAttribute=diagnosticAttributes.has(attribute)?attribute:undefined;
  const constraint=(category==='attribute_value'||category==='unsupported_attribute'&&safeAttribute==='data-pptx-bounds')&&safeAttribute?attributeConstraint(safeTag,safeAttribute):rule;
  const location=[safeTag,safeAttribute].filter(Boolean).join('.');
  return Object.assign(fail('ppt_master_svg_invalid',constraint?'演示页面校验失败'+(location?'（'+location+'）':'')+'：'+constraint:svgPublicMessage),{publicMessage:svgPublicMessage,...(rule?{svgValidation:{category,...(safeTag?{tag:safeTag}:{}),...(safeAttribute?{attribute:safeAttribute}:{}),constraint}}:{})});
};
const cancelled=()=>fail('ppt_master_cancelled','本次演示文稿生成已停止',499);
const packageInvalid=()=>fail('ppt_master_package_invalid','演示文稿未通过导出校验，请重新生成');

function parseXML(value,error=invalid){
  if(typeof value!=='string')throw error('input_type');
  if(/<!DOCTYPE|<!ENTITY|<\?/i.test(value))throw error('xml_declaration');
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw error('xml_control');
  try{
    const doc=new DOMParser({onError(){throw error('xml_syntax');}}).parseFromString(value,'application/xml');
    if(!doc.documentElement||doc.doctype)throw error('xml_syntax');
    return doc;
  }catch{throw error('xml_syntax');}
}
function numeric(value,min=-10000,max=10000){return numberPattern.test(value)&&Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;}
function numericList(value,maxCount,min=-10000,max=10000){const parts=value.trim().split(/[\s,]+/);return parts.length>0&&parts.length<=maxCount&&parts.every(n=>numeric(n,min,max));}
function pathData(value){
  const tokenPattern=/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi;
  const tokens=value.match(tokenPattern)||[],arity={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
  if(value.length>20000||tokens.length>3000||!/^m$/i.test(tokens[0]||'')||value.replace(tokenPattern,'').replace(/[\s,]/g,''))return false;
  let command='',count=0;
  for(const token of tokens){
    if(/^[a-z]$/i.test(token)){
      if(command&&((arity[command]&&(!count||count%arity[command]))||(!arity[command]&&count)))return false;
      command=token.toUpperCase();count=0;
    }else{
      if(!arity[command]||!numeric(token)||command==='A'&&[3,4].includes(count%7)&&!['0','1'].includes(token))return false;
      count++;
    }
  }
  return Boolean(command)&&(!arity[command]?!count:count>0&&count%arity[command]===0);
}
function attributeValue(tag,name,value){
  if(value.length>24000)return false;
  if(name==='xmlns')return value===SVG_NS;
  if(name==='viewBox')return value.trim().replace(/\s+/g,' ')==='0 0 1280 720';
  if(name==='data-pptx-page-role')return ['cover','toc','section','content','ending'].includes(value);
  if(name==='data-pptx-role')return ['background','decoration','footer','page-number','header'].includes(value);
  if(name==='data-pptx-bounds')return value.trim().split(/[\s,]+/).length===4&&numericList(value,4);
  if(name==='id')return /^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(value);
  if(name==='fill'||name==='stroke')return /^(?:#[a-f0-9]{3}|#[a-f0-9]{6}|none)$/i.test(value);
  if(['fill-opacity','stroke-opacity','opacity'].includes(name))return numeric(value,0,1);
  if(name==='stroke-width')return numeric(value,0,80);
  if(name==='stroke-linecap')return ['butt','round','square'].includes(value);
  if(name==='stroke-linejoin')return ['miter','round','bevel'].includes(value);
  if(name==='stroke-dasharray')return value==='none'||numericList(value,32,0,1000);
  if(name==='font-family')return fontFamilies.has(value);
  if(name==='font-size')return numeric(value,8,160);
  if(name==='font-weight')return /^(?:normal|bold|[1-9]00)$/.test(value);
  if(name==='font-style')return ['normal','italic'].includes(value);
  if(name==='text-anchor')return ['start','middle','end'].includes(value);
  if(name==='dominant-baseline')return ['auto','middle','central','hanging','alphabetic'].includes(value);
  if(name==='xml:space')return value==='preserve';
  if(name==='points')return numericList(value,600)&&value.trim().split(/[\s,]+/).length%2===0;
  if(name==='d')return pathData(value);
  if(['x','y','dx','dy'].includes(name))return numeric(value);
  if(['width','height','rx','ry','r'].includes(name))return numeric(value,0,2560)&&(tag!=='svg'||Number(value)===(name==='width'?1280:720));
  return numeric(value);
}

/** Restrictive resource-free SVG subset. Text remains native editable DrawingML. */
export function validatePptMasterSvg(value){
  if(typeof value!=='string')throw invalid('input_type');
  if(Buffer.byteLength(value)>256*1024)throw invalid('svg_size');
  const doc=parseXML(value),root=doc.documentElement,ids=new Set();
  if(root.tagName!=='svg')throw invalid('root_tag');
  if(root.namespaceURI!==SVG_NS)throw invalid('namespace',{tag:'svg'});
  if(!root.hasAttribute('viewBox'))throw invalid('canvas',{tag:'svg'});
  let count=0,textLength=0;
  function visit(node,depth){
    if(depth>24)throw invalid('node_depth');
    if(++count>1800)throw invalid('node_count');
    if(node.nodeType===3){if(!['text','tspan'].includes(node.parentNode?.localName)&&node.data.trim())throw invalid('text_placement');textLength+=node.data.length;if(textLength>20000)throw invalid('text_size');return;}
    if(node.nodeType!==1)throw invalid('node_kind');
    const tag=node.localName;
    if(node.namespaceURI!==SVG_NS||node.prefix)throw invalid('namespace',{tag});
    if(!tags.has(tag))throw invalid('unsupported_element',{tag});
    if(tag==='svg'&&node!==root)throw invalid('nested_svg',{tag});
    if(tag==='tspan'&&!['text','tspan'].includes(node.parentNode?.localName))throw invalid('tspan_placement',{tag});
    if(['text','tspan'].includes(node.parentNode?.localName)&&tag!=='tspan')throw invalid('text_child',{tag});
    for(const attr of Array.from(node.attributes)){
      const name=attr.name;
      if(!common.has(name)&&!geometry[tag].has(name))throw invalid('unsupported_attribute',{tag,attribute:name});
      if(attr.value.length>24000)throw invalid('attribute_size',{tag,attribute:name});
      if(!attributeValue(tag,name,attr.value))throw invalid('attribute_value',{tag,attribute:name});
      if(name==='id'){if(ids.has(attr.value))throw invalid('duplicate_id',{tag,attribute:'id'});ids.add(attr.value);}
    }
    for(const child of Array.from(node.childNodes))visit(child,depth+1);
  }
  if(Array.from(doc.childNodes).some(n=>n!==root&&(n.nodeType!==3||n.data.trim())))throw invalid('root_siblings');
  visit(root,0);
  if(!root.getElementsByTagName('text').length)throw invalid('editable_text_required');
  return new XMLSerializer().serializeToString(root);
}

export function validatePptMasterSlides(slides){
  if(!Array.isArray(slides)||slides.length<1||slides.length>40)throw invalid();
  let total=0;
  return slides.map(slide=>{
    if(!slide||typeof slide!=='object'||Array.isArray(slide))throw invalid();
    const svg=validatePptMasterSvg(slide.svg),notes=slide.notes??'',title=slide.title??'';
    if(typeof notes!=='string'||notes.length>12000||typeof title!=='string'||title.length>300||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(notes+title))throw invalid();
    total+=Buffer.byteLength(svg)+Buffer.byteLength(notes);if(total>8*1024*1024)throw invalid();
    return{svg,notes,title};
  });
}

/** Checks every OPC relationship and refuses raster-only or active-content exports. */
export async function validatePptMasterPackage(input,{slideCount,slides,maxOutputBytes=PPT_MASTER_MAX_OUTPUT_BYTES}={}){
  const bytes=Buffer.from(input??[]);
  if(bytes.length<200||bytes.length>Math.min(maxOutputBytes,PPT_MASTER_MAX_OUTPUT_BYTES)||!bytes.subarray(0,2).equals(Buffer.from('PK')))throw packageInvalid();
  // JSZip indexes entries by name and would conceal duplicate central-directory
  // records. Office readers can select a different duplicate, so reject these
  // (and encrypted/multipart/ZIP64 containers) before parsing any part.
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50&&p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10))throw packageInvalid();
  const records=bytes.readUInt16LE(end+10),directorySize=bytes.readUInt32LE(end+12),directoryOffset=bytes.readUInt32LE(end+16),names=new Set();
  if(!records||records>2000||directoryOffset+directorySize!==end)throw packageInvalid();
  let cursor=directoryOffset;
  for(let i=0;i<records;i++){
    if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50||bytes.readUInt16LE(cursor+8)&1||bytes.readUInt16LE(cursor+34))throw packageInvalid();
    const length=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);
    if(cursor+46+length+extra+comment>end||local+30>directoryOffset||bytes.readUInt32LE(local)!==0x04034b50)throw packageInvalid();
    let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+length));}catch{throw packageInvalid();}
    const localLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),compressed=bytes.readUInt32LE(cursor+20);
    if(names.has(name)||bytes.readUInt16LE(local+6)!==bytes.readUInt16LE(cursor+8)||bytes.readUInt16LE(local+8)!==bytes.readUInt16LE(cursor+10)||localLength!==length||!bytes.subarray(local+30,local+30+localLength).equals(bytes.subarray(cursor+46,cursor+46+length))||local+30+localLength+localExtra+compressed>directoryOffset)throw packageInvalid();
    names.add(name);cursor+=46+length+extra+comment;
  }
  if(cursor!==end)throw packageInvalid();
  let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false,createFolders:false});}catch{throw packageInvalid();}
  const entries=Object.values(zip.files);let expanded=0;
  if(entries.length>2000)throw packageInvalid();
  for(const entry of entries){
    const original=entry.unsafeOriginalName??entry.name;
    if(original!==entry.name||/[\\\x00-\x1f]/.test(original)||original.startsWith('/')||original.split('/').some(p=>p==='.'||p==='..')||/(?:activeX|embeddings|externalLinks|vbaProject|oleObject)/i.test(original))throw packageInvalid();
    if(entry.dir)continue;
    const size=entry._data?.uncompressedSize;
    if(!Number.isSafeInteger(size)||size<0||size>10*1024*1024||(expanded+=size)>64*1024*1024||!/(?:\.xml|\.rels|\.jpeg|\.jpg|\.png)$/.test(original))throw packageInvalid();
  }
  for(const name of ['[Content_Types].xml','_rels/.rels','ppt/presentation.xml'])if(!zip.file(name))throw packageInvalid();
  const slideFiles=entries.filter(e=>/^ppt\/slides\/slide[1-9]\d*\.xml$/.test(e.name));
  if(!Number.isInteger(slideCount)||slideCount<1||slideCount>40||slideFiles.length!==slideCount)throw packageInvalid();
  let nativeShapeCount=0;
  for(const entry of entries){
    if(entry.dir||!/(?:\.xml|\.rels)$/.test(entry.name))continue;
    let raw;try{raw=await entry.async('string');}catch{throw packageInvalid();}
    // XML declarations are permitted for OOXML, never processing instructions.
    const doc=parseXML(raw.replace(/^\s*<\?xml\s[^?]*\?>/,''),packageInvalid);
    if(doc.getElementsByTagNameNS(DML_NS,'hlinkClick').length||doc.getElementsByTagNameNS(DML_NS,'hlinkMouseOver').length)throw packageInvalid();
    if(entry.name.endsWith('.rels')){
      if(doc.documentElement.namespaceURI!==REL_NS||doc.documentElement.localName!=='Relationships')throw packageInvalid();
      const base=entry.name==='_rels/.rels'?'':path.posix.dirname(entry.name).replace(/(?:^|\/)\_rels$/,'');
      for(const rel of Array.from(doc.getElementsByTagNameNS(REL_NS,'Relationship'))){
        const target=rel.getAttribute('Target'),type=rel.getAttribute('Type');
        if(!target||rel.getAttribute('TargetMode')||/[\\\x00-\x20?#%]/.test(target)||/^[a-z][a-z\d+.-]*:/i.test(target)||target.startsWith('/')||/(?:hyperlink|oleObject|attachedTemplate|externalLink|vbaProject|control)$/i.test(type))throw packageInvalid();
        const resolved=path.posix.normalize(path.posix.join(base,target));
        if(resolved.startsWith('../')||!zip.file(resolved))throw packageInvalid();
      }
    }
    if(/^ppt\/slides\/slide\d+\.xml$/.test(entry.name)){
      if(doc.documentElement.namespaceURI!==PML_NS||doc.documentElement.localName!=='sld'||doc.getElementsByTagNameNS(PML_NS,'pic').length||doc.getElementsByTagNameNS(DML_NS,'blip').length)throw packageInvalid();
      const shapes=doc.getElementsByTagNameNS(PML_NS,'sp').length;
      if(!shapes||!doc.getElementsByTagNameNS(DML_NS,'t').length)throw packageInvalid();
      if(slides){
        const index=Number(entry.name.match(/slide(\d+)\.xml$/)[1])-1,source=slides[index];
        if(!source)throw packageInvalid();
        const sourceDoc=parseXML(source.svg,packageInvalid);
        const expected=Array.from(sourceDoc.getElementsByTagName('text')).map(n=>n.textContent).join('').replace(/\s+/g,'');
        const actual=Array.from(doc.getElementsByTagNameNS(DML_NS,'t')).map(n=>n.textContent).join('').replace(/\s+/g,'');
        if(!expected||actual!==expected)throw packageInvalid();
      }
      nativeShapeCount+=shapes;
    }
  }
  for(let i=1;i<=slideCount;i++)if(!zip.file(`ppt/slides/slide${i}.xml`))throw packageInvalid();
  return{slideCount,nativeShapeCount,bytes:bytes.length};
}

function settings(config={}){
  const runtimeRoot=path.resolve(config.runtimeRoot||path.join(here,'../.data/ppt-master'));
  return{runtimeRoot,pythonPath:config.pythonPath||path.join(runtimeRoot,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')};
}
/** A cheap local readiness check: installation does all dependency and source checks. */
export function getPptMasterRuntimeStatus(config={}){
  const value=settings(config);
  try{
    if(!path.isAbsolute(value.pythonPath))throw new Error();
    accessSync(value.pythonPath,constants.X_OK);accessSync(helperPath,constants.R_OK);
    const installed=JSON.parse(readFileSync(path.join(value.runtimeRoot,'ready.json'),'utf8'));
    const lock=JSON.parse(readFileSync(path.join(vendorRoot,'source-lock.json'),'utf8'));
    if(installed.commit!==PPT_MASTER_COMMIT||lock.commit!==PPT_MASTER_COMMIT||installed.pythonPath!==value.pythonPath)throw new Error();
    return{ready:true,engine:'ppt-master',commit:PPT_MASTER_COMMIT};
  }catch{return{ready:false,engine:'ppt-master',commit:PPT_MASTER_COMMIT};}
}

export function pptMasterRuntimeReady(config={}){
  return config.pptMasterEnabled===true&&getPptMasterRuntimeStatus({runtimeRoot:config.pptMasterRuntimeRoot,pythonPath:config.pptMasterPython}).ready;
}

export function runPptMasterCompiler({pythonPath,workspace,signal,timeoutMs=90000,maxLogBytes=64*1024,spawnImpl=spawn,killImpl=process.kill}){
  if(signal?.aborted)return Promise.reject(cancelled());
  return new Promise((resolve,reject)=>{
    let child,bytes=0,timer,reason,finished=false;
    const stop=error=>{if(reason)return;reason=error;try{if(process.platform!=='win32'&&child?.pid)killImpl(-child.pid,'SIGKILL');else child?.kill('SIGKILL');}catch{try{child?.kill('SIGKILL');}catch{}}};
    const abort=()=>stop(cancelled());
    const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    try{child=spawnImpl(pythonPath,['-I',helperPath,vendorRoot,workspace],{cwd:workspace,detached:process.platform!=='win32',windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:`${path.dirname(pythonPath)}:/usr/bin:/bin`,HOME:workspace,TMPDIR:workspace,TMP:workspace,TEMP:workspace,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});}catch{finish(fail('ppt_master_unavailable','演示文稿编译服务暂不可用',503));return;}
    const output=chunk=>{bytes+=chunk.length;if(bytes>maxLogBytes)stop(fail('ppt_master_output_limit','演示文稿编译输出超过限制'));};
    child.stdout?.on('data',output);child.stderr?.on('data',output);
    child.once('error',()=>finish(reason||fail('ppt_master_unavailable','演示文稿编译服务暂不可用',503)));
    child.once('close',code=>finish(reason||(code===0?null:fail('ppt_master_compile_failed','演示文稿编译失败，请重新生成'))));
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>stop(fail('ppt_master_timeout','演示文稿编译超时，请减少页数后重试',504)),timeoutMs);
    timer.unref?.();if(signal?.aborted)abort();
  });
}

let activeCompiles=0;
/** One compiler process per Node worker, bounded for a shared 2 core / 4 GB host. */
export function createPptMasterRuntime(config={}, {runCompiler=runPptMasterCompiler,tempRoot=tmpdir(),readiness=getPptMasterRuntimeStatus}={}){
  const options=settings(config);
  const maxOutputBytes=Math.min(PPT_MASTER_MAX_OUTPUT_BYTES,Math.max(1024,Number(config.maxOutputBytes)||PPT_MASTER_MAX_OUTPUT_BYTES));
  const timeoutMs=Math.min(120000,Math.max(100,Number(config.timeoutMs)||90000));
  return{
    status:()=>readiness(config),
    isReady:()=>readiness(config).ready===true,
    async render({slides,signal}={}){
      if(signal?.aborted)throw cancelled();
      let checked;
      try{checked=validatePptMasterSlides(slides);}catch(error){if(error?.code==='ppt_master_svg_invalid')throw invalid();throw error;}
      if(!readiness(config).ready)throw fail('ppt_master_not_configured','演示文稿编译服务暂未配置',503);
      if(activeCompiles>=1)throw fail('ppt_master_busy','演示文稿编译服务繁忙，请稍后重试',429);
      activeCompiles++;let workspace;
      try{
        workspace=await mkdtemp(path.join(tempRoot,'paperknow-ppt-master-'));
        await mkdir(path.join(workspace,'slides'),{mode:0o700});
        const manifest={slides:checked.map(({title,notes},i)=>({file:`${String(i+1).padStart(3,'0')}.svg`,title,notes})),maxOutputBytes};
        for(let i=0;i<checked.length;i++)await writeFile(path.join(workspace,'slides',manifest.slides[i].file),checked[i].svg,{mode:0o600});
        await writeFile(path.join(workspace,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
        if(signal?.aborted)throw cancelled();
        await runCompiler({...options,workspace,signal,timeoutMs});
        if(signal?.aborted)throw cancelled();
        const target=path.join(workspace,'presentation.pptx'),info=await stat(target);
        if(!info.isFile()||info.size>maxOutputBytes)throw fail('ppt_master_result_large','演示文稿超过20MB，请减少页数后重试');
        const pptx=await readFile(target),validation=await validatePptMasterPackage(pptx,{slideCount:checked.length,slides:checked,maxOutputBytes});
        if(signal?.aborted)throw cancelled();
        return{pptx,previews:checked.map((slide,i)=>({index:i+1,title:slide.title,mime:'image/svg+xml',svg:slide.svg})),validation,engine:'ppt-master',commit:PPT_MASTER_COMMIT};
      }catch(error){if(error?.pptMasterSafe)throw error;throw fail('ppt_master_compile_failed','演示文稿编译失败，请重新生成');}
      finally{try{if(workspace)await rm(workspace,{recursive:true,force:true});}catch{throw fail('ppt_master_cleanup_failed','演示文稿临时文件清理失败，请稍后重试',503);}finally{activeCompiles--;}}
    },
  };
}

export function renderPptMaster(input,config={},dependencies={}){return createPptMasterRuntime(config,dependencies).render(input);}
