// Technical export profiles are not an editorial acceptance or peer-review decision.
export const publicationPolicyVersion='2026-10-31';
export const publicationProfiles=Object.freeze({
 general:{id:'general',label:'通用投稿规范',widthMm:180,fontPt:8,minFontPt:7,maxFontPt:12,minLinePt:.4,photoDpi:300,combinedDpi:600,lineDpi:1000,aiIllustration:'check-journal',source:'https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-journal-article/create-graphics-for-your-article/'},
 nature:{id:'nature',label:'Nature 绘图规范',widthMm:183,fontPt:6.5,minFontPt:5,maxFontPt:7,minLinePt:.4,photoDpi:300,combinedDpi:600,lineDpi:1000,aiIllustration:'not-permitted',source:'https://www.nature.com/documents/nature-final-artwork.pdf',policySource:'https://www.nature.com/nature-portfolio/editorial-policies/ai'},
 elsevier:{id:'elsevier',label:'Elsevier 绘图规范',widthMm:190,fontPt:9,minFontPt:7,maxFontPt:12,minLinePt:.25,photoDpi:300,combinedDpi:500,lineDpi:1000,aiIllustration:'explanatory-only',source:'https://www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions',policySource:'https://www.elsevier.com/en-gb/about/policies-and-standards/generative-ai-policies-for-journals'},
 ieee:{id:'ieee',label:'IEEE 绘图规范',widthMm:181,fontPt:8,minFontPt:8,maxFontPt:10,minLinePt:.5,photoDpi:300,combinedDpi:600,lineDpi:600,aiIllustration:'disclosure',source:'https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-journal-article/create-graphics-for-your-article/',policySource:'https://journals.ieeeauthorcenter.ieee.org/become-an-ieee-journal-author/publishing-ethics/guidelines-and-policies/submission-and-peer-review-policies/'}
});
export function publicationProfile(id='general'){
 if(typeof id!=='string'||!Object.hasOwn(publicationProfiles,id))throw Object.assign(Error('请选择有效的投稿绘图规范。'),{status:400});
 return {...publicationProfiles[id]};
}
export const printPixels=(mm,dpi)=>Math.ceil(mm/25.4*dpi);
export function assessPublicationFigure({profile='general',widthMm,vector=false,widthPx=0,heightPx=0,minFontPt=null,maxFontPt=null,minLinePt=null,kind='illustration',dataVerified=false,aiGenerated=false,primaryResearchImage=false,graphicalAbstract=false}={}){
 const p=publicationProfile(profile),checks=[],warnings=[],add=(id,passed,message)=>checks.push({id,passed,message});
 const width=widthMm??p.widthMm;
 add('print-size',Number.isFinite(width)&&width>0&&width<=p.widthMm,`成图宽度不超过 ${p.widthMm} mm`);
 const dpi=widthPx/(width/25.4),required=kind==='data'||kind==='diagram'?p.lineDpi:p.photoDpi;
 add('resolution',vector||Number.isFinite(dpi)&&dpi+1e-6>=required,vector?'可编辑矢量线条与文字':`原始像素按成图宽度计算至少 ${required} dpi`);
 add('dimensions',vector||Number.isInteger(widthPx)&&widthPx>0&&Number.isInteger(heightPx)&&heightPx>0,'图像具有有效尺寸');
 if(minFontPt!==null)add('minimum-font',Number.isFinite(minFontPt)&&minFontPt>=p.minFontPt,`最小标注字号至少 ${p.minFontPt} pt`);
 if(maxFontPt!==null)add('maximum-font',Number.isFinite(maxFontPt)&&maxFontPt<=p.maxFontPt,`标注字号不超过 ${p.maxFontPt} pt`);
 if(minLinePt!==null)add('line-weight',Number.isFinite(minLinePt)&&minLinePt>=p.minLinePt,`最细线条至少 ${p.minLinePt} pt`);
 if(kind==='data')add('traceable-data',dataVerified===true,'图形按可核验的原始数据绘制');
 add('research-image-integrity',!(aiGenerated&&primaryResearchImage),'真实实验、患者和观测图像须来自研究原件');
 if(aiGenerated){
  if(p.aiIllustration==='not-permitted')add('publisher-ai-policy',false,'当前期刊规范不接受通用生成式 AI 插图；请选择可复现数据图或文本结构图。');
  else if(p.aiIllustration==='explanatory-only')add('publisher-ai-policy',!graphicalAbstract&&!primaryResearchImage&&kind!=='data','仅适用于可核对的解释性图示，不能替代实验图像、数据可视化或图文摘要。');
  warnings.push(p.aiIllustration==='check-journal'?'请核对目标期刊是否接受生成式 AI 插图。':'投稿图注及稿件声明需披露所用工具、版本与用途。');
 }
 return {version:publicationPolicyVersion,profile:p.id,passed:checks.every(c=>c.passed),checks,warnings,effectiveDpi:vector?null:Math.round(dpi),widthMm:width,editorialAcceptanceGuaranteed:false};
}

const basicData=new Set(['pie','bar','line','treemap','horizontal-bar','pictorial-bar','radar','heatmap','boxplot','gauge','scatter','candlestick','sankey','sunburst','calendar','parallel','river','funnel','chord']);
const basicSequence=new Set(['sequence','timing','timeline','journey','zenuml']);
export function publicationFigureKind(choice){
 if(choice.categoryId==='basic'&&['journey','timeline'].includes(choice.id))return 'diagram';
 if(choice.categoryId==='basic')return basicData.has(choice.id)?'data':basicSequence.has(choice.id)||/时序|时间线|旅程|ZenUML/.test(choice.label)?'sequence':choice.id==='auto'?'auto':'diagram';
 const name=[choice.label,choice.sceneLabel].filter(Boolean).join(' ');
 if(/混淆矩阵|ROC|生存曲线|训练曲线|损失函数|曲线拟合|峰拟合|回归分析|面板数据|计量经济|生物统计|实验数据|质量控制|过程能力|信号分析|频率响应|频谱|谱分析|时序分析/.test(name))return 'data';
 if(/光路|原理图|电路图|信号通路|信号网络|基因网络|代谢网络|蛋白互作|网络结构|模型架构|神经网络|功能块|梯形图|功能块图|顺序功能图|结构化文本|IEC 61131|控制系统|PCB布局|原理设计|数据采集|系统仿真|控制设计|动态建模|PLC|SCL|模型评估|算法对比|特征重要性/.test(name))return 'diagram';
 return 'illustration';
}
