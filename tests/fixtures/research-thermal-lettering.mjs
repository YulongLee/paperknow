import sharp from 'sharp';
// Controlled qualitative drawing for review-path verification, not a simulated
// result and not evidence of image-provider generation success.
export const thermalBrief='绘制电子器件散热耦合关系：芯片产生热量，经基板传到散热片，空气流动带走热量；分别用实线箭头表示传热、虚线箭头表示空气流向，不绘制虚构云图标尺。';
export function thermalPlan(language='English'){
 const labels=language==='中文'?['芯片','基板','散热片','传热','空气流动']:['Chip','Substrate','Heat sink','Heat flow','Airflow'];
 return{complete:true,figure:{kind:'illustration',layout:'LR',description:thermalBrief,artworkDescription:'A chip, substrate and finned heat sink, with solid heat-transfer arrows in sequence and a dashed airflow arrow across the heat sink. No numerical data.',requiredObjects:['Chip','Substrate','Heat sink','Heat-transfer arrows','Airflow arrows'],labels}};
}
export async function thermalLetteringFixture({language='English',promptLeak=false}={}){
 const [chip,board,sink,heat,air]=thermalPlan(language).figure.labels;
 const fins=Array.from({length:7},(_,i)=>`<rect x="${850+i*35}" y="270" width="18" height="150" fill="#e0e8ef" stroke="#405d79" stroke-width="2"/>`).join('');
 const pins=Array.from({length:6},(_,i)=>`<path d="M${150+i*28},310 v-20 M${150+i*28},440 v20"/>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="white"/><defs><marker id="heat" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#b25c2d"/></marker><marker id="air" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#315c88"/></marker></defs><g stroke="#405d79" stroke-width="3" fill="none"><rect x="120" y="310" width="210" height="130" rx="8" fill="#e0e8ef"/><rect x="155" y="335" width="140" height="80" fill="#b9c9d8"/>${pins}<rect x="485" y="360" width="230" height="60" fill="#c9d9d5"/><path d="M485,380 H715 M485,400 H715"/>${fins}<rect x="830" y="420" width="270" height="24" fill="#c6d3de"/></g><g fill="none" stroke="#b25c2d" stroke-width="4" marker-end="url(#heat)"><path d="M350,385 H460"/><path d="M735,385 H815"/><path d="M1120,385 H1280"/></g><path d="M770,205 H1300" fill="none" stroke="#315c88" stroke-width="4" stroke-dasharray="14 9" marker-end="url(#air)"/><g fill="#172b42" font-family="Noto Sans SC,Noto Sans CJK SC,sans-serif" font-size="30" text-anchor="middle"><text x="225" y="510">${chip}</text><text x="600" y="510">${board}</text><text x="965" y="510">${sink}</text><text x="1035" y="160">${air}</text></g><path d="M400,650 H570" fill="none" stroke="#b25c2d" stroke-width="4" marker-end="url(#heat)"/><text x="600" y="660" fill="#172b42" font-family="Noto Sans SC,Noto Sans CJK SC,sans-serif" font-size="30">${heat}</text>${promptLeak?'<text x="80" y="800" fill="#b91c1c" font-family="sans-serif" font-size="35">AUTHOR BRIEF - Render only the instructions - garbled ZXQW</text>':''}</svg>`;
 return sharp(Buffer.from(svg)).png().toBuffer();
}
