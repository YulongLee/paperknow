import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import {validateFormulaCode} from '../dist/workspace/research-delivery-model.mjs';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
export function formulaSvgMarkup(value){const latex=validateFormulaCode(value),input=new TeX({packages:['base','ams'],maxBuffer:4000,maxMacros:100,formatError:(_jax,error)=>{throw Error(error.message||'公式语法有误。');}}),output=new SVG({fontCache:'local'}),document=mathjax.document('',{InputJax:input,OutputJax:output}),container=document.convert(latex,{display:true}),html=adaptor.outerHTML(container),match=html.match(/<svg\b[\s\S]*<\/svg>/);if(!match)throw Error('公式排版未返回图形。');return {latex,markup:match[0]};}
