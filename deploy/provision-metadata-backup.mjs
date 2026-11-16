// Explicit one-time bootstrap. Never prints AccessKeys or user records.
// Creates only a new PaperKnow backup bucket and its narrowly scoped API user.
import OSS from 'ali-oss';
import OpenAPI from '@alicloud/openapi-client';
import Util from '@alicloud/tea-util';
import {randomBytes} from 'node:crypto';
import {mkdir,lstat,writeFile} from 'node:fs/promises';
import {environmentConfig} from '../backend/config.mjs';
const cfg=environmentConfig(process.env),stateRoot='/var/lib/paperknow-ops';
if(process.getuid?.()!==0||process.argv.length!==3||process.argv[2]!=='--apply')throw Error('Explicit installed root bootstrap required.');
try{await lstat('/etc/paperknow/backup.env');throw Error('Backup configuration already exists; refuse to replace it.');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(stateRoot,{mode:0o700,recursive:true});const s=await lstat(stateRoot);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o777)!==0o700)throw Error('Unsafe operations directory.');
const metadataPath=stateRoot+'/backup-provision.json';
try{await lstat(metadataPath);throw Error('Previous bootstrap exists; inspect its private state before retrying.');}catch(e){if(e.code!=='ENOENT')throw e;}
const suffix=randomBytes(4).toString('hex'),bucket='paperknow-metadata-backup-'+suffix,user='paperknow-metadata-backup-'+suffix,policy='PaperKnowMetadataBackup'+suffix;
const state={bucket,user,policy,stage:'prepared',createdAt:new Date().toISOString()},save=()=>writeFile(metadataPath,JSON.stringify(state)+'\n',{mode:0o600});await save();
const rootOss=new OSS({bucket,endpoint:cfg.ossEndpoint,region:cfg.ossRegion,accessKeyId:cfg.ossAccessKeyId,accessKeySecret:cfg.ossAccessKeySecret,authorizationV4:true,secure:true,timeout:15000});
const ram=new OpenAPI.default(new OpenAPI.Config({accessKeyId:cfg.ossAccessKeyId,accessKeySecret:cfg.ossAccessKeySecret,endpoint:'ram.aliyuncs.com',protocol:'HTTPS'}));
const call=async(action,query)=>ram.callApi(new OpenAPI.Params({action,version:'2015-05-01',protocol:'HTTPS',pathname:'/',method:'POST',authType:'AK',bodyType:'json',reqBodyType:'formData',style:'RPC'}),new OpenAPI.OpenApiRequest({query}),new Util.RuntimeOptions({autoretry:false,maxAttempts:1,connectTimeout:10000,readTimeout:15000}));
try{
 await rootOss.putBucket(bucket,{acl:'private',StorageClass:'Standard'});state.stage='bucket_created';await save();
 const block=rootOss._bucketRequestParams('PUT',bucket,'publicAccessBlock');block.mime='xml';block.content='<?xml version="1.0" encoding="UTF-8"?><PublicAccessBlockConfiguration><BlockPublicAccess>true</BlockPublicAccess></PublicAccessBlockConfiguration>';block.successStatuses=[200];await rootOss.request(block);
 await rootOss.putBucketEncryption(bucket,{SSEAlgorithm:'AES256'});
 // This brand new bucket contains only our recovery points, never user originals.
 await rootOss.putBucketLifecycle(bucket,[{id:'metadata-recovery-35-days',prefix:'paperknow-metadata-v1/',status:'Enabled',expiration:{days:35}}]);
 await call('CreateUser',{UserName:user,DisplayName:'PaperKnow database backup API only'});state.stage='identity_created';await save();
 const document={Version:'1',Statement:[{Effect:'Allow',Action:['oss:PutObject','oss:PutObjectAcl','oss:GetObject'],Resource:[`acs:oss:*:*:${bucket}/paperknow-metadata-v1/*`]},{Effect:'Allow',Action:['oss:GetBucketAcl','oss:GetBucketVersioning','oss:GetBucketPublicAccessBlock'],Resource:[`acs:oss:*:*:${bucket}`]}]};
 await call('CreatePolicy',{PolicyName:policy,PolicyDocument:JSON.stringify(document),Description:'Read/write immutable PaperKnow metadata recovery points only. No delete or production access.'});
 await call('AttachPolicyToUser',{UserName:user,PolicyName:policy,PolicyType:'Custom'});state.stage='policy_attached';await save();
 const response=await call('CreateAccessKey',{UserName:user}),access=response.body?.AccessKey;
 if(!access?.AccessKeyId||!access?.AccessKeySecret)throw Error('API identity unavailable');
 const env={PK_OSS_BUCKET:cfg.ossBucket,PK_BACKUP_OSS_BUCKET:bucket,PK_BACKUP_OSS_ENDPOINT:cfg.ossEndpoint,PK_BACKUP_OSS_REGION:cfg.ossRegion,PK_BACKUP_OSS_ACCESS_KEY_ID:access.AccessKeyId,PK_BACKUP_OSS_ACCESS_KEY_SECRET:access.AccessKeySecret};
 for(const value of Object.values(env))if(typeof value!=='string'||/[\r\n'"\s]/.test(value))throw Error('Invalid protected environment value');
 await writeFile('/etc/paperknow/backup.env',Object.entries(env).filter(([k])=>k!=='PK_OSS_BUCKET').map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});state.stage='credentials_saved';await save();
 // IAM propagation can lag. Verification is a separate rerunnable read-only step.
 console.log(JSON.stringify({configured:true,retentionDays:35,scope:'Private SSE-OSS database metadata only; dedicated API identity; verification required.'}));
}catch{console.error('Backup bootstrap incomplete; inspect private provision state. No production bucket was changed; do not blindly rerun.');process.exitCode=1;}
