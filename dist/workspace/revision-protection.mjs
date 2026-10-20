export const revisionProtectionVersion='revision-protection-v1';
export const revisionProtectionRequirements='仅优化表达，保留原文的完整信息与段落对应关系。带符号及科学计数法的数字、数值及其单位（含复合单位）、完整 LaTeX/MathML 公式、来源标记、数字引用、作者年份引用和 cite/ref 命令必须逐字保留并维持原始顺序，不得新增、删除、改写或调换；不得以分散保留相同数字替代原有数值、单位或公式。长度按Unicode字符计数，排除空白及默认不可见格式字符：原文达到40字符时，候选至少保留原文字符数的60%；不足40字符时至少保留50%，不得把整段缩成摘要或用不可见字符补足长度。机械核对不能验证事实、公式含义或引用与论断的关系，所有结果仍须用户逐段核对，不得声称事实已验证或保证检测分数。';

const maximumLength=200000;
const explicitEnvironments=new Set(['math','displaymath','equation','equation*','align','align*','aligned','gather','gather*','multline','multline*','eqnarray','eqnarray*']);
const numberPart='(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+)';
const numberPattern=new RegExp('(?:[+−±∓-]\\s*)?'+numberPart+'(?:[eE][+−-]?\\d+|\\s*[×x·]\\s*10\\s*(?:\\^\\s*\\{?[+−-]?\\d+\\}?|[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))?','gu');
const unitNames=['mmHg','kcal','mmol','μmol','µmol','nmol','kHz','MHz','GHz','kPa','MPa','GPa','mPa','mHz','mN','kN','mJ','kJ','MJ','mW','kW','MW','mV','kV','mA','μA','µA','mL','μL','µL','nL','μg','µg','mg','kg','ng','pg','μm','µm','nm','mm','cm','km','ms','μs','µs','ns','min','day','mol','mM','μM','µM','nM','Hz','Pa','eV','keV','MeV','GeV','Bq','Gy','Sv','Wb','lm','lx','rad','sr','dB','ohm','Ω','°C','°F','℃','℉','%','％','‰','g','t','m','s','h','d','N','J','W','V','A','K','M','L','l','T','H','F','S','C','cd'];
const escape=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const exponent='(?:\\^\\s*[+−-]?\\d+(?:/\\d+)?|[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+|[−-]\\d+)?';
const atom='(?:'+unitNames.sort((a,b)=>b.length-a.length).map(escape).join('|')+')'+exponent+'(?![\\p{L}\\p{M}])';
const separator='(?:\\s*[·⋅*/×]\\s*|\\s+per\\s+|\\s+)';
const factor='(?:\\(\\s*'+atom+'(?:'+separator+atom+'){0,5}\\s*\\)'+exponent+'|'+atom+')';
const unitPattern=new RegExp('\\s*'+factor+'(?:'+separator+factor+'){0,6}','uy');
const commandPattern=/\\(?:[Cc]ite(?:p|t|alt|alp|author|year|yearpar)?|[Pp]arencite|[Tt]extcite|[Aa]utocite|[Ff]ootcite|nocite|[Cc]ref|[Ee]qref|[Aa]utoref|pageref|vref|ref)\*?(?![A-Za-z])/gy;
const author='(?:\\p{Lu}[\\p{L}\\p{M}’\'.-]{0,50}|[\\p{Script=Han}]{1,12})';
const narrativeCitation=new RegExp(author+'(?:\\s+(?:and|&|与|和)\\s*'+author+'){0,2}(?:\\s+et\\s+al\\.?)?(?:等)?\\s*[（(](?:18|19|20|21)\\d{2}[a-z]?(?:\\s*[,，;；]\\s*(?:(?:18|19|20|21)\\d{2})?[a-z]?)*[)）]','gu');
const parentheticalCitation=/[（(][^()（）\n]{1,240}[)）]/gu;
const markerPattern=/\[source:[^\]\r\n]{1,500}\]|\[\s*\d+(?:\s*[,，;；\-–—]\s*\d+)*\s*\]/gu;

function escapeMap(text){const map=new Uint8Array(text.length);let backslashes=0;for(let i=0;i<text.length;i++){map[i]=backslashes%2;backslashes=text[i]==='\\'?backslashes+1:0;}return map;}
function characters(text){let count=0;for(const char of text)if(!/[\s\p{Default_Ignorable_Code_Point}]/u.test(char))count++;return count;}
function lowerBound(values,minimum){let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<minimum)lo=mid+1;else hi=mid;}return values[lo]??-1;}
function balancedEnds(text,escaped){const ends=new Map(),stacks={'{':[],'[':[]},opens={'}':'{',']':'['};for(let i=0;i<text.length;i++)if(!escaped[i]){if(stacks[text[i]])stacks[text[i]].push(i);else if(opens[text[i]]){const start=stacks[opens[text[i]]].pop();if(start!==undefined)ends.set(start,i+1);}}return ends;}
function tagEnd(text,start){let quote='';for(let i=start;i<text.length;i++){const char=text[i];if(quote){if(char===quote)quote='';}else if(char==='"'||char==="'")quote=char;else if(char==='>')return i+1;}return -1;}
function mathTags(text){
 const records=new Map(),stacks=new Map(),pattern=/<\/?((?:[A-Za-z_][\w.-]{0,40}:)?math)(?=[\s/>]|$)/g;let match;
 while((match=pattern.exec(text))){const start=match.index,end=tagEnd(text,start),name=match[1],closing=text[start+1]==='/',record={end:Math.max(start+match[0].length,end),pairEnd:-1};records.set(start,record);if(end<0)break;pattern.lastIndex=end;
  if(closing){const open=stacks.get(name)?.pop();if(open!==undefined)records.get(open).pairEnd=end;}
  else if(/\/\s*>$/.test(text.slice(start,end)))record.pairEnd=end;
  else{if(!stacks.has(name))stacks.set(name,[]);stacks.get(name).push(start);}
 }
 return records;
}
function scanMath(text){
 const spans=[],tags=mathTags(text),cache=new Map(),escaped=escapeMap(text);let malformed=0;
 const next=(delimiter,from,singleDollar=false)=>{const key=singleDollar?'single-dollar':delimiter;if(!cache.has(key)){const indexes=[];let at=-1;while((at=text.indexOf(delimiter,at+1))>=0)if(!escaped[at]&&(!singleDollar||(text[at-1]!=='$'&&text[at+1]!=='$')))indexes.push(at);cache.set(key,indexes);}return lowerBound(cache.get(key),from);};
 for(let i=0;i<text.length;){let end=-1,opener=0;
  const tag=tags.get(i);if(tag){if(tag.pairEnd>=0){end=tag.pairEnd;}else{malformed++;i=tag.end;continue;}}
  else if(text[i]==='\\'&&!escaped[i]){
   const mark=text.slice(i,i+2);if(mark==='\\('||mark==='\\['){opener=2;const closing=mark==='\\('?'\\)':'\\]',at=next(closing,i+2);if(at>=0)end=at+2;}
   else if(mark==='\\)'||mark==='\\]'){malformed++;i+=2;continue;}
   else{const environment=/^\\(begin|end)\{([a-z]+\*?)\}/.exec(text.slice(i,i+40));if(environment&&explicitEnvironments.has(environment[2])){if(environment[1]==='end'){malformed++;i+=environment[0].length;continue;}opener=environment[0].length;const closing='\\end{'+environment[2]+'}',at=next(closing,i+opener);if(at>=0)end=at+closing.length;}}
  }else if(text[i]==='$'&&!escaped[i]){
   if(text[i+1]==='$'){opener=2;const at=next('$$',i+2);if(at>=0)end=at+2;}
   // Consider only the nearest single dollar. A currency opener before prose
   // must not pair across the opener of a later formula; numeric $2+3$ is math.
   else{const at=next('$',i+1,true);if(at>=0){const body=text.slice(i+1,at),following=text[at+1]||'',numericOpening=/\d/.test(text[i+1]||''),mathOperator=/[=+*/^_<>\\{}±∓−]/.test(body),currencyBoundary=numericOpening&&!mathOperator&&(/\s$/.test(body)||/[\p{L}\p{N}]/u.test(following));if(body.trim()&&!/\d/.test(following)&&!currencyBoundary)end=at+1;}}
  }
  if(end>=0){spans.push({type:'math',start:i,end,value:text.slice(i,end)});i=end;}
  else{if(opener)malformed++;i+=opener||1;}
 }
 return{spans,malformed};
}
function scanGap(text,start,end){
 const spans=[],part=text.slice(start,end),escaped=escapeMap(part),ends=balancedEnds(part,escaped),add=(type,a,b)=>spans.push({type,start:start+a,end:start+b,value:part.slice(a,b)});let match;
 markerPattern.lastIndex=0;while((match=markerPattern.exec(part)))add('citation',match.index,markerPattern.lastIndex);
 narrativeCitation.lastIndex=0;while((match=narrativeCitation.exec(part)))add('citation',match.index,narrativeCitation.lastIndex);
 parentheticalCitation.lastIndex=0;while((match=parentheticalCitation.exec(part))){const body=match[0].slice(1,-1),year=/(?:18|19|20|21)\d{2}[a-z]?/u.exec(body);if(year&&/^[\p{L}\p{M} .,'’;&，；、\-–]+$/u.test(body.slice(0,year.index))&&/[\p{L}]/u.test(body.slice(0,year.index)))add('citation',match.index,parentheticalCitation.lastIndex);}
 for(let i=0;i<part.length;i++)if(part[i]==='\\'&&!escaped[i]){commandPattern.lastIndex=i;const command=commandPattern.exec(part);if(!command)continue;let at=commandPattern.lastIndex;while(/\s/.test(part[at]||'')&&at<part.length)at++;for(let optional=0;optional<2&&part[at]==='[';optional++){const stop=ends.get(at);if(stop===undefined)break;at=stop;while(/\s/.test(part[at]||'')&&at<part.length)at++;}if(part[at]==='{'){const stop=ends.get(at);if(stop!==undefined){add('citation',i,stop);i=stop-1;}}}
 numberPattern.lastIndex=0;while((match=numberPattern.exec(part))){let stop=numberPattern.lastIndex;unitPattern.lastIndex=stop;const units=unitPattern.exec(part);if(units)stop=unitPattern.lastIndex;add(units?'measurement':'number',match.index,stop);numberPattern.lastIndex=stop;}
 // Standalone compound units and multi-letter SI units are useful even without
 // a preceding value. Single-letter prose (for example the article A) is not
 // classified as a unit without an associated number.
 const standalone=new RegExp('(?<![\\p{L}\\p{M}])'+factor+'(?:'+separator+factor+'){0,6}','gu');
 while((match=standalone.exec(part))){const value=match[0];if(/[·⋅*/×^⁰¹²³⁴⁵⁶⁷⁸⁹]/u.test(value)||unitNames.includes(value)&&Array.from(value).length>1)add('unit',match.index,standalone.lastIndex);}
 return spans;
}
function scan(text){
 const math=scanMath(text),candidates=[...math.spans];let start=0;
 for(const span of math.spans){candidates.push(...scanGap(text,start,span.start));start=span.end;}candidates.push(...scanGap(text,start,text.length));
 candidates.sort((a,b)=>a.start-b.start||b.end-a.end);const spans=[];let end=-1;for(const span of candidates)if(span.start>=end){spans.push(span);end=span.end;}
 return{spans,malformed:math.malformed};
}
function inputIssue(text,kind){return typeof text!=='string'||text.length>maximumLength?{code:'invalid_'+kind+'_input'}:!characters(text)?{code:kind+'_blank'}:null;}
export function protectedRevisionSpans(text){return typeof text==='string'&&text.length<=maximumLength?scan(text).spans:[];}
export function validateRevisionOriginal(text){
 const issues=[],invalid=inputIssue(text,'original'),originalCharacters=typeof text==='string'&&text.length<=maximumLength?characters(text):0;if(invalid)issues.push(invalid);else{const result=scan(text);if(result.malformed)issues.push({code:'malformed_original_math',count:result.malformed});}
 return{valid:issues.length===0,issues,originalCharacters,requiresReview:true,factsVerified:false};
}
export function validateRevisionProtection(original,revised){
 const issues=[],originalInvalid=inputIssue(original,'original'),revisedInvalid=inputIssue(revised,'revised'),originalCharacters=typeof original==='string'&&original.length<=maximumLength?characters(original):0,revisedCharacters=typeof revised==='string'&&revised.length<=maximumLength?characters(revised):0,minimumCharacters=Math.ceil(originalCharacters*(originalCharacters>=40?.6:.5));
 if(originalInvalid)issues.push(originalInvalid);if(revisedInvalid)issues.push(revisedInvalid);
 if(!originalInvalid&&!revisedInvalid){const before=scan(original),after=scan(revised);if(before.malformed)issues.push({code:'malformed_original_math',count:before.malformed});if(after.malformed)issues.push({code:'malformed_revised_math',count:after.malformed});let changed=before.spans.length!==after.spans.length;for(let i=0;i<Math.min(before.spans.length,after.spans.length);i++)if(before.spans[i].type!==after.spans[i].type||before.spans[i].value!==after.spans[i].value){changed=true;break;}if(changed)issues.push({code:'protected_spans_changed',originalCount:before.spans.length,revisedCount:after.spans.length});}
 if(!originalInvalid&&revisedCharacters<minimumCharacters)issues.push({code:'too_short',minimumCharacters,revisedCharacters});
 return{valid:issues.length===0,issues,originalCharacters,revisedCharacters,minimumCharacters,requiresReview:true,factsVerified:false};
}
