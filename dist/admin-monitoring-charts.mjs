const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const number=v=>numeric(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:1}):'—';
const time=(v,full=false)=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,...(full?{year:'numeric'}:{})});
const metrics=[
 ['diskPercent','磁盘使用率','%','整台共享服务器',100,'blue'],['hostMemoryPercent','主机内存使用率','%','整台主机，按可用内存统计',100,'teal'],
 ['processMemoryMiB','本站进程内存','MiB','仅PaperKnow进程RSS',null,'violet'],['loadPerCore','主机每核心负载','','主机1分钟平均负载 / 核心数',null,'amber'],
 ['queue','排队任务','条','本站服务任务',null,'blue'],['running','执行中任务','条','本站服务任务',null,'teal'],
 ['p95Ms','接口响应P95','ms','各采样点对应此前5分钟的请求',null,'violet'],['errorPercent','接口5xx比例','%','各采样点对应此前5分钟的请求',100,'rose']
];
function chart(history,meta,[key,label,unit,scope,fixedMax,tone]){
 const points=history.map(p=>({at:Date.parse(p.at),value:p[key]})).filter(p=>Number.isFinite(p.at));
 const from=Date.parse(meta.from),to=Date.parse(meta.to),valid=points.filter(p=>numeric(p.value)&&p.at>=from&&p.at<=to),rawLast=meta.latestMetrics?.[key],last=meta.latestMetrics?(rawLast&&numeric(rawLast.value)&&Number.isFinite(Date.parse(rawLast.at))?{at:Date.parse(rawLast.at),value:rawLast.value}:null):valid.at(-1),peak=valid.length?Math.max(...valid.map(p=>p.value)):null;
 const lastLabel=meta.aggregation==='max'&&!meta.latestMetrics?'最近时段峰值':'最近有效采样';
 const max=fixedMax??Math.max(1,peak??0)*1.15,left=55,right=616,top=18,bottom=178;
 const x=t=>left+(t-from)/Math.max(1,to-from)*(right-left),y=v=>bottom-v/max*(bottom-top),gap=Math.max(1,meta.intervalSeconds||60,meta.bucketSeconds||0)*2500;
 let path='',previous=null;
 for(const p of points){
  if(!numeric(p.value)||p.at<from||p.at>to){previous=null;continue;}
  path+=`${!previous||p.at-previous.at>gap?'M':'L'}${x(p.at).toFixed(2)} ${y(p.value).toFixed(2)} `;previous=p;
 }
 const title=label+(last?`，${lastLabel}${time(last.at)}：${number(last.value)}${unit}，时段峰值${number(peak)}${unit}`:'，该时段暂无有效采样');
 const graphic=valid.length?`<svg class="monitor-series-svg" viewBox="0 0 640 220" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${[0,1,2,3,4].map(i=>{const yy=top+(bottom-top)*i/4;return `<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" class="monitor-grid-line"/><text x="46" y="${yy+4}" text-anchor="end">${esc(number(max*(4-i)/4))}</text>`;}).join('')}${[0,.5,1].map((v,i)=>`<text x="${left+(right-left)*v}" y="204" text-anchor="${i===0?'start':i===2?'end':'middle'}">${esc(time(from+(to-from)*v))}</text>`).join('')}<path class="monitor-series-line" d="${path.trim()}"/>${valid.map(p=>`<circle class="monitor-series-point${valid.length===1?' is-single':''}" cx="${x(p.at).toFixed(2)}" cy="${y(p.value).toFixed(2)}" r="${valid.length===1?4:3}"><title>${esc(time(p.at,true)+' · '+number(p.value)+' '+unit+(meta.aggregation==='max'?'（该时间段峰值）':''))}</title></circle>`).join('')}</svg>`:`<div class="monitor-series-empty">${key==='p95Ms'||key==='errorPercent'?'该时段暂无有效请求采样':'该时段暂无有效采样'}<small>数据不足时保留空白，不按0填补。</small></div>`;
 return `<article class="monitor-series ${tone}" data-monitor-chart="${key}"><header><div><h3>${esc(label)}</h3><p>${esc(scope)}</p></div><div class="monitor-series-value"><strong>${last?esc(number(last.value)):'—'}</strong><span>${esc(unit)}</span></div></header>${graphic}<footer><span>${last?lastLabel+' '+esc(time(last.at)):'等待有效采样'}</span><span>时段峰值 ${esc(number(peak))}${peak===null?'':' '+esc(unit)}</span></footer></article>`;
}
export function monitoringCharts(data,{range=data.historyMeta?.range||'1h'}={}){
 const history=(data.history||[]).filter(p=>Number.isFinite(Date.parse(p.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const latest=Date.parse(data.latest?.sampledAt),to=Number.isFinite(latest)?latest:Date.now(),duration=({'1h':3600000,'6h':21600000,'24h':86400000})[range]||3600000;
 const meta={range,from:new Date(to-duration).toISOString(),to:new Date(to).toISOString(),sampleCount:history.length,intervalSeconds:data.settings?.sampleIntervalSeconds||60,aggregation:'none',...data.historyMeta};
 const start=Date.parse(meta.from),end=Date.parse(meta.to);if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw Error('监控历史时间范围无效');
 const rows=history.filter(p=>Date.parse(p.at)>=start&&Date.parse(p.at)<=end);
 return `<section class="panel monitor-history" aria-labelledby="monitor-history-title"><div class="panel-heading"><div><h2 id="monitor-history-title">历史运行趋势</h2><p>北京时间 ${esc(time(start,true))} — ${esc(time(end,true))}</p></div><div class="monitor-range" role="group" aria-label="监控时间范围">${[['1h','近1小时'],['6h','近6小时'],['24h','近24小时']].map(([key,label])=>`<button class="button" type="button" data-monitor-range="${key}" aria-pressed="${key===range}">${label}</button>`).join('')}<span id="monitor-history-loading" class="monitor-note" role="status" hidden>正在更新曲线…</span></div></div><div class="monitor-history-note"><span>${esc(number(meta.sampleCount))} 个采样 · ${esc(number(rows.length))} 个展示点</span><span>${meta.aggregation==='max'?'按时间段展示各指标峰值；接口P95不代表整个时段的总体P95。':'展示实际采样值；缺失读数和采样中断保留空缺。'}</span>${meta.invalidSamples?`<span>有 ${esc(number(meta.invalidSamples))} 条异常历史记录未绘制。</span>`:''}</div><div class="monitor-series-grid">${metrics.map(metric=>chart(rows,meta,metric)).join('')}</div><details class="monitor-data"><summary>查看图表采样值</summary><div class="table-scroll"><table class="data-table"><caption class="visually-hidden">图表采样值；${meta.aggregation==='max'?'降采样点为对应时间段各指标峰值':'实际采样'}</caption><thead><tr><th>北京时间</th>${metrics.map(m=>`<th>${esc(m[1])}${m[2]?'（'+esc(m[2])+'）':''}</th>`).join('')}</tr></thead><tbody>${rows.map(p=>`<tr><td>${esc(time(p.at,true))}</td>${metrics.map(([key])=>`<td>${esc(number(p[key]))}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="9">该时段没有采样记录</td></tr>'}</tbody></table></div></details></section>`;
}
