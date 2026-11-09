import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {writingFlowSnapshot} from '../dist/workspace/writing-flow-model.mjs';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';
import {thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {createWritingDocx} from '../src/writing-document.js';

// Public bibliographic metadata, with short paraphrases of the abstracts only.
// https://arxiv.org/abs/1706.03762; https://arxiv.org/abs/1810.04805
const references=[
 {id:'transformer',title:'Attention Is All You Need',authors:'Ashish Vaswani; Noam Shazeer; Niki Parmar; Jakob Uszkoreit; Llion Jones; Aidan N. Gomez; Lukasz Kaiser; Illia Polosukhin',year:'2017',documentType:'preprint',url:'https://arxiv.org/abs/1706.03762',confirmed:true,scope:'abstract',text:'Transformer 使用注意力机制处理序列转换，论文在机器翻译任务中进行了实验。'},
 {id:'bert',title:'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',authors:'Jacob Devlin; Ming-Wei Chang; Kenton Lee; Kristina Toutanova',year:'2018',documentType:'preprint',url:'https://arxiv.org/abs/1810.04805',confirmed:true,scope:'abstract',text:'BERT 使用双向上下文预训练语言表示，模型可经微调用于多种语言理解任务。'}
];
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
for(const kind of ['proposal','summary','taskbook','article','course','practice'])test(kind+' multiple public references preserve distinct citations and bibliographic entries in editable Word',async()=>{
 const data={title:'注意力与语言表示的研究',level:'本科',targetWords:1000,materials:[],references,outline:[{id:'c1',title:'研究背景',targetWords:1000}]};
 const snapshot=normalizeThesisSnapshot(writingFlowSnapshot(kind,data));
 const presentation=thesisDocumentPresentation(snapshot,[{id:'c1',title:'研究背景',text:'BERT 的语言表示来自双向预训练[source:bert]。Transformer 使用注意力机制[source:transformer]。BERT 可用于多种语言理解任务[source:bert]。'}]);
 assert.deepEqual(presentation.citationRanges.map(row=>row.number),[1,2,1]);
 assert.match(presentation.text,/\[1\].*BERT: Pre-training/);assert.match(presentation.text,/\[2\].*Attention Is All You Need/);
 const bytes=await createWritingDocx(presentation.text,{documentKind:'writing',writingKind:kind,metadata:{title:data.title,chapterTitles:['研究背景'],citationRanges:presentation.citationRanges}});
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser().parseFromString(xml,'application/xml');
 const links=[...doc.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_'));
 assert.deepEqual(links.map(node=>node.textContent),['[1]','[2]','[1]']);
 assert.ok(links.every(node=>node.getElementsByTagNameNS(W,'vertAlign')[0]?.getAttributeNS(W,'val')==='superscript'));
 assert.ok(xml.includes('https://arxiv.org/abs/1706.03762'));assert.ok(xml.includes('https://arxiv.org/abs/1810.04805'));
 assert.doesNotMatch(xml,/\[source:/);
});

test('thesis retains multiple public references and citation links through Word export',async()=>{
 const snapshot=normalizeThesisSnapshot({title:'注意力与语言表示的研究',profile:{level:'本科',language:'中文',targetWords:1000},references,materials:[],outline:[{id:'c1',title:'研究背景',targetWords:1000}]});
 const presentation=thesisDocumentPresentation(snapshot,[{id:'c1',title:'研究背景',text:'Transformer 使用注意力机制[source:transformer]。BERT 使用双向上下文预训练语言表示[source:bert]。'}]);
 assert.deepEqual(presentation.citationRanges.map(row=>row.number),[1,2]);
 assert.match(presentation.text,/\[1\].*Attention Is All You Need/);assert.match(presentation.text,/\[2\].*BERT: Pre-training/);
 const bytes=await createWritingDocx(presentation.text,{documentKind:'thesis',metadata:{title:snapshot.title,chapterTitles:['研究背景'],citationRanges:presentation.citationRanges}});
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser().parseFromString(xml,'application/xml');
 const links=[...doc.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_'));
 assert.deepEqual(links.map(node=>node.textContent),['[1]','[2]']);assert.doesNotMatch(xml,/\[source:/);
});
