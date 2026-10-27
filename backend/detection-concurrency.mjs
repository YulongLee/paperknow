// A failed worker stops new work, while issued requests are joined before return.
export async function concurrentDetection(items,limit,work){
 let cursor=0,failure;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
  while(!failure&&cursor<items.length){const index=cursor++;try{await work(items[index],index);}catch(error){failure??=error;}}
 }));
 if(failure)throw failure;
}
export function detectionSlots(limit){
 let active=0;const queue=[];
 return async work=>{
  if(active>=limit)await new Promise(resolve=>queue.push(resolve));else active++;
  try{return await work();}finally{const next=queue.shift();if(next)next();else active--;}
 };
}
