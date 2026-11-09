'use strict';
// UI labels are not CMS category IDs. Resolve the provider's own tree, then
// visit its leaf categories in round-robin pages rather than querying empty parents.
const patterns=Object.freeze({
  '电影':/^(?:电影|电影片|影片)$/,
  '电视剧':/^(?:电视剧|连续剧|剧集|电视连续剧)$/,
  '动作':/^(?:动作|动作片|动作电影)$/,
  '喜剧':/^(?:喜剧|喜剧片|喜剧电影)$/,
  '科幻':/^(?:科幻|科幻片|科幻电影)$/,
  '悬疑':/^(?:悬疑|悬疑片|悬疑电影)$/,
  '爱情':/^(?:爱情|爱情片|爱情电影)$/,
  '恐怖':/^(?:恐怖|恐怖片|恐怖电影)$/,
  '动画':/^(?:动画|动画片|动画电影|动漫|动漫片)$/,
  '纪录片':/^(?:纪录|纪录片|记录|记录片|纪录电影)$/
});
const excluded=/伦理|倫理|色情|福利|成人|预告|解说/;
function resolveCategoryTypes(values,category){
  const pattern=patterns[category];if(!pattern)return [];
  const nodes=(Array.isArray(values)?values:[]).slice(0,200).flatMap(value=>{
    const id=String(value?.type_id??''),name=String(value?.type_name??'').normalize('NFKC').replace(/\s+/g,'');
    return /^\d{1,10}$/.test(id)&&name&&!excluded.test(name)?[{id,parent:String(value.type_pid??0),name}]:[];
  });
  const children=new Map();for(const node of nodes){if(!children.has(node.parent))children.set(node.parent,[]);children.get(node.parent).push(node);}
  const selected=new Set(),seen=new Set();
  function visit(node){if(seen.has(node.id))return;seen.add(node.id);const descendants=children.get(node.id)||[];if(descendants.length)descendants.forEach(visit);else selected.add(node.id);}
  nodes.filter(node=>pattern.test(node.name)).forEach(visit);
  return [...selected].slice(0,30);
}
function categoryPage(types,logicalPage){
  if(!types.length)return null;
  const position=Math.max(0,Math.floor(logicalPage)-1),index=position%types.length;
  return {type:types[index],page:Math.floor(position/types.length)+1,index};
}
function categoryHasMore(types,counts,consumedPage){
  return types.some((id,index)=>{
    if(!counts.has(id))return true;
    const nextIndex=consumedPage+(index-consumedPage%types.length+types.length)%types.length;
    return Math.floor(nextIndex/types.length)+1<=counts.get(id);
  });
}
function doubanCategory(category){return {type:category==='电视剧'?'tv':'movie',tag:['主页','电影','电视剧'].includes(category)?'热门':category};}
module.exports={resolveCategoryTypes,categoryPage,categoryHasMore,doubanCategory};
