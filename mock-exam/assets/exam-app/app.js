'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'mock-exam-v1';
let session = null, config = {}, current = '1', draft = null, scratch = {}, runResults = {};
let saveTimer, pollTimer, timerHandle, offset = 0, submitting = false, running = false, wrongOnly = false;
let lastLocal = 0, saveChain = Promise.resolve(), saveVersion = 0;
let codeEditor = null, editorWrap = true;
function disposeEditor(){codeEditor?.destroy();codeEditor=null;}
const starters = {
  python: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    # 在这里完成解题，并输出结果\n\nif __name__ == "__main__":\n    main()\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // 在这里完成解题，并输出结果\n    return 0;\n}\n'
};

function storageGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function storageSet(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch { toast('浏览器存储不可用，请留意服务器保存状态。'); } }
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').hidden=true,4500); }
async function api(path, body) {
  const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Exam-Token':window.EXAM_TOKEN},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok){ const e=new Error(data.error||'操作失败'); e.session=data.session; throw e; }
  return data;
}
function remember() {
  if(!session || !draft) return;
  lastLocal=Date.now()/1000+offset;
  rememberSession(session);
  storageSet(KEY+'-'+session.id,{draft,current,scratch,updatedAt:lastLocal});
}
function queueSave() {
  if(session?.status!=='active')return;
  remember(); updateNav();
  if($('#save-status')) $('#save-status').textContent='本机已保存 · 正在同步…';
  clearTimeout(saveTimer); saveTimer=setTimeout(()=>flushSave(),450);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if(session?.status!=='active') return;
  const body={id:session.id,draft:structuredClone(draft)}, version=++saveVersion;
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    try {
      const data=await api('/api/save',body);
      if($('#save-status') && version===saveVersion){$('#save-status').textContent='已自动保存 · '+new Date(data.savedAt*1000).toLocaleTimeString('zh-CN',{hour12:false});$('#save-status').classList.remove('storage-error');}
    }catch(e){
      if(e.session) acceptSession(e.session);
      else if($('#save-status')){$('#save-status').textContent='服务器未同步；草稿保存在本机，连接恢复后重试';$('#save-status').classList.add('storage-error');}
    }
  });
  return saveChain;
}
function acceptSession(s) {
  session=s; offset=s.serverTime-Date.now()/1000;
  draft=structuredClone(s.draft);
  const local=storageGet(KEY+'-'+s.id);
  if(local){ current=local.current||'1'; scratch=local.scratch||{};
    if(s.status==='active' && local.updatedAt>s.savedAt && local.draft)draft=local.draft;
  }
  if(!keys().includes(current))current=keys()[0];
  rememberSession(s);
  render();
  if(s.status==='active'){remember();flushSave();}
}
function keys(){return session?[...session.bank.questions.map(q=>q.id),...session.bank.problems.map(p=>p.id)]:[];}
function answered(id){return session.bank.problems.some(p=>p.id===id)?!!draft.codes[id]?.code?.trim():!!draft.answers[id]?.length;}
function totals(){return {choices:session.bank.questions.filter(q=>answered(q.id)).length,code:session.bank.problems.filter(p=>answered(p.id)).length};}

function rememberSession(s) {
  const saved=storageGet(KEY)||{};
  saved.papers??={};
  saved.papers[(s.paperId||'set-01')+'/'+s.mode]=s.id;
  saved.id=s.id;saved.selectedPaper=s.paperId||'set-01';saved.openExam=true;
  storageSet(KEY,saved);
}
async function backToLibrary(){
  if(submitting)return;
  if(session?.status==='active')await flushSave();
  const saved=storageGet(KEY)||{};saved.openExam=false;storageSet(KEY,saved);
  session=null;draft=null;scratch={};runResults={};wrongOnly=false;
  config=await api('/api/config');entry();
}
$('#library-top').onclick=()=>backToLibrary().catch(e=>toast(e.message));
function entry() {
  disposeEditor();
  clearInterval(timerHandle);clearTimeout(pollTimer);$('#exam-actions').hidden=true;$('#library-top').hidden=true;
  $('#header-state').innerHTML='<span class="status-dot"></span> 本地试卷库';
  $('#app').innerHTML=`<section class="entry">
    <div class="entry-top"><div><span class="eyebrow">我的试卷库</span><h1>选择一套，开始练习</h1><p class="muted">先练选择题，也可以选择整套考试。</p></div><div class="edition">已保存 ${config.papers.length} 套试卷</div></div>
    <div class="entry-grid"><div><div class="panel"><div class="panel-pad"><span class="eyebrow" id="paper-name"></span><h2 id="paper-title"></h2><p class="note" id="paper-description"></p><p class="note" id="retained-code"></p></div><table class="entry-table"><thead><tr><th>本次考试内容</th><th>题量</th><th class="num">分值</th></tr></thead><tbody>
    <tr id="single-row"><td><strong>单项选择</strong></td><td id="single-count"></td><td class="num" id="single-points"></td></tr>
    <tr id="multi-row"><td><strong>多项选择</strong></td><td id="multi-count"></td><td class="num" id="multi-points"></td></tr>
    <tr id="code-row"><td><strong>编程实践</strong></td><td id="code-count"></td><td class="num" id="code-points"></td></tr>
    </tbody></table><div class="panel-pad"><h3>考试规则</h3><div class="note">选择题全部选对才得该题分数。编程题按测试通过率计分，仅计入包含编程的考试。交卷后查看答案与解析。刷新、关页和切出页面都不会暂停倒计时。</div></div></div>
    <div class="notice"><b>试卷来源说明</b><br><span id="paper-source"></span></div></div>
    <form id="start-form" class="panel panel-pad"><h2>考试设置</h2>
    <label class="field"><span>选择试卷</span><select id="paper">${config.papers.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.title)}</option>`).join('')}</select></label>
    <label class="field"><span>考试范围</span><select id="mode"></select></label>
    <label class="field"><span>考生称呼</span><input id="name" maxlength="40" placeholder="考生" autocomplete="off"></label>
    <label class="field"><span>考试时长</span><input id="minutes" type="number" min="1" max="240" value="30" required></label>
    <p class="note" id="exam-total"></p>
    <div id="resume-box" hidden><button type="button" id="resume" class="wide">打开上次答卷</button><p class="note">按试卷和考试范围分别保存；新开考试会保留原有记录。</p></div>
    <label class="checkline"><input type="checkbox" id="ready" required><span>我已阅读规则，点击开始后立即计时，到时自动交卷。</span></label>
    <button class="primary wide" id="start-btn">开始考试 →</button></form></div>
    <div class="entry-bottom"><span>试卷与答卷保存在本机 · 新增材料会保存为新的一套</span><span>已保留原有编程题</span></div></section>`;
  const saved=storageGet(KEY)||{};
  if(config.papers.some(p=>p.id===saved.selectedPaper))$('#paper').value=saved.selectedPaper;
  function updateMode(){
    const paper=config.papers.find(p=>p.id===$('#paper').value),m=paper.modes.find(m=>m.id===$('#mode').value);
    for(const prefix of ['single','multi','code']){$('#'+prefix+'-row').hidden=!m[prefix+'Count'];$('#'+prefix+'-count').textContent=m[prefix+'Count']+' 题';$('#'+prefix+'-points').textContent=m[prefix+'Points'];}
    $('#minutes').value=String(m.minutes);$('#exam-total').textContent=`本次共 ${m.count} 题，满分 ${m.total} 分。时长可调整。`;
    $('#resume-box').hidden=!storageGet(KEY)?.papers?.[paper.id+'/'+m.id];
  }
  function updatePaper(){
    const paper=config.papers.find(p=>p.id===$('#paper').value);
    const selection=storageGet(KEY)||{};selection.selectedPaper=paper.id;storageSet(KEY,selection);
    $('#paper-name').textContent=paper.name;$('#paper-title').textContent=paper.title;$('#paper-description').textContent=paper.description;$('#paper-source').textContent=paper.sourceNote;
    $('#retained-code').textContent=paper.retainedCodeCount?`已保留 ${paper.retainedCodeCount} 道编程题，选择“整套考试”即可作答。`:'';
    $('#mode').innerHTML=paper.modes.map(m=>`<option value="${m.id}">${esc(m.label)} · ${m.count} 题 · ${m.total} 分</option>`).join('');
    updateMode();
  }
  $('#paper').onchange=updatePaper;$('#mode').onchange=updateMode;updatePaper();
  $('#resume').onclick=async()=>{try{const id=storageGet(KEY)?.papers?.[$('#paper').value+'/'+$('#mode').value];acceptSession(await api('/api/session/'+id));}catch(e){toast(e.message);}};
  $('#start-form').onsubmit=async e=>{e.preventDefault();$('#start-btn').disabled=true;try{const s=await api('/api/start',{paperId:$('#paper').value,name:$('#name').value,mode:$('#mode').value,minutes:Number($('#minutes').value)});scratch={};runResults={};current=[...s.bank.questions,...s.bank.problems][0].id;acceptSession(s);}catch(err){toast(err.message);$('#start-btn').disabled=false;}};
}

function render(){disposeEditor();$('#library-top').hidden=false;$('#submit-top').disabled=false;clearInterval(timerHandle);clearTimeout(pollTimer);if(session.status==='active')exam();else if(session.status==='finished')report();else grading();}
function exam(){
  $('#exam-actions').hidden=false;
  $('#header-state').innerHTML=`<span class="status-dot"></span> ${esc(session.paperName||'第一套')} · ${esc(session.name)}`;
  $('#app').innerHTML=`<div class="workspace"><aside class="sidebar"><div class="panel"><div class="timerbox"><div class="timerlabel">剩余时间</div><div id="timer">--:--:--</div><div class="timerlabel" id="progress-label"></div><div class="progress-track"><div id="progress-fill"></div></div></div><nav class="navigation" id="nav" aria-label="答题卡"></nav></div><div class="save-note"><div id="save-status">已自动保存</div><div>切出页面 <span id="switch-count">${session.visibilityChanges}</span> 次 · 仅记录，不扣分</div></div></aside><section class="content"><div id="question-view"></div></section></div>`;
  $('#nav').onclick=e=>{const btn=e.target.closest('[data-go]');if(btn)navigate(btn.dataset.go);};
  showQuestion();updateNav();tick();timerHandle=setInterval(tick,500);
}
function tick(){
  if(session?.status!=='active')return;
  const left=Math.max(0,Math.ceil(session.deadline-(Date.now()/1000+offset)));
  const h=String(Math.floor(left/3600)).padStart(2,'0'),m=String(Math.floor(left%3600/60)).padStart(2,'0'),s=String(left%60).padStart(2,'0');
  if($('#timer')){$('#timer').textContent=`${h}:${m}:${s}`;$('#timer').classList.toggle('timer-warning',left<=300);}
  if(left===0&&!submitting){document.querySelectorAll('#question-view input,#question-view textarea,#question-view select,#question-view button').forEach(el=>el.disabled=true);submitExam(true);}
}
function updateNav(){
  if(!$('#nav')||!session)return;
  const count=totals();
  $('#progress-label').textContent=`已作答 ${count.choices+count.code} / ${keys().length}`;
  $('#progress-fill').style.width=((count.choices+count.code)/keys().length*100)+'%';
  $('#nav').innerHTML=`<div class="nav-heading"><span>选择题</span><span>${count.choices}/${session.bank.questions.length}</span></div><div class="question-grid">${session.bank.questions.map(q=>`<button data-go="${q.id}" class="qnum ${answered(q.id)?'answered':''} ${current===q.id?'current':''} ${draft.flags.includes(q.id)?'flagged':''}" aria-label="第 ${q.id} 题${answered(q.id)?'，已答':''}${draft.flags.includes(q.id)?'，已标记':''}" ${current===q.id?'aria-current="true"':''}>${q.id}</button>`).join('')}</div>${session.bank.problems.length?`<div class="nav-heading"><span>编程题</span><span>${count.code}/${session.bank.problems.length}</span></div>`:''}${session.bank.problems.map((p,i)=>`<button data-go="${p.id}" class="nav-code ${current===p.id?'current':''}"><span>${i+1}. ${esc(p.shortTitle||p.title)}${draft.flags.includes(p.id)?' · 标记':''}</span><span>${answered(p.id)?'已写':''}</span></button>`).join('')}<div class="legend"><span><i></i>已作答</span><span><i class="amber"></i>待检查</span></div>`;
}
function navigate(id){if(!keys().includes(id))return;current=id;remember();showQuestion();updateNav();window.scrollTo({top:0,behavior:'instant'});}
function bottomNav(){const ix=keys().indexOf(current);return `<div class="bottom-nav"><button id="prev" ${ix===0?'disabled':''}>← 上一题</button><span class="keyboard-note">${session.bank.problems.some(p=>p.id===current)?'Ctrl + Enter 运行样例 · Tab 缩进':'A–D 选择选项 · ← → 切换题目'}</span>${ix===keys().length-1?'<button class="primary" id="finish-bottom">检查并交卷</button>':'<button id="next">下一题 →</button>'}</div>`;}
function bindBottom(){if($('#prev'))$('#prev').onclick=()=>navigate(keys()[keys().indexOf(current)-1]);if($('#next'))$('#next').onclick=()=>navigate(keys()[keys().indexOf(current)+1]);if($('#finish-bottom'))$('#finish-bottom').onclick=confirmSubmit;}
function flagButton(){return `<button id="flag" class="${draft.flags.includes(current)?'flag-active':''}">${draft.flags.includes(current)?'已标记 · 取消标记':'标记，稍后检查'}</button>`;}
function bindFlag(){$('#flag').onclick=()=>{draft.flags=draft.flags.includes(current)?draft.flags.filter(x=>x!==current):[...draft.flags,current];queueSave();$('#flag').classList.toggle('flag-active',draft.flags.includes(current));$('#flag').textContent=draft.flags.includes(current)?'已标记 · 取消标记':'标记，稍后检查';};}
function showQuestion(){
  disposeEditor();
  if(session.bank.problems.some(p=>p.id===current))return showCode();
  const q=session.bank.questions.find(q=>q.id===current);
  $('#question-view').innerHTML=`<div class="sectionbar"><h2>${q.multi?'多项选择':'单项选择'}</h2><span>${q.multi?`全部选对得 ${q.points} 分，少选、错选不得分`:'每题仅一个正确答案'}</span></div><article class="panel question-card"><div class="question-meta"><span class="badge ${q.source!=='原题收录'?'added':''}">${esc(q.source)}</span><span>第 ${q.id} 题 / ${session.bank.questions.length}</span>${q.originalNumber?`<span>截图原第 ${q.originalNumber} 题</span>`:''}<span>${q.points} 分</span></div><h2 class="question-title">${esc(q.text)}</h2><div id="options">${q.options.map((v,i)=>{const letter='ABCD'[i],checked=draft.answers[q.id]?.includes(letter);return `<label class="option ${checked?'selected':''}"><input type="${q.multi?'checkbox':'radio'}" name="answer" value="${letter}" ${checked?'checked':''}><span class="option-letter">${letter}</span><span class="option-text">${esc(v)}</span></label>`;}).join('')}</div><div class="question-tools">${flagButton()}<button id="clear-answer" class="quiet">清空本题</button></div></article>${bottomNav()}`;
  $('#options').onchange=()=>{draft.answers[q.id]=[...document.querySelectorAll('#options input:checked')].map(x=>x.value);document.querySelectorAll('.option').forEach(el=>el.classList.toggle('selected',el.querySelector('input').checked));queueSave();};
  $('#clear-answer').onclick=()=>{draft.answers[q.id]=[];queueSave();showQuestion();};bindFlag();bindBottom();
}
function showCode(){
  disposeEditor();
  const p=session.bank.problems.find(p=>p.id===current),entry=draft.codes[current]||{language:'python',code:''};draft.codes[current]=entry;
  $('#question-view').innerHTML=`<div class="sectionbar"><h2>编程题 ${session.bank.problems.findIndex(x=>x.id===current)+1} <span> / ${session.bank.problems.length}</span></h2><span>${p.points} 分 · ACM 输入输出</span></div><div class="coding-layout"><article class="panel problem-panel"><div class="question-meta"><span class="badge">${esc(p.sourceType||"原题收录")}</span><span>${esc(p.source)}</span></div><h2>${esc(p.title)}</h2><p>${esc(p.description)}</p><ol>${p.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ol><h3>输入描述</h3><p>${esc(p.input)}</p><h3>输出描述</h3><p>${esc(p.output)}</p><div class="samplebox"><div><h3>样例输入</h3><pre>${esc(p.sampleIn.trim())}</pre></div><div><h3>样例输出</h3><pre>${esc(p.sampleOut)}</pre></div></div><h3>样例说明</h3><p>${esc(p.sampleNote)}</p><div class="notice">${esc(p.convention)}</div></article><section class="panel editor-panel"><div class="editor-toolbar"><span>代码编辑器</span><div class="inline-row"><button id="template" class="quiet" style="padding:4px 8px">插入模板</button><label class="wrap-toggle"><input type="checkbox" id="editor-wrap" ${editorWrap?'checked':''}>自动换行</label><select id="language" aria-label="编程语言">${config.languages.map(l=>`<option value="${l}" ${entry.language===l?'selected':''}>${l==='python'?'Python 3':'C++17'}</option>`).join('')}</select></div></div><div id="code-editor"></div><div class="runner"><div class="run-controls"><button id="run-sample" class="primary" ${running?'disabled':''}>${running?'运行中…':'运行样例'}</button><button id="custom-toggle">自定义输入</button><button id="run-custom" hidden>运行自定义</button><span class="muted">限时 4 秒 / 测试</span></div><textarea id="custom-input" class="custom-input" hidden aria-label="自定义测试输入" spellcheck="false">${esc(p.sampleIn)}</textarea><div id="run-result" class="run-result"><span class="muted">运行结果显示在这里，隐藏测试将在交卷后判分。</span></div></div></section></div><div class="question-tools" style="margin-top:16px;padding-top:0;border:0">${flagButton()}<span class="note">${p.points} 分按测试通过率计算</span></div>${bottomNav()}`;
  const pid=current;
  codeEditor=window.ExamEditor.create($('#code-editor'),{
    code:entry.code,language:entry.language,wrap:editorWrap,
    onChange:value=>{if(session?.status==='active'&&!submitting){draft.codes[pid].code=value;queueSave();}},
    onRun:()=>runCode(false)
  });
  $('#editor-wrap').onchange=()=>{editorWrap=$('#editor-wrap').checked;codeEditor.setWrap(editorWrap);};
  $('#template').onclick=()=>{if(codeEditor.getValue().trim()){toast('编辑器已有内容。清空后可插入模板。');return;}codeEditor.setValue(starters[entry.language]);codeEditor.focus();};
  $('#language').onchange=()=>{scratch[current]??={};scratch[current][entry.language]=codeEditor.getValue();draft.codes[current]={language:$('#language').value,code:scratch[current][$('#language').value]||''};queueSave();showCode();};
  $('#custom-toggle').onclick=()=>{const open=$('#custom-input').hidden;$('#custom-input').hidden=!open;$('#run-custom').hidden=!open;};
  $('#run-sample').onclick=()=>runCode(false);$('#run-custom').onclick=()=>runCode(true);bindFlag();bindBottom();
  if(runResults[current])showRunResult(runResults[current]);
}
async function runCode(custom){
  if(running||session.status!=='active')return;
  const pid=current;if(!draft.codes[pid].code.trim()){toast('请先编写代码。');return;}
  const customInput=$('#custom-input').value;
  running=true;document.querySelectorAll('#run-sample,#run-custom').forEach(b=>b.disabled=true);$('#run-sample').textContent='运行中…';
  try{await flushSave();const r=await api('/api/run',{id:session.id,draft:structuredClone(draft),problem:pid,custom,input:customInput});runResults[pid]=r;if(current===pid&&$('#run-result'))showRunResult(r);}catch(e){if(e.session)acceptSession(e.session);else toast(e.message);}finally{running=false;if($('#run-sample')){$('#run-sample').disabled=false;$('#run-sample').textContent='运行样例';$('#run-custom').disabled=false;}}
}
function showRunResult(r){
  if(r.compile){$('#run-result').innerHTML=`<b class="failure">编译失败</b><pre>${esc(r.compile.stderr||r.compile.status)}</pre>`;return;}
  const out=r.custom?r.result:r.cases?.[0];if(!out){$('#run-result').textContent=r.message||'没有可运行代码';return;}
  const good=['OK','AC'].includes(out.status);
  const labels={AC:'样例通过',OK:'运行完成',WA:'样例未通过',TLE:'超出 4 秒时间限制',RE:'运行错误',OLE:'输出超过限制'};
  $('#run-result').innerHTML=`<b class="${good?'success':'failure'}">${labels[out.status]||esc(out.status)}</b><span class="muted"> · ${out.ms} ms${r.custom?' · 自定义输入不判正确性':''}</span><pre>${esc(out.stdout||'（无输出）')}</pre>${out.expected&&!good?`<p class="muted">期望输出</p><pre>${esc(out.expected)}</pre>`:''}${out.stderr?`<pre class="failure">${esc(out.stderr)}</pre>`:''}`;
}

function confirmSubmit(){if(session?.status!=='active'||submitting)return;const count=totals();$('#submit-summary').textContent=`选择题已答 ${count.choices}/${session.bank.questions.length} 道${session.bank.problems.length?`，编程题已写 ${count.code}/${session.bank.problems.length} 道`:''}，标记待检查 ${draft.flags.length} 道。`;$('#confirm-dialog').showModal();}
$('#confirm-dialog').addEventListener('close',()=>{if($('#confirm-dialog').returnValue==='submit')submitExam(false);});
$('#submit-top').onclick=confirmSubmit;
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器不支持全屏，可按 F11。');}};
async function submitExam(auto=false){
  if(submitting||session?.status!=='active')return;
  submitting=true;codeEditor?.setReadOnly(true);clearTimeout(saveTimer);remember();
  if($('#confirm-dialog').open)$('#confirm-dialog').close('cancel');
  document.querySelectorAll('#question-view input,#question-view textarea,#question-view select,#question-view button,#submit-top').forEach(el=>el.disabled=true);
  try{await saveChain;const s=await api('/api/submit',{id:session.id,draft:structuredClone(draft)});acceptSession(s);}catch(e){toast('交卷未完成，答卷仍在本机。请检查连接后重试。');if(!auto){codeEditor?.setReadOnly(false);document.querySelectorAll('#question-view input,#question-view textarea,#question-view select,#question-view button,#submit-top').forEach(el=>el.disabled=false);}}finally{submitting=false;}
}
function grading(){
  $('#exam-actions').hidden=true;$('#header-state').textContent='答卷已锁定';
  const failed=session.status==='grade_error';
  $('#app').innerHTML=`<section class="panel grading">${failed?'':'<div class="spinner" aria-hidden="true"></div>'}<span class="eyebrow">${session.reason==='timeout'?'时间到 · 已自动交卷':'考试结束'}</span><h1>${failed?'判分暂未完成':'正在判分'}</h1><p>${failed?esc(session.error):(session.bank.problems.length?'正在运行编程题测试，完成后展示成绩和解析。':'正在核对选择题答案，完成后展示成绩和解析。')}</p><p class="muted">答卷已保存，刷新页面可以继续查看。</p>${failed?'<button class="primary" id="retry-grade">重新判分</button>':''}</section>`;
  if(failed){$('#retry-grade').onclick=async()=>{try{acceptSession(await api('/api/submit',{id:session.id}));}catch(e){toast(e.message);}};return;}
  pollTimer=setTimeout(async()=>{try{const s=await api('/api/session/'+session.id);session=s;if(s.status!=='grading')render();else grading();}catch{pollTimer=setTimeout(()=>grading(),2500);}},1500);
}

function report(){
  $('#exam-actions').hidden=true;$('#header-state').innerHTML='<span class="status-dot"></span> 已交卷';
  const r=session.report;const spent=Math.max(0,Math.floor((session.submittedAt-session.startedAt)/60)),secs=Math.max(0,Math.floor(session.submittedAt-session.startedAt)%60);
  const correct=r.questions.filter(q=>q.score>0).length;
  $('#app').innerHTML=`<section class="report"><div class="panel report-hero"><div><span class="eyebrow">${esc(session.paperName||'第一套')} · 考试报告</span><h1>${esc(session.name)}，本次模拟已完成</h1><p class="muted">${session.reason==='timeout'?'到时自动交卷':'主动交卷'} · 用时 ${spent} 分 ${secs} 秒 · 切出页面 ${session.visibilityChanges} 次</p><div class="score-grid"><div>选择题<strong>${r.objectiveScore} / ${r.questions.reduce((sum,q)=>sum+q.points,0)}</strong></div>${r.problems.length?`<div>编程题<strong>${r.programmingScore} / ${r.problems.reduce((sum,p)=>sum+p.points,0)}</strong></div>`:''}<div>选择正确<strong>${correct} / ${r.questions.length}</strong></div></div></div><div><div class="score-number">${r.score}<small> / ${r.total}</small></div><p class="note" style="margin:14px 0 0">模拟测试得分，不设官方及格线</p></div></div><div class="report-tools"><button id="filter-wrong">${wrongOnly?'查看全部题目':'只看失分题'}</button><button id="export-report">导出答卷与解析</button><button id="again" class="primary">返回试卷库</button></div><p class="source-note">题目与解析根据提供的材料整理；补题有明确标注，判题数据与分值为本地模拟设置。</p><div id="review-list"></div><div class="sources">核对来源${r.sources.map(s=>s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`:`<span>${esc(s.title)}</span>`).join('')}</div></section>`;
  drawReview();
  $('#filter-wrong').onclick=()=>{wrongOnly=!wrongOnly;$('#filter-wrong').textContent=wrongOnly?'查看全部题目':'只看失分题';drawReview();};
  $('#export-report').onclick=exportReport;
  $('#again').onclick=()=>backToLibrary().catch(e=>toast(e.message));
}
function drawReview(){
  const r=session.report;
  const qs=r.questions.filter(q=>!wrongOnly||q.score<q.points),ps=r.problems.filter(p=>!wrongOnly||p.score<p.points);
  $('#review-list').innerHTML=qs.map(q=>`<article class="panel review-item"><div class="question-meta"><span class="badge ${q.source!=='原题收录'?'added':''}">${esc(q.source)}</span><span>${q.multi?'多选':'单选'} · ${esc(q.topic)}</span><strong class="${q.score?'success':'failure'}">${q.score} / ${q.points} 分</strong></div><h3>${q.id}. ${q.originalNumber?`（截图原第 ${q.originalNumber} 题）`:""}${esc(q.text)}</h3><ol type="A">${q.options.map((o,i)=>`<li class="${q.answer.includes('ABCD'[i])?'success':''}">${esc(o)}</li>`).join('')}</ol><p class="answer-line">你的答案：<b>${q.given.join('、')||'未作答'}</b>　参考答案：<b class="success">${q.answer.join('、')}</b></p><div class="explanation">${esc(q.explanation)}</div></article>`).join('')+ps.map((p,i)=>`<article class="panel review-item"><div class="question-meta"><span class="badge">编程题</span><strong class="${p.score===p.points?'success':'failure'}">${p.score} / ${p.points} 分</strong><span>通过 ${p.result.passed}/${p.result.total} 个测试</span></div><h3>${esc(p.title)}</h3>${p.result.message?`<p class="failure">${esc(p.result.message)}</p>`:''}${p.result.compile?`<pre>${esc(p.result.compile.stderr)}</pre>`:''}<div class="test-grid">${p.result.cases.map(c=>`<div class="test-cell"><span>${esc(c.label)}</span><b class="${c.status==='AC'?'success':'failure'}">${esc(c.status)}</b></div>`).join('')}</div><div class="explanation">${esc(p.explanation)}</div><details><summary>查看我的代码（${p.language==='python'?'Python':'C++17'}）</summary><pre>${esc(p.code||'未作答')}</pre></details><details><summary>查看 Python 参考实现</summary><pre>${esc(p.reference)}</pre></details></article>`).join('')+(!qs.length&&!ps.length?'<div class="panel panel-pad success">没有失分题，全部通过。</div>':'');
}
function exportReport(){
  const r=session.report;
  let text=`# 模拟笔试答卷\n\n试卷：${session.paperName||'第一套'}\n考生：${session.name}\n成绩：${r.score}/${r.total}\n考试时长：${session.minutes} 分钟\n日期：${new Date(session.startedAt*1000).toLocaleString()}\n\n题目来源：用户提供材料及明确标注的补充题，详见下方来源。测试数据和评分为模拟设置。\n`;
  for(const q of r.questions)text+=`\n## ${q.id}. ${q.text}\n\n${q.source}${q.originalNumber?` · 截图原第 ${q.originalNumber} 题`:""} · ${q.score}/${q.points} 分\n\n${q.options.map((o,i)=>'ABCD'[i]+'. '+o).join('\n')}\n\n你的答案：${q.given.join(',')||'未作答'}\n参考答案：${q.answer.join(',')}\n\n${q.explanation}\n`;
  for(const p of r.problems)text+=`\n## ${esc(p.title)}\n\n${p.score}/${p.points} 分，通过 ${p.result.passed}/${p.result.total} 个测试\n\n${p.explanation}\n\n### 我的代码\n\n\`\`\`${p.language}\n${p.code}\n\`\`\`\n\n### Python 参考实现\n\n\`\`\`python\n${p.reference}\n\`\`\`\n`;
  text+='\n## 来源\n\n'+r.sources.map(s=>s.url?`- [${s.title}](${s.url})`:`- ${s.title}`).join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=(session.paperName||'第一套')+'_答卷_'+new Date(session.startedAt*1000).toISOString().slice(0,10)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden||session?.status!=='active')return;
  flushSave();api('/api/visibility',{id:session.id}).then(r=>{session.visibilityChanges=r.count;if($('#switch-count'))$('#switch-count').textContent=r.count;}).catch(()=>{});
});
window.addEventListener('online',()=>{if(session?.status==='active')flushSave();});
window.addEventListener('pagehide',()=>{if(session?.status==='active'){remember();fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json','X-Exam-Token':window.EXAM_TOKEN},body:JSON.stringify({id:session.id,draft}),keepalive:true}).catch(()=>{});}});
document.addEventListener('keydown',e=>{
  if(session?.status!=='active'||$('#confirm-dialog').open||e.target.closest('.cm-editor,[contenteditable="true"]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(!session.bank.problems.some(p=>p.id===current)&&/^[a-d]$/i.test(e.key)){e.preventDefault();const el=document.querySelector(`#options input[value="${e.key.toUpperCase()}"]`);if(el)el.click();}
  if(e.key==='ArrowRight'&&keys().indexOf(current)<keys().length-1){e.preventDefault();navigate(keys()[keys().indexOf(current)+1]);}
  if(e.key==='ArrowLeft'&&keys().indexOf(current)>0){e.preventDefault();navigate(keys()[keys().indexOf(current)-1]);}
});
async function boot(){
  if(location.protocol==='file:'){$('#app').innerHTML='<section class="panel grading"><h2>请通过本地考场打开</h2><p>双击同目录的“启动考试.cmd”，即可打开支持编程运行与自动判分的考试页面。</p></section>';return;}
  try{config=await api('/api/config');const saved=storageGet(KEY);if(saved?.id){try{if(saved.openExam){acceptSession(await api('/api/session/'+saved.id));return;}if(!saved.papers){const old=await api('/api/session/'+saved.id);rememberSession(old);const migrated=storageGet(KEY);migrated.openExam=false;storageSet(KEY,migrated);}}catch(e){toast('未能恢复上次考试：'+e.message);}}entry();}catch(e){$('#app').innerHTML=`<section class="panel grading"><h2>考场暂未连接</h2><p>${esc(e.message)}</p><p>请运行“启动考试.cmd”，然后刷新页面。</p><button onclick="location.reload()">重新连接</button></section>`;}
}
boot();
