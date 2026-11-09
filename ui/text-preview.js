'use strict';
// Presentation-only cleanup. The underlying log and accounting data stay intact.
((root) => {
  function clean(value, maximum = 1600) {
    return String(value || '')
      .slice(0, 12000)
      .replace(/:{1,2}(?:codex-[a-z-]+|created-thread|code-comment)\{[^}\r\n]*\}/gi, '')
      .replace(/:codex-followup\[([^\]]*)\]\{[^}\r\n]*\}/gi, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*```[^\r\n]*$/gm, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*{1,3}([^*\r\n]+)\*{1,3}/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n')
      .trim().slice(0, maximum);
  }
  const api = Object.freeze({ clean });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseTextPreview = api;
})(typeof window === 'object' ? window : globalThis);
