import json,re,pathlib
p=pathlib.Path('ui/music/visual-settings.js')
s=p.read_text(encoding='utf8')
def read(name): return json.loads(re.search(r'const '+name+r'=Object.freeze\(([^\n]+)\);',s).group(1))
d,f,n=read('DEFAULTS'),read('FIELDS'),read('NUMBERS')
original=json.loads(pathlib.Path('assets/music/source-presets/source-defaults.json').read_text(encoding='utf8'))
shelf=[('shelfSize','整体尺寸',.5,1.5,.01),('shelfOffsetX','水平位移',-2,2,.01),('shelfOffsetY','垂直位移',-2,2,.01),('shelfOffsetZ','前后位移',-2,2,.01),('shelfAngleY','歌单转角',-60,60,1),('shelfOpacity','卡片透明',.2,1,.01),('shelfBgOpacity','卡片底色透明',0,1,.01),('shelfDetailOffsetX','详情水平',-2,2,.01),('shelfDetailOffsetY','详情垂直',-2,2,.01),('shelfDetailOffsetZ','详情前后',-2,2,.01),('shelfDetailScale','详情尺寸',.5,2,.01),('shelfDetailAngleX','详情俯仰',-60,60,1),('shelfDetailAngleY','详情转角',-60,60,1),('shelfDetailRowGap','歌曲间距',.5,2,.01),('shelfDetailOpenDuration','详情展开时长',.1,1.5,.01),('shelfDetailCloseDuration','详情收起时长',.1,1.5,.01),('shelfDetailRowDuration','歌曲展开时长',.1,1.5,.01),('shelfDetailIntroStrength','详情入场幅度',0,2,.01),('shelfDetailParallax','详情视差',0,2,.01),('shelfSummonOpenDuration','唤出时长',.1,1.5,.01),('shelfSummonCloseDuration','隐退时长',.1,1.5,.01),('shelfSummonSlide','唤出滑动距离',0,3,.01),('shelfSummonStagger','层间延迟',0,2,.01),('shelfSummonScale','入场缩放',.5,1.5,.01),('shelfSummonParallax','入场视差',0,2,.01),('shelfCameraEnterSpeed','镜头进入速度',.05,1,.01),('shelfCameraExitSpeed','镜头退出速度',.05,1,.01)]
for key,label,low,high,step in shelf:
 d[key]=original[key];n[key]=[low,high]
 if not any(row[1]==key for row in f['library']): f['library'].append(['立体歌单 · 原版',key,label,low,high,step])
# The original workshop has independently editable five-color theme roles.
for key,label in [('sonicWorkshopColorMode','颜色来源'),('sonicWorkshopBaseColorMode','暗部来源'),('sonicWorkshopWarmColorMode','暖色来源'),('sonicWorkshopCoolColorMode','冷色来源'),('sonicWorkshopRippleColorMode','涟漪来源'),('sonicWorkshopPeakColorMode','高光来源')]:
 if not any(row[1]==key for row in f['motion']): f['motion'].append(['音域回响 · 配色',key,label,{'cover':'封面取色','custom':'自定义'}])
for key,label in [('sonicWorkshopCustomColor','主色'),('sonicWorkshopBaseColor','暗部'),('sonicWorkshopWarmColor','暖色'),('sonicWorkshopCoolColor','冷色'),('sonicWorkshopRippleColor','涟漪'),('sonicWorkshopPeakColor','高光')]:
 if not any(row[1]==key for row in f['motion']): f['motion'].append(['音域回响 · 配色',key,label,'color'])
for name,value in [('DEFAULTS',d),('FIELDS',f),('NUMBERS',n)]: s=re.sub(r'const '+name+r'=Object.freeze\([^\n]+\);','const '+name+'=Object.freeze('+json.dumps(value,ensure_ascii=False,separators=(',',':'))+');',s)
p.write_text(s,encoding='utf8')
