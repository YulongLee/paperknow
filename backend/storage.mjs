import OSS from 'ali-oss';
import {digest} from './auth.mjs';
export function createStorage(config,client){
  const values=[config.ossBucket,config.ossEndpoint,config.ossRegion,config.ossAccessKeyId,config.ossAccessKeySecret];
  if(!client&&!values.some(Boolean))return null;
  if(!values.every(Boolean))throw new Error('OSS 配置不完整');
  const endpoint=new URL(config.ossEndpoint);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!endpoint.hostname.endsWith('.aliyuncs.com'))throw new Error('OSS 必须使用阿里云 HTTPS 地址');
  const prefix=config.ossPrefix||'paperknow/';
  if(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix))throw new Error('OSS 项目目录无效');
  const oss=client||new OSS({bucket:config.ossBucket,endpoint:config.ossEndpoint,region:config.ossRegion.startsWith('oss-')?config.ossRegion:`oss-${config.ossRegion}`,accessKeyId:config.ossAccessKeyId,accessKeySecret:config.ossAccessKeySecret,authorizationV4:true,secure:true,timeout:30000});
  return {provider:'aliyun_oss',bucket:config.ossBucket,prefix,
    async put(id,userId,kind,buffer){
      const key=`${prefix}users/${userId}/originals/${id}.${kind}`;
      try{await oss.put(key,buffer,{headers:{'x-oss-object-acl':'private','Content-Type':'application/octet-stream'}});}catch{throw new Error('OSS 文件保存失败，请稍后重试');}
      return key;
    },async read(file){
      if(file.storage_bucket!==config.ossBucket||!file.storage_key?.startsWith(`${prefix}users/${file.user_id}/originals/`))throw new Error('文件存储位置与当前项目配置不匹配');
      let result;try{result=await oss.get(file.storage_key);}catch{throw new Error('OSS 文件读取失败，请稍后重试');}
      const buffer=Buffer.from(result.content);
      if(buffer.length!==file.bytes||digest(buffer)!==file.sha256)throw new Error('文件完整性校验失败');
      return buffer;
    }};
}
export async function fileBytes(file,storage){
  if(file.storage_provider==='aliyun_oss'){
    if(!storage)throw new Error('此文件保存在 OSS，请配置存储服务后读取');
    return storage.read(file);
  }
  return Buffer.from(file.body);
}
