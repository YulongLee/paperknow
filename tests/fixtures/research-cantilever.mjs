import sharp from 'sharp';
// Controlled, non-simulated reference artwork for layout regression only. The
// setup matches the public example; no stress values or FEA results are made up.
export const cantileverPlan={kind:'illustration',layout:'LR',description:'Left-fixed meshed cantilever with a downward tip load; a separate qualitative bending sketch on the right.',artworkDescription:'A grey rectangular beam fixed on the left, with a regular grid, a downward arrow at the free right end, and a separate bent beam outline on the right.',requiredObjects:['Cantilever','Fixed support','Downward tip load','Regular mesh','Separate bending sketch'],labels:['Fixed support','Load','Regular mesh','Bending trend']};
export const cantileverLocations={hasText:false,annotations:[{index:0,kind:'object',x:68.75,y:400},{index:1,kind:'object',x:462.5,y:272.22},{index:2,kind:'object',x:262.5,y:416.67},{index:3,kind:'object',x:813.1,y:426.6667}]};
export async function cantileverArtwork(){
 const grid=Array.from({length:13},(_,i)=>`<path d="M${120+i*48},330 V420"/>`).join('')+[350,375,400].map(y=>`<path d="M120,${y} H750"/>`).join('');
 const support=Array.from({length:9},(_,i)=>`<path d="M90,${290+i*20} l30,-20"/>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="white"/><g fill="none" stroke="#354f70" stroke-width="2"><rect x="120" y="330" width="630" height="90" fill="#e7edf2"/>${grid}<path d="M120,270 V470" stroke-width="5"/>${support}<path d="M740,180 V325" stroke-width="4"/><path d="M728,305 L740,330 L752,305" fill="#354f70"/><path d="M1000,330 H1500" stroke="#9baabc" stroke-dasharray="8 7"/><path d="M1000,330 C1160,330 1340,355 1500,530" stroke-width="5"/><path d="M1000,300 V375" stroke-width="5"/></g></svg>`;
 return sharp(Buffer.from(svg)).png().toBuffer();
}
