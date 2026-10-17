import OSS from 'ali-oss';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {basename,isAbsolute} from 'node:path';

export const desktopReleaseVersion='0.1.0';
const platforms={macos:new Set(['arm64','x64']),windows:new Set(['x64'])};
const shaPattern=/^[a-f0-9]{64}$/;
const versionPattern=/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
export function desktopReleaseIdentity(value){
 if(!value||!platforms[value.platform]?.has(value.arch)||!versionPattern.test(value.version||''))throw new Error('客户端系统、架构或版本无效');
 if(typeof value.fileName!=='string'||!/^PaperKnow-[A-Za-z0-9._-]{1,100}\.(?:dmg|zip|exe|msi)$/.test(value.fileName))throw new Error('安装包文件名无效');
 const format=value.fileName.split('.').at(-1);
 if(!(value.platform==='macos'?['dmg','zip']:['exe','msi']).includes(format)||value.format!==format)throw new Error('安装包格式与系统不匹配');
 if(!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>1024*1024*1024||!shaPattern.test(value.sha256||''))throw new Error('安装包大小或 SHA-256 无效');
 if(typeof value.minSystem!=='string'||!value.minSystem.trim()||value.minSystem.length>100||/[\u0000-\u001f\u007f]/.test(value.minSystem)||value.signed!==false)throw new Error('最低系统要求或签名状态无效');
 return {platform:value.platform,arch:value.arch,version:value.version,fileName:value.fileName,bytes:value.bytes,sha256:value.sha256,minSystem:value.minSystem.trim(),format,signed:false};
}
export function createDesktopReleaseStorage(config={},client){
 const values=[config.ossBucket,config.ossEndpoint,config.ossRegion,config.ossAccessKeyId,config.ossAccessKeySecret];
 if(!client&&!values.some(Boolean))return null;
 if(!values.every(Boolean))throw new Error('客户端 OSS 配置不完整');
 const endpoint=new URL(config.ossEndpoint),prefix=config.ossPrefix||'paperknow/';
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!endpoint.hostname.endsWith('.aliyuncs.com')||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw new Error('客户端 OSS 必须使用阿里云 HTTPS 地址');
 if(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix)||!/^[-a-z0-9]{3,63}$/.test(config.ossBucket))throw new Error('客户端 OSS 项目目录或存储桶无效');
 const oss=client||new OSS({bucket:config.ossBucket,endpoint:config.ossEndpoint,region:config.ossRegion.startsWith('oss-')?config.ossRegion:`oss-${config.ossRegion}`,accessKeyId:config.ossAccessKeyId,accessKeySecret:config.ossAccessKeySecret,authorizationV4:true,secure:true,timeout:120000});
 const keyFor=value=>`${prefix}clients/${value.platform}/${value.arch}/${value.version}/${value.sha256}/${value.fileName}`;
 function descriptor(value){
  const identity=desktopReleaseIdentity(value),storageKey=keyFor(identity);
  if(value.storageProvider!=='aliyun_oss'||value.storageBucket!==config.ossBucket||value.storageKey!==storageKey)throw new Error('安装包不在当前项目的客户端目录中');
  return {...identity,storageProvider:'aliyun_oss',storageBucket:config.ossBucket,storageKey};
 }
 async function verify(value){
  const release=descriptor(value);let result;
  try{result=await oss.head(release.storageKey,{timeout:15000});}catch{throw new Error('安装包尚未上传或 OSS 暂时无法验证');}
  const headers=result.res?.headers||{},metadata=result.meta||{};
  if(Number(headers['content-length'])!==release.bytes||String(metadata.sha256||headers['x-oss-meta-sha256']||'')!==release.sha256||String(metadata['paperknow-release']||headers['x-oss-meta-paperknow-release']||'')!==`${release.platform}/${release.arch}/${release.version}`)throw new Error('OSS 安装包完整性校验失败');
  let acl;try{acl=await oss.getACL(release.storageKey,{timeout:15000});}catch{throw new Error('无法验证安装包的私有访问权限');}
  if(acl.acl!=='private')throw new Error('安装包必须使用私有对象访问权限');
  return release;
 }
 return {provider:'aliyun_oss',bucket:config.ossBucket,prefix,
  descriptor,verify,
  async upload(input){
   if(!input||!isAbsolute(input.file||''))throw new Error('请提供安装包文件的绝对路径');
   const before=await stat(input.file);
   if(!before.isFile()||before.size<1||before.size>1024*1024*1024)throw new Error('安装包必须是 1GB 以内的普通文件');
   const hash=createHash('sha256');for await(const chunk of createReadStream(input.file))hash.update(chunk);
   const identity=desktopReleaseIdentity({...input,fileName:basename(input.file),format:basename(input.file).split('.').at(-1),bytes:before.size,sha256:hash.digest('hex'),signed:false});
   const after=await stat(input.file);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('安装包在校验时发生变化，请重新构建后发布');
   const release={...identity,storageProvider:'aliyun_oss',storageBucket:config.ossBucket,storageKey:keyFor(identity)};
   let present=false;
   try{await oss.head(release.storageKey,{timeout:15000});present=true;}catch(error){if(![404,'NoSuchKey','NotFound','NoSuchObject'].includes(error.status)&&!['NoSuchKey','NotFound','NoSuchObject'].includes(error.code))throw new Error('客户端 OSS 连接检查失败');}
   if(present)return verify(release);
   let checkpoint;
   try{
    await oss.multipartUpload(release.storageKey,input.file,{parallel:2,partSize:4*1024*1024,timeout:120000,mime:'application/octet-stream',meta:{sha256:release.sha256,'paperknow-release':`${release.platform}/${release.arch}/${release.version}`},headers:{'x-oss-object-acl':'private','Content-Disposition':`attachment; filename="${release.fileName}"`,'Cache-Control':'private, no-store'},progress:(_percentage,value)=>{checkpoint=value;}});
    const final=await stat(input.file);if(final.size!==before.size||final.mtimeMs!==before.mtimeMs)throw new Error('file-changed');
    return await verify(release);
   }catch{
    // Only this uncommitted multipart upload may be aborted. Existing packages
    // and previously published catalogue rows are never removed on failure.
    if(checkpoint?.uploadId)try{await oss.abortMultipartUpload(release.storageKey,checkpoint.uploadId,{timeout:15000});}catch{}
    throw new Error('安装包上传或校验未完成，客户端目录未发布');
   }
  },
  async downloadURL(value){
   const release=await verify(value);
   let target;try{target=await oss.signatureUrlV4('GET',300,{queries:{'response-content-disposition':`attachment; filename="${release.fileName}"`,'response-content-type':'application/octet-stream','response-cache-control':'private, no-store'}},release.storageKey);}catch{throw new Error('安装包下载链接暂时不可用');}
   const url=new URL(target),expectedHost=`${config.ossBucket}.${endpoint.hostname}`;
   if(url.protocol!=='https:'||url.hostname!==expectedHost||url.username||url.password||decodeURIComponent(url.pathname)!==`/${release.storageKey}`)throw new Error('安装包下载地址校验失败');
   return target;
  }
 };
}
