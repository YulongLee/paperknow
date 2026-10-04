import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,analyzeDocument,countChars,unionRanges,subtractRanges,normalize,sliceCp} from '../dist/precheck/engine.mjs';
import {DEMO_DOCUMENT,DEMO_SOURCES} from '../dist/precheck/sample.mjs';
const text='研究需要同时关注学习效果使用体验与潜在风险';
const source={id:'s1',title:'来源一',text,provider:'本地测试',authors:[],kind:'user'};
test('overlap is merged, exclusions are subtracted without double counting',()=>{
 assert.deepEqual(unionRanges([[2,8],[5,12],[12,14],[20,25]]),[[2,14],[20,25]]);
 assert.deepEqual(subtractRanges([[0,20]],[[3,7],[5,10],[18,30]]),[[0,3],[10,18]]);
});
test('multiple sources matching the same position count only once',()=>{
 const r=analyzeDocument(parseDocument(text),[source,{...source,id:'s2'}]);
 assert.equal(r.sourceCount,2);assert.equal(r.ratio,1);assert.equal(r.similarChars,countChars(text));
 assert.equal(r.sources.reduce((n,s)=>n+s.overlapChars,0),r.similarChars*2);
});
test('no source text or unrelated source never creates similarity evidence',()=>{
 for(const sources of [[],[{...source,text:''}],[{...source,text:'abcdefghijklmnoabcdefghijklmnop'}]]){
 const r=analyzeDocument(parseDocument(text),sources);assert.equal(r.ratio,0);assert.equal(r.sourceCount,0);assert.equal(r.semanticStatus,'not_connected');
 }
});
test('matching is mapped back to original Unicode characters and punctuation',()=>{
 const r=analyzeDocument(parseDocument('😀ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰ。研究'),[{...source,text:'abcdefghijklmnop'}]);
 const p=r.sections[0].paragraphs[0],m=p.matches[0];
 assert.equal(sliceCp(p.text,...m.range),'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰ');assert.equal(p.similarChars,16);assert.equal(p.totalChars,18);
 assert.equal(normalize('😀Ａ，B').map[0],1);
});
test('minimum match threshold rejects short coincidental matches',()=>{
 const r=analyzeDocument(parseDocument('abcdefghijklmnopqr'),[{...source,text:'abcdefghijklmnoXXXX'}]);assert.equal(r.similarChars,0);
});
test('references and unselected chapters do not enter denominator or evidence',()=>{
 const p=parseDocument('目录\n第一条目\n第1章 绪论\n'+text+'\n第2章 方法\n完全不相同的独立研究结果与分析表述\n参考文献\n'+text);
 const r=analyzeDocument(p,[source],{sectionIds:[p.sections.find(s=>s.title.startsWith('第1章')).id]});
 assert.equal(r.totalChars,countChars(text));assert.equal(r.ratio,1);assert.equal(r.sections.filter(s=>s.included).length,1);
});
test('demo quotation requires a matching bibliography and preserves other matches',()=>{
 const p=parseDocument(DEMO_DOCUMENT.text,DEMO_DOCUMENT.title),r=analyzeDocument(p,DEMO_SOURCES);
 assert.ok(r.similarChars>r.uncitedChars);assert.ok(r.uncitedChars>0);assert.ok(r.ratio<=1);
 const removed=parseDocument(DEMO_DOCUMENT.text.split('参考文献')[0],DEMO_DOCUMENT.title);
 const r2=analyzeDocument(removed,DEMO_SOURCES);assert.equal(r2.similarChars,r2.uncitedChars);
 assert.ok(r.sections.flatMap(s=>s.paragraphs).flatMap(p=>p.matches).every(m=>m.semanticScore===null));
});
test('quotation exemption does not erase unquoted evidence from another source',()=>{
 const s={...source,refNo:'1'};
 const p=parseDocument('“'+text+'”[1]\n参考文献\n[1] 来源一');
 const cited=analyzeDocument(p,[s]);assert.equal(cited.uncitedChars,0);
 const multi=analyzeDocument(p,[s,{...source,id:'s2'}]);assert.equal(multi.uncitedChars,countChars(text));
});
test('empty text and empty selected range are rejected',()=>{
 assert.throws(()=>parseDocument(''),/正文/);assert.throws(()=>analyzeDocument(parseDocument(text),[source],{sectionIds:[]}),/选择/);
});
