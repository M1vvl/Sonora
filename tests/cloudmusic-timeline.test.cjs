'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('native progress parser and stale-playing samples use real text without a synthesized clock',{skip:process.platform!=='win32'},()=>{
  const framework=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-cloudmusic-timeline-'));
  const file=path.join(directory,'TimelineTest.cs'),executable=path.join(directory,'TimelineTest.exe');
  fs.writeFileSync(file,`using System;
using AgentPulse.Media;
class TimelineTest {
  static void Check(bool value,string name){if(!value)throw new Exception(name);}
  static int Main(){
    double position,duration;
    Check(CloudMusicTimeline.TryParse(" 01:12 / 03:45 ",out position,out duration)&&position==72&&duration==225,"paired time text");
    Check(CloudMusicTimeline.TryParse("00:00 | 60:01",out position,out duration)&&position==0&&duration==3601,"pipe separator");
    Check(CloudMusicTimeline.TryParsePair("01:12","03:45",out position,out duration)&&position==72&&duration==225,"separate elapsed and duration controls");
    Check(!CloudMusicTimeline.TryParsePair("03:45","01:12",out position,out duration),"reverse controls rejected");
    Check(!CloudMusicTimeline.TryParsePair("-00:10","03:45",out position,out duration),"remaining clock is not elapsed time");
    foreach(string source in new[]{"cloudmusic","qqmusic","applemusic","spotify","kugou","kuwo","yesplaymusic","qishui"})Check(CloudMusicTimeline.Supports(source),"process-specific fallback");
    Check(!CloudMusicTimeline.Supports("browser"),"arbitrary process is not inspected");
    foreach(string value in new[]{"50%","01:00","01:60 / 03:45","04:00 / 03:45","00:00 / 00:00","some text 01:00 / 03:00","٠١:١٢ / ٠٣:٤٥",new string('0',90)})
      Check(!CloudMusicTimeline.TryParse(value,out position,out duration),"reject non-authoritative time");
    var sample=new TimelineObservation();Check(!sample.IsFresh(0),"new track has no timeline");
    sample.Accept(5,100,true,0);Check(sample.IsFresh(1700),"recent real read");
    sample.Accept(5,100,true,1700);Check(!sample.IsFresh(1801),"unchanged playing text expires");
    sample.Accept(6,100,true,1900);Check(sample.IsFresh(2000)&&sample.Position==6,"advancing text restores timeline");
    sample.Accept(42,100,true,2100);Check(sample.Position==42,"actual seek is retained");
    sample.Accept(42,100,false,5000);Check(sample.IsFresh(6000),"paused read remains authoritative");
    sample.Accept(double.NaN,100,true,6100);Check(sample.Position==42,"invalid values do not contaminate cache");
    Console.WriteLine("parser/staleness/seek/pause passed");return 0;
  }
}`);
  try {
    const references=['WindowsBase','UIAutomationClient','UIAutomationTypes'].map(name=>'/r:'+path.join(framework,'WPF',name+'.dll'));
    const build=spawnSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/target:exe','/out:'+executable,...references,path.join(__dirname,'../native/media/CloudMusicTimeline.cs'),path.join(__dirname,'../native/media/PlayerSources.cs'),file],{encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const result=spawnSync(executable,[],{encoding:'utf8',windowsHide:true,timeout:5000});
    assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/passed/);
  } finally {
    for(const target of [file,executable])if(fs.existsSync(target))fs.unlinkSync(target);
    fs.rmdirSync(directory);
  }
});
