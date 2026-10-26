import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {parseCitationImport,recoverCitationMetadata} from '../dist/workspace/citation-import.mjs';
import {formatThesisReference,thesisReferenceMetadata,withBibliographicMetadata,thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {writingFlowSpecs,writingFlowSnapshot} from '../dist/workspace/writing-flow-model.mjs';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';
import {createWritingDocx} from '../src/writing-document.js';

const entry='张三, 李四. 2020年以来图像识别研究[J]. 合成研究期刊, 2026, 12(3): 45-49. DOI: 10.1234/example.';
const ris='TY  - JOUR\nTI  - Synthetic image study\nAU  - Smith, Jane Mary\nAU  - Doe, John\nPY  - 2026\nJO  - Synthetic Research\nVL  - 18\nIS  - 2\nSP  - 101\nEP  - 112\nDO  - 10.1234/synthetic\nAB  - This supplied abstract is not the bibliographic record.\nER  -\n';
const bib='@book{test, title={Synthetic Research Methods}, author={Smith, Jane and {Research and Development Group}}, year={2026}, publisher={Synthetic Press}, address={Beijing}, edition={2}, pages={20--25}}';
const confirmed=row=>({...row,confirmed:true});

test('standard citation import retains the full entry and obtains its year from the publication rather than the title',()=>{
 const item=parseCitationImport('[27] '+entry+'\n摘要：用户实际提供的摘要。').items[0];
 assert.equal(item.year,'2026');assert.equal(item.documentType,'journal');assert.equal(item.journal,'合成研究期刊');assert.equal(item.volume,'12');assert.equal(item.issue,'3');assert.equal(item.pages,'45-49');assert.equal(item.citationText,entry);assert.equal(item.text,'用户实际提供的摘要。');assert.equal(formatThesisReference(item),entry);
 const metadata=thesisReferenceMetadata(item);assert.equal(metadata.citationText,entry);assert.equal('rawCitation' in metadata,false);assert.equal('text' in metadata,false);assert.doesNotMatch(JSON.stringify(metadata),/用户实际提供的摘要/);
});

test('wrapped standard citations remain one complete entry while unrecognized extra entries fail atomically',()=>{
 const imported=parseCitationImport('[1] 张三. 合成研究[J].\n合成期刊, 2026, 12(3): 45-49.\nDOI: 10.1234/wrapped.\n[2] 李四. 合成学位论文[D]. 北京: 合成大学, 2025.');
 assert.equal(imported.items.length,2);assert.equal(imported.items[0].journal,'合成期刊');assert.equal(imported.items[0].doi,'10.1234/wrapped');assert.equal(imported.items[1].publicationPlace,'北京');assert.equal(imported.items[1].publisher,'合成大学');
 assert.throws(()=>parseCitationImport('[1] '+entry+'\n这不是一条标准引文'),/标准引文/);
});

test('RIS retains journal locators and structured personal names through the actual thesis request boundary',()=>{
 const imported=parseCitationImport(ris).items[0],draft={title:'合成引用贯通测试',degree:'本科',targetWords:500,writingReferences:[confirmed(imported)],outlineRows:[{id:'c1',title:'研究背景',level:1,words:500}]},snapshot=normalizeThesisSnapshot(thesisSnapshotFromDraft(draft)),row=snapshot.references[0];
 assert.equal(row.journal,'Synthetic Research');assert.equal(row.documentType,'journal');assert.equal(row.volume,'18');assert.equal(row.issue,'2');assert.equal(row.pages,'101-112');assert.deepEqual(row.authorNames,[{family:'Smith',given:'Jane Mary'},{family:'Doe',given:'John'}]);
 assert.equal(formatThesisReference(row),'Smith J M, Doe J. Synthetic image study[J]. Synthetic Research, 2026, 18(2): 101-112. DOI: 10.1234/synthetic.');assert.deepEqual(normalizeThesisSnapshot(snapshot),snapshot);
});

test('BibTeX retains corporate authors containing and as well as book publication details',()=>{
 const row=parseCitationImport(bib).items[0];assert.equal(row.authors,'Smith, Jane; Research and Development Group');assert.deepEqual(row.authorNames,[{family:'Smith',given:'Jane'},{literal:'Research and Development Group'}]);assert.equal(row.documentType,'book');assert.equal(row.publisher,'Synthetic Press');assert.equal(row.publicationPlace,'Beijing');assert.equal(row.edition,'2');assert.equal(row.pages,'20-25');
 assert.match(formatThesisReference(row),/^Smith J, Research and Development Group\. Synthetic Research Methods\[M\]\. 2nd ed\. Beijing: Synthetic Press, 2026: 20-25\.$/);
 const thesis=parseCitationImport('@phdthesis{t,title={Synthetic thesis},author={张三},year={2026},school={合成大学},address={北京}}').items[0];assert.equal(thesis.documentType,'thesis');assert.match(formatThesisReference(thesis),/\[D\]\. 北京: 合成大学, 2026\./);
 const conference=parseCitationImport('@inproceedings{c,title={Synthetic proceedings paper},author={Doe, Jane},year={2026},booktitle={Synthetic Proceedings},publisher={Synthetic Press},pages={1--9}}').items[0];assert.equal(conference.publicationSource,'Synthetic Proceedings');assert.match(formatThesisReference(conference),/\[C\]\/\/ Synthetic Proceedings\. Synthetic Press, 2026: 1-9\./);
});

test('historical imported citations recover missing catalog fields without changing source text and metadata edits override stale original citations',()=>{
 const legacy={id:'legacy',title:'2020年以来图像识别研究',authors:'张三, 李四',year:'2026',text:'真实来源文字',rawCitation:'[11] '+entry+'\n摘要：不得出现在参考文献中的摘要',confirmed:true},before=structuredClone(legacy);
 assert.equal(formatThesisReference(legacy),entry);assert.equal(recoverCitationMetadata(legacy).journal,'合成研究期刊');assert.deepEqual(legacy,before);const edited={...legacy,journal:'作者重新核对的刊名'};const text=formatThesisReference(edited);assert.match(text,/作者重新核对的刊名/);assert.doesNotMatch(text,/合成研究期刊|不得出现在/);
 legacy.rawCitation='[1] 王五. 另一条来源[J]. 另一刊, 2026.';assert.deepEqual(recoverCitationMetadata(legacy),{});assert.doesNotMatch(formatThesisReference(legacy),/另一条来源|另一刊/);
});

test('export recovery adds only missing metadata to identical existing source IDs and preserves immutable snapshots',()=>{
 const imported=confirmed({...parseCitationImport('[1] '+entry).items[0],id:'r1'}),snapshot={references:[{id:'r1',title:imported.title,authors:imported.authors,year:imported.year,confirmed:true,text:'原来源正文'}],materials:[]},before=structuredClone(snapshot),enriched=withBibliographicMetadata(snapshot,[imported]);
 assert.equal(enriched.references[0].citationText,entry);assert.equal(enriched.references[0].text,'原来源正文');assert.deepEqual(snapshot,before);assert.equal(enriched.references.length,1);
 for(const candidate of [{...imported,title:'另一标题'},{...imported,confirmed:false},{...imported,id:'another'}])assert.deepEqual(withBibliographicMetadata(snapshot,[candidate]),snapshot);
 assert.deepEqual(withBibliographicMetadata(snapshot,[imported,imported]),snapshot);
 const known={...snapshot,references:[{...snapshot.references[0],journal:'原已确认刊名'}]};assert.equal(withBibliographicMetadata(known,[imported]).references[0].journal,'原已确认刊名');assert.match(formatThesisReference(withBibliographicMetadata(known,[imported]).references[0]),/原已确认刊名/);
});

for(const kind of Object.keys(writingFlowSpecs))test(kind+' preserves standard reference records to the backend and numbers only actual prose citations',()=>{
 const a=confirmed(parseCitationImport('[23] '+entry).items[0]),b=confirmed(parseCitationImport(ris).items[0]),data={title:'合成写作参考文献测试',level:'本科',targetWords:1000,materials:[],references:[a,b],outline:[{id:'c1',title:'研究背景',targetWords:1000}],notes:'',instructions:''},snapshot=normalizeThesisSnapshot(writingFlowSnapshot(kind,data)),model=thesisDocumentPresentation(snapshot,[{id:'c1',title:'研究背景',text:'先引用[source:'+b.id+']，再引用[source:'+a.id+']，再次引用[source:'+b.id+']。'}]);
 assert.match(model.text,/参考文献\n+\[1\] Smith J M, Doe J/);assert.ok(model.text.includes('[2] '+entry));assert.deepEqual(model.citationRanges.map(row=>row.number),[1,2,1]);assert.doesNotMatch(model.text,/\[23\]|\[source:|This supplied abstract|已使用的参考文献/);
});

test('standard reference text and canonical indexes reach editable Word paragraphs and actual citation links',async()=>{
 const row=confirmed({...parseCitationImport('[27] '+entry).items[0],id:'r1'}),snapshot={title:'参考文献格式验收',references:[row],materials:[],outline:[]},presentation=thesisDocumentPresentation(snapshot,[{title:'研究背景',text:'数组[1]保持原文，来源引用[source:r1]。再次引用[source:r1]。'}]),bytes=await createWritingDocx(presentation.text,{documentKind:'writing',writingKind:'proposal',metadata:{title:snapshot.title,chapterTitles:['研究背景'],citationRanges:presentation.citationRanges}}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string'),document=new DOMParser().parseFromString(xml,'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',paragraphs=[...document.getElementsByTagNameNS(W,'p')].map(node=>node.textContent),links=[...document.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_'));
 assert.ok(paragraphs.includes('[1] '+entry));assert.equal(paragraphs.filter(text=>text.includes('合成研究期刊')).length,1);assert.equal(links.length,2);assert.ok(links.every(node=>node.getElementsByTagNameNS(W,'vertAlign')[0]?.getAttributeNS(W,'val')==='superscript'));assert.doesNotMatch(xml,/\[source:|\[27\]|用户实际提供的摘要/);
});


test('current standard preprint and dataset markers survive import and old generated bibliography chapters do not duplicate recovered records',()=>{
 const line='作者. 合成预印本[PP/OL]. 合成平台 (2026-01-01)[2026-10-26]. https://example.org/preprint.';const preprint=parseCitationImport('[8] '+line).items[0];assert.equal(preprint.documentType,'preprint');assert.equal(formatThesisReference(preprint),line);assert.match(formatThesisReference({title:'合成预印本',documentType:'preprint',year:'2026',url:'https://example.org/preprint'}),/\[PP\/OL\]/);
 const data=parseCitationImport('[2] 作者. 合成数据集[DS/OL]. 合成平台 (2026)[2026-10-26]. https://example.org/data.').items[0];assert.equal(data.documentType,'dataset');assert.match(formatThesisReference(data),/\[DS\/OL\]/);
 const imported=confirmed({...parseCitationImport('[1] '+entry).items[0],id:'r1'}),base={title:'旧稿参考文献恢复',references:[{id:'r1',title:imported.title,authors:imported.authors,year:imported.year,doi:imported.doi,confirmed:true}],materials:[]},snapshot=withBibliographicMetadata(base,[imported]),chapters=[{title:'研究背景',text:'引用[source:r1]。'},{title:'参考文献',text:'[source:r1] '+imported.authors+'. '+imported.title+'. '+imported.year+'. DOI: '+imported.doi}];const model=thesisDocumentPresentation(snapshot,chapters);assert.equal(model.text.split(imported.title).length-1,1);assert.doesNotMatch(model.text,/参考文献原文|已使用的参考文献/);
});
