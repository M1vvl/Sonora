'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createQishuiPassport}=require('../src/music/providers/qishui-passport.cjs');

test('Passport isolates its SDK, keeps QR credentials private, embeds official MFA and releases its host',async()=>{
  const handlers={},constructed=[],requests=[],notices=[];let config={},mfaVisible=false;
  const owner={views:[],isDestroyed:()=>false,getContentSize:()=>[1000,800],contentView:{addChildView(view){owner.views.push(view);},removeChildView(view){owner.views=owner.views.filter(value=>value!==view);}}};
  const network={cookies:{get:async()=>[]},flushStorageData:async()=>{},webRequest:{}};
  for(const name of ['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived'])network.webRequest[name]=(filter,callback)=>{if(filter===null)delete handlers[name];else handlers[name]=callback;};
  class NativeView {
    constructor(options){this.options=options;constructed.push(this);this.webContents=new EventEmitter();const web=this.webContents;web.id=9;web.dead=false;web.isDestroyed=()=>web.dead;web.setUserAgent=()=>{};web.setWindowOpenHandler=callback=>web.open=callback;web.loadURL=async url=>{web.url=url;};web.focus=()=>{};web.close=()=>{web.dead=true;};web.executeJavaScript=async source=>{
      if(source.startsWith('Boolean('))return true;
      if(source==='window.__qishuiBrowserInfo()')return {encrypted:'fixture-browser-parameters'};
      if(source.startsWith('window.__qishuiSecondVerify(')){mfaVisible=owner.views.includes(this);return {status:true};}
      if(!source.startsWith('window.__qishuiRequest('))return true;
      const payload=JSON.parse(source.slice('window.__qishuiRequest('.length,-1)),url=new URL(payload.url);requests.push({path:url.pathname,method:payload.method});url.searchParams.set('a_bogus','F'.repeat(44));
      handlers.onBeforeSendHeaders({id:requests.length,webContentsId:web.id,url:url.href,method:payload.method,requestHeaders:{Origin:new URL(web.url).origin,...payload.headers}},()=>{});
      if(url.pathname.endsWith('/get_qrcode/'))return {status:200,body:JSON.stringify({message:'success',data:{error_code:0,token:'owned-token',qrcode_index_url:'https://api.qishui.com/qr?token=scan-fixture'}})};
      const resend=url.searchParams.get('isResend')==='true';
      return {status:200,body:JSON.stringify({message:resend?'success':'error',data:resend?{error_code:0,status:'3',session_cookie:'sessionid=owned-confirmed'}:{error_code:2046,url:'https://verify.zijieapi.com/fixture-verify.js',biz_params:{}}})};
    };}
    setBounds(value){this.bounds=value;}
  }
  const passport=createQishuiPassport({electron:{app:{whenReady:async()=>{}},WebContentsView:NativeView},network,getHostWindow:()=>owner,getConfig:()=>({...config}),updateConfig:value=>{config={...config,...value};},onStatus:value=>notices.push(value)});
  let assetURL;
  try{
    const qr=await passport.createQr({bounds:{x:20,y:40,width:430,height:400}});assert(qr.qrImage.startsWith('data:image/png;base64,'));assert.equal(constructed.length,1);assert.equal(owner.views.length,0);assert.equal(constructed[0].options.webPreferences.webSecurity,true);assert.equal(constructed[0].options.webPreferences.nodeIntegration,false);assert.equal(constructed[0].options.webPreferences.preload,undefined);assert.equal(config.deviceId.length,16);assert.equal(config.installId.length,15);
    assetURL=constructed[0].webContents.url;const asset=await fetch(assetURL);assert.equal(asset.status,200);const html=await asset.text();assert(html.includes('resource.protocol'));assert.equal((await fetch(new URL('not-allowed.js',assetURL))).status,404);
    const confirmed=await passport.checkQr(qr.token,qr.generation);assert.equal(confirmed.status,'confirmed');assert(mfaVisible);assert.equal(owner.views.length,0);assert.equal(config.cookie,'sessionid=owned-confirmed');assert(notices.some(value=>value.mfa));assert.equal(requests.filter(value=>value.path.endsWith('/check_qrconnect/')).length,2);
  }finally{await passport.dispose();}
  assert.equal(constructed[0].webContents.dead,true);assert.equal(Object.keys(handlers).length,0);assert.equal(config.cookie,'sessionid=owned-confirmed','disposing the host must preserve account state');
  await assert.rejects(fetch(assetURL));
});
