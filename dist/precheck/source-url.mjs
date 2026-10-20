// Source metadata is also included in downloadable reports. Never retain an
// account credential or a temporary signed download link as a public source.
export function publicSourceHref(value){
 if(typeof value!=='string'||!value.trim()||value.length>4096||/[\x00-\x20\x7f\\]/.test(value.trim()))return null;
 try{
  const url=new URL(value.trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
  const sensitive=key=>{const normalized=key.replace(/[_.-]/g,'').toLowerCase();return /token|secret|password|passwd|signature|credential|authorization|accesskey|apikey|session|jwt|ticket|bearer/.test(normalized)||['sig','key','code','policy','expires'].includes(normalized)||/^x(?:amz|oss|goog)/.test(normalized);};
  if([...url.searchParams.keys()].some(sensitive))return null;
  // OAuth-style fragments are private too; ordinary paper section anchors stay.
  const fragment=url.hash.slice(1),query=fragment.includes('?')?fragment.slice(fragment.indexOf('?')+1):fragment;
  if(query.includes('=')&&[...new URLSearchParams(query).keys()].some(sensitive))return null;
  return url.href;
 }catch{return null;}
}
