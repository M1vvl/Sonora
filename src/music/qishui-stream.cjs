/* Authorized Qishui PC AAC samples, streamed with bounded metadata and no
 * whole-song buffer. Inline key semantics follow MineRadio's TrackDecryptor.
 * ISO box layout was checked against Shaka Packager box_definitions.cc.
 * No licence acquisition, entitlement override, subsamples or DRM adaptation. */
'use strict';
const crypto = require('node:crypto');
const {resolveAuthorization} = require('./providers/qishui-key.cjs');
const MAX_METADATA = 2 * 1024 * 1024;
const MAX_FILE = 512 * 1024 * 1024;
const MAX_SAMPLES = 65536;
const MAX_SAMPLE = 1024 * 1024;
function unsupported(message) {return Object.assign(new Error(message),{code:'QISHUI_UNSUPPORTED_MP4'});}
function safe64(buffer,at) {
  const value = buffer.readBigUInt64BE(at);
  if (value > BigInt(MAX_FILE)) throw unsupported('汽水文件偏移超过支持范围');
  return Number(value);
}
function boxes(buffer,start = 0,end = buffer.length) {
  const result = [];
  while (start < end) {
    if (result.length >= 4096 || start + 8 > end) throw unsupported('汽水 MP4 元数据不完整');
    const type = buffer.toString('ascii',start+4,start+8);
    let size = buffer.readUInt32BE(start), header = 8;
    if (size === 1) {if (start+16>end) throw unsupported('汽水扩展盒不完整'); size=safe64(buffer,start+8);header=16;}
    else if (size === 0) size=end-start;
    if (size < header || start+size > end) throw unsupported('汽水 MP4 盒长度无效');
    result.push({type,start,end:start+size,data:start+header});
    start += size;
  }
  return result;
}
function one(list,type) {
  const matches = list.filter(box => box.type === type);
  if (matches.length !== 1) throw unsupported('汽水 MP4 缺少唯一的 '+type+' 元数据');
  return matches[0];
}
function need(buffer,at,length,end = buffer.length) {
  if (!Number.isSafeInteger(at) || length < 0 || at < 0 || at+length > end) throw unsupported('汽水 MP4 索引截断');
}
function parseIndex(buffer,moovOffset,media,total) {
  const moov=one(boxes(buffer),'moov'),movie=boxes(buffer,moov.data,moov.end);
  const track=one(movie,'trak'),trackBoxes=boxes(buffer,track.data,track.end);
  const mdia=one(trackBoxes,'mdia'),mdiaBoxes=boxes(buffer,mdia.data,mdia.end);
  const handler=one(mdiaBoxes,'hdlr');need(buffer,handler.data,12,handler.end);
  if (buffer.toString('ascii',handler.data+8,handler.data+12)!=='soun') throw unsupported('汽水当前只支持独立音频轨道');
  const minf=one(mdiaBoxes,'minf'),minfBoxes=boxes(buffer,minf.data,minf.end);
  const stbl=one(minfBoxes,'stbl'),table=boxes(buffer,stbl.data,stbl.end);
  if ([...movie,...trackBoxes,...mdiaBoxes,...minfBoxes,...table].some(box=>['pssh','mvex','moof'].includes(box.type))) throw unsupported('汽水当前不支持 DRM 或分片媒体');
  const stsd=one(table,'stsd');need(buffer,stsd.data,8,stsd.end);
  if (buffer.readUInt32BE(stsd.data+4)!==1) throw unsupported('汽水当前只支持单一 AAC 描述');
  const entry=one(boxes(buffer,stsd.data+8,stsd.end),'enca');need(buffer,entry.data,28,entry.end);
  if (buffer.readUInt16BE(entry.data+8)!==0) throw unsupported('汽水音频描述版本暂不支持');
  const entryBoxes=boxes(buffer,entry.data+28,entry.end),sinf=one(entryBoxes,'sinf'),protection=boxes(buffer,sinf.data,sinf.end);
  const original=one(protection,'frma');need(buffer,original.data,4,original.end);
  if (buffer.toString('ascii',original.data,original.data+4)!=='mp4a' || entryBoxes.some(box=>box.type==='dfLa')) throw unsupported('汽水当前流式解码仅支持 AAC/M4A，暂不支持 FLAC');
  one(entryBoxes,'esds');
  const scheme=one(protection,'schm');need(buffer,scheme.data,8,scheme.end);
  if (buffer.toString('ascii',scheme.data+4,scheme.data+8)!=='cenc') throw unsupported('汽水当前仅支持授权 AES-CTR 样本');
  const schi=one(protection,'schi'),tenc=one(boxes(buffer,schi.data,schi.end),'tenc');need(buffer,tenc.data,24,tenc.end);
  const ivSize=buffer[tenc.data+7];
  if (buffer[tenc.data]!==0 || buffer.readUIntBE(tenc.data+1,3)!==0 || buffer[tenc.data+5]!==0 || buffer[tenc.data+6]!==1 || ![8,16].includes(ivSize)) throw unsupported('汽水加密描述不在当前支持范围');
  const stsz=one(table,'stsz');need(buffer,stsz.data,12,stsz.end);
  const fixed=buffer.readUInt32BE(stsz.data+4),count=buffer.readUInt32BE(stsz.data+8);
  if (!count || count>MAX_SAMPLES) throw unsupported('汽水样本数量超过有界索引范围');
  if (!fixed) need(buffer,stsz.data+12,count*4,stsz.end);
  const sizes=new Uint32Array(count),offsets=new Float64Array(count),ivs=Buffer.alloc(count*16);
  for (let i=0;i<count;i++) {sizes[i]=fixed || buffer.readUInt32BE(stsz.data+12+i*4);if (!sizes[i] || sizes[i]>MAX_SAMPLE) throw unsupported('汽水单样本长度超限');}
  const senc=one(table,'senc');need(buffer,senc.data,8,senc.end);
  if (buffer[senc.data]!==0 || buffer.readUIntBE(senc.data+1,3)!==0) throw unsupported('汽水暂不支持子样本或覆盖式加密');
  if (buffer.readUInt32BE(senc.data+4)!==count || senc.end-senc.data!==8+count*ivSize) throw unsupported('汽水样本与 IV 索引不匹配');
  for (let i=0;i<count;i++) buffer.copy(ivs,i*16,senc.data+8+i*ivSize,senc.data+8+(i+1)*ivSize);
  const chunkBox=table.find(box=>box.type==='stco') || table.find(box=>box.type==='co64');
  if (!chunkBox) throw unsupported('汽水缺少 chunk 偏移表');
  need(buffer,chunkBox.data,8,chunkBox.end);
  const chunkCount=buffer.readUInt32BE(chunkBox.data+4),chunkWidth=chunkBox.type==='co64'?8:4;
  if (!chunkCount || chunkCount>count) throw unsupported('汽水 chunk 数量无效');
  need(buffer,chunkBox.data+8,chunkCount*chunkWidth,chunkBox.end);
  const stsc=one(table,'stsc');need(buffer,stsc.data,8,stsc.end);
  const groupCount=buffer.readUInt32BE(stsc.data+4);
  if (!groupCount || groupCount>chunkCount) throw unsupported('汽水 stsc 索引无效');
  need(buffer,stsc.data+8,groupCount*12,stsc.end);
  const groups=[];
  for (let i=0;i<groupCount;i++) {
    const at=stsc.data+8+i*12,first=buffer.readUInt32BE(at),samples=buffer.readUInt32BE(at+4),description=buffer.readUInt32BE(at+8);
    if ((i===0&&first!==1) || first>chunkCount || (i&&first<=groups[i-1].first) || !samples || samples>count || description!==1) throw unsupported('汽水 stsc 映射超出支持范围');
    groups.push({first,samples});
  }
  let sample=0,group=0,previousEnd=0;
  for (let chunk=1;chunk<=chunkCount;chunk++) {
    if (group+1<groups.length&&chunk>=groups[group+1].first) group++;
    const at=chunkBox.data+8+(chunk-1)*chunkWidth;
    let offset=chunkWidth===8?safe64(buffer,at):buffer.readUInt32BE(at);
    for (let n=0;n<groups[group].samples;n++) {
      if (sample>=count) throw unsupported('汽水 stsc 样本总数不匹配');
      const end=offset+sizes[sample];
      if (offset<previousEnd || end>total || !media.some(box=>offset>=box.data&&end<=box.end)) throw unsupported('汽水样本不在有效媒体区域内');
      offsets[sample]=offset;previousEnd=end;offset=end;sample++;
    }
  }
  if (sample!==count) throw unsupported('汽水样本总数不匹配');
  // Keep every file offset intact. Only the authorized decrypted track's type
  // and encryption-only metadata are changed to ordinary ignored free boxes.
  buffer.write('mp4a',entry.start+4,4,'ascii');
  for (const box of [sinf,...table.filter(box=>['senc','saiz','saio'].includes(box.type))]) buffer.write('free',box.start+4,4,'ascii');
  return {moov:buffer,moovOffset,offsets,sizes,ivs,total};
}
function sampleAt(index,offset) {
  let low=0,high=index.offsets.length;
  while (low<high) {const middle=(low+high)>>1;if(index.offsets[middle]<=offset)low=middle+1;else high=middle;}
  return Math.max(0,low-1);
}
function applyCounter(counter,blocks) {
  let carry=BigInt(blocks);
  for (let at=15;at>=0&&carry;at--) {const value=BigInt(counter[at])+(carry&255n);counter[at]=Number(value&255n);carry=(carry>>8n)+(value>>8n);}
  if (carry) throw unsupported('汽水样本计数器溢出');
}
function transform(index,key,input,start) {
  const output=Buffer.from(input),end=start+output.length;
  for (let i=sampleAt(index,start);i<index.offsets.length&&index.offsets[i]<end;i++) {
    const from=Math.max(start,index.offsets[i]),to=Math.min(end,index.offsets[i]+index.sizes[i]);
    if (to<=from) continue;
    const within=from-index.offsets[i],counter=Buffer.from(index.ivs.subarray(i*16,i*16+16));
    applyCounter(counter,Math.floor(within/16));
    const decipher=crypto.createDecipheriv('aes-128-ctr',key,counter);
    const skip=within%16;if(skip)decipher.update(Buffer.alloc(skip));
    decipher.update(input.subarray(from-start,to-start)).copy(output,from-start);decipher.final();counter.fill(0);
  }
  const from=Math.max(start,index.moovOffset),to=Math.min(end,index.moovOffset+index.moov.length);
  if (to>from) index.moov.copy(output,from-start,from-index.moovOffset,to-index.moovOffset);
  return output;
}
function createQishuiStream({url,authorization,fetchImpl}) {
  const address=new URL(url);
  if (address.protocol!=='https:'||address.username||address.password||address.port||address.hash||typeof fetchImpl!=='function') throw new Error('Invalid owned Qishui stream');
  const key=resolveAuthorization(authorization),controllers=new Set();
  let index=null,initializing=null,disposed=false,total=0,etag='';
  async function fetchRange(start,end,controller) {
    const response=await fetchImpl(address.href,{method:'GET',headers:{Range:`bytes=${start}-${end}`,'Cache-Control':'no-store',Pragma:'no-cache'},signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'manual'});
    const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
    const version=response.headers.get('etag')||'';
    if (disposed||response.status!==206||!match||Number(match[1])!==start||Number(match[2])!==Math.min(end,Number(match[3])-1)||Number(match[3])>MAX_FILE||(total&&Number(match[3])!==total)||(etag&&version&&etag!==version)) {
      await response.body?.cancel();throw unsupported('汽水音源未提供稳定的有界 Range');
    }
    total=Number(match[3]);if(!etag&&version)etag=version;
    return {response,length:Number(match[2])-start+1};
  }
  async function readRange(start,end,controller) {
    if (end-start+1>MAX_METADATA) throw unsupported('汽水元数据超过 2MiB 限制');
    const {response,length}=await fetchRange(start,end,controller),buffer=Buffer.alloc(length),reader=response.body.getReader();let at=0;
    try {
      while (at<length) {const {done,value}=await reader.read();if(done)break;if(value.byteLength>length-at)throw unsupported('汽水 Range 响应超长');buffer.set(value,at);at+=value.byteLength;}
      if (at!==length) throw unsupported('汽水元数据不完整');
      return buffer;
    } finally {await reader.cancel().catch(()=>{});}
  }
  async function initialize() {
    if (disposed) throw new Error('汽水播放已停止');
    if (index) return index;
    if (initializing) return initializing;
    const controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),20000);timer.unref?.();
    initializing=(async()=>{
      const media=[];let moov=null,moovOffset=0,offset=0,count=0;
      while (!total||offset<total) {
        if (++count>64) throw unsupported('汽水顶层盒数量超限');
        const header=await readRange(offset,offset+15,controller);
        if (header.length<8) throw unsupported('汽水文件头不完整');
        const type=header.toString('ascii',4,8);let size=header.readUInt32BE(0),headerSize=8;
        if (size===1) {if(header.length<16)throw unsupported('汽水扩展头不完整');size=safe64(header,8);headerSize=16;}
        else if(size===0)size=total-offset;
        if (size<headerSize||offset+size>total) throw unsupported('汽水顶层盒长度无效');
        if (['pssh','moof'].includes(type)) throw unsupported('汽水当前不支持 DRM 或分片音频');
        if (type==='moov') {if(moov)throw unsupported('汽水出现多个 moov');moov=await readRange(offset,offset+size-1,controller);moovOffset=offset;}
        if (type==='mdat') media.push({data:offset+headerSize,end:offset+size});
        offset+=size;
      }
      if (!moov||!media.length) throw unsupported('汽水缺少 MP4 音频索引');
      if (disposed) throw new Error('汽水播放已停止');
      index=parseIndex(moov,moovOffset,media,total);
      return index;
    })().finally(()=>{clearTimeout(timer);controllers.delete(controller);initializing=null;});
    return initializing;
  }
  async function handle(request) {
    if (disposed) return new Response(null,{status:410});
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405});
    let controller,reader,timer,abort;
    function release() {clearTimeout(timer);if(abort)request.signal?.removeEventListener('abort',abort);if(controller)controllers.delete(controller);}
    try {
      const current=await initialize();
      if (disposed||request.signal?.aborted) return new Response(null,{status:499});
      if (controllers.size>=3) return new Response(null,{status:429});
      let start=0,end=current.total-1;const range=request.headers.get('range');
      if (range) {
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match||(!match[1]&&!match[2])) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${current.total}`}});
        if (!match[1]) start=Math.max(0,current.total-Number(match[2]));
        else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
        if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=current.total) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${current.total}`}});
      }
      const headers={'Content-Type':'audio/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'no-store, max-age=0',Pragma:'no-cache',Expires:'0','Access-Control-Allow-Origin':'*'};
      if(range)headers['Content-Range']=`bytes ${start}-${end}/${current.total}`;
      if(request.method==='HEAD')return new Response(null,{status:range?206:200,headers});
      controller=new AbortController();controllers.add(controller);abort=()=>controller.abort();request.signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(abort,10000);timer.unref?.();
      const upstream=await fetchRange(start,end,controller);clearTimeout(timer);timer=null;reader=upstream.response.body.getReader();let cursor=start;
      const body=new ReadableStream({
        async pull(output) {
          try {
            if(disposed||controller.signal.aborted)throw new Error('汽水播放已停止');
            const {done,value}=await reader.read();
            if(done){if(cursor!==end+1)throw new Error('汽水音频传输不完整');release();output.close();return;}
            if(value.byteLength>MAX_METADATA||cursor+value.byteLength>end+1)throw new Error('汽水音频分块超过上限');
            output.enqueue(transform(current,key,Buffer.from(value.buffer,value.byteOffset,value.byteLength),cursor));cursor+=value.byteLength;
          }catch(error){controller.abort();release();await reader.cancel().catch(()=>{});output.error(error);}
        },
        async cancel(){controller.abort();release();await reader.cancel().catch(()=>{});}
      });
      return new Response(body,{status:range?206:200,headers});
    } catch(error) {
      controller?.abort();release();await reader?.cancel().catch(()=>{});
      return new Response(error.code==='QISHUI_UNSUPPORTED_MP4'?error.message:'汽水音源暂时不可用',{status:error.code==='QISHUI_UNSUPPORTED_MP4'?415:502,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    }
  }
  return {handle,ready:async()=>{await initialize();return true;},dispose(){if(disposed)return;disposed=true;for(const controller of controllers)controller.abort();controllers.clear();key.fill(0);if(index){index.ivs.fill(0);index.moov.fill(0);}index=null;},getStatus:()=>({ready:!!index,disposed,active:controllers.size,metadataBytes:index?.moov.length||0,samples:index?.sizes.length||0})};
}
module.exports={createQishuiStream};
