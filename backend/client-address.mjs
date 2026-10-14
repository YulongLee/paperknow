import {isIP} from 'node:net';

const loopbackProxies=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);

export function clientAddress(req,config={}){
  const remoteAddress=req.socket.remoteAddress;
  if(config.trustProxy!==true||!loopbackProxies.has(remoteAddress))return remoteAddress;
  const forwarded=req.headers['x-real-ip'];
  return typeof forwarded==='string'&&isIP(forwarded)?forwarded:remoteAddress;
}
