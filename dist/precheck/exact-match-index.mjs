/** Deterministic suffix array + LCP RMQ. No hashes or approximate matching. */
function suffixLcpIndex(first,second){
 const values=[...first.map(c=>c.codePointAt(0)+1),0,...second.map(c=>c.codePointAt(0)+1)],n=values.length;
 const alphabet=[...new Set(values)].sort((a,b)=>a-b),codes=new Map(alphabet.map((value,index)=>[value,index+1]));
 let rank=Uint32Array.from(values,value=>codes.get(value)),classes=alphabet.length,sa=Uint32Array.from({length:n},(_,i)=>i),scratch=new Uint32Array(n),nextRank=new Uint32Array(n);
 function sortBy(input,result,offset){const counts=new Uint32Array(classes+1);for(let i=0;i<n;i++)counts[input[i]+offset<n?rank[input[i]+offset]:0]++;let sum=0;for(let i=0;i<counts.length;i++){const count=counts[i];counts[i]=sum;sum+=count;}for(let i=0;i<n;i++){const index=input[i],key=index+offset<n?rank[index+offset]:0;result[counts[key]++]=index;}}
 for(let length=1;length<n;length*=2){sortBy(sa,scratch,length);sortBy(scratch,sa,0);let count=1;nextRank[sa[0]]=count;for(let i=1;i<n;i++){const a=sa[i-1],b=sa[i];if(rank[a]!==rank[b]||(a+length<n?rank[a+length]:0)!==(b+length<n?rank[b+length]:0))count++;nextRank[b]=count;}[rank,nextRank]=[nextRank,rank];classes=count;if(classes===n)break;}
 const order=new Uint32Array(n),lcp=new Uint32Array(n);for(let i=0;i<n;i++)order[sa[i]]=i;let common=0;for(let i=0;i<n;i++){const at=order[i];if(at===0){common=0;continue;}const j=sa[at-1];while(i+common<n&&j+common<n&&values[i+common]===values[j+common])common++;lcp[at]=common;if(common)common--;}
 const logs=new Uint8Array(n+1);for(let i=2;i<=n;i++)logs[i]=logs[i>>1]+1;const levels=[lcp];for(let k=1;(1<<k)<=n;k++){const span=1<<k,half=span>>1,previous=levels[k-1],current=new Uint32Array(n-span+1);for(let i=0;i<current.length;i++)current[i]=Math.min(previous[i],previous[i+half]);levels.push(current);}
 return (i,j)=>{if(i>=first.length||j>=second.length)return 0;let a=order[i],b=order[first.length+1+j];if(a>b)[a,b]=[b,a];a++;const length=b-a+1,k=logs[length],span=1<<k;return Math.min(levels[k][a],levels[k][b-span+1]);};
}
export function exactMatchExtents(first,second){const right=suffixLcpIndex(first,second),left=suffixLcpIndex([...first].reverse(),[...second].reverse());return (i,j)=>{const before=i&&j?left(first.length-i,second.length-j):0,after=right(i,j);return {a:i-before,b:j-before,e:i+after,f:j+after};};}
