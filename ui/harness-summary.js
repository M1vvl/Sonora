'use strict';
// Summarize observed Harness log activity. Never inspect tool arguments/results
// or invent hidden reasoning, progress percentages, or an execution state.
((root) => {
  const cleanup = typeof module === 'object' && module.exports ? require('./text-preview.js').clean : (...args) => root.PulseTextPreview.clean(...args);
  function shorten(value, maximum = 28) {
    const text = cleanup(value, 700).split('\n').map(line => line.trim()).find(Boolean) || '';
    const chars = Array.from(text.replace(/\s+/g, ' '));
    return chars.length > maximum ? chars.slice(0, maximum - 1).join('') + '…' : chars.join('');
  }
  function toolSummary(value) {
    const name = String(value || '').split(/[.:]/).at(-1) || 'tool';
    if (/request_user_input|approval/i.test(name)) return '等待你的输入';
    if (/apply_patch|edit_file|write_file/i.test(name)) return '正在修改项目文件';
    if (/exec_command|shell|bash|powershell/i.test(name)) return '正在执行命令';
    if (/spawn_agent|create_agent/i.test(name)) return '正在分配子代理任务';
    if (/send_message|followup_task/i.test(name)) return '正在同步代理消息';
    if (/read_file|view_image|inspect/i.test(name)) return '正在查看项目资料';
    if (/search|browse|web__run/i.test(name)) return '正在检索资料';
    if (/wait|sleep/i.test(name)) return '等待后台任务结果';
    return shorten(`调用 ${name}`, 28);
  }
  function project(session, loading = false) {
    const sessionId = String(session?.id || '');
    const state = session?.status || 'unknown';
    const events = [...(session?.events || [])].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const latest = events.filter(event => !['usage', 'status'].includes(event.type)).at(-1);
    let text;
    if (!session) text = loading ? '正在发现会话' : '等待 Agent 活动';
    else if (state === 'waiting') text = '等待你的输入';
    else if (state === 'completed') text = '本轮已完成';
    else if (state === 'idle') text = '等待下一次任务';
    else if (latest?.type === 'tool') text = toolSummary(latest.title);
    else if (latest?.role === 'user' || latest?.title === '用户') text = '正在处理你的请求';
    else text = shorten(latest?.text) || (state === 'working' ? '正在处理任务' : '等待 Agent 活动');
    return { sessionId, key: `${state}:${latest?.id || latest?.timestamp || ''}`, text };
  }
  const api = Object.freeze({ project, shorten, toolSummary });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseHarnessSummary = api;
})(typeof window === 'object' ? window : globalThis);
