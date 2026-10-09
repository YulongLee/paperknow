// Fit actual saved results to the available viewport without stretching cards.
export function fitProjectRows({width,height,listTop,rowHeight,footerHeight=180}){
 if(width<=760)return 5;
 if(![height,listTop,rowHeight,footerHeight].every(Number.isFinite)||rowHeight<=0)return 5;
 return Math.max(3,Math.min(20,Math.floor((height-listTop-footerHeight)/rowHeight)));
}
