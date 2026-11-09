(function(host,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else host.PulseTokenActivityModel=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const DAY=86400000,MAX=Number.MAX_SAFE_INTEGER,MODES=Object.freeze(['daily','weekly','cumulative']);
  const WEEKDAYS=['星期一','星期二','星期三','星期四','星期五','星期六','星期日'];
  const count=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX?Math.floor(value):null;
  function dayNumber(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const time=Date.parse(value+'T00:00:00.000Z');
    return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time/DAY:null;
  }
  const dayString=value=>new Date(value*DAY).toISOString().split('T')[0];
  const monday=value=>value-((new Date(value*DAY).getUTCDay()+6)%7);
  function beijingDay(value=Date.now()){
    const time=value instanceof Date?value.getTime():Number(value);
    return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,10):'';
  }
  function displayDay(day){const date=new Date(day*DAY);return `${date.getUTCFullYear()}年${date.getUTCMonth()+1}月${date.getUTCDate()}日`;}
  // Presentation only: all calendar cells and summary values retain exact
  // integers. Select units from the real value before rounding the display.
  function formatTokens(value){
    const total=typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
    return total>=1e8?(total/1e8).toFixed(1)+'亿':(total/1e4).toFixed(1)+'万';
  }
  function add(a,b,flags){if(a>MAX-b){flags.overflow=true;return MAX;}return a+b;}
  function normalizeDaily(rows){
    const days=new Map(),flags={overflow:false};let invalidRows=0;
    for(const row of Array.isArray(rows)?rows:[]){
      const date=dayNumber(row?.date);if(date===null){invalidRows++;continue;}
      let total;
      if(row.total!==undefined&&row.total!==null)total=count(row.total);
      else{
        // Monitor input already contains cached/cache-write input, and output
        // already contains reasoning. Neither is an additional token charge.
        const input=count(row.input??0),output=count(row.output??0);
        total=input===null||output===null?null:add(input,output,flags);
      }
      if(total===null){invalidRows++;continue;}
      days.set(date,add(days.get(date)||0,total,flags));
    }
    return {entries:[...days].sort(([a],[b])=>a-b).map(([day,total])=>({day,date:dayString(day),total})),invalidRows,overflow:flags.overflow};
  }
  function createScale(values){
    let minValue=Infinity,maxValue=0;
    for(const value of values)if(value>0&&Number.isFinite(value)){minValue=Math.min(minValue,value);maxValue=Math.max(maxValue,value);}
    if(!maxValue)minValue=0;
    const lower=Math.log1p(minValue),span=Math.log1p(maxValue)-lower;
    function level(value){
      if(!(value>0)||!maxValue)return 0;
      if(!span)return 5;
      return Math.max(1,Math.min(5,1+Math.floor((Math.log1p(value)-lower)/span*4)));
    }
    return {method:'log-relative',levels:5,minValue,maxValue,level};
  }
  function buildActivity(options={}){
    const today=options.today??beijingDay(),lastDay=dayNumber(today);
    if(lastDay===null)throw new RangeError('Token 活动需要有效的北京时间日期');
    const mode=MODES.includes(options.mode)?options.mode:'daily';
    const firstMonth=new Date(lastDay*DAY);firstMonth.setUTCDate(1);firstMonth.setUTCMonth(firstMonth.getUTCMonth()-11);
    const startDay=firstMonth.getTime()/DAY,gridFirst=monday(startDay),gridLast=monday(lastDay)+6;
    const normalized=normalizeDaily(options.dailyUsage),flags={overflow:normalized.overflow},days=new Map();
    let datedTotal=0,allDatedTotal=0,olderDatedTotal=0,visibleTotal=0,activeDays=0,futureTotal=0;
    for(const entry of normalized.entries){
      allDatedTotal=add(allDatedTotal,entry.total,flags);
      if(entry.day>lastDay){futureTotal=add(futureTotal,entry.total,flags);continue;}
      days.set(entry.day,entry.total);datedTotal=add(datedTotal,entry.total,flags);
      if(entry.day<startDay)olderDatedTotal=add(olderDatedTotal,entry.total,flags);
      else{visibleTotal=add(visibleTotal,entry.total,flags);if(entry.total>0)activeDays++;}
    }
    const columns=[],cells=[];let cumulative=0,visibleWeeklyTotal=0;
    // Carry all dated history before the aligned calendar, rather than starting
    // cumulative totals at the first visible month.
    for(const [day,total]of days)if(day<gridFirst)cumulative=add(cumulative,total,flags);
    for(let weekStart=gridFirst,index=0;weekStart<=lastDay;weekStart+=7,index++){
      const weekEnd=weekStart+6,asOf=Math.min(weekEnd,lastDay);let weekTotal=0;
      for(let day=weekStart;day<=asOf;day++)weekTotal=add(weekTotal,days.get(day)||0,flags);
      cumulative=add(cumulative,weekTotal,flags);visibleWeeklyTotal=add(visibleWeeklyTotal,weekTotal,flags);
      const column={index,key:dayString(weekStart),weekStart:dayString(weekStart),weekEnd:dayString(weekEnd),periodStart:dayString(weekStart),periodEnd:dayString(asOf),weekTotal,cumulativeValue:cumulative,cells:[]};
      for(let row=0;row<7;row++){
        const day=weekStart+row,date=dayString(day),future=day>lastDay,inRange=day>=startDay&&!future,disabled=mode==='daily'&&!inRange;
        const value=mode==='daily'?(inRange?days.get(day)||0:0):mode==='weekly'?weekTotal:cumulative;
        let label;
        if(mode==='daily')label=`${displayDay(day)} · ${WEEKDAYS[row]}\n${future?'尚未到来':!inRange?'不在当前月份范围':formatTokens(value)+' 个 Token'}`;
        else if(mode==='weekly')label=`${displayDay(weekStart)} 起的一周\n${formatTokens(value)} 个 Token${asOf<weekEnd?'\n截至 '+displayDay(asOf):''}`;
        else label=`累计至 ${displayDay(asOf)}\n${formatTokens(value)} 个 Token\n${displayDay(weekStart)} 起的一周`;
        const cell={key:mode+':'+date,index:cells.length,column:index,row,date,weekStart:column.weekStart,weekEnd:column.weekEnd,value,level:0,future,inRange,disabled,label};
        column.cells.push(cell);cells.push(cell);
      }
      columns.push(column);
    }
    const scale=createScale(mode==='daily'?cells.filter(cell=>!cell.disabled).map(cell=>cell.value):columns.map(column=>mode==='weekly'?column.weekTotal:column.cumulativeValue));
    for(const cell of cells)cell.level=cell.disabled?0:scale.level(cell.value);
    const months=[];
    for(let index=0;index<12;index++){
      const month=new Date(firstMonth);month.setUTCMonth(firstMonth.getUTCMonth()+index);
      const day=month.getTime()/DAY;months.push({column:Math.floor((day-gridFirst)/7),label:(month.getUTCMonth()+1)+'月',date:dayString(day)});
    }
    const globalTotal=count(options.totalTokens??options.total),undatedTotal=globalTotal===null||flags.overflow?0:Math.max(0,globalTotal-allDatedTotal),notices=[];
    if(undatedTotal>0)notices.push(`${formatTokens(undatedTotal)} 个 Token 缺少有效日期，未计入活动图。`);
    if(futureTotal>0)notices.push(`未来日期的 ${formatTokens(futureTotal)} 个 Token 暂不显示。`);
    if(normalized.invalidRows)notices.push(`${normalized.invalidRows} 条无效日期或计数记录已忽略。`);
    if(flags.overflow)notices.push('超大计数已按安全整数上限展示。');
    return {mode,today,startDate:dayString(startDay),endDate:today,gridStart:dayString(gridFirst),gridEnd:dayString(gridLast),columnCount:columns.length,columns,cells,months,
      scale:{method:scale.method,levels:scale.levels,minValue:scale.minValue,maxValue:scale.maxValue},
      summary:{visibleTotal,visibleWeeklyTotal,datedTotal,allDatedTotal,olderDatedTotal,undatedTotal,futureTotal,activeDays,todayTotal:days.get(lastDay)||0,maximum:scale.maxValue,modeTotal:mode==='daily'?visibleTotal:mode==='weekly'?visibleWeeklyTotal:datedTotal,invalidRows:normalized.invalidRows,overflow:flags.overflow},
      notice:notices.join(' ')};
  }
  return Object.freeze({MODES,beijingDay,dayNumber,formatTokens,normalizeDaily,createScale,buildActivity});
});
