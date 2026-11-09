/* MineRadio GPL-3.0 lyric module host contracts. Load after Three/scene and before source modules.
 * Supplies real Agent Pulse state adapters, not a second renderer or audio element. */
window.pulseSourceSceneOwnsFrames=true;
var pulseSourceLyricHost={active:true,disposed:false,attached:false,songId:'',title:'',position:0,duration:0,playing:false,seeking:false,offset:0,shelf:{open:false,detail:false},frameGates:{},errors:[]};
var fxDefaults=Object.assign({},typeof pulseSourceLyricDefaults==='object'?pulseSourceLyricDefaults:{},typeof fxDefaults==='object'?fxDefaults:{});
var fx=Object.assign({},fxDefaults,typeof fx==='object'?fx:{});
var scene=typeof scene==='object'?scene:null,camera=typeof camera==='object'?camera:null,renderer=typeof renderer==='object'?renderer:null;
var uniforms=typeof uniforms==='object'?uniforms:{};
['uTime','uPixel','uBass','uMid','uTreble','uBeat','uEnergy'].forEach(function(key){if(!uniforms[key])uniforms[key]={value:key==='uPixel'?1:0};});
var lyricsLines=[],lyricsTranslationLines=[],lyricsHasNativeKaraoke=false,lyricsTimingSource='fallback',lyricsTranslationSource='none',lyricSourceMode='original';
var audio={currentTime:0,duration:0,src:'',paused:true,ended:false},playing=false,playQueue=[],currentIdx=-1;
var bass=typeof bass==='number'?bass:0,mid=typeof mid==='number'?mid:0,treble=typeof treble==='number'?treble:0,beatPulse=typeof beatPulse==='number'?beatPulse:0,lyricSunEnergy=0;
var beatCam={punch:0,radiusKick:0,thetaKick:0,phiKick:0,rollKick:0};
var orbit=typeof orbit==='object'?orbit:{centerLocked:false,recentering:false};
var particles=typeof particles==='object'?particles:null;
var shelfManager=(typeof shelfManager==='object'&&shelfManager)||{getMode:function(){return pulseSourceLyricHost.shelf.mode||'side';},hasOpenContent:function(){return pulseSourceLyricHost.shelf.detail===true;}};
var shelfPinnedOpen=false,shelfVisibility=0;
var customLyricFonts=[],CUSTOM_LYRIC_FONT_STORE_KEY='pulse-source-fonts',CUSTOM_LYRIC_FONT_MAX_COUNT=0;
var pulseOwnLyricDot=typeof dotTexture==='undefined';
var dotTexture=typeof dotTexture!=='undefined'?dotTexture:(function(){var c=document.createElement('canvas');c.width=c.height=32;var x=c.getContext('2d'),g=x.createRadialGradient(16,16,0,16,16,16);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,32,32);return new THREE.CanvasTexture(c);})();
function clampRange(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function normalizeHexColor(value,fallback){return /^#[a-f0-9]{6}$/i.test(value||'')?value:fallback;}
function normalizeLyricTranslationText(value){return String(value||'').replace(/\s+/g,' ').trim();}
function hexToRgb(value){var c=new THREE.Color(value||'#ffffff');return {r:Math.round(c.r*255),g:Math.round(c.g*255),b:Math.round(c.b*255)};}
function rgbToHsl(r,g,b){return new THREE.Color(r/255,g/255,b/255).getHSL({});}
function hslToRgb(h,s,l){var c=new THREE.Color().setHSL(h,s,l);return {r:Math.round(c.r*255),g:Math.round(c.g*255),b:Math.round(c.b*255)};}
function rgbCss(c,alpha){return alpha==null?'rgb('+c.r+','+c.g+','+c.b+')':'rgba('+c.r+','+c.g+','+c.b+','+alpha+')';}
function currentAppliedLyricRenderSignature(){return [pulseSourceLyricHost.songId,lyricSourceMode,lyricsHasNativeKaraoke,lyricsLines.length,lyricsLines[0]?.text||'',lyricsLines.at(-1)?.text||''].join('|');}
function currentLyricFallbackText(){return pulseSourceLyricHost.title||'';}
function getAdjustedLyricPlaybackTime(seconds){return Math.max(0,Number(seconds||0)+pulseSourceLyricHost.offset);}
function isProgressDragPreviewActive(){return pulseSourceLyricHost.seeking;}
function getProgressDragPreviewSeconds(){return pulseSourceLyricHost.seeking?pulseSourceLyricHost.position:null;}
function songProviderKey(song){return String(song?.provider||song?.source||'netease');}
function resetFrameGate(name){pulseSourceLyricHost.frameGates[name]=0;}
function markRenderInteraction(kind,duration){pulseSourceLyricHost.interactionUntil=performance.now()+Math.max(0,Number(duration)||0);pulseSourceLyricHost.interactionKind=kind;}
function shouldAvoidStageLyricsForShelf(){return pulseSourceLyricHost.shelf.open===true;}
function shouldOffsetLyricsForShelfDetail(){return pulseSourceLyricHost.shelf.detail===true;}
function isHiddenForBackgroundOptimization(){return !pulseSourceLyricHost.active||document.hidden;}
function isDeepBackgroundMode(){return !pulseSourceLyricHost.active;}

// Capture the one original font listener so disposing the source layer removes
// it even when the containing scene is kept alive by the host.
var pulseLyricFontListeners=[],pulseLyricFontAdd=null;
if(document.fonts&&document.fonts.addEventListener){pulseLyricFontAdd=document.fonts.addEventListener;document.fonts.addEventListener=function(type,listener,options){pulseLyricFontListeners.push({type:type,listener:listener,options:options});return pulseLyricFontAdd.call(this,type,listener,options);};}
