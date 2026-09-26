// Human-entered observations are kept in memory and downloaded only on request.
if (new URLSearchParams(location.search).has('human')) {
  const mode = new URLSearchParams(location.search).get('mode') === '3d' ? '3d' : '2d';
  const panel = document.createElement('section');
  panel.style.cssText = 'padding:16px;background:#213932;margin-bottom:16px';
  panel.innerHTML = `<h2>Human comparison · ${mode === '2d' ? 'Pixi plan' : 'Three.js oblique'}</h2>
    <p>About 10 minutes per view. Start with either view (coin toss); use the same tasks in the other.
    Think aloud. Try each task for up to two minutes, then record what happened, including help or giving up.
    This fixture has authored queue data and exaggerated elevation.</p>
    <label>Anonymous participant code <input id="participant" placeholder="e.g. P01"></label>
    <label>Order and context <input id="context" size="80" placeholder="First/second view; browser/device; prior editing experience; input/access needs"></label>
    <p id="human-task"></p><button id="human-start">Start task</button>
    <label>Outcome <select id="human-outcome"><option value="">Choose after trying</option><option>Completed without help</option><option>Completed with help</option><option>Gave up</option></select></label>
    <label>Observations / explanation / help received <textarea id="human-notes" rows="3" cols="95" placeholder="What did you expect? What was confusing? Wrong selections or retries? For crossing/queue tasks, explain what you understood."></textarea></label>
    <button id="human-finish" disabled>Record task and continue</button>
    <button id="human-export">Download observations</button>
    <p id="human-status" role="status"></p>
    <p>Download before leaving this view; observations are not stored automatically.
    <a id="human-other">Then open the other view</a>. After both, tell the facilitator which felt clearer and why.</p>`;
  panel.id = 'human-panel';
  document.querySelector('main').append(panel);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:sticky;top:0;z-index:10;background:#213932;padding:12px;border-bottom:1px solid #6d9185';
  banner.innerHTML = '<span></span> <a href="#human-panel" style="color:#ffce91">Start / record task below</a>';
  document.querySelector('main').prepend(banner);
  panel.querySelector('a').style.color = '#ffce91';
  const $ = id => panel.querySelector(`#${id}`);
  const tasks = [
    'Draw an S-shaped road, then reshape it to make one bend gentler.',
    'Select the turning lane. Explain how you know which lane is selected.',
    'Identify which road passes above the other, explain whether they connect, then raise the upper road by 5 m.',
    'Inspect the head of the queue beneath the crossing. Explain the reported cause and how you reached the obscured vehicle.',
    'Using the keyboard, select the queue head and adjust a curve handle. Describe anything you could not do.'
  ];
  let index = 0, active = null;
  const observations = [];
  const provenance = await (await fetch('/__m4_provenance')).json();
  $('human-other').href = `?mode=${mode === '2d' ? '3d' : '2d'}&human=1`;
  function prompt() { banner.querySelector('span').textContent = $('human-task').textContent = index < tasks.length ? `Task ${index+1}/${tasks.length}: ${tasks[index]}` : 'View complete. Download observations, then compare the other view.'; }
  prompt();
  $('human-start').onclick = () => {
    if (!$('participant').value.trim()) { $('human-status').textContent = 'Enter an anonymous participant code first.'; return; }
    banner.scrollIntoView();
    active = { task: tasks[index], startedAt: new Date().toISOString(), startMs: performance.now(), logStart: window.study.log.length };
    $('human-start').disabled = true; $('human-finish').disabled = false;
    $('human-status').textContent = 'Task running. Record the outcome when finished or after two minutes.';
  };
  $('human-finish').onclick = () => {
    if (!$('human-outcome').value || !$('human-notes').value.trim()) { $('human-status').textContent = 'Choose an outcome and record your observations.'; return; }
    observations.push({ task: active.task, startedAt: active.startedAt,
      elapsedMs: performance.now()-active.startMs, selfReportedOutcome: $('human-outcome').value,
      humanNotes: $('human-notes').value, interactionLog: window.study.log.slice(active.logStart), finalState: window.study.state });
    active = null; index++; prompt();
    $('human-notes').value = ''; $('human-outcome').value = '';
    $('human-start').disabled = index === tasks.length; $('human-finish').disabled = true;
    $('human-status').textContent = `${observations.length} observations recorded in this page.`;
  };
  $('human-export').onclick = () => {
    const report = { kind: 'human-entered-observations', recordedAt: new Date().toISOString(),
      participant: $('participant').value, context: $('context').value, mode, provenance,
      info: window.study.info(), completedTasks: observations.length, unfinishedTask: active?.task ?? null, observations };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `m4-human-${mode}.json`; link.click(); URL.revokeObjectURL(url);
  };
  window.addEventListener('beforeunload', e => { if (observations.length || active) { e.preventDefault(); e.returnValue = ''; } });
}
