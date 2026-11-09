'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { loadPricing, normalizeUsage, priceUsage } = require('./pricing.cjs');
const { readCodexScope, GRACE_MS } = require('./codex-scope.cjs');
const { normalizeRoot } = require('./projects.cjs');

const ZERO = () => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 });
const CACHE_VERSION = 3;
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24); }
function redact(value, limit = 420) {
  return String(value || '')
    .replace(/\b(?:sk|sess|rk)-[A-Za-z0-9_-]{12,}\b/g, '[已隐藏凭据]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[已隐藏凭据]')
    .replace(/((?:api[_ -]?key|authorization|access[_ -]?token|refresh[_ -]?token|password|secret)\s*["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'\]}]+/gi, '$1[已隐藏凭据]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [已隐藏凭据]')
    .slice(0, limit);
}
function dayKey(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : '';
}
function titlePreview(value) {
  let text = String(value || '').trim();
  if (/^(?:<external_codex_apps_open_page>|\{"page_id":null\})/.test(text)) return '';
  const marker = text.indexOf('## My request:');
  if (marker >= 0) text = text.slice(marker + '## My request:'.length).trim();
  else if (/^# Files mentioned by the user:/.test(text)) return '';
  text = text.replace(/^\s*\[[^\]]+\]\(https?:\/\/[^)]+\)\s*/, '')
    .replace(/^\s*["“][A-Za-z]:\\[^"”\r\n]+["”]\s*/, '');
  return redact(text.split(/\r?\n/).find(line => line.trim())?.replace(/^#+\s*/, '').trim(), 100);
}
function add(target, value) { for (const key of Object.keys(ZERO())) target[key] += value[key] || 0; }
function newAggregate() { return { ...ZERO(), costUSD: 0, knownCostUSD: 0, unpricedTokens: 0, sessions: 0 }; }
function mergeUsage(target, entry) {
  add(target, entry.tokens);
  target.knownCostUSD += entry.costUSD || 0;
  target.unpricedTokens += entry.unpricedTokens || 0;
  target.costUSD = target.unpricedTokens ? null : target.knownCostUSD;
}
async function exists(file) { try { await fsp.access(file); return true; } catch { return false; } }
async function dirs(file) { try { return await fsp.readdir(file, { withFileTypes: true }); } catch { return []; } }

function createMonitor(options = {}) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const claudeHome = path.resolve(options.claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  // Explicit bounds remain available for diagnostics/tests; production defaults index
  // every eligible local file from byte zero; archived and hidden Codex threads are excluded before aggregation.
  const historyDays = Number.isFinite(options.historyDays) && options.historyDays > 0 ? options.historyDays : null;
  const maxFiles = Number.isFinite(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : Infinity;
  const maxInitialBytes = options.maxInitialBytes ?? 0;
  const maxLineBytes = options.maxLineBytes || 0;
  const now = options.now || (() => Date.now());
  const states = new Map();
  const usageIds = new Set();
  let timer, running = false, stopped = false, refreshPromise, discoveredAt = 0, revision = 0, persistedRevision = -1;
  let codexScope = readCodexScope(codexHome),scopeIdentity = null;
  const scopeProjects = () => codexScope.projectCatalog.available ? codexScope.projectCatalog.projects : (options.projects || []);
  const scopeAssignments = () => codexScope.projectCatalog.available ? codexScope.projectCatalog.assignments : (options.projectAssignments || {});
  const scopeContext = statesById => ({projects:scopeProjects(),assignments:scopeAssignments(),now:now(),statesById});
  let catalog = [], pricing = loadPricing(options.pricingPath);
  const diagnostics = {
    loading: false, partial: false, historyComplete: false, progress: 0, historyDays, maxFiles: Number.isFinite(maxFiles) ? maxFiles : null, maxInitialBytes,
    scopeLabel: historyDays ? `最近 ${historyDays} 日活跃的本地会话${maxInitialBytes ? `（每文件最多初读 ${(maxInitialBytes / 1048576).toFixed(1)} MiB）` : '（完整日志）'}` : 'Codex可见项目的未归档对话',
    codexHome, claudeHome, filesDiscovered: 0, filesRead: 0, bytesRead: 0,
    filesTotal: 0, bytesTotal: 0, bytesIndexed: 0, cacheRestored: 0, cacheUpdatedAt: null,
    unavailableIndexedLogs: 0, unavailableConversations: 0,
    malformedLines: 0, oversizedLines: 0, duplicatesSkipped: 0,
    truncatedFiles: 0, errors: [], sources: {},
    note: '完整读取本地现存会话日志并按北京时间划分每日用量；云端未同步或已被删除的日志无法补回。输入含缓存，输出含推理。',
  };
  function recordError(message) {
    const safe = redact(message, 220);
    if (!diagnostics.errors.includes(safe)) diagnostics.errors.push(safe);
    diagnostics.errors = diagnostics.errors.slice(-12);
    diagnostics.partial = true;
  }
  function publish() { if (!stopped) options.onUpdate?.(getSnapshot()); }
  function makeState(file, agent, meta = {}) {
    const id = meta.id || path.basename(file, '.jsonl').replace(/^rollout-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-/, '');
    const state = {
      file, agent, offset: 0, mtimeMs: null, decoder: new StringDecoder('utf8'), pending: '', skipFirst: false,
      skipLong: false, previous: null, previousAt: null, canonicalPending: ZERO(), seen: new Set(), usage: [], usageMap: new Map(), events: [],
      id, title: titlePreview(meta.title), model: meta.model || 'unknown', priceModel: 'unknown', cwd: meta.cwd || '',
      startedAt: null, updatedAt: null, status: 'unknown', rateLimits: null, contextWindow: null,
      partial: false, provider: null, source: null, parentThreadId: null, rootSessionId: null, isSubagent: false, initial: true,
      archive: /[\\/]archived_sessions[\\/]/.test(file), fingerprint: null, identityEstablished: false,
    };
    states.set(file, state);
    return state;
  }
  const cacheIdentity = JSON.stringify({ codexHome, claudeHome, historyDays, maxFiles: Number.isFinite(maxFiles) ? maxFiles : null, maxInitialBytes, maxLineBytes });
  function cachedFileAllowed(file, agent) {
    const home = agent === 'Codex' ? codexHome : claudeHome;
    const relative = path.relative(home, file);
    return !relative.startsWith('..') && !path.isAbsolute(relative) && file.endsWith('.jsonl')
      && (agent === 'Codex' ? /^sessions[\\/]/.test(relative) : /^projects[\\/]/.test(relative));
  }
  function restoreCache() {
    if (!options.cachePath) return;
    try {
      const cached = JSON.parse(fs.readFileSync(options.cachePath, 'utf8'));
      if (cached.version !== CACHE_VERSION || cached.identity !== cacheIdentity || !Array.isArray(cached.states)) return;
      for (const saved of cached.states) {
        if (!saved || !['Codex', 'Claude'].includes(saved.agent) || typeof saved.file !== 'string' || !cachedFileAllowed(saved.file, saved.agent)
            || !Number.isSafeInteger(saved.offset) || saved.offset < 0 || !Array.isArray(saved.usage)) continue;
        const state = makeState(saved.file, saved.agent);
        // Explicit fields only: never serialize arbitrary log objects, tool arguments,
        // half-read lines, raw metadata, or decoder buffers into our cache.
        for (const key of ['offset', 'mtimeMs', 'previous', 'previousAt', 'previousInherited', 'ignoredMirror', 'id', 'title', 'model', 'priceModel', 'cwd', 'startedAt', 'updatedAt', 'status', 'rateLimits', 'contextWindow', 'partial', 'provider', 'source', 'parentThreadId', 'rootSessionId', 'isSubagent', 'archive', 'fingerprint']) {
          if (saved[key] !== undefined) state[key] = saved[key];
        }
        state.canonicalPending = normalizeUsage(saved.canonicalPending || {});
        state.events = (saved.events || []).slice(-100).map(item => ({ ...item, title: redact(item.title, 120), text: redact(item.text) }));
        state.seen = new Set(state.events.map(item => `event:${item.id}`));
        state.usage = saved.usage.filter(item => typeof item.key === 'string' && item.tokens && Number.isFinite(item.tokens.total)).map(item => ({
          key: item.key, timestamp: item.timestamp, model: item.model, tokens: item.tokens, ...priceUsage(item.model, item.tokens, pricing)
        }));
        state.usageMap = new Map(state.usage.map(item => [item.key, item]));
        state.identityEstablished = true;
        for (const item of state.usage) usageIds.add(item.key);
        state.initial = false;
        diagnostics.cacheRestored++;
      }
      for (const key of ['malformedLines', 'oversizedLines', 'truncatedFiles']) diagnostics[key] = Number(cached.diagnostics?.[key]) || 0;
      diagnostics.partial = [...states.values()].some(state => state.partial) || diagnostics.malformedLines > 0 || diagnostics.oversizedLines > 0;
      diagnostics.cacheUpdatedAt = cached.updatedAt || null;
      diagnostics.loading = true;
      revision++;
    } catch (error) {
      if (error.code !== 'ENOENT') diagnostics.cacheWarning = '历史缓存不可用，正在重新读取原始日志';
    }
  }
  async function saveCache() {
    if (!options.cachePath || persistedRevision === revision || stopped) return;
    const saveRevision = revision;
    const records = [...states.values()].filter(state => !state.initial).map(state => {
      const heldBytes = state.decoder.lastNeed ? state.decoder.lastTotal - state.decoder.lastNeed : 0;
      const completeOffset = Math.max(0, state.offset - Buffer.byteLength(state.pending, 'utf8') - heldBytes);
      const saved = {};
      for (const key of ['file', 'agent', 'mtimeMs', 'previous', 'previousAt', 'previousInherited', 'ignoredMirror', 'id', 'title', 'model', 'priceModel', 'cwd', 'startedAt', 'updatedAt', 'status', 'rateLimits', 'contextWindow', 'partial', 'provider', 'source', 'parentThreadId', 'rootSessionId', 'isSubagent', 'archive', 'fingerprint']) saved[key] = state[key];
      saved.offset = completeOffset;
      saved.canonicalPending = state.canonicalPending;
      saved.usage = state.usage;
      saved.events = state.events.slice(-100);
      return saved;
    });
    const updatedAt = new Date(now()).toISOString();
    const payload = JSON.stringify({ version: CACHE_VERSION, identity: cacheIdentity, updatedAt, diagnostics: {
      malformedLines: diagnostics.malformedLines, oversizedLines: diagnostics.oversizedLines, truncatedFiles: diagnostics.truncatedFiles
    }, states: records });
    const temporary = `${options.cachePath}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(path.dirname(options.cachePath), { recursive: true });
      await fsp.writeFile(temporary, payload, 'utf8');
      await fsp.rename(temporary, options.cachePath);
      diagnostics.cacheUpdatedAt = updatedAt;
      persistedRevision = saveRevision;
    } catch (error) { diagnostics.cacheWarning = `缓存未保存：${redact(error.code || error.message, 100)}`; }
  }
  restoreCache();
  async function discover() {
    const found = new Map();
    codexScope = readCodexScope(codexHome);
    const indexed = codexScope.indexed,cutoff = historyDays ? now() - historyDays * 86400000 : 0;
    const signature=JSON.stringify({projects:scopeProjects(),assignments:scopeAssignments(),rows:codexScope.rows.map(row=>[row.id,row.archived,row.cwd,row.source,row.project_id]),projectless:[...codexScope.projectCatalog.projectless],excludedAssignments:[...codexScope.projectCatalog.excludedAssignments]});
    if(signature!==scopeIdentity){scopeIdentity=signature;revision++;}
    const excluded={},indexedByFile=new Map();
    const absoluteLog=value=>path.resolve(String(value||'').replace(/^\\\\\?\\/,''));
    for(const row of codexScope.rows){
      const file=absoluteLog(row.rollout_path),relative=path.relative(codexHome,file);
      if(relative.startsWith('..')||path.isAbsolute(relative)||!/^(sessions|archived_sessions)[\\/]/.test(relative)||!file.endsWith('.jsonl'))continue;
      indexedByFile.set(file,row);
      const reason=codexScope.reason({...row,file,agent:'Codex'},scopeContext());
      if(reason){excluded[reason]=(excluded[reason]||0)+1;continue;}
      if(historyDays&&Number(row.updated_at)*1000<cutoff)continue;
      found.set(file,{file,agent:'Codex',meta:row,mtime:Number(row.updated_at)*1000});
    }
    diagnostics.codexScope={projects:scopeProjects().length,indexed,projectSource:codexScope.projectCatalog.source,excluded,graceMs:GRACE_MS};
    diagnostics.scopeLabel = codexScope.projectCatalog.available ? 'Codex可见项目的未归档对话' : '未归档本地对话（Codex项目元数据不可用时按已配置目录）';
    if(codexScope.indexWarning)diagnostics.indexWarning=codexScope.indexWarning;
    else delete diagnostics.indexWarning;
    async function walk(folder, agent) {
      const children = await fsp.readdir(folder, { withFileTypes: true }).catch(error => {
        if (error.code !== 'ENOENT') recordError(`无法枚举日志目录：${error.code || error.message}`);
        return [];
      });
      for (const item of children) {
        if (stopped) return;
        const file = path.join(folder, item.name);
        if (item.isDirectory()) await walk(file, agent);
        else if (item.isFile() && item.name.endsWith('.jsonl')) {
          const stat = await fsp.stat(file).catch(() => null);
          if (stat && (!historyDays || stat.mtimeMs >= cutoff)) {
            const previous = found.get(file), indexedRow=agent==='Codex'?indexedByFile.get(file):null;
            if(agent==='Codex'){
              if(indexedRow&&codexScope.reason({...indexedRow,file,agent},scopeContext()))continue;
              // A newly active rollout may arrive before its desktop SQLite row.
              // Old unindexed logs are not silently resurrected as visible history.
              if(indexed&&!indexedRow&&stat.mtimeMs<now()-GRACE_MS)continue;
            }
            found.set(file, { file, agent, meta: previous?.meta || indexedRow || {}, mtime: stat.mtimeMs, size: stat.size });
          }
        }
      }
    }
    await walk(path.join(codexHome, 'sessions'), 'Codex');
    await walk(path.join(claudeHome, 'projects'), 'Claude');
    // Index rows pointing to deleted logs are not billable history. Ignore them;
    // existing logs remain authoritative even when absent from the SQLite index.
    diagnostics.unavailableIndexedLogs = 0; diagnostics.unavailableConversations = 0;
    for (const [file, entry] of found) if (!Number.isFinite(entry.size)) {
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat) {
        found.delete(file); diagnostics.unavailableIndexedLogs++;
        let source = entry.meta.source;
        try { source = JSON.parse(source); } catch {}
        if (!source?.subagent && !String(entry.meta.source || '').includes('"subagent"')) diagnostics.unavailableConversations++;
      } else { entry.size = stat.size; entry.mtime = stat.mtimeMs; }
    }
    diagnostics.filesDiscovered = found.size;
    diagnostics.sources = { codexIndex: indexed, codexLogs: [...found.values()].filter(v => v.agent === 'Codex').length, claudeLogs: [...found.values()].filter(v => v.agent === 'Claude').length };
    diagnostics.partial = found.size > maxFiles || diagnostics.truncatedFiles > 0 || diagnostics.oversizedLines > 0 || diagnostics.malformedLines > 0 || diagnostics.errors.length > 0;
    catalog = [...found.values()].sort((a, b) => b.mtime - a.mtime).slice(0, maxFiles);
    diagnostics.filesTotal = catalog.length;
    diagnostics.bytesTotal = catalog.reduce((total, entry) => total + entry.size, 0);
    const selected = new Set(catalog.map(entry => entry.file));
    for (const [file] of states) if (!selected.has(file)) { states.delete(file); revision++; }
    usageIds.clear();
    for (const state of states.values()) for (const entry of state.usage) usageIds.add(entry.key);
    discoveredAt = now();
  }
  function event(state, value) {
    const id = value.id || hash(`${state.id}|${value.timestamp}|${value.type}|${value.title}|${value.text}`);
    if (state.seen.has(`event:${id}`)) return;
    state.seen.add(`event:${id}`);
    state.events.push({ id, timestamp: value.timestamp, type: value.type || 'message', role: value.role || 'assistant', title: redact(value.title, 120), text: redact(value.text), tokens: value.tokens || null, costUSD: value.costUSD ?? null });
    if (state.events.length > 100) state.seen.delete(`event:${state.events.shift().id}`);
  }
  function usage(state, key, tokens, timestamp, model = state.model) {
    if (!tokens.total) return false;
    if (state.usageMap.has(key)) { diagnostics.duplicatesSkipped++; return false; }
    // Keep every source's canonical record. Snapshot ownership deduplicates across
    // sources, so removing or rewriting one file cannot erase a surviving copy.
    if (usageIds.has(key)) diagnostics.duplicatesSkipped++;
    usageIds.add(key);
    const priced = priceUsage(model, tokens, pricing);
    const entry = { key, timestamp, model, tokens, ...priced };
    state.usage.push(entry); state.usageMap.set(key, entry);
    event(state, { id: `usage:${key}`, timestamp, type: 'usage', role: 'system', title: `${model} · token 用量`, text: `输入 ${tokens.input}（缓存 ${tokens.cached}）· 输出 ${tokens.output}（推理 ${tokens.reasoning}）`, tokens, costUSD: priced.costUSD });
    return true;
  }
  function parseCodex(state, item) {
    const payload = item.payload || {};
    const timestamp = item.timestamp || state.updatedAt || new Date(now()).toISOString();
    if (item.type === 'session_meta') {
      // Fork/subagent rollouts replay the parent's metadata after their own header.
      // Identity belongs to the first header, never to the replayed transcript.
      if (state.identityEstablished && payload.id && payload.id !== state.id) return;
      if (payload.id) state.id = payload.id;
      state.identityEstablished = true;
      state.cwd = payload.cwd || state.cwd;
      state.startedAt ||= payload.timestamp || timestamp;
      state.provider = payload.model_provider || state.provider;
      state.source = payload.thread_source || payload.originator || null;
      state.parentThreadId = payload.parent_thread_id || payload.forked_from_id || payload.source?.subagent?.thread_spawn?.parent_thread_id || state.parentThreadId;
      state.rootSessionId = payload.session_id || state.rootSessionId || state.id;
      state.isSubagent = payload.thread_source === 'subagent' || Boolean(payload.source?.subagent) || Boolean(payload.agent_path && payload.agent_path !== '/root');
      if (!state.title && payload.agent_nickname) state.title = redact(payload.agent_nickname, 100);
      return;
    }
    if (item.type === 'turn_context') {
      state.model = payload.model || state.model;
      state.priceModel = payload.model || state.priceModel;
      state.cwd = payload.cwd || state.cwd;
      return;
    }
    state.updatedAt = timestamp;
    state.startedAt ||= timestamp;
    if (item.type === 'token_usage_record') {
      // Forks can inherit their parent's history; never attribute those requests to this child.
      if (payload.thread_id && payload.thread_id !== state.id) {
        state.ignoredMirror = normalizeUsage(payload.thread_token_usage || payload.turn_token_usage || payload.usage);
        // The inherited cumulative total is a baseline, never a local charge.
        // Retain it across any number of mirrored legacy notifications.
        if (!state.usage.length) { state.previous = state.ignoredMirror; state.previousAt = timestamp; state.previousInherited = true; }
        return;
      }
      const tokens = normalizeUsage(payload.usage);
      const key = payload.response_id ? `codex:${payload.response_id}` : `codex:${hash(JSON.stringify([state.id, timestamp, payload.usage]))}`;
      const added = usage(state, key, tokens, timestamp, payload.model || state.priceModel);
      if (added) {
        // Modern thread_token_usage may start from zero midway through an older
        // rollout whose legacy total already includes hundreds of millions of
        // tokens. Keep the legacy baseline independent and subtract requests
        // already charged here from the next legacy increment.
        add(state.canonicalPending, tokens);
        state.ignoredMirror = null;
      }
      return;
    }
    if (item.type === 'event_msg' && payload.type === 'token_count') {
      if (payload.rate_limits) {
        const limits = payload.rate_limits;
        const window = value => value ? { used_percent: Number(value.used_percent) || 0, window_minutes: Number(value.window_minutes) || 0, resets_at: value.resets_at || null } : null;
        state.rateLimits = { primary: window(limits.primary), secondary: window(limits.secondary), plan_type: limits.plan_type || null, observedAt: timestamp };
      }
      state.contextWindow = payload.info?.model_context_window || state.contextWindow;
      if (!payload.info?.total_token_usage) return;
      const current = normalizeUsage(payload.info.total_token_usage);
      if (state.parentThreadId && state.startedAt && timestamp < state.startedAt && !state.usage.length) {
        state.previous = current; state.previousAt = timestamp; state.previousInherited = true;
        diagnostics.duplicatesSkipped++;
        return;
      }
      if (state.ignoredMirror && current.input === state.ignoredMirror.input && current.output === state.ignoredMirror.output) {
        diagnostics.duplicatesSkipped++;
        return;
      }
      if (state.previousAt && timestamp < state.previousAt) { diagnostics.duplicatesSkipped++; return; }
      let delta;
      if (state.previous && current.input >= state.previous.input && current.output >= state.previous.output) {
        delta = ZERO();
        for (const key of Object.keys(delta)) delta[key] = Math.max(0, current[key] - state.previous[key]);
      } else delta = normalizeUsage(!state.previous && !state.partial ? payload.info.total_token_usage : (payload.info.last_token_usage || payload.info.total_token_usage));
      for (const key of Object.keys(delta)) delta[key] = Math.max(0, delta[key] - (state.canonicalPending[key] || 0));
      delta.cached = Math.min(delta.input, delta.cached);
      delta.cacheWrite = Math.min(delta.input - delta.cached, delta.cacheWrite);
      delta.reasoning = Math.min(delta.output, delta.reasoning);
      delta.total = delta.input + delta.output;
      state.previous = current;
      state.previousAt = timestamp;
      state.previousInherited = false;
      state.canonicalPending = ZERO();
      if (!delta.total) { diagnostics.duplicatesSkipped++; return; }
      usage(state, `codex-legacy:${hash(JSON.stringify([state.id, timestamp, current]))}`, delta, timestamp, state.priceModel);
      return;
    }
    if (item.type === 'event_msg') {
      const type = payload.type;
      if (type === 'task_started') state.status = 'working';
      else if (type === 'task_complete') state.status = 'completed';
      else if (type === 'turn_aborted') state.status = 'idle';
      else if (/approval|request_user_input/.test(type || '')) state.status = 'waiting';
      if (['task_started', 'task_complete', 'turn_aborted'].includes(type)) event(state, { timestamp, type: 'status', role: 'system', title: { task_started: '开始处理', task_complete: '本轮完成', turn_aborted: '本轮已停止' }[type] });
      // response_item.message carries the canonical visible message; avoid mirrored event_msg copies.
      return;
    }
    if (item.type !== 'response_item') return;
    if (payload.type === 'message' && ['user', 'assistant'].includes(payload.role)) {
      const text = Array.isArray(payload.content) ? payload.content.filter(x => ['input_text', 'output_text', 'text'].includes(x.type)).map(x => x.text || '').join('\n') : '';
      if (!text || (payload.role === 'user' && /^\s*<(?:environment_context|permissions|turn_aborted)/.test(text))) return;
      if (payload.role === 'user' && !state.title) state.title = titlePreview(text);
      event(state, { id: payload.id, timestamp, type: 'message', role: payload.role, title: payload.role === 'user' ? '用户' : '助手', text });
    } else if (['function_call', 'custom_tool_call'].includes(payload.type)) {
      const name = payload.name || 'tool';
      if (/request_user_input/.test(name)) state.status = 'waiting';
      else state.status = 'working';
      // Tool arguments/results can contain secrets and large file contents; intentionally keep only the name.
      event(state, { id: payload.call_id || payload.id, timestamp, type: 'tool', role: 'tool', title: name, text: `调用 ${name}` });
    }
  }
  function parseClaude(state, item) {
    const timestamp = item.timestamp || state.updatedAt || new Date(now()).toISOString();
    state.id = item.sessionId || state.id;
    state.cwd = item.cwd || state.cwd;
    state.startedAt ||= timestamp;
    state.updatedAt = timestamp;
    const message = item.message || {};
    if (message.model) state.model = message.model;
    if (item.type === 'assistant') {
      state.status = message.stop_reason === 'end_turn' ? 'completed' : 'working';
      if (message.usage) {
        const key = `claude:${message.id || item.uuid || hash(JSON.stringify([state.id, timestamp, message.usage]))}`;
        const tokens = normalizeUsage(message.usage, 'Claude');
        const previous = state.usageMap.get(key);
        if (previous && tokens.total > previous.tokens.total) {
          Object.assign(previous, { tokens, timestamp, ...priceUsage(state.model, tokens, pricing) });
          const priorEvent = state.events.find(entry => entry.id === `usage:${key}`);
          if (priorEvent) Object.assign(priorEvent, { tokens, costUSD: previous.costUSD });
        } else usage(state, key, tokens, timestamp);
      }
    }
    if (!['user', 'assistant'].includes(item.type)) return;
    let content = typeof message.content === 'string' ? message.content : (message.content || []).filter(x => x.type === 'text').map(x => x.text || '').join('\n');
    if (item.type === 'user' && !state.title && content) state.title = titlePreview(content);
    if (content) event(state, { id: item.uuid, timestamp, type: 'message', role: item.type, title: item.type === 'user' ? '用户' : '助手', text: content });
    for (const tool of Array.isArray(message.content) ? message.content.filter(x => x.type === 'tool_use') : []) event(state, { id: tool.id, timestamp, type: 'tool', role: 'tool', title: tool.name, text: `调用 ${tool.name}` });
  }
  function parseLine(state, line) {
    if (!line.trim()) return;
    try {
      const item = JSON.parse(line);
      if (!item || typeof item !== 'object') return;
      if (state.agent === 'Codex') parseCodex(state, item); else parseClaude(state, item);
    } catch { diagnostics.malformedLines++; diagnostics.partial = true; state.partial = true; }
  }
  async function readState(state) {
    const stat = await fsp.stat(state.file).catch(error => {
      recordError(`无法读取 ${path.basename(state.file)}：${error.code || error.message}`);
      states.delete(state.file);
      return null;
    });
    if (!stat) return;
    let changedPrefix = false;
    if (state.fingerprint && state.mtimeMs !== stat.mtimeMs && stat.size > state.offset) {
      const handle = await fsp.open(state.file, 'r');
      try {
        const prefix = Buffer.alloc(Math.min(state.fingerprint.size, stat.size));
        const read = await handle.read(prefix, 0, prefix.length, 0);
        changedPrefix = hash(prefix.subarray(0, read.bytesRead).toString('base64')) !== state.fingerprint.hash;
      } finally { await handle.close(); }
    }
    if (stat.size < state.offset || changedPrefix || (state.mtimeMs !== null && stat.size === state.offset && stat.mtimeMs !== state.mtimeMs)) {
      // Rewrites/rotation invalidate the old per-file state and its usage ownership.
      state = makeState(state.file, state.agent, { id: state.id, title: state.title, cwd: state.cwd });
    }
    if (!state.fingerprint && stat.size) {
      const handle = await fsp.open(state.file, 'r');
      try {
        const prefix = Buffer.alloc(Math.min(4096, stat.size));
        const read = await handle.read(prefix, 0, prefix.length, 0);
        state.fingerprint = { size: read.bytesRead, hash: hash(prefix.subarray(0, read.bytesRead).toString('base64')) };
      } finally { await handle.close(); }
    }
    if (stat.size === state.offset) {
      if (state.initial) { state.initial = false; state.updatedAt ||= stat.mtime.toISOString(); revision++; }
      return;
    }
    if (state.initial && stat.size > maxInitialBytes && maxInitialBytes > 0) {
      // Read only a bounded head for identity. A model before an omitted middle section
      // cannot establish the tail's price; tail usage stays unpriced until its next context.
      const head = await fsp.open(state.file, 'r');
      const tailStart = stat.size - maxInitialBytes;
      try {
        const buffer = Buffer.alloc(Math.min(512 * 1024, stat.size));
        const { bytesRead } = await head.read(buffer, 0, buffer.length, 0);
        for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n').slice(0, -1)) {
          try {
            const item = JSON.parse(line);
            if (state.agent === 'Codex' && item.type === 'session_meta') parseCodex(state, item);
          } catch {}
        }
        const before = Buffer.alloc(1);
        await head.read(before, 0, 1, tailStart - 1);
        state.skipFirst = before[0] !== 10;
      } finally { await head.close(); }
      state.offset = tailStart;
      state.partial = true;
      diagnostics.truncatedFiles++;
      diagnostics.partial = true;
    }
    const end = stat.size - 1;
    // Keep large JSON records in chunks until their newline arrives. Concatenating
    // and rescanning the entire carry on every 256 KiB read becomes quadratic for
    // embedded instructions/tool output; it is not a reason to drop history.
    let carry = state.pending ? [state.pending] : [];
    let carryBytes = state.pending ? Buffer.byteLength(state.pending, 'utf8') : 0;
    state.pending = '';
    for await (const buffer of fs.createReadStream(state.file, { start: state.offset, end, highWaterMark: 256 * 1024 })) {
      if (stopped) break;
      diagnostics.bytesRead += buffer.length;
      state.offset += buffer.length;
      let text = state.decoder.write(buffer);
      if (state.skipFirst) {
        const newline = text.indexOf('\n');
        if (newline < 0) continue;
        text = text.slice(newline + 1);
        state.skipFirst = false;
      }
      if (state.skipLong) {
        const newline = text.indexOf('\n');
        if (newline < 0) continue;
        text = text.slice(newline + 1);
        state.skipLong = false;
      }
      let start = 0, newline;
      while ((newline = text.indexOf('\n', start)) >= 0) {
        const fragment = text.slice(start, newline);
        const line = carry.length ? [...carry, fragment].join('') : fragment;
        carry = []; carryBytes = 0; start = newline + 1;
        if (maxLineBytes && Buffer.byteLength(line, 'utf8') > maxLineBytes) { diagnostics.oversizedLines++; diagnostics.partial = true; state.partial = true; continue; }
        parseLine(state, line);
      }
      if (start < text.length) {
        const fragment = text.slice(start); carry.push(fragment); carryBytes += Buffer.byteLength(fragment, 'utf8');
      }
      if (maxLineBytes && carryBytes > maxLineBytes) { carry = []; carryBytes = 0; state.skipLong = true; diagnostics.oversizedLines++; diagnostics.partial = true; state.partial = true; }
    }
    state.pending = carry.join('');
    state.initial = false;
    revision++;
    state.mtimeMs = stat.mtimeMs;
    diagnostics.filesRead = [...states.values()].filter(s => !s.initial).length;
    state.updatedAt ||= stat.mtime.toISOString();
  }
  function getSnapshot() {
    const totals = newAggregate(), today = newAggregate();
    const todayKey = dayKey(now());
    const byModel = new Map(), daily = new Map(), owners = new Map(), ownedUsage = new Map();
    const statesById=new Map([...states.values()].filter(state=>state.agent==='Codex').map(state=>[state.id,state]));
    const context=scopeContext(statesById);
    const ordered = [...states.values()].filter(state=>state.agent!=='Codex'||!codexScope.reason(state,context)).sort((a, b) => a.file.localeCompare(b.file));
    for (const state of ordered) for (const entry of state.usage) {
      // Cross-file copies have a single owner. Claude streaming copies select the
      // final usage, while deterministic ties make rescans and cached starts stable.
      const previous = ownedUsage.get(entry.key);
      if (!previous || (entry.key.startsWith('claude:') && entry.tokens.total > previous.tokens.total)) {
        owners.set(entry.key, state.file); ownedUsage.set(entry.key, entry);
      }
    }
    const groups = new Map();
    for (const state of ordered.filter(value => !value.initial)) {
      const key = `${state.agent}:${state.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(state);
    }
    const dailyArray = map => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([date, aggregate]) => ({ date, ...aggregate }));
    const sessions = [...groups.values()].map(group => {
      const latest = [...group].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      const aggregate = newAggregate(), sessionToday = newAggregate(), sessionDaily = new Map();
      const entries = group.flatMap(state => state.usage.filter(entry => owners.get(entry.key) === state.file));
      const eventMap = new Map();
      for (const state of group) for (const item of state.events) {
        if (item.type === 'usage' && owners.get(item.id.slice(6)) !== state.file) continue;
        eventMap.set(item.id, item);
      }
      for (const entry of entries) {
        mergeUsage(aggregate, entry); mergeUsage(totals, entry);
        const date = dayKey(entry.timestamp);
        if (date === todayKey) { mergeUsage(today, entry); mergeUsage(sessionToday, entry); }
        if (date) {
          if (!sessionDaily.has(date)) sessionDaily.set(date, newAggregate());
          if (!daily.has(date)) daily.set(date, newAggregate());
          mergeUsage(sessionDaily.get(date), entry); mergeUsage(daily.get(date), entry);
        }
        if (!byModel.has(entry.model)) byModel.set(entry.model, { model: entry.model, ...newAggregate() });
        mergeUsage(byModel.get(entry.model), entry);
      }
      aggregate.sessions = 1; totals.sessions++;
      const activeToday = sessionToday.total > 0 || dayKey(latest.updatedAt) === todayKey;
      sessionToday.sessions = activeToday ? 1 : 0;
      if (activeToday) today.sessions++;
      for (const date of sessionDaily.keys()) { sessionDaily.get(date).sessions = 1; daily.get(date).sessions++; }
      const stale = now() - new Date(latest.updatedAt).getTime() > 15 * 60000;
      const parentThreadId = group.find(state => state.parentThreadId)?.parentThreadId || null;
      const partial = group.some(state => state.partial);
      return {
        id: latest.id, agent: latest.agent, title: latest.title || group.find(state => state.title)?.title || path.basename(latest.cwd || latest.file),
        cwd: latest.cwd, model: latest.model, provider: latest.provider, source: latest.source,
        parentId: parentThreadId, parentThreadId, rootSessionId: group.find(state => state.rootSessionId)?.rootSessionId || latest.id,
        isSubagent: group.some(state => state.isSubagent), archived: group.every(state => state.archive),
        desktopProjectId: latest.agent==='Codex'?codexScope.projectId(latest,context):null,
        status: stale && latest.status === 'working' ? 'idle' : latest.status,
        statusInferred: stale && latest.status === 'working', updatedAt: latest.updatedAt,
        startedAt: group.map(state => state.startedAt).filter(Boolean).sort()[0] || null,
        tokens: Object.fromEntries(Object.keys(ZERO()).map(key => [key, aggregate[key]])),
        history: aggregate, today: sessionToday, dailyUsage: dailyArray(sessionDaily),
        costUSD: aggregate.costUSD, knownCostUSD: aggregate.knownCostUSD, unpricedTokens: aggregate.unpricedTokens,
        events: [...eventMap.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(-100),
        rateLimits: [...group].filter(state => state.rateLimits).sort((a, b) => String(b.rateLimits.observedAt).localeCompare(String(a.rateLimits.observedAt)))[0]?.rateLimits || null,
        contextWindow: latest.contextWindow, sourcePath: latest.file, sourcePaths: group.map(state => state.file),
        partial, historyComplete: !partial, usageRequests: entries.length,
      };
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const configured = scopeProjects().filter(project => project && project.id).map(project => ({
      id: String(project.id), name: String(project.name || '未命名项目'), roots: (project.roots || []).filter(root => typeof root === 'string')
    }));
    const projects = new Map(configured.map(project => [project.id, { ...project, sessionIds: [], totals: newAggregate(), today: newAggregate(), dailyUsage: [], _daily: new Map() }]));
    const assignments = scopeAssignments();
    function matchProject(session) {
      const explicit = session.desktopProjectId || assignments[session.id] || (session.isSubagent ? assignments[session.parentThreadId] || assignments[session.rootSessionId] : null);
      if (explicit && projects.has(String(explicit))) return projects.get(String(explicit));
      const cwd = normalizeRoot(session.cwd);
      let best = null, length = -1;
      for (const project of configured) for (const root of project.roots) {
        const prefix = normalizeRoot(root);
        if (prefix && (cwd === prefix || cwd.startsWith(prefix + '/')) && prefix.length > length) { best = projects.get(project.id); length = prefix.length; }
      }
      if (best) return best;
      const id = cwd ? `directory:${hash(cwd)}` : 'unassigned';
      if (!projects.has(id)) projects.set(id, { id, name: cwd ? String(session.cwd).split(/[\\/]/).filter(Boolean).pop() || session.cwd : '未分组', roots: cwd ? [session.cwd] : [], sessionIds: [], totals: newAggregate(), today: newAggregate(), dailyUsage: [], _daily: new Map(), inferred: true });
      return projects.get(id);
    }
    function mergeAggregate(target, source) {
      add(target, source); target.knownCostUSD += source.knownCostUSD || 0;
      target.unpricedTokens += source.unpricedTokens || 0; target.sessions += source.sessions || 0;
      target.costUSD = target.unpricedTokens ? null : target.knownCostUSD;
    }
    for (const session of sessions) {
      const project = matchProject(session);
      session.projectId = project.id; session.projectName = project.name;
      project.sessionIds.push(session.id);
      mergeAggregate(project.totals, session.history); mergeAggregate(project.today, session.today);
      for (const entry of session.dailyUsage) {
        if (!project._daily.has(entry.date)) project._daily.set(entry.date, newAggregate());
        mergeAggregate(project._daily.get(entry.date), entry);
      }
    }
    const projectList = [...projects.values()].map(project => {
      const { _daily, ...value } = project;
      return { ...value, dailyUsage: dailyArray(_daily), conversationCount: sessions.filter(session => session.projectId === value.id && !session.isSubagent).length };
    });
    diagnostics.filesRead = catalog.filter(entry => states.get(entry.file) && !states.get(entry.file).initial).length;
    diagnostics.bytesIndexed = catalog.reduce((sum, entry) => sum + Math.min(entry.size, states.get(entry.file)?.offset || 0), 0);
    diagnostics.progress = diagnostics.bytesTotal ? Math.min(1, diagnostics.bytesIndexed / diagnostics.bytesTotal) : diagnostics.loading ? 0 : 1;
    diagnostics.historyComplete = Boolean(discoveredAt && !diagnostics.loading && !diagnostics.partial && !historyDays && diagnostics.filesRead === diagnostics.filesTotal);
    const limits = sessions.filter(session => session.rateLimits).sort((a, b) => String(b.rateLimits.observedAt).localeCompare(String(a.rateLimits.observedAt)))[0]?.rateLimits || null;
    return { updatedAt: new Date(now()).toISOString(), sessions, projects: projectList, totals, today, dailyUsage: dailyArray(daily), rateLimits: limits, byModel: [...byModel.values()], pricing: JSON.parse(JSON.stringify(pricing)), diagnostics: { ...diagnostics, errors: [...diagnostics.errors], sources: { ...diagnostics.sources } } };
  }
  function refresh(forceDiscover = true) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const beforeDiscoveryRevision=revision;
      if (forceDiscover || now() - discoveredAt > 10000) await discover();
      const initialLoading = diagnostics.loading || catalog.some(entry => !states.has(entry.file) || states.get(entry.file).initial);
      const startingRevision = revision;
      let publishedRevision = revision, lastPublish = Date.now();
      diagnostics.loading = initialLoading;
      if (initialLoading) publish();
      for (let start = 0; start < catalog.length && !stopped; start += 3) {
        await Promise.all(catalog.slice(start, start + 3).map(async entry => {
          const state = states.get(entry.file) || makeState(entry.file, entry.agent, entry.meta);
          try { await readState(state); } catch (error) { recordError(`读取 ${path.basename(entry.file)}：${error.message}`); }
        }));
        if (revision !== publishedRevision && Date.now() - lastPublish >= 200) {
          publish(); publishedRevision = revision; lastPublish = Date.now();
        }
      }
      diagnostics.loading = false;
      await saveCache();
      if (initialLoading || revision !== startingRevision || revision!==beforeDiscoveryRevision) publish();
      return getSnapshot();
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  function start() {
    if (running) return refreshPromise || Promise.resolve(getSnapshot());
    running = true; stopped = false;
    timer = setInterval(() => refresh(false).catch(error => recordError(error.message)), options.pollIntervalMs || 1500);
    timer.unref?.();
    return refresh(true);
  }
  function stop() { stopped = true; running = false; clearInterval(timer); }
  function setProjects(projects, assignments = {}) {
    options.projects = Array.isArray(projects) ? projects : [];
    options.projectAssignments = assignments && typeof assignments === 'object' ? assignments : {};
    publish();
    return getSnapshot().projects;
  }
  function reloadPricing() {
    pricing = loadPricing(options.pricingPath);
    for (const state of states.values()) for (const entry of state.usage) {
      Object.assign(entry, priceUsage(entry.model, entry.tokens, pricing));
      const usageEvent = state.events.find(event => event.id === `usage:${entry.key}`);
      if (usageEvent) usageEvent.costUSD = entry.costUSD;
    }
    publish(); return pricing;
  }
  return { start, stop, refresh, getSnapshot, getSession: id => getSnapshot().sessions.find(s => s.id === id) || null, reloadPricing, setProjects };
}
module.exports = { createMonitor, redact, dayKey, titlePreview };
