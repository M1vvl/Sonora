'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('native source mapping recognizes Apple Music without treating arbitrary apps as players',{skip:process.platform!=='win32'},()=>{
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sonara-media-source-'));
  const source=path.join(directory,'SourceTest.cs'),executable=path.join(directory,'SourceTest.exe');
  fs.writeFileSync(source,`using System;
using AgentPulse.Media;
class SourceTest {
  static void Check(bool value,string name){if(!value)throw new Exception(name);}
  static int Main(){
    Check(PlayerSources.FromAppId("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App")=="applemusic","Apple Store app ID");
    Check(PlayerSources.FromAppId("AppleMusic.exe")=="applemusic","Apple desktop app ID");
    Check(PlayerSources.ProcessName("applemusic")=="AppleMusic","Apple executable name");
    Check(PlayerSources.FromAppId("QQMusic.exe")=="qqmusic","QQ remains supported");
    Check(PlayerSources.FromAppId("browser.exe")==null,"unknown app excluded");
    Console.WriteLine("source mapping passed");return 0;
  }
}`);
  try {
    const build=spawnSync(compiler,['/nologo','/target:exe','/out:'+executable,path.join(__dirname,'../native/media/PlayerSources.cs'),source],{encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const result=spawnSync(executable,[],{encoding:'utf8',windowsHide:true,timeout:5000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/source mapping passed/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
