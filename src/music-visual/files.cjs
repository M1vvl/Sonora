'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function writeJSON(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const next=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';let fd;try{fd=fs.openSync(next,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(next,file);}finally{if(fd!==undefined&&fd!==null)fs.closeSync(fd);try{fs.unlinkSync(next);}catch{}}}
function readJSON(file,max=65536){try{if(fs.statSync(file).size<=max)return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{}return null;}
module.exports={writeJSON,readJSON};
