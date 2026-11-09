'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = path.join(__dirname, '..', 'config', 'pricing.json');
function loadPricing(file = DEFAULT_PATH) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value.models || typeof value.models !== 'object') throw new Error('missing models');
    return value;
  } catch (error) {
    return { currency: 'USD', models: {}, note: '价格配置不可用', error: error.message };
  }
}
function number(value) { return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0; }
function normalizeUsage(value = {}, agent = 'Codex') {
  if (agent === 'Claude') {
    const cached = number(value.cache_read_input_tokens);
    const cacheWrite = number(value.cache_creation_input_tokens);
    const input = number(value.input_tokens) + cached + cacheWrite;
    const output = number(value.output_tokens);
    return { input, cached, cacheWrite, output, reasoning: 0, total: input + output };
  }
  const input = number(value.input_tokens ?? value.input);
  const output = number(value.output_tokens ?? value.output);
  return {
    input, cached: Math.min(input, number(value.cached_input_tokens ?? value.cached)),
    cacheWrite: Math.min(input, number(value.cache_write_input_tokens ?? value.cacheWrite)),
    output, reasoning: Math.min(output, number(value.reasoning_output_tokens ?? value.reasoning)),
    total: input + output,
  };
}
function priceUsage(model, tokens, pricing = loadPricing()) {
  const rate = pricing.models[model];
  if (!rate || !['input', 'cached', 'output'].every(k => Number.isFinite(rate[k]) && rate[k] >= 0)) {
    return { costUSD: null, unpricedTokens: tokens.total };
  }
  // Cache creation has a separate tariff whose retention is not in all local logs.
  if (tokens.cacheWrite && !Number.isFinite(rate.cacheWrite)) return { costUSD: null, unpricedTokens: tokens.total };
  const costUSD = (Math.max(0, tokens.input - tokens.cached - (tokens.cacheWrite || 0)) * rate.input
    + tokens.cached * rate.cached + tokens.output * rate.output
    + (tokens.cacheWrite || 0) * (rate.cacheWrite || 0)) / 1e6;
  return { costUSD, unpricedTokens: 0 };
}
module.exports = { DEFAULT_PATH, loadPricing, normalizeUsage, priceUsage };
