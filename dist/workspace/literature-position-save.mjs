// Persist only the last page reached during a burst of scrolling.
export function createReadingPositionSaver({save,delay=500,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let timer=null,pending=null;
 const flush=()=>{if(timer!==null){clearTimer(timer);timer=null;}if(pending===null)return;const position=pending;pending=null;save(position);};
 return {
  schedule(position){pending=position;if(timer!==null)clearTimer(timer);timer=setTimer(flush,delay);},
  flush
 };
}
