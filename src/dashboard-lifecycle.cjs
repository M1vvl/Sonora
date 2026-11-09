'use strict';

// The dashboard owns the single music element. Keep that renderer only while
// a stream or a pending play needs it, and suspend its presentation when hidden.
function attachDashboardLifecycle({window,isQuitting,hasPlayback,onBackground,onClose,onVideoClose,onVisibility}) {
  const close = event => {
    if (isQuitting()) return;
    onVideoClose();
    if (hasPlayback()) {
      event.preventDefault();
      onBackground();
      window.hide();
    } else onClose();
  };
  const hide = () => onVisibility(false);
  const show = () => onVisibility(true);
  const dispose = () => {
    window.removeListener('close',close);
    window.removeListener('hide',hide);
    window.removeListener('show',show);
  };
  window.on('close',close);
  window.on('hide',hide);
  window.on('show',show);
  window.once('closed',dispose);
  return {dispose};
}
module.exports = {attachDashboardLifecycle};
