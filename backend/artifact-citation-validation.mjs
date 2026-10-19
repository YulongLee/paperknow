const fail=()=>{throw Object.assign(Error('引用文件必须是有效的 UTF-8 BibTeX 或 RIS 纯文本，不支持活动指令或页面内容。'),{status:400});};
const bibTypes=new Set(['article','book','booklet','inbook','incollection','inproceedings','conference','manual','mastersthesis','phdthesis','misc','periodical','proceedings','report','techreport','thesis','unpublished','patent','standard','online']);
const risTypes=new Set(['JOUR','BOOK','THES','CONF','CPAPER','PAT','STAND','STD','SER','NEWS','UNPB','GEN','RPRT','CHAP','ELEC']);
const safeURL=value=>{try{const url=new URL(value);return !/[\u0000-\u0020\u007f<>]/.test(value)&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}};
function bibliographicText(buffer){let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{fail();}if(!value.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)||/<\/?[A-Za-z][^>]*>/u.test(value))fail();return value;}
function validateBib(text){
 // Exported BibTeX consists of inert braced field values. Do not admit a
 // preamble, string macro or arbitrary TeX command under the new extension.
 for(const match of text.matchAll(/\\([A-Za-z]+|[^\s])/g))if(!['textbackslash','textasciicircum','textasciitilde','{','}','%','&','_','#','$','^','~','\\',"'",'"','`','=', '.', 'u','v','H','c','k','b','d','r','t'].includes(match[1]))fail();
 let cursor=0,entries=0;
 const whitespace=()=>{while(/\s/.test(text[cursor]||'')&&cursor<text.length)cursor++;};
 function braced(){if(text[cursor]!=='{')fail();cursor++;let depth=1,value='';for(;cursor<text.length;cursor++){const char=text[cursor];if(char==='\\'){if(cursor+1>=text.length)fail();value+=char+text[++cursor];continue;}if(char==='{')depth++;if(char==='}'&&--depth===0){cursor++;return value;}else if(char!=='}')depth+=0;value+=char;}fail();}
 while(cursor<text.length){whitespace();if(cursor===text.length)break;const header=text.slice(cursor).match(/^@([A-Za-z]+)\s*\{\s*([A-Za-z0-9_:.+-]+)\s*,/);if(!header||!bibTypes.has(header[1].toLowerCase()))fail();cursor+=header[0].length;let fields=0,title=false;
  for(;;){whitespace();if(text[cursor]==='}'){cursor++;break;}const field=text.slice(cursor).match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/);if(!field)fail();cursor+=field[0].length;const value=braced(),key=field[1].toLowerCase();if(key==='title'&&value.trim())title=true;if(key==='url'){const plain=value.replace(/\\([&_%#$])/g,'$1');if(!safeURL(plain))fail();}fields++;whitespace();if(text[cursor]===','){cursor++;continue;}if(text[cursor]!=='}')fail();}
  if(!fields||!title)fail();entries++;
 }
 if(!entries)fail();
}
function validateRIS(text){
 let open=false,title=false,records=0;
 for(const line of text.split(/\r?\n/)){if(!line.trim())continue;const match=line.match(/^([A-Z0-9]{2})\s+-\s?(.*)$/);if(!match)fail();const[,tag,value]=match;if(tag==='TY'){if(open||!risTypes.has(value.trim()))fail();open=true;title=false;}else if(tag==='ER'){if(!open||value.trim()||!title)fail();open=false;records++;}else{if(!open)fail();if(['TI','T1'].includes(tag)&&value.trim())title=true;if(tag==='UR'&&!safeURL(value))fail();}}
 if(open||!records)fail();
}
export function validateCitationArtifact(kind,buffer){if(!['bib','ris'].includes(kind))return;const text=bibliographicText(buffer);if(kind==='bib')validateBib(text);else validateRIS(text);}
