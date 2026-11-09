'use strict';

// Fixed operations on publicly rendered official UI only. Never inspect storage,
// page internals, requests, access tokens, license keys, or audio URLs.
function snapshot(playerOnly = false) {
  if(location.origin!=='https://open.spotify.com')return {playlists:[],songs:[],song:null,playing:null,position:0,duration:0,loginRequired:location.hostname==='accounts.spotify.com'};
  const text = node => (node?.innerText || node?.textContent || '').trim().slice(0, 180);
  const id = (link, kind) => {try {const u = new URL(link?.getAttribute('href'), location.href);return u.origin === 'https://open.spotify.com' ? new RegExp('^/' + kind + '/([A-Za-z0-9]{22})$').exec(u.pathname)?.[1] : null;} catch {return null;}};
  const image = node => {
    for (const img of node?.querySelectorAll('img') || []) {
      const sources = (img.getAttribute('srcset') || '').split(',').map(value => {
        const [url,size] = value.trim().split(/\s+/);
        return {url,size:parseFloat(size) || 0};
      }).sort((a,b) => b.size - a.size);
      const candidates = [...sources.map(value => value.url),img.currentSrc,img.getAttribute('src'),img.getAttribute('data-src')];
      for (const value of candidates) {
        if (!value) continue;
        try {
          const url = new URL(value);
          const artworkHost = /(?:^|\.)scdn\.co$|^(?:image-cdn-[a-z]+|pickasso)\.spotifycdn\.com$/.test(url.hostname);
          if (url.protocol !== 'https:' || !artworkHost) continue;
          if (url.hostname === 'i.scdn.co') {
            url.pathname = url.pathname.replace(/^\/image\/ab67616d(?:00004851|00001e02|0000aa54)([a-f0-9]{24})$/i,'/image/ab67616d0000b273$1');
          }
          return url.href;
        } catch {}
      }
    }
    return '';
  };
  const seconds = value => {const parts = value?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);return !parts ? 0 : parts[3] ? +parts[1]*3600 + +parts[2]*60 + +parts[3] : +parts[1]*60 + +parts[2];};
  const widget = document.querySelector('[data-testid="now-playing-widget"],[data-testid="now-playing-widget-v2"]');
  const trackLink = widget?.querySelector('a[href*="/track/"],[data-testid="context-item-info-title"],[data-testid="context-item-link"]'), trackKey = id(trackLink,'track');
  const label = document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute('aria-label') || '';
  const playing = /pause|暂停/i.test(label) ? true : /play|播放/i.test(label) ? false : null;
  const position = seconds(text(document.querySelector('[data-testid="playback-position"]')));
  const duration = seconds(text(document.querySelector('[data-testid="playback-duration"]')));
  const player = {song:text(trackLink)?{id:trackKey?'spotify:'+trackKey:null,title:text(trackLink),artist:[...(widget?.querySelectorAll('a[href*="/artist/"]')||[])].map(text).join(' / '),coverURL:image(widget),duration,source:'spotify'}:null,playing,position,duration,loginRequired:!!document.querySelector('[data-testid="login-button"]')};
  if (playerOnly) return player;
  const playlists = [], seen = new Set();let mainPlaylistCount=0;
  const library = [];
  for (const title of document.querySelectorAll('[id^="listrow-title-spotify:playlist:"]')) {
    const key = title.id.split(':').at(-1);
    if (!/^[A-Za-z0-9]{22}$/.test(key)) continue;
    const row = title.closest('[role="row"]');
    const subtitle = text(row?.querySelector('[data-encore-id="listRowSubtitle"]'));
    library.push({id:'spotify:'+key,title:text(title),coverURL:image(row),source:'spotify',creator:subtitle.replace(/^.*?•\s*/, '')});
  }
  // Main recommendation cards take precedence over lazy sidebar entries.
  const playlistLinks=[...document.querySelectorAll('main a[href*="/playlist/"]'),...document.querySelectorAll('a[href*="/playlist/"]')];
  for (const link of playlistLinks) {
    const key = id(link, 'playlist');if (!key || seen.has(key)) continue;
    if(link.closest('[data-encore-id="cardSubtitle"]'))continue;
    // Encore places the link over a sibling image. Stop at the nearest card
    // that belongs to this playlist, never borrow an adjacent playlist's art.
    let card = link.closest('[data-testid="card"],[data-encore-id="card"],[data-encore-id="listRow"],[role="listitem"],li') || link.parentElement || link;
    const primary=card.querySelector('a[href*="/playlist/"]');
    if(primary&&id(primary,'playlist')!==key)continue;
    for (let depth = 0; depth < 4 && !image(card) && card.parentElement; depth++) {
      const parent = card.parentElement;
      const keys = new Set([...parent.querySelectorAll('a[href*="/playlist/"]')].map(node=>id(node,'playlist')).filter(Boolean));
      if (keys.size !== 1 || !keys.has(key)) break;
      card = parent;
    }
    const title = text(link) || link.getAttribute('aria-label') || card.querySelector('img')?.alt || '';
    if (!title) continue;seen.add(key);playlists.push({id:'spotify:'+key,title,coverURL:image(card),source:'spotify'});if(link.closest('main'))mainPlaylistCount++;if (playlists.length>=100)break;
  }
  // New Spotify rows omit public track URLs. These keys identify rendered
  // playlist rows locally; they are never sent to Spotify's music API.
  const localKey=value=>[2166136261,2246822519,3266489917].map(seed=>{let hash=seed;for(const ch of value)hash=Math.imul(hash^ch.charCodeAt(0),16777619);return (hash>>>0).toString(16).padStart(8,'0');}).join('').slice(0,22);
  const songs = [];
  let rowOffset=0;
  for (const row of document.querySelectorAll('[data-testid="tracklist-row"]')) {
    const rowNumber=Number(row.closest('[aria-rowindex]')?.getAttribute('aria-rowindex'))||++rowOffset;
    const link = [...row.querySelectorAll('a[href*="/track/"]')].find(node=>id(node,'track'));
    const playlistId=/^\/playlist\/([A-Za-z0-9]{22})$/.exec(location.pathname)?.[1] || (/^\/(search|collection)\//.test(location.pathname)?location.pathname:null);
    const key = id(link,'track')||(playlistId?localKey(playlistId+':'+rowNumber):null);if(!key)continue;
    const title=link||row.querySelector('[role="gridcell"][aria-colindex="2"] [data-encore-id="text"][dir="auto"]');if(!text(title))continue;
    const durations = [...row.querySelectorAll('[data-testid="track-duration"],[role="gridcell"],span')].map(text).concat(text(row).split(/\n/)).map(value=>value.trim()).filter(value=>/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value));
    const saved=row.querySelector('button[aria-checked]')?.getAttribute('aria-checked');
    songs.push({id:'spotify:'+key,title:text(title),browserRow:rowNumber,artist:[...row.querySelectorAll('a[href*="/artist/"]')].map(text).join(' / '),coverURL:image(row),duration:seconds(durations.at(-1)),source:'spotify',...(saved==='true'||saved==='false'?{liked:saved==='true'}:{})});if(songs.length>=100)break;
  }
  for (const link of document.querySelectorAll('main [data-testid="title"] a[href*="/track/"]')) {
    const key = id(link, 'track');
    if (!key || songs.some(song => song.id === 'spotify:' + key)) continue;
    const row = link.closest('[data-encore-id="listRow"]');
    const checked = row?.querySelector('[data-testid="save-button"] button')?.getAttribute('aria-checked');
    songs.push({id:'spotify:'+key,title:text(link),artist:[...(row?.querySelectorAll('a[href*="/artist/"]') || [])].map(text).join(' / '),coverURL:image(row),duration:0,source:'spotify',...(checked === 'true' || checked === 'false' ? {liked:checked === 'true'} : {})});
  }
  const user = document.querySelector('[data-testid="user-widget-link"],[data-testid="user-widget-avatar"]');
  return {path:location.pathname,heading:text(document.querySelector('main h1')),library,playlists:location.pathname==='/'&&mainPlaylistCount?playlists.slice(0,mainPlaylistCount):playlists,mainPlaylistCount,songs,profileName:user?.getAttribute('title')||user?.getAttribute('aria-label')||'',
    ...player};
}

function target(kind, value, readSnapshot, activate) {
  if(location.origin!=='https://open.spotify.com')return null;
  let node;
  if(kind==='track'){const item=readSnapshot().songs.find(song=>song.id==='spotify:'+value);if(!item)return null;let offset=0;node=item.browserRow?[...document.querySelectorAll('[data-testid="tracklist-row"]')].find(row=>(Number(row.closest('[aria-rowindex]')?.getAttribute('aria-rowindex'))||++offset)===item.browserRow):[...document.querySelectorAll('main a[href*="/track/"]')].find(link=>new URL(link.href).pathname==='/track/'+value)?.closest('[data-encore-id="listRow"]');if(node){const button=node.querySelector('button[data-testid="play-button"]')||[...node.querySelectorAll('button[aria-label]')].find(button=>/^(?:播放 |Play )/.test(button.getAttribute('aria-label')));if(button)node=button;}}
  else node=document.querySelector('[data-testid="control-button-playpause"]');
  if(!node)return null;node.scrollIntoView({block:'center'});const box=node.getBoundingClientRect();
  if(box.width<=0||box.height<=0)return null;
  const button=node.tagName==='BUTTON';if(activate&&button)node.click();return {x:box.x+Math.min(box.width/2,160),y:box.y+box.height/2,clicks:button?1:2,activated:!!activate&&button};
}

const snapshotScript = '('+snapshot.toString()+')()';
const playerSnapshotScript = '('+snapshot.toString()+')(true)';
function targetScript(kind,value='',activate=false) {
  if(!['track','toggle'].includes(kind)||kind==='track'&&!/^[A-Za-z0-9]{22}$/.test(value))throw new Error('无效的 Spotify 网页操作');
  return '('+target.toString()+')('+JSON.stringify(kind)+','+JSON.stringify(value)+','+snapshot.toString()+','+JSON.stringify(activate===true)+')';
}
module.exports={snapshotScript,playerSnapshotScript,targetScript,snapshotFunction:snapshot};
