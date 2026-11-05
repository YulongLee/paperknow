import pptxgen from 'pptxgenjs';
import {themes,validateDeck} from '../dist/workspace/presentation-model.mjs';

// Base export uses native PowerPoint text and shapes, so edits remain possible.
// A generated PPTX is saved separately; this is the editable editor's layout.
export function createPresentation(deck){
 validateDeck(deck);const pptx=new pptxgen();pptx.layout='LAYOUT_WIDE';pptx.author=deck.author||'PaperKnow 用户';pptx.subject='用户核对后的学术演示';pptx.title=deck.title;pptx.lang=deck.language==='英文'?'en-US':'zh-CN';pptx.theme={headFontFace:'Microsoft YaHei',bodyFontFace:'Microsoft YaHei',lang:pptx.lang};
 const t=themes[deck.theme]||themes.academic;
 for(const [i,s]of deck.slides.entries()){
  const slide=pptx.addSlide(),cover=s.layout==='cover',closing=s.layout==='closing',dark=cover||closing;
  slide.background={color:dark?t.dark:'F7F9FD'};
  if(dark){
   slide.addShape(pptx.ShapeType.rect,{x:10.7,y:0,w:2.63,h:7.5,line:{color:t.accent,transparency:100},fill:{color:t.accent,transparency:82}});
   // Cover illustration stays in a dedicated right-hand zone, leaving a
   // separate, bounded area for arbitrary user-provided titles and content.
   if(t.coverVariant==='ribbon'){
    slide.addShape(pptx.ShapeType.parallelogram,{x:9.15,y:2.15,w:3.45,h:3.0,line:{color:t.accent,transparency:100},fill:{color:t.accent,transparency:64}});
    slide.addShape(pptx.ShapeType.parallelogram,{x:9.45,y:2.15,w:.36,h:3.0,line:{color:t.accent,transparency:100},fill:{color:t.accent,transparency:8}});
   }else if(t.coverVariant==='geometry'){
    slide.addShape(pptx.ShapeType.roundRect,{x:9.2,y:2.15,w:3.15,h:3.0,rectRadius:.12,line:{color:t.accent,transparency:100},fill:{color:t.accent,transparency:70}});
    slide.addShape(pptx.ShapeType.roundRect,{x:9.42,y:2.37,w:2.7,h:2.56,rectRadius:.08,line:{color:t.accent,width:1.5},fill:{color:t.dark,transparency:35}});
    slide.addShape(pptx.ShapeType.rect,{x:11.7,y:4.48,w:.32,h:.32,line:{color:t.accent,transparency:100},fill:{color:t.accent}});
   }else if(t.coverVariant==='minimal'){
    slide.addShape(pptx.ShapeType.rect,{x:9.2,y:2.15,w:3.15,h:3.0,line:{color:t.accent,transparency:100},fill:{color:t.accent,transparency:78}});
    slide.addShape(pptx.ShapeType.line,{x:9.42,y:4.88,w:2.7,h:0,line:{color:t.accent,width:2}});
   }else{
    slide.addShape(pptx.ShapeType.ellipse,{x:9.28,y:2.12,w:3.1,h:3.1,line:{color:t.accent,transparency:100},fill:{color:t.accent,transparency:70}});
    slide.addShape(pptx.ShapeType.ellipse,{x:9.62,y:2.46,w:2.42,h:2.42,line:{color:t.accent,width:1.5},fill:{color:t.dark,transparency:100}});
    slide.addShape(pptx.ShapeType.line,{x:9.75,y:5.38,w:2.15,h:0,line:{color:t.accent,width:3}});
   }
  }else{
   slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.33,h:.1,line:{color:t.accent,transparency:100},fill:{color:t.accent}});
   slide.addShape(pptx.ShapeType.roundRect,{x:.64,y:2.12,w:12.05,h:4.55,rectRadius:.12,line:{color:'E2EAF5',width:.8},fill:{color:'FFFFFF'}});
  }
  slide.addText('PaperKnow · '+deck.scenario,{x:.75,y:.36,w:10.5,h:.27,fontSize:10.5,color:dark?'DCE6F5':t.accent,margin:0,fit:'shrink'});
  slide.addShape(pptx.ShapeType.rect,{x:.75,y:dark?1.55:1.7,w:dark?1.04:.66,h:.045,line:{color:t.accent,transparency:100},fill:{color:t.accent}});
  slide.addText(s.title,{x:.75,y:dark?1.95:.9,w:dark?7.8:11.55,h:dark?1.5:.78,fontSize:dark?34:26,bold:true,color:dark?'FFFFFF':t.dark,breakLine:false,fit:'shrink',margin:0,valign:'mid'});
  const textOpts={fontSize:dark?20:18,color:dark?'E2EAF5':'344762',breakLine:false,fit:'shrink',paraSpaceAfterPt:14,margin:0,valign:'top'};
  if(s.layout==='twoColumn'){
   const lines=s.body.split('\n'),middle=Math.ceil(lines.length/2);
   for(const [column,text]of [lines.slice(0,middle).join('\n'),lines.slice(middle).join('\n')].entries()){
    const x=.96+column*5.88;
    slide.addShape(pptx.ShapeType.roundRect,{x,y:2.44,w:5.58,h:3.9,rectRadius:.10,fill:{color:'F4F7FC'},line:{color:'E4EBF6',width:.6}});
    slide.addShape(pptx.ShapeType.rect,{x:x+.22,y:2.7,w:.05,h:.44,line:{color:t.accent,transparency:100},fill:{color:t.accent}});
    slide.addText(text,{...textOpts,x:x+.40,y:2.72,w:4.88,h:3.35});
   }
  }else if(!dark&&s.body.split('\n').length>=2&&s.body.split('\n').length<=4&&s.body.split('\n').every(line=>line.trim()&&Array.from(line).length<=75)){
   // Independent, unnumbered information blocks keep the author's wording and
   // never imply a sequence or relationship between unrelated statements.
   const rows=s.body.split('\n'),area=3.85,rowHeight=(area-(rows.length-1)*.15)/rows.length;
   rows.forEach((line,index)=>{const y=2.42+index*(rowHeight+.15);
    slide.addShape(pptx.ShapeType.roundRect,{x:.96,y,w:11.42,h:rowHeight,rectRadius:.1,line:{color:'E6ECF6',width:.6},fill:{color:'F6F8FC'}});
    slide.addShape(pptx.ShapeType.ellipse,{x:1.23,y:y+rowHeight/2-.045,w:.09,h:.09,line:{color:t.accent,transparency:100},fill:{color:t.accent}});
    slide.addText(line,{...textOpts,x:1.5,y:y+.14,w:10.48,h:rowHeight-.28,valign:'mid'});
   });
  }else slide.addText(s.body,{...textOpts,x:dark?.78:1.06,y:dark?3.92:2.53,w:dark?7.75:11.1,h:dark?2.12:3.75,align:closing?'center':'left'});
  if(cover&&deck.author)slide.addText('作者：'+deck.author,{x:.78,y:6.35,w:7.75,h:.34,fontSize:13,color:'E2EAF5',fit:'shrink',margin:0});
  slide.addText(`${String(i+1).padStart(2,'0')} / ${String(deck.slides.length).padStart(2,'0')}`,{x:11.55,y:7,w:1,h:.22,fontSize:10,color:dark?'DCE6F5':'778AA8',align:'right',margin:0});
  if(s.notes)slide.addNotes(s.notes);
 }
 return pptx;
}
export async function exportPresentation(deck){return createPresentation(deck).write({outputType:'uint8array',compression:true});}
