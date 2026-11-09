'use strict';
// Public non-adult defaults from LibreSpark/LibreTV historical config.js,
// commit 26ec4e8. Current upstream intentionally ships no provider defaults.
// See artifacts/libretv-rea/provider-probe.json for this release's live checks.
module.exports=Object.freeze([
  {id:'ry',name:'如意资源',url:'https://cj.rycjapi.com/api.php/provide/vod',enabled:true},
  {id:'bf',name:'暴风资源',url:'https://bfzyapi.com/api.php/provide/vod',enabled:true},
  {id:'zy360',name:'360资源',url:'https://360zy.com/api.php/provide/vod',enabled:true},
  {id:'zuid',name:'最大资源',url:'https://api.zuidapi.com/api.php/provide/vod',enabled:true},
  {id:'jszy',name:'极速资源',url:'https://jszyapi.com/api.php/provide/vod',enabled:true,introducedIn:2},
  {id:'mdzy',name:'魔都资源',url:'https://www.mdzyapi.com/api.php/provide/vod',enabled:true,introducedIn:2}
].map(Object.freeze));
