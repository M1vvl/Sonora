'use strict';

// DOM geometry only. This check never captures the desktop or changes system
// transparency, and can run in either compact or expanded island state.
async function checkIslandChrome(island) {
  return island.webContents.executeJavaScript(`(() => {
    const header=document.querySelector('.island-header').getBoundingClientRect();
    const metrics=document.querySelector('.compact-metrics').getBoundingClientRect();
    const root=document.getElementById('island').getBoundingClientRect();
    const right=root.right-metrics.right,top=metrics.top-root.top;
    const bottom=header.bottom-metrics.bottom+header.top-root.top;
    const bars=[...document.querySelectorAll('.drag-handle span')];
    const ratio=devicePixelRatio;
    const pixel=value=>Math.abs(value*ratio-Math.round(value*ratio))<.06;
    return {
      comfortableTokenPillInset:right>=6&&right<=8&&Math.abs(right-top-3)<.75&&Math.abs(top-bottom)<.75,
      roundedMeterPixelGrid:bars.length===3&&bars.every(bar=>{
        const style=getComputedStyle(bar),rect=bar.getBoundingClientRect();
        return style.position==='absolute'&&style.transform.startsWith('matrix(1, 0, 0, 1,')&&pixel(rect.left)&&pixel(rect.right)&&pixel(rect.top)&&pixel(rect.bottom);
      })
    };
  })()`);
}

module.exports={checkIslandChrome};
