'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('immersive transport enlarges the cover and anchors the play button between equal side columns', () => {
  const dom = new JSDOM('<section class="music-immersive"><div class="uses-stage-transport"><div class="music-player-bar"><div class="music-stage-transport"><div class="music-stage-progress"></div><div class="music-stage-track"><i class="music-disc"></i></div><div class="music-stage-center"><button class="music-icon-button"></button><button class="music-play-toggle"></button></div></div></div></div></section>');
  try {
    const style = dom.window.document.createElement('style');
    style.textContent = fs.readFileSync(path.join(__dirname, '../ui/music/immersive-transport.css'), 'utf8');
    dom.window.document.head.append(style);
    const computed = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
    assert.equal(computed('.music-player-bar').height, '82px');
    assert.equal(computed('.music-disc').width, '60px');
    assert.equal(computed('.music-disc').height, '60px');
    assert.equal(computed('.music-icon-button').width, '27px');
    assert.equal(computed('.music-icon-button').height, '30px');
    assert.equal(computed('.music-stage-transport').getPropertyValue('--stage-play-size'), '46px');
    assert.equal(computed('.music-play-toggle').width, 'var(--stage-play-size)');
    assert.equal(computed('.music-play-toggle').height, 'var(--stage-play-size)');
    assert.equal(computed('.music-stage-center').left, '50%');
    assert.equal(computed('.music-stage-center').gridTemplateColumns, '1fr auto 1fr');
    assert.equal(computed('.music-stage-track').top, '50%');
    assert.equal(computed('.music-stage-track').transform, 'translateY(-50%)');
    assert.equal(computed('.music-stage-progress').left, 'var(--stage-copy-left)');
    assert.match(computed('.music-play-toggle').backgroundImage, /255, 255, 255/);
  } finally {dom.window.close();}
});
