const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('all nine Anime4K shader files retain their exact imported bytes and upstream license',()=>{
  const directory=path.join(__dirname,'../native/player/resources/shaders'),manifest=require('../native/player/resources/shaders/manifest.json');
  assert.equal(Object.keys(manifest.files).length,9);
  for(const[name,digest]of Object.entries(manifest.files)){
    const bytes=fs.readFileSync(path.join(directory,name));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),digest);assert.match(bytes.toString('utf8'),/Anime4K/);assert.match(bytes.toString('utf8'),/\/\/!HOOK/);
  }
  assert.match(fs.readFileSync(path.join(directory,'LICENSE'),'utf8'),/bloc97/);
});
