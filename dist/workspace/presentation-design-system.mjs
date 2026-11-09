// One visual contract for the template gallery, generated slides and editable
// export. Values are repository-owned; no user supplied CSS or paths enter it.
const families=Object.freeze({
 academic:{label:'明亮学术',coverSurface:'#FFFFFF',coverText:'#172B4D',coverMuted:'#53677F',coverOverlay:1,coverTextWidth:830,contentBackground:'#FFFFFF',secondary:'#F1F5FA',text:'#172B4D',muted:'#53677F',divider:'#D9E3ED',cardRadius:0},
 technology:{label:'深色科技',coverSurface:'#091A31',coverText:'#FFFFFF',coverMuted:'#D1DFEE',coverOverlay:.88,coverTextWidth:830,contentBackground:'#0D1E35',secondary:'#172D47',text:'#F2F7FD',muted:'#B7C9DE',divider:'#36506B',cardRadius:10},
 report:{label:'专业汇报',coverSurface:'#F6F8FC',coverText:'#172B4D',coverMuted:'#52667F',coverOverlay:1,coverTextWidth:850,contentBackground:'#F6F8FC',secondary:'#E9F0F8',text:'#172B4D',muted:'#52667F',divider:'#D4DFED',cardRadius:12},
 editorial:{label:'人文编辑',coverSurface:'#F6F0E5',coverText:'#44352A',coverMuted:'#75604E',coverOverlay:1,coverTextWidth:820,contentBackground:'#F8F4EC',secondary:'#EDE5D7',text:'#44352A',muted:'#75604E',divider:'#D6C9B8',cardRadius:0}
});
const themes=Object.freeze({
 academic:{family:'academic',primary:'#18345B',accent:'#286AFF'},formal:{family:'academic',primary:'#652A38',accent:'#A43F50'},focus:{family:'academic',primary:'#174B47',accent:'#168B89'},
 slate:{family:'report',primary:'#243446',accent:'#51647A'},indigo:{family:'technology',primary:'#181833',accent:'#A898F0'},sand:{family:'editorial',primary:'#493829',accent:'#946334'},
 cobalt:{family:'technology',primary:'#102E53',accent:'#67B5FB'},crimson:{family:'editorial',primary:'#652A38',accent:'#A43F50'},forest:{family:'academic',primary:'#193E35',accent:'#347A5D'},
 teal:{family:'technology',primary:'#123946',accent:'#5DD0D5'},ink:{family:'report',primary:'#252F3F',accent:'#596B85'},amber:{family:'editorial',primary:'#4A3828',accent:'#946334'}
});
export function presentationTemplateStyle(theme){
 const own=Object.hasOwn(themes,theme)?themes[theme]:themes.academic,base=families[own.family];
 return {...base,family:own.family,typography:{title:own.family==='editorial'?44:42,body:26},palette:{primary:own.primary,accent:own.accent,background:base.contentBackground,secondary:base.secondary,text:base.text,muted:base.muted,divider:base.divider}};
}
