// Review dates come from the server clock, never from uploaded instructions.
// A calendar comparison does not authenticate an author's event or timestamp.
export function reviewCalendarDate(now=Date.now()){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
function calendarKey(year,month,day){
 const key=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
 const parsed=new Date(key+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===key?key:null;
}
export function contradictsReviewCalendar(finding,reviewDate){
 if(typeof reviewDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)||calendarKey(...reviewDate.split('-'))!==reviewDate)return false;
 const dates=new Set([...String(finding.quote||'').matchAll(/(?<!\d)(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})(?:日)?(?!\d)/gu)].map(m=>calendarKey(m[1],m[2],m[3])).filter(Boolean));
 // Multiple event dates or unparsed timestamps require ordinary review.
 if(dates.size!==1||[...dates][0]>reviewDate)return false;
 const explanation=String(finding.explanation||'');
 for(const match of explanation.matchAll(/(?:晚于|迟于)(?:本次|稿件)?审校(?:当日|日期)/gu)){
  if(!/(?:不|未|并非|不是|不能|不可)\s*$/u.test(explanation.slice(Math.max(0,match.index-8),match.index)))return true;
 }
 return false;
}
