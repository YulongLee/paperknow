import {simulationInUse,simulationResearchDisclosure} from './simulation-data.mjs';
import {thesisDocumentPresentation,thesisChapterCompletion} from './thesis-document.mjs';
import {thesisEnglishTitle} from './thesis-delivery.mjs';
export function thesisExportMetadata(value={},options={}){
 const snapshot=value.snapshot||value,profile=snapshot.profile||value.profile||{},requirements=snapshot.requirements||{};
 const simulations=simulationInUse(snapshot,value.chapters||[]),simulationNotes=simulationResearchDisclosure(snapshot,value.chapters||[]);
 const chapterTitles=(value.chapters||snapshot.outline||value.outlineRows||[]).filter(row=>row.level===undefined||Number(row.level)===1).map(row=>String(row.title||'').trim()).filter(Boolean);
 const title=String(value.title||snapshot.title||''),presentation=Array.isArray(value.chapters)?thesisDocumentPresentation(snapshot,value.chapters,{title,...options}):null,citationRanges=presentation?.citationRanges;
 return {title,...(simulations.length?{simulationSourceCount:simulations.length,simulationDisclosure:simulationNotes[1]}:{}),...(thesisEnglishTitle(value.chapters)?{englishTitle:thesisEnglishTitle(value.chapters)}:{}),level:String(profile.level||value.degree||''),major:String(profile.major||profile.discipline||value.major||''),institution:String(requirements.institution||value.institution||''),supervisor:String(requirements.supervisor||value.supervisor||''),author:String(value.author||requirements.author||''),...(value.exportMetadata||{}),chapterTitles,...(Array.isArray(value.chapters)&&Array.isArray(snapshot.outline)?{chapterCompletion:thesisChapterCompletion(snapshot,value.chapters)}:{}),...(citationRanges?{citationRanges}:{}),...(presentation?.figures?.length?{figures:presentation.figures}:{})};
}
