// Only numeric operational metrics enter the history response; never request,
// user, document, provider or database-path fields from stored payloads.
export const monitoringRanges=Object.freeze({'1h':3600000,'6h':21600000,'24h':86400000});
export const monitoringHistoryFields=Object.freeze(['diskPercent','hostMemoryPercent','processMemoryMiB','loadPerCore','queue','running','errorPercent','p95Ms','alerts']);
export function monitoringRange(value='1h'){
 if(typeof value!=='string'||!Object.hasOwn(monitoringRanges,value))throw Object.assign(Error('请选择最近1小时、6小时或24小时'),{status:400});
 return value;
}
const value=(n,percent=false)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&(!percent||n<=100)?Math.round(n*100)/100:null;
export function monitoringHistory(rows,{range='1h',now=Date.now(),intervalSeconds=60,maximumPoints=240}={}){
 monitoringRange(range);
 const from=now-monitoringRanges[range],to=now,points=[];let invalidSamples=0;
 for(const row of rows){
  try{
   const time=Date.parse(row.created_at);if(!Number.isFinite(time)||time<from||time>to)continue;
   const data=JSON.parse(row.payload),m=data?.metrics;if(!m||typeof m!=='object')throw Error('invalid sample');
   points.push({at:new Date(time).toISOString(),diskPercent:value(m.disk?.usedPercent,true),hostMemoryPercent:value(m.host?.memoryUsedPercent,true),processMemoryMiB:value(typeof m.process?.rssBytes==='number'?m.process.rssBytes/1024**2:null),loadPerCore:value(m.host?.loadPerCore),queue:value(m.jobs?.queued),running:value(m.jobs?.running),errorPercent:value(m.http?.errorPercent,true),p95Ms:value(m.http?.p95Ms),alerts:Array.isArray(data.alerts)?data.alerts.length:null});
  }catch{invalidSamples++;}
 }
 points.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const limit=Math.max(2,Math.min(240,Number.isSafeInteger(maximumPoints)?maximumPoints:240)),bucketMs=monitoringRanges[range]/limit;
 let history=points,aggregation='none';
 if(points.length>limit){
  aggregation='max';const buckets=new Map();
  for(const point of points){
   const key=Math.min(limit-1,Math.floor((Date.parse(point.at)-from)/bucketMs));
   if(!buckets.has(key))buckets.set(key,{at:point.at,...Object.fromEntries(monitoringHistoryFields.map(field=>[field,null]))});
   const bucket=buckets.get(key);bucket.at=point.at;
   for(const field of monitoringHistoryFields)if(point[field]!==null)bucket[field]=bucket[field]===null?point[field]:Math.max(bucket[field],point[field]);
  }
  history=[...buckets.values()];
 }
 const latestMetrics=Object.fromEntries(monitoringHistoryFields.map(field=>{const point=points.findLast(p=>p[field]!==null);return [field,point?{at:point.at,value:point[field]}:null];}));
 let maxGap=0;for(let i=1;i<points.length;i++)maxGap=Math.max(maxGap,Date.parse(points[i].at)-Date.parse(points[i-1].at));
 return {history,historyMeta:{range,from:new Date(from).toISOString(),to:new Date(to).toISOString(),sampleCount:points.length,latestMetrics,invalidSamples,pointsReturned:history.length,maximumPoints:limit,aggregation,bucketSeconds:aggregation==='max'?Math.ceil(bucketMs/1000):null,intervalSeconds,coverageFrom:points[0]?.at||null,coverageTo:points.at(-1)?.at||null,maxGapSeconds:Math.ceil(maxGap/1000)}};
}
