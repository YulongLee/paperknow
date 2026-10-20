import pptxgen from 'pptxgenjs';
import {themes,validateDeck} from '../dist/workspace/presentation-model.mjs';

export function createPresentation(deck){
 validateDeck(deck);const pptx=new pptxgen();pptx.layout='LAYOUT_WIDE';pptx.author=deck.author||'PaperKnow 用户';pptx.subject='用户核对后的学术演示';pptx.title=deck.title;pptx.lang=deck.language==='英文'?'en-US':'zh-CN';pptx.theme={headFontFace:'Microsoft YaHei',bodyFontFace:'Microsoft YaHei',lang:pptx.lang};
 const t=themes[deck.theme]||themes.academic;
 for(const [i,s]of deck.slides.entries()){
  const slide=pptx.addSlide(),cover=s.layout==='cover',closing=s.layout==='closing';slide.background={color:cover?t.dark:'FFFFFF'};
  slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:.16,h:7.5,fill:{color:t.accent},line:{color:t.accent}});
  slide.addShape(pptx.ShapeType.rect,{x:.65,y:cover?1.7:1.9,w:cover?1.2:.7,h:.055,fill:{color:t.accent},line:{color:t.accent}});
  slide.addText('PaperKnow · '+deck.scenario,{x:.65,y:.36,w:11.5,h:.3,fontSize:11,color:cover?'DCE6F5':t.accent});
  slide.addText(s.title,{x:.7,y:cover?2.12:1.02,w:11.8,h:cover?1.5:1.05,fontSize:cover?34:26,bold:true,color:cover?'FFFFFF':t.dark,breakLine:false,fit:'shrink'});
  const textOpts={fontSize:cover?20:18,color:cover?'E2EAF5':'394D68',breakLine:false,fit:'shrink',paraSpaceAfterPt:16,margin:0,valign:'top'};
  if(s.layout==='twoColumn'){
   const lines=s.body.split('\n'),middle=Math.ceil(lines.length/2);
   for(const [column,text]of [lines.slice(0,middle).join('\n'),lines.slice(middle).join('\n')].entries()){
    slide.addShape(pptx.ShapeType.roundRect,{x:.7+column*6.05,y:2.3,w:5.8,h:4.1,rectRadius:.12,fill:{color:'F4F7FC'},line:{color:'E3EAF5'}});
    slide.addText(text,{...textOpts,x:.95+column*6.05,y:2.57,w:5.25,h:3.56});
   }
  }else slide.addText(s.body,{...textOpts,x:.75,y:cover?4:2.38,w:11.7,h:cover?2:3.95,align:closing?'center':'left'});
  if(cover&&deck.author)slide.addText('作者：'+deck.author,{x:.75,y:6.35,w:11.2,h:.35,fontSize:14,color:'E2EAF5',fit:'shrink',margin:0});
  slide.addText(`${i+1} / ${deck.slides.length}`,{x:11.6,y:7,w:1,h:.2,fontSize:10,color:cover?'DCE6F5':'7C8BA3',align:'right'});
  if(s.notes)slide.addNotes(s.notes);
 }
 return pptx;
}
export async function exportPresentation(deck){return createPresentation(deck).write({outputType:'uint8array',compression:true});}
