import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
import {reportHtml} from '../dist/precheck/export.mjs';
test('HTML export preserves actual evidence and escapes user-controlled metadata',()=>{const text='研究需要同时关注学习效果使用体验与潜在风险';const r=analyzeDocument(parseDocument(text),[{id:'s',title:'<script>来源</script>',authors:['<作者>'],text,provider:'自有材料',kind:'user',year:'<年份>',doi:'10.1234/example',url:'https://example.org/paper'}]);r.title='<img src=x onerror=alert(1)>';r.id='<编号>';r.algorithm='<算法>';const html=reportHtml(r);assert.ok(html.includes('10.1234/example'));assert.ok(html.includes('https://example.org/paper'));assert.ok(html.includes('100.0%'));assert.ok(html.includes('<mark'));assert.ok(html.includes('&lt;script&gt;来源&lt;/script&gt;'));assert.ok(html.includes('&lt;年份&gt;'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('未检索在线学术数据库'));});
