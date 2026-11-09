'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const model=require('../ui/token-activity-model.js');
const today='2026-10-29';
const find=(chart,date)=>chart.cells.find(cell=>cell.date===date);

test('activity labels use one decimal 万 or 亿 without changing exact totals',()=>{
  for(const [value,label]of [[0,'0.0万'],[499,'0.0万'],[500,'0.1万'],[10000,'1.0万'],[89019000,'8901.9万'],[99999999,'10000.0万'],[100000000,'1.0亿'],[210000000,'2.1亿'],[Number.MAX_SAFE_INTEGER,'90071992.5亿']])assert.equal(model.formatTokens(value),label);
  for(const value of [NaN,Infinity,-1,null,'100000000'])assert.equal(model.formatTokens(value),'0.0万');
  const rows=[{date:'2026-10-28',total:89019000},{date:today,total:120981000}];
  const daily=model.buildActivity({today,dailyUsage:rows});assert.equal(find(daily,'2026-10-28').value,89019000);assert.match(find(daily,'2026-10-28').label,/8901\.9万 个 Token/);assert.doesNotMatch(find(daily,'2026-10-28').label,/89,019,000/);
  const cumulative=model.buildActivity({today,mode:'cumulative',dailyUsage:rows});assert.equal(cumulative.summary.datedTotal,210000000);assert.match(cumulative.columns.at(-1).cells[0].label,/2\.1亿 个 Token/);
});

test('twelve calendar months have Monday columns, seven ordered days and correctly positioned month labels',()=>{
  const chart=model.buildActivity({today});
  assert.equal(chart.startDate,'2025-11-01');assert.equal(chart.gridStart,'2025-10-27');assert.equal(chart.gridEnd,'2026-11-01');assert.equal(chart.columnCount,53);
  assert.equal(chart.cells.length,53*7);assert(chart.columns.every(column=>column.cells.length===7));
  assert.deepEqual(chart.columns.at(-1).cells.map(cell=>cell.date),['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
  assert.deepEqual(chart.months.map(month=>month.label),['11月','12月','1月','2月','3月','4月','5月','6月','7月','8月','9月','10月']);
  assert.equal(chart.months[0].column,0);assert.equal(chart.months[2].column,9);assert(find(chart,'2025-10-31').disabled);assert(find(chart,'2026-10-30').disabled);
});

test('authoritative totals and input/output fallback never charge cached or reasoning tokens twice',()=>{
  const chart=model.buildActivity({today,dailyUsage:[{date:today,input:100,cached:90,output:20,reasoning:15},{date:'2026-10-28',input:1000,cached:999,output:50,total:123},{date:today,total:7}]});
  assert.equal(find(chart,today).value,127);assert.equal(find(chart,'2026-10-28').value,123);assert.equal(chart.summary.visibleTotal,250);assert.equal(chart.summary.todayTotal,127);assert.equal(chart.summary.activeDays,2);
});

test('weekly columns aggregate Monday to Sunday, including the first aligned partial calendar week',()=>{
  const chart=model.buildActivity({today,mode:'weekly',dailyUsage:[{date:'2025-10-27',total:10},{date:'2025-11-01',total:20},{date:'2026-10-25',total:30},{date:'2026-10-26',total:40},{date:today,total:50},{date:'2026-10-30',total:900}]});
  assert.equal(chart.columns[0].weekTotal,30);assert(chart.columns[0].cells.every(cell=>cell.value===30&&!cell.disabled));
  assert.equal(find(chart,'2026-10-25').value,30);assert.equal(chart.columns.at(-1).weekTotal,90);
  assert(chart.columns.at(-1).cells.every(cell=>cell.value===90&&!cell.disabled));assert.match(chart.columns.at(-1).cells[6].label,/截至 2026年10月29日/);assert.equal(chart.summary.futureTotal,900);
});

test('cumulative totals carry all older dated history, remain monotonic and stop at today',()=>{
  const usage=[{date:'2020-01-01',total:1000},{date:'2025-10-26',total:100},{date:'2025-10-27',total:10},{date:'2025-11-01',total:20},{date:today,total:50},{date:'2026-10-30',total:999}];
  const chart=model.buildActivity({today,mode:'cumulative',dailyUsage:usage,totalTokens:1300});
  assert.equal(chart.columns[0].cumulativeValue,1130);assert.equal(chart.columns.at(-1).cumulativeValue,1180);
  assert(chart.columns.every((column,index)=>!index||column.cumulativeValue>=chart.columns[index-1].cumulativeValue));
  assert(chart.columns.at(-1).cells.every(cell=>cell.value===1180));assert.match(chart.columns.at(-1).cells[0].label,/累计至 2026年10月29日/);
  assert.equal(chart.summary.olderDatedTotal,1110);assert.equal(chart.summary.visibleTotal,70);assert.equal(chart.summary.datedTotal,1180);
  // A valid future timestamp is not an undated baseline.
  assert.equal(chart.summary.undatedTotal,0);assert.equal(chart.summary.futureTotal,999);
});

test('leap days, year-spanning weeks and Beijing midnight use calendar arithmetic without local DST',()=>{
  const chart=model.buildActivity({today:'2024-03-01',dailyUsage:[{date:'2024-02-29',total:50},{date:'2023-02-29',total:99}]});
  assert.equal(find(chart,'2024-02-29').value,50);assert.equal(chart.summary.invalidRows,1);
  const cross=model.buildActivity({today:'2026-01-02',mode:'weekly',dailyUsage:[{date:'2025-12-28',total:1},{date:'2025-12-29',total:2},{date:'2026-01-01',total:3},{date:'2026-01-02',total:4}]});
  assert.equal(cross.columns.at(-1).weekStart,'2025-12-29');assert.equal(cross.columns.at(-1).weekEnd,'2026-01-04');assert.equal(cross.columns.at(-1).weekTotal,9);
  assert.equal(model.beijingDay(Date.parse('2026-10-28T15:59:59Z')),'2026-10-28');assert.equal(model.beijingDay(Date.parse('2026-10-28T16:00:00Z')),'2026-10-29');
});

test('invalid rows, future dates and undated historical totals cannot create fabricated activity',()=>{
  const chart=model.buildActivity({today,totalTokens:900,dailyUsage:[null,{date:'2026-02-30',total:800},{date:today,total:NaN},{date:today,total:-1},{date:today,total:Number.MAX_SAFE_INTEGER+1},{date:today,total:100},{date:'2026-10-30',total:200}]});
  assert.equal(chart.summary.invalidRows,5);assert.equal(chart.summary.datedTotal,100);assert.equal(chart.summary.undatedTotal,600);assert.equal(chart.summary.futureTotal,200);
  assert.equal(find(chart,'2026-10-30').value,0);assert.equal(find(chart,'2026-10-30').level,0);assert.match(chart.notice,/缺少有效日期/);assert.match(chart.notice,/未来日期/);assert.throws(()=>model.buildActivity({today:'2026-02-30'}),RangeError);
});

test('relative logarithmic intensity is deterministic, zero-separated and monotonic for huge safe totals',()=>{
  const scale=model.createScale([0,1,10,1000,1000000,Number.MAX_SAFE_INTEGER]);
  const levels=[0,1,10,1000,1000000,Number.MAX_SAFE_INTEGER].map(scale.level);
  assert.equal(levels[0],0);assert.equal(levels.at(-1),5);assert(levels.every((value,index)=>!index||value>=levels[index-1]));assert.equal(model.createScale([4,4]).level(4),5);
  const chart=model.buildActivity({today,dailyUsage:[{date:today,total:Number.MAX_SAFE_INTEGER},{date:today,total:100}]});
  assert.equal(chart.summary.datedTotal,Number.MAX_SAFE_INTEGER);assert.equal(chart.summary.overflow,true);assert.match(chart.notice,/安全整数/);assert(chart.cells.every(cell=>Number.isFinite(cell.value)));
});

test('browser export creates no DOM or timer and input rows are not mutated across modes',()=>{
  const context={Intl,Date,Number,Object,Array,Map,Math,RangeError,window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/token-activity-model.js'),'utf8'),context);
  assert.equal(typeof context.window.PulseTokenActivityModel.buildActivity,'function');
  const rows=[Object.freeze({date:today,total:100})],before=JSON.stringify(rows);
  for(const mode of model.MODES){const chart=model.buildActivity({today,mode,dailyUsage:rows});assert.equal(chart.mode,mode);assert.equal(chart.summary.datedTotal,100);}
  assert.equal(JSON.stringify(rows),before);assert.equal(model.buildActivity({today,mode:'unknown'}).mode,'daily');
});

test('first day of a month keeps twelve labels without inventing a fixed 52 weeks',()=>{
  const november=model.buildActivity({today:'2026-11-01'});
  assert.equal(november.startDate,'2025-12-01');assert.equal(november.columnCount,48);
  assert.equal(november.months.length,12);assert.equal(november.months.at(-1).label,'11月');
  assert.equal(november.cells.length,336);assert.equal(november.cells.filter(cell=>cell.date==='2026-11-01').length,1);
  const leap=model.buildActivity({today:'2024-03-01'});assert.equal(leap.startDate,'2023-04-01');assert.equal(leap.months.length,12);
  assert.equal(leap.cells.filter(cell=>cell.date==='2024-02-29').length,1);assert.equal(leap.columnCount,49);
});
