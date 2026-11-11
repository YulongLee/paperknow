// Identifies a narrow set of formula/citation locations for review. Literal
// equality is not evidence of support: the source may deny the expression,
// describe a different context, or use an equivalent formulation instead.
const equationPattern=/\b[A-Za-z]\s*\(\s*[A-Za-z]\s*\)\s*=\s*[A-Za-z]\s*(?:\^\s*\{?\s*[23]\s*\}?|[²³])/g;
const sourceMarker=/\[source:[^\]\n]{1,200}\]/u;

export function uncheckedFormulaCitations(text){
 const findings=[];
 for(const equation of text.matchAll(equationPattern)){
  const end=equation.index+equation[0].length;
  const tail=text.slice(end,Math.min(text.length,end+300)).split(/[。！？\n]/u,1)[0];
  // Do not infer a formula from the prefix of a longer expression.
  if(/^\s*(?:[A-Za-z0-9]|[+\-−*/^×⋅·]|\\(?:cdot|times))/u.test(tail))continue;
  const start=Math.max(0,equation.index-300),head=text.slice(start,equation.index).split(/[。！？\n]/u).pop();
  if(!sourceMarker.test(tail)&&!sourceMarker.test(head))continue;
  findings.push({quote:equation[0],offset:equation.index});
 }
 return findings;
}
