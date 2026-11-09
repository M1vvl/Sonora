'use strict';
const {stripAdGroups}=require('./libretv-m3u8.cjs');
// Removing encrypted segments changes implicit AES IV sequence numbers. Keep
// such playlists intact unless each encrypted key declares an explicit IV.
// Conservative passthrough is preferable to corrupting otherwise valid video.
function filterM3u8(text){
  const filtered=stripAdGroups(text);
  if(filtered!==text&&text.split(/\r?\n/).some(line=>line.startsWith('#EXT-X-KEY:')&&/METHOD=AES-128(?:,|$)/i.test(line)&&!/(?:^|,)IV=0x[\da-f]+/i.test(line)))return text;
  return filtered;
}
module.exports={filterM3u8};
