'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {resolveCategoryTypes,categoryPage,categoryHasMore,doubanCategory}=require('../src/movies/categories.cjs');
const {createMoviesService}=require('../src/movies/index.cjs');
const source={id:'fixture',name:'分类测试',url:'https://category.example/api.php/provide/vod'};
const classes=[{type_id:1,type_name:'电影片',type_pid:0},{type_id:6,type_name:'动作片',type_pid:1},{type_id:7,type_name:'喜剧片',type_pid:1},{type_id:8,type_name:'伦理片',type_pid:1},{type_id:2,type_name:'连续剧',type_pid:0},{type_id:13,type_name:'国产剧',type_pid:2},{type_id:14,type_name:'香港剧',type_pid:2},{type_id:20,type_name:'记录片',type_pid:1}];
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const vod=(id,type)=>({vod_id:id,vod_name:'条目 '+id,type_name:type,vod_play_url:'正片$https://media.example/'+id+'.m3u8'});
async function fixture(t,fetchImpl){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pulse-category-')),service=createMoviesService({dataDir,sources:[source],fetchImpl});t.after(async()=>{await service.dispose();await fs.rm(dataDir,{recursive:true,force:true});});return service;}

test('category aliases resolve provider leaves and exclude adult or preview branches',()=>{
  assert.deepEqual(resolveCategoryTypes(classes,'电视剧'),['13','14']);assert.deepEqual(resolveCategoryTypes(classes,'电影'),['6','7','20']);assert.deepEqual(resolveCategoryTypes(classes,'动作'),['6']);assert.deepEqual(resolveCategoryTypes(classes,'纪录片'),['20']);assert.deepEqual(resolveCategoryTypes(classes,'悬疑'),[]);
  assert.deepEqual(doubanCategory('电视剧'),{type:'tv',tag:'热门'});
});
test('leaf cursors round-robin countries and exhaust only after every known leaf is done',()=>{
  const ids=['13','14'],counts=new Map();assert.deepEqual(categoryPage(ids,1),{type:'13',page:1,index:0});counts.set('13',2);assert(categoryHasMore(ids,counts,1));assert.deepEqual(categoryPage(ids,2),{type:'14',page:1,index:1});counts.set('14',1);assert(categoryHasMore(ids,counts,2));assert.deepEqual(categoryPage(ids,3),{type:'13',page:2,index:0});assert.equal(categoryHasMore(ids,counts,3),false);
});
test('TV catalog never queries empty parent IDs and advances each leaf with its own actual pages',async t=>{
  const requests=[],service=await fixture(t,async(url)=>{const u=new URL(url);requests.push(u);if(u.hostname==='movie.douban.com')throw new Error('Specific source catalog must be preferred');if(u.searchParams.get('ac')==='list')return json({class:classes});const type=u.searchParams.get('t'),pg=Number(u.searchParams.get('pg'));assert(['13','14'].includes(type));return json({page:pg,pagecount:type==='13'?2:1,list:[vod(type+'-'+pg,type==='13'?'国产剧':'香港剧')]});});
  const first=await service.request('catalog',{category:'电视剧'}),second=await service.request('catalog',{category:'电视剧',offset:first.nextOffset}),third=await service.request('catalog',{category:'电视剧',offset:second.nextOffset});
  assert.equal(first.items[0].title,'条目 13-1');assert.equal(second.items[0].title,'条目 14-1');assert.equal(third.items[0].title,'条目 13-2');assert.equal(first.hasMore,true);assert.equal(second.hasMore,true);assert.equal(third.hasMore,false);assert.equal(third.nextOffset,72);assert.equal(requests.filter(u=>u.searchParams.get('ac')==='list').length,1);
});
test('full genre catalog wins over tiny stale recommendations and remains on the same backend for pagination',async t=>{
  let metadataCalls=0;const service=await fixture(t,async(url)=>{const u=new URL(url);if(u.hostname==='movie.douban.com'){metadataCalls++;return json({subjects:[{id:'old',title:'陈旧推荐'}]});}if(u.searchParams.get('ac')==='list')return json({class:classes});assert.equal(u.searchParams.get('t'),'6');return json({page:Number(u.searchParams.get('pg')),pagecount:5,list:Array.from({length:20},(_,i)=>vod(u.searchParams.get('pg')+'-'+i,'动作片'))});});
  const first=await service.request('catalog',{category:'动作'});assert.equal(first.items.length,20);assert(first.hasMore);await service.request('catalog',{category:'动作',offset:first.nextOffset});assert.equal(metadataCalls,0);
});
test('empty first recommendation page falls back, while exhausted later metadata pages do not mix CMS cursors',async t=>{
  let cmsCalls=0;const service=await fixture(t,async(url)=>{const u=new URL(url);if(u.hostname==='movie.douban.com')return json({subjects:[]});cmsCalls++;return json({page:Number(u.searchParams.get('pg')),pagecount:2,list:[vod('movie','动作片')]});});
  const first=await service.request('catalog',{category:'热门'});assert.equal(first.items.length,1);assert(first.hasMore);await service.request('catalog',{category:'热门',offset:first.nextOffset});assert.equal(cmsCalls,2);
  const metadata=await fixture(t,async(url)=>{const u=new URL(url);if(u.hostname==='movie.douban.com')return json({subjects:Number(u.searchParams.get('page_start'))===0?Array.from({length:24},(_,i)=>({id:i+1,title:'推荐 '+i})):[]});throw new Error('metadata pagination must not switch providers');});
  const start=await metadata.request('catalog',{category:'热门'}),end=await metadata.request('catalog',{category:'热门',offset:start.nextOffset});assert.equal(end.items.length,0);assert.equal(end.hasMore,false);
});
