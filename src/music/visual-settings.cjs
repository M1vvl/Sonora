'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normalize}=require('../../ui/music/visual-settings.js');
function createVisualSettings(dataDir){const file=dataDir?path.join(dataDir,'music-visuals.json'):null;let loaded=false,current=normalize();function read(){if(!loaded){loaded=true;try{if(file&&fs.statSync(file).size<=16384)current=normalize(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}}return {...current};}function save(input){read();const value=normalize({...current,...input});if(file){fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch{}}}current=value;return read();}return {read,save};}
module.exports={createVisualSettings};
