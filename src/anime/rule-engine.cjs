'use strict';
// Kazumi-compatible XPath / restricted JSONPath adapter. Derived from Kazumi
// lib/services/plugin/{xpath_rule_strategy,api_rule_strategy}.dart, GPL-3.0.
// Changes: JS DOM backend, bounded output and explicit cancellation in transport.
const {safeHttpUrl,BROWSER_UA}=require('./config.cjs');
const own=(o,k)=>o!=null&&Object.prototype.hasOwnProperty.call(o,k);
const scalar=x=>x==null?'':String(x).trim();
const encode=x=>encodeURIComponent(String(x??'')).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());

function jsonPath(data,expression) {
  if(typeof expression!=='string'||expression[0]!=='$')throw new Error('JSONPath 必须以 $ 开头');
  const tokens=[];let i=1;
  while(i<expression.length){
    if(expression[i]==='.'){
      const match=/^[A-Za-z0-9_$-]+/.exec(expression.slice(++i));if(!match)throw new Error('不支持的 JSONPath');tokens.push(match[0]);i+=match[0].length;
    } else if(expression[i]==='['){
      const match=/^\[(\*|\d+|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\]/.exec(expression.slice(i));if(!match)throw new Error('不支持的 JSONPath');const t=match[1];
      tokens.push(t==='*'?Symbol.for('wildcard'):/^\d+$/.test(t)?Number(t):t[0]==='"'?JSON.parse(t):t.slice(1,-1).replace(/\\'/g,"'").replace(/\\\\/g,'\\'));i+=match[0].length;
    } else throw new Error('不支持的 JSONPath');
  }
  let nodes=[data];for(const token of tokens){nodes=nodes.flatMap(node=>token===Symbol.for('wildcard')?Array.isArray(node)?node:node&&typeof node==='object'?Object.values(node):[]:own(node,token)?[node[token]]:[]);}
  return nodes;
}
const first=(data,path)=>jsonPath(data,path)[0];
function template(text,variables,{encoded=false}={}) {
  return String(text??'').replace(/(?<![A-Za-z0-9_])@([A-Za-z_][A-Za-z0-9_]*)/g,(_,name)=>{if(!own(variables,name))throw new Error('缺少模板变量 @'+name);return encoded?encode(variables[name]):String(variables[name]??'');});
}
function renderValue(value,vars){
  if(typeof value==='string'){const match=/^@([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);if(match){if(!own(vars,match[1]))throw new Error('缺少模板变量');return vars[match[1]];}return template(value,vars);}
  if(Array.isArray(value))return value.map(x=>renderValue(x,vars));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[template(key,vars),renderValue(v,vars)]));
  return value;
}
function normalizeUrl(base,raw) {
  const text=scalar(raw);if(!text)return '';
  let url;try{url=new URL(text,base);}catch{return text;}
  const b=new URL(base);if(url.hostname===b.hostname&&url.port===b.port&&['http:','https:'].includes(url.protocol))url.protocol=b.protocol;
  url.pathname=url.pathname.length>1?url.pathname.replace(/\/+$/,''):url.pathname;
  if(url.search==='?')url.search='';if(url.hash==='#')url.hash='';return safeHttpUrl(url.toString());
}
function apiRequest(config,variables) {
  const method=String(config.method||'GET').toUpperCase();if(!['GET','POST'].includes(method))throw new Error('规则仅支持 GET/POST');
  const url=new URL(safeHttpUrl(template(config.url,variables,{encoded:true})));
  for(const [key,v]of Object.entries(renderValue(config.query||{},variables)))url.searchParams.set(key,String(v));
  const headers=renderValue(config.headers||{},variables),options={method,headers};
  if(method==='POST'&&config.bodyType==='json'){headers['content-type']='application/json';options.body=JSON.stringify(renderValue(config.body,variables));}
  if(method==='POST'&&config.bodyType==='form'){headers['content-type']='application/x-www-form-urlencoded';options.body=new URLSearchParams(renderValue(config.body||{},variables)).toString();}
  return {url:url.toString(),options};
}
function xpathRequest(rule,source,search) {
  const url=search?safeHttpUrl(rule.searchURL.replaceAll('@keyword',encode(source))):normalizeUrl(rule.baseURL,source);
  if(search&&rule.usePost){const u=new URL(url),body=u.searchParams.toString();u.search='';return {url:u.toString(),options:{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body}};}
  return {url,options:{method:'GET'}};
}
function htmlDocument(raw) {
  // No scripts, remote subresources or user cookies execute in this parser.
  const {JSDOM}=require('jsdom');const dom=new JSDOM(raw,{contentType:'text/html'});return {document:dom.window.document,close:()=>dom.window.close()};
}
function xpath(document,root,expression) {
  if(!expression?.trim())throw new Error('XPath 不能为空');
  if(expression==='//')return [root];
  // Dart queryXPath scopes leading // and /self to the selected subtree.
  let expressionScoped=expression;
  if(root!==document&&root!==document.documentElement)expressionScoped=expression.split('|').map(x=>{const t=x.trim();return t.startsWith('//')?'.'+t:t.startsWith('/self::')?'.'+t:t;}).join(' | ');
  const result=document.evaluate(expressionScoped,root,null,7,null),nodes=[];
  for(let i=0;i<Math.min(3000,result.snapshotLength);i++)nodes.push(result.snapshotItem(i));return nodes;
}
function captcha(rule,raw,document) {
  const c=rule.antiCrawlerConfig;if(!c?.enabled)return false;
  if(c.captchaDetectValue){
    if(c.captchaDetectType===1||c.captchaDetectType==='text')return raw.includes(c.captchaDetectValue);
    if(c.captchaDetectType===2||c.captchaDetectType==='regex'){try{return new RegExp(c.captchaDetectValue,'is').test(raw);}catch{return false;}}
    return xpath(document,document.documentElement,c.captchaDetectValue).length>0;
  }
  return [c.captchaImage,c.captchaButton].some(e=>e&&xpath(document,document.documentElement,e).length);
}
function parseSearch(rule,raw) {
  if(rule.searchMode==='api'){
    const c=rule.searchApiConfig||{},data=JSON.parse(raw);
    return jsonPath(data,c.listPath||'$.data[*]').flatMap(item=>{
      const title=scalar(first(item,c.namePath||'$.name')),source=scalar(first(item,c.sourcePath||'$.url'));if(!title||!source)return [];
      return [{title,url:c.sourceTemplate?c.sourceTemplate.replaceAll('@source',encode(source)):source}];
    }).slice(0,100);
  }
  const doc=htmlDocument(raw);
  try {
    const root=doc.document.documentElement;if(captcha(rule,raw,doc.document))throw new Error('来源需要人工完成验证');
    return xpath(doc.document,root,rule.searchList).flatMap(node=>{
      const title=scalar(xpath(doc.document,node,rule.searchName)[0]?.textContent);
      const source=scalar(xpath(doc.document,node,rule.searchResult)[0]?.getAttribute?.('href'));
      return title&&source?[{title,url:source}]:[];
    }).slice(0,100);
  }finally{doc.close();}
}
function resolveEpisode(rule,c,variables,rawUrl,roadIndex,episodeIndex) {
  if(!c.episodePage)return normalizeUrl(rule.baseURL,rawUrl);
  const page=c.episodePage,vars={...variables,episodeUrl:rawUrl,roadIndex,roadNumber:roadIndex+1,episodeIndex,episodeNumber:episodeIndex+1};
  if(!page.url?.trim())throw new Error('播放页地址模板不能为空');
  const url=new URL(template(page.url,vars,{encoded:true}),rule.baseURL);
  for(const [key,value]of Object.entries(renderValue(page.query||{},vars)))url.searchParams.set(key,String(value));
  return normalizeUrl(rule.baseURL,url.toString());
}
function parseChapters(rule,raw,source) {
  if(rule.chapterMode!=='api'){
    const doc=htmlDocument(raw);
    try{return xpath(doc.document,doc.document.documentElement,rule.chapterRoads).flatMap((root,index)=>{
      const episodes=xpath(doc.document,root,rule.chapterResult).flatMap((node,i)=>{const url=node.getAttribute?.('href');return url?[{title:scalar(node.textContent).replace(/\s/g,'')||'第'+(i+1)+'集',url:normalizeUrl(rule.baseURL,url)}]:[];}).slice(0,1000);
      return episodes.length?[{name:'播放线路'+(index+1),episodes}]:[];
    }).slice(0,30);}finally{doc.close();}
  }
  const c=rule.chapterApiConfig||{},data=JSON.parse(raw),vars={source};
  for(const [key,path]of Object.entries(c.variables||{})){vars[key]=first(data,path);if(vars[key]==null)throw new Error('章节响应缺少变量 '+key);}
  if(c.format==='delimited'){
    const roadSeparator=c.roadSeparator??'$$$',episodeSeparator=c.episodeSeparator??'#',fieldSeparator=c.fieldSeparator??'$';
    if(!roadSeparator||!episodeSeparator||!fieldSeparator)throw new Error('章节分隔符不能为空');
    const names=scalar(first(data,c.roadNamesPath)).split(roadSeparator),groups=scalar(first(data,c.roadEpisodesPath)).split(roadSeparator);
    return groups.flatMap((group,roadIndex)=>{
      const episodes=group.split(episodeSeparator).flatMap((entry,index)=>{const at=entry.indexOf(fieldSeparator);if(at<0)return [];const title=entry.slice(0,at).trim()||'第'+(index+1)+'集',rawUrl=entry.slice(at+fieldSeparator.length).trim(),url=resolveEpisode(rule,c,vars,rawUrl,roadIndex,index);return url?[{title,url}]:[];}).slice(0,1000);
      return episodes.length?[{name:names[roadIndex]||'播放线路'+(roadIndex+1),episodes}]:[];
    }).slice(0,30);
  }
  const roots=c.roadsPath=== ''?[data]:jsonPath(data,c.roadsPath||'$.data.roads[*]');
  return roots.flatMap((root,roadIndex)=>{
    const episodes=jsonPath(root,c.episodesPath||'$.episodes[*]').flatMap((episode,index)=>{
      const title=scalar(first(episode,c.episodeNamePath||'$.name'))||'第'+(index+1)+'集',rawUrl=c.episodeUrlPath===''?'':scalar(first(episode,c.episodeUrlPath||'$.url'));
      const url=resolveEpisode(rule,c,vars,rawUrl,roadIndex,index);return url?[{title,url}]:[];
    }).slice(0,1000);
    return episodes.length?[{name:c.roadNamePath?scalar(first(root,c.roadNamePath))||'播放线路'+(roadIndex+1):'播放线路'+(roadIndex+1),episodes}]:[];
  }).slice(0,30);
}
function validateRule(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>128*1024)throw new Error('无效的规则');
  const rule=JSON.parse(JSON.stringify(value));
  if(typeof rule.name!=='string'||!rule.name.trim()||rule.name.length>80||/[\x00-\x1f\\/]/.test(rule.name))throw new Error('规则名称无效');
  rule.name=rule.name.trim();rule.id=rule.name;rule.enabled=rule.enabled!==false;
  safeHttpUrl(rule.baseURL);
  if(Number(rule.api||1)>9)throw new Error('此规则需要更高的 Kazumi API 级别');
  for(const phase of ['search','chapter']){
    if(rule[phase+'Mode']==='api'){
      const c=rule[phase+'ApiConfig'];if(!c?.request?.url)throw new Error('API 规则缺少请求地址');safeHttpUrl(c.request.url.replace(/@[A-Za-z_][A-Za-z0-9_]*/g,'placeholder'));
      if(phase==='search'){for(const key of ['listPath','namePath','sourcePath'])jsonPath({},c[key]||({listPath:'$.data[*]',namePath:'$.name',sourcePath:'$.url'}[key]));}
      else {for(const key of c.format==='delimited'?['roadNamesPath','roadEpisodesPath']:['roadsPath','roadNamePath','episodesPath','episodeNamePath','episodeUrlPath'])if(c[key])jsonPath({},c[key]);}
    } else if(phase==='search')safeHttpUrl(rule.searchURL?.replaceAll('@keyword','test'));
  }
  return rule;
}
function createRuleEngine(network) {
  async function load(rule,source,search) {
    const request=rule[search?'searchMode':'chapterMode']==='api'?apiRequest(rule[search?'searchApiConfig':'chapterApiConfig'].request,{[search?'keyword':'source']:source}):xpathRequest(rule,source,search);
    request.options.headers={'user-agent':rule.userAgent||BROWSER_UA,referer:rule.baseURL.replace(/\/$/,'')+'/',...request.options.headers};
    return network.text(request.url,request.options);
  }
  return {async search(rule,keyword){return parseSearch(rule,await load(rule,keyword,true));},async chapters(rule,source){return parseChapters(rule,await load(rule,source,false),source);}};
}
module.exports={jsonPath,template,renderValue,normalizeUrl,apiRequest,xpathRequest,parseSearch,parseChapters,validateRule,createRuleEngine};
