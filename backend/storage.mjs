import OSS from 'ali-oss';
import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {artifactKinds} from './artifact-formats.mjs';
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const originalKinds=['txt','docx','pdf'];
export function createStorage(config,client){
  const values=[config.ossBucket,config.ossEndpoint,config.ossRegion,config.ossAccessKeyId,config.ossAccessKeySecret];
  if(!client&&!values.some(Boolean))return null;
  if(!values.every(Boolean))throw new Error('OSS 配置不完整');
  const endpoint=new URL(config.ossEndpoint);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!endpoint.hostname.endsWith('.aliyuncs.com'))throw new Error('OSS 必须使用阿里云 HTTPS 地址');
  const prefix=config.ossPrefix||'paperknow/';
  if(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix))throw new Error('OSS 项目目录无效');
  const oss=client||new OSS({bucket:config.ossBucket,endpoint:config.ossEndpoint,region:config.ossRegion.startsWith('oss-')?config.ossRegion:`oss-${config.ossRegion}`,accessKeyId:config.ossAccessKeyId,accessKeySecret:config.ossAccessKeySecret,authorizationV4:true,secure:true,timeout:30000});
  const objectKey=(id,userId,kind,area)=>{
    if(!safeId(id)||!safeId(userId)||!(area==='originals'?originalKinds:artifactKinds).includes(kind))throw new Error('文件存储位置与当前项目配置不匹配');
    return `${prefix}users/${userId}/${area}/${id}.${kind}`;
  };
  const assertObject=(file,area)=>{
    const key=objectKey(file.id,file.user_id,file.kind,area);
    if(file.storage_bucket!==config.ossBucket||file.storage_key!==key)throw new Error('文件存储位置与当前项目配置不匹配');
    return key;
  };
  const readObject=async(file,area)=>{
    const key=assertObject(file,area),maximum=(area==='exports'||file.kind==='pdf'?20:2)*1024*1024;
    if(!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>maximum||!/^[a-f0-9]{64}$/.test(file.sha256||''))throw new Error('文件完整性校验失败');
    let buffer;
    try{
      if(typeof oss.getStream==='function'){
        const {stream}=await oss.getStream(key);let length=0;const chunks=[];
        const timeout=setTimeout(()=>stream.destroy(new Error('storage-read-timeout')),30000);timeout.unref?.();
        try{for await(const chunk of stream){length+=chunk.length;if(length>file.bytes){stream.destroy();throw new Error('storage-read-size');}chunks.push(Buffer.from(chunk));}buffer=Buffer.concat(chunks,length);}finally{clearTimeout(timeout);}
      }else buffer=Buffer.from((await oss.get(key)).content);
    }catch{throw new Error('OSS 文件读取失败，请稍后重试');}
    if(buffer.length!==file.bytes||digest(buffer)!==file.sha256)throw new Error('文件完整性校验失败');
    return buffer;
  };
  let healthState={configured:true,ok:null,checkedAt:null,lastSuccessAt:null};
  return {provider:'aliyun_oss',bucket:config.ossBucket,prefix,
    async put(id,userId,kind,buffer){
      const key=objectKey(id,userId,kind,'originals');
      try{await oss.put(key,buffer,{headers:{'x-oss-object-acl':'private','Content-Type':'application/octet-stream'}});}catch{try{await oss.delete(key);}catch{/* A private object may need storage reconciliation if both operations fail. */}throw new Error('OSS 文件保存失败，请稍后重试');}
      return key;
    },async remove(file){
      const key=assertObject(file,'originals');
      try{await oss.delete(key);}catch{throw new Error('OSS 原件删除未完成，请稍后重试');}
    },async read(file){
      return readObject(file,'originals');
    },async signedOriginalURL(file,expires=600){
      const key=assertObject(file,'originals');
      if(!['pdf','docx'].includes(file.kind)||!Number.isSafeInteger(expires)||expires<60||expires>900)throw new Error('文档翻译原件签名参数无效');
      const value=await oss.signatureUrlV4('GET',expires,{},key);
      const signed=new URL(value);
      if(signed.protocol!=='https:'||signed.hostname!==`${config.ossBucket}.${endpoint.hostname}`||signed.username||signed.password)throw new Error('原件访问签名地址无效');
      return signed.href;
    },async putArtifact(id,userId,kind,buffer,sha256){
      const key=objectKey(id,userId,kind,'exports');
      if(!Buffer.isBuffer(buffer)||!buffer.length||digest(buffer)!==sha256)throw new Error('文件完整性校验失败');
      // The caller has persisted this exact private key before I/O. On an ambiguous
      // failure it keeps cleanup metadata until removeArtifact succeeds.
      try{await oss.put(key,buffer,{timeout:90000,headers:{'x-oss-object-acl':'private','Content-Type':'application/octet-stream','Content-Disposition':'attachment'}});}catch{throw new Error('OSS 成果保存失败，请稍后重试');}
      return key;
    },async readArtifact(file){return readObject(file,'exports');
    },async removeArtifact(file){
      const key=assertObject(file,'exports');
      try{await oss.delete(key);}catch{throw new Error('OSS 成果删除未完成，请稍后重试');}
    },healthStatus(){return {...healthState};
    },async health(){
      const checkedAt=new Date().toISOString(),key=`${prefix}_health/${randomUUID()}.txt`,buffer=Buffer.from('paperknow-storage-health');let ok=false,reason='OSS 存储读写检查未通过';
      try{
        await oss.put(key,buffer,{timeout:3000,headers:{'x-oss-object-acl':'private','Content-Type':'application/octet-stream'}});
        const result=await oss.get(key,{timeout:3000});ok=digest(Buffer.from(result.content))===digest(buffer);
      }catch{/* Do not disclose provider credentials or diagnostics. */}
      try{await oss.delete(key,{timeout:3000});}catch{ok=false;reason='OSS 存储检查清理未完成';}
      healthState={configured:true,ok,checkedAt,lastSuccessAt:ok?checkedAt:healthState.lastSuccessAt,...(ok?{}:{reason})};
      return {...healthState};
    }};
}
export async function fileBytes(file,storage){
  if(file.storage_provider==='aliyun_oss'){
    if(!storage)throw new Error('此文件保存在 OSS，请配置存储服务后读取');
    return storage.read(file);
  }
  return Buffer.from(file.body);
}
