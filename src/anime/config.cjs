'use strict';

const NETWORK_DEFAULTS=Object.freeze({bangumi:'mirror',rules:'ghProxy',images:'ech'});
const NETWORK_OPTIONS=Object.freeze({
  bangumi:[{value:'direct',label:'直连',description:'访问官方接口'},{value:'ech',label:'ECH',description:'启用加密握手'},{value:'mirror',label:'镜像',description:'镜像接口（默认）'}],
  rules:[{value:'ghProxy',label:'gh-proxy',description:'默认镜像'},{value:'ghfast',label:'ghfast',description:'备用镜像'},{value:'gitcode',label:'GitCode',description:'国内镜像'},{value:'direct',label:'直连',description:'访问 GitHub'}],
  images:[{value:'direct',label:'直连',description:'加载原始图片'},{value:'ech',label:'ECH',description:'加密握手（推荐）'},{value:'mirror',label:'镜像',description:'使用图片镜像'}]
});
const CATEGORIES=Object.freeze(['主页','热门','日常','原创','异世界','热血','悬疑','治愈','搞笑','恋爱','奇幻','科幻','冒险','运动','音乐']);
const RULE_REPOSITORY='https://raw.githubusercontent.com/Predidit/KazumiRules/main/';
const UA='AgentPulse/0.3.7 (Windows; local Kazumi-compatible adapter; https://github.com/Predidit/Kazumi)';
const BROWSER_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
function validateNetwork(value={}) {
  const result={...NETWORK_DEFAULTS};
  for(const key of Object.keys(result)) {
    if(value[key]!==undefined && !NETWORK_OPTIONS[key].some(x=>x.value===value[key]))throw new Error('无效的网络加速选项');
    if(value[key]!==undefined)result[key]=value[key];
  }
  return result;
}
function safeHttpUrl(value) {
  const url=new URL(String(value));
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持 HTTP/HTTPS 地址');
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(host==='localhost'||host==='::1'||host==='0.0.0.0'||host==='::'||/^(127|10|0)\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||/^(fc|fd|fe80):/i.test(host))throw new Error('番剧来源不支持本地网络地址');
  return url.toString();
}
function repositoryUrl(name,mode) {
  const source=RULE_REPOSITORY+name;
  if(mode==='ghProxy')return 'https://gh-proxy.org/'+source;
  if(mode==='ghfast')return 'https://ghfast.top/'+source;
  if(mode==='gitcode')return 'https://raw.gitcode.com/gh_mirrors/ka/KazumiRules/raw/main/'+name;
  return source;
}
function imageRequest(value,mode) {
  const url=new URL(safeHttpUrl(value));
  const isBangumi=url.hostname==='lain.bgm.tv'||(url.hostname==='api.bgm.tv'&&/^\/v0\/(subjects|characters|persons)\/\d+\/image$/.test(url.pathname));
  if(!isBangumi)return {url:url.toString(),ech:false};
  if(mode==='ech'){url.protocol='https:';return {url:url.toString(),ech:true};}
  if(mode==='mirror'){
    const target=new URL('https://wsrv.nl/');target.searchParams.set('url',url.host+url.pathname+url.search);
    if(/\.gif$/i.test(url.pathname))target.searchParams.set('n','-1');
    return {url:target.toString(),ech:false};
  }
  return {url:url.toString(),ech:false};
}
module.exports={NETWORK_DEFAULTS,NETWORK_OPTIONS,CATEGORIES,RULE_REPOSITORY,UA,BROWSER_UA,validateNetwork,safeHttpUrl,repositoryUrl,imageRequest};
