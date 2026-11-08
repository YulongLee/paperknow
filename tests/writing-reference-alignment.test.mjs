import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createWritingDocx} from '../src/writing-document.js';
import {defaultThesisTemplateProfile,defaultWritingTemplateProfile} from '../src/thesis-template-profile.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
test('default document references stay left aligned and retain hanging indent',async()=>{
 for(const [documentKind,writingKind,profile] of [['thesis',undefined,defaultThesisTemplateProfile()],['writing','article',defaultWritingTemplateProfile('article')]]){
  assert.equal(profile.rules.styles.References.alignment,'left');assert.ok(profile.rules.styles.References.hanging>0);
  const bytes=await createWritingDocx('样例论文\n第一章 背景\n正文。\n参考文献\n[1] Vaswani A, Shazeer N. Attention Is All You Need[PP/OL]. 2017.',{documentKind,writingKind,metadata:{title:'样例论文'}});
  const zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/styles.xml').async('string'),'application/xml');
  const style=[...doc.getElementsByTagNameNS(W,'style')].find(x=>x.getAttributeNS(W,'styleId')==='PKReferences');assert.ok(style);assert.equal(style.getElementsByTagNameNS(W,'jc')[0]?.getAttributeNS(W,'val'),'left');assert.ok(Number(style.getElementsByTagNameNS(W,'ind')[0]?.getAttributeNS(W,'hanging'))>0);
 }
});
