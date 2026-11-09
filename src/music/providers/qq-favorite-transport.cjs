/*
 * MIT License. zzc/ag-1 protocol adapted from jixunmoe/qmweb-sign
 * https://github.com/jixunmoe/qmweb-sign/tree/15305a3cc39f80eb1646ab2bae46468231765736
 * Copyright (c) 2024 Jixun Wu
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
'use strict';
const crypto = require('node:crypto');
const REQUEST_KEY = Buffer.from([189,48,95,16,208,255,116,182,239,84,218,184,53,181,225,207]);
const RESPONSE_KEY = [122,63,140,29,94,155,47,10,108,77,126,139,31,58,92,157,14,43,111,74,129];
function sign(body) {
  const digest = crypto.createHash('sha1').update(body).digest('hex').toUpperCase();
  const pick = indexes => indexes.map(index => digest[index]).join('');
  const mask = [89,39,179,150,218,82,58,252,177,52,186,123,120,64,242,133,143,161,121,179];
  const middle = Buffer.from(mask.map((value,index) => value ^ parseInt(digest.slice(index*2,index*2+2),16))).toString('base64').replace(/[\/+=]/g,'');
  return ('zzc'+pick([23,14,6,36,16,7,19])+middle+pick([16,1,32,12,19,27,8,5])).toLowerCase();
}
async function writeFavorite(requestText, payload, headers) {
  const json = JSON.stringify(payload), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-128-gcm',REQUEST_KEY,iv);
  const body = Buffer.concat([iv,cipher.update(json,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');
  const url = new URL('https://u6.y.qq.com/cgi-bin/musics.fcg');
  url.searchParams.set('encoding','ag-1');
  url.searchParams.set('sign',sign(json));
  // Writes are never retried or downgraded to the incompatible plain channel.
  const raw = await requestText(url.href,{method:'POST',timeoutMs:10000,responseType:'buffer',headers:{...headers,'Content-Type':'text/plain',Accept:'application/octet-stream','Content-Length':Buffer.byteLength(body)}},body);
  if (!Buffer.isBuffer(raw)) throw new Error('QQ 收藏响应格式不正确');
  const decoded = Buffer.from(raw.map((value,index) => value ^ RESPONSE_KEY[index % RESPONSE_KEY.length])).toString('utf8');
  try { return JSON.parse(decoded); }
  catch { throw new Error('QQ 收藏响应无法解析，请刷新确认收藏状态'); }
}
module.exports = {writeFavorite};
