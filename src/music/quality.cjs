'use strict';
// NetEase response level IDs, as used by the provider adapter. A requested tier
// is never used as evidence that the server actually delivered that tier.
const QUALITY_OPTIONS=Object.freeze([
  {id:'sky',label:'沉浸环绕声',shortLabel:'环绕',description:'SVIP / 以账号与歌曲实际权限为准'},
  {id:'jymaster',label:'超清母带',shortLabel:'母带',description:'SVIP / 片源权限要求'},
  {id:'vivid',label:'臻音全景声',shortLabel:'全景',description:'空间音频 / 以平台实际返回为准'},
  {id:'jyeffect',label:'高清臻音',shortLabel:'臻音',description:'Hi-Res / 以账号与片源权限为准'},
  {id:'lossless',label:'无损 SQ',shortLabel:'SQ',description:'FLAC 无损优先'},
  {id:'exhigh',label:'极高 HQ',shortLabel:'HQ',description:'最高 320 kbps'},
  {id:'standard',label:'标准',shortLabel:'标准',description:'最高 128 kbps'}
].map(Object.freeze));
// Previous releases used hires as the UI key for 高清臻音. Incoming preferences
// migrate to the actual jyeffect tier. Returned server hires keeps its own label.
const normalizeQuality=value=>value==='hires'?'jyeffect':value;
const validQuality=value=>QUALITY_OPTIONS.some(option=>option.id===normalizeQuality(value));
const EXTRA_LABELS={higher:'较高音质',hires:'Hi-Res',dolby:'杜比全景声'};
const RANK={standard:0,higher:1,exhigh:2,lossless:3,hires:4,jyeffect:5,vivid:6,sky:7,jymaster:6,dolby:5};
function actualQuality(track){
  const level=String(track?.level||'');
  if(validQuality(level)||EXTRA_LABELS[level])return level;
  if(level)return 'unknown';
  // A bitrate alone cannot establish lossless/Hi-Res/mastering.
  const bitrate=Number(track?.br)||0;
  return bitrate>192000?'exhigh':bitrate>0?'standard':'unknown';
}
function describe(track,requested){
  const quality=actualQuality(track),option=QUALITY_OPTIONS.find(option=>option.id===quality);
  return {quality,qualityLabel:option?.label||EXTRA_LABELS[quality]||'音质未标明',requestedQuality:requested,degraded:quality!=='unknown'&&RANK[quality]<RANK[normalizeQuality(requested)],different:quality!==requested,bitrate:Math.max(0,Number(track?.br)||0),source:'netease',qualityOptions:QUALITY_OPTIONS};
}
module.exports={QUALITY_OPTIONS,validQuality,normalizeQuality,actualQuality,describe};
