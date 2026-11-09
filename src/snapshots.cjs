'use strict';
// Keep the island contract small: no complete event history, paths catalogue,
// daily archive, price table, or project aggregation crosses its IPC boundary.
function forIsland(snapshot) {
  return {
    updatedAt: snapshot.updatedAt,
    settings: snapshot.settings,
    material: snapshot.material,
    diagnostics: { loading: snapshot.diagnostics?.loading },
    sessions: (snapshot.sessions || []).filter(session => !session.isSubagent).map(session => {
      const events = session.events || [];
      const recent = events.filter(event => !['usage', 'status'].includes(event.type)).slice(-6);
      if (!recent.length && events.length) recent.push(events.at(-1));
      const { id, title, agent, model, cwd, tokens, costUSD, knownCostUSD, unpricedTokens, status, updatedAt, projectName, today } = session;
      return { id, title, agent, model, cwd, tokens, costUSD, knownCostUSD, unpricedTokens, status, updatedAt, projectName, today,
        events: recent.map(({ id, type, role, title, text, timestamp }) => ({ id, type, role, title, text: typeof text === 'string' ? text.slice(0, 1600) : '', timestamp })) };
    })
  };
}
module.exports = { forIsland };
