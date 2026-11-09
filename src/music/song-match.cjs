'use strict';

const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function matchSong(target,candidates){
  const title=normalize(target?.title);
  const artistNames=value=>String(value||'').split(/\s*(?:\/|&|;|、|，|,|\bfeat\.?|\bft\.?)\s*/i).map(normalize).filter(Boolean);
  const artists=artistNames(target?.artist);
  if(!title||!artists.length||artists.includes('未知歌手'))return null;
  return (Array.isArray(candidates)?candidates:[]).slice(0,60).find(song=>{
    const candidateArtists=new Set(artistNames(song?.artist));
    if(normalize(song?.title)!==title||!artists.every(artist=>candidateArtists.has(artist)))return false;
    return !target.duration||!song.duration||Math.abs(song.duration-target.duration)<5;
  })||null;
}
module.exports={matchSong};
