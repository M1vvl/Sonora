'use strict';

// All platforms confirm server state before changing the local heart. A
// truncated library is an unknown state, never evidence that a track is absent.
async function confirmFavorite({read, write, liked, toggle = false, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (typeof liked !== 'boolean' || typeof toggle !== 'boolean') throw new Error('无效的收藏操作');
  const before = await read();
  if (typeof before?.liked !== 'boolean') throw new Error('未能读取完整收藏状态，请稍后重试');
  const desired = toggle ? !before.liked : liked;
  if (before.liked === desired) return desired;
  await write(desired, before);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait(300);
    const state = await read();
    if (state?.liked === desired) return desired;
  }
  throw Object.assign(new Error('平台尚未确认收藏变更，请刷新后重试'), {code:'LIKE_UNCONFIRMED'});
}

module.exports = {confirmFavorite};
