'use strict';

const {matchSong} = require('./song-match.cjs');

// Reuse the existing lyric catalog for an exact recording match. Account,
// playback ownership and audio remain with the source platform.
function createMatchedLyrics({request}) {
  const cache = new Map();
  let disposed = false;
  async function lookup(target) {
    if (disposed || !target?.title || !target?.artist) return {lines:[]};
    const key = JSON.stringify([target.title,target.artist,Math.round(target.duration || 0)]);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < (hit.value.lines?.length ? 1800000 : 30000)) return structuredClone(hit.value);
    // The title-only pass covers providers which tokenize multiple credited
    // artists differently. Every candidate still passes the same strict match.
    const queries = [...new Set([target.title+' '+target.artist,target.title])];
    for (const query of queries) {
      const result = await request('search',{query});
      if (disposed) return {lines:[]};
      const song = matchSong(target,result.songs);
      if (!song) continue;
      const value = await request('lyrics',{id:song.id});
      if (disposed) return {lines:[]};
      if (value.lines?.length) return save(key,{...value,matched:true,lyricSource:'netease'});
    }
    return save(key,{lines:[]});
  }
  function save(key,value) {
    cache.delete(key);cache.set(key,{at:Date.now(),value:structuredClone(value)});
    while (cache.size > 12 || [...cache.values()].reduce((sum,item)=>sum+Buffer.byteLength(JSON.stringify(item.value)),0)>2*1024*1024) cache.delete(cache.keys().next().value);
    return value;
  }
  return {lookup,dispose(){disposed=true;cache.clear();}};
}
module.exports = {createMatchedLyrics};
