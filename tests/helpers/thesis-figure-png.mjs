import {deflateSync} from 'node:zlib';
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
export function pngChunk(type,data=new Uint8Array()){
 const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length,0);chunk.write(type,4,'ascii');chunk.set(data,8);let crc=0xffffffff;for(let index=4;index<chunk.length-4;index++)crc=crcTable[(crc^chunk[index])&255]^(crc>>>8);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);return chunk;
}
export function figurePngFixture(width=1,height=1){
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const raw=Buffer.alloc(height*(width*4+1));for(let row=0;row<height;row++)for(let column=0;column<width;column++){const at=row*(width*4+1)+1+column*4;raw.set([41,91,151,255],at);}return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND')]));
}
