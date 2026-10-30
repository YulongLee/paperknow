export function mapPdfView(view={},pageCount){
 const total=Math.max(1,Number(pageCount)||1),source=Math.max(1,Number(view.pageCount)||total),page=Math.max(1,Math.min(source,Number(view.page)||1)),fraction=Math.max(0,Math.min(1,Number(view.fraction)||0));
 const point=source===total?page-1+fraction:(page-1+fraction)/source*total;
 const target=Math.min(total-1,Math.max(0,Math.floor(point)));
 return{page:target+1,fraction:Math.max(0,Math.min(1,point-target)),xFraction:Math.max(0,Math.min(1,Number(view.xFraction)||0)),scale:Math.max(.75,Math.min(1.75,Number(view.scale)||1)),pageCount:total};
}
export function normalizedSelectionRects(rects,page){
 if(!page?.width||!page?.height)return[];const result=[];
 for(const rect of rects){const left=Math.max(page.left,rect.left),right=Math.min(page.right,rect.right),top=Math.max(page.top,rect.top),bottom=Math.min(page.bottom,rect.bottom);if(right-left<1||bottom-top<1)continue;const item={x:(left-page.left)/page.width,y:(top-page.top)/page.height,width:(right-left)/page.width,height:(bottom-top)/page.height};if(!result.some(v=>Math.abs(v.x-item.x)<.001&&Math.abs(v.y-item.y)<.001&&Math.abs(v.width-item.width)<.001&&Math.abs(v.height-item.height)<.001))result.push(item);}
 return result.slice(0,100);
}
