(() => {
  const scenes = {
    center: {name:'Hollowmere',sub:'Bitterroot starter test area · morning',text:'Hollowmere is awake around you. Praxis is using this as the first story sandbox rather than loading an entire world at once.',present:['Townsfolk'],items:[],exits:[{label:'Market',to:'market'},{label:'Bakery',to:'bakery'}]},
    market: {name:'Hollowmere · Market',sub:'Scene-presence test fixture',text:"The market scene is active. Only this scene's local presence is available to the narrator and interaction layer.",present:['Market traders','Townsfolk'],items:[],exits:[{label:'Return to Hollowmere',to:'center'}]},
    bakery: {name:'Hollowmere · Bakery',sub:'Scene-presence test fixture',text:'Warmth and the smell of baking bread define the active scene. This remains a prototype fixture, not final Orbis map structure.',present:['Bakery staff','Patrons'],items:[],exits:[{label:'Return to Hollowmere',to:'center'}]}
  };

  const $ = selector => document.querySelector(selector);
  const side = $('#side'), log = $('#log'), input = $('#input');
  let pendingMove = null;
  let aiBusy = false;
  let activeRequest = null;
  let requestEpoch = 0;
  let saveBlocked = false;
  let saveWarning = '';
  const Session = window.PraxisSession;

  function freshState(){return{location:'center',minutes:480,fatigue:0,maxFatigue:10,health:10,maxHealth:10,inventory:[],visited:['center'],story:{title:'A Morning in Hollowmere',phase:'arrival',status:'active',goals:{market:false,bakery:false,return:false}},aiTask:null,lastRoll:null,turn:1,mode:'assisted',goal:''}}
  let state = freshState();
  const transcript = [
    {k:'narr',t:'Morning settles over Hollowmere. You are free to talk, look around, wander and spend time as you choose.'},
    {k:'runtime',t:'Praxis anchored the story at Hollowmere. Connect NovelAI for narration and dialogue. Your actions are recorded independently.',kind:'ai'}
  ];

  try {
    const saved = localStorage.getItem(Session.STORAGE_KEY);
    if(saved) {
      const restored = Session.decode(saved, scenes);
      state = restored.state;
      transcript.splice(0,transcript.length,...restored.transcript);
      input.value = restored.draft;
    }
  } catch(error) {
    saveBlocked = true;
    saveWarning = 'Saved session could not be loaded. It has been kept untouched. Reset the slice to start a new save.';
  }

  function saveSession() {
    if(saveBlocked) return;
    try {
      localStorage.setItem(Session.STORAGE_KEY, JSON.stringify({schema:1,state,transcript,draft:input.value}));
      saveWarning = '';
    } catch(error) { saveWarning = 'Saving is unavailable. Keep this page open to retain your session.'; }
  }
  const scene = () => scenes[state.location];
  const esc = value => String(value).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  const clock = () => `${String(Math.floor(state.minutes/60)%24).padStart(2,'0')}:${String(state.minutes%60).padStart(2,'0')}`;
  const narr = text => transcript.push({k:'narr',t:text});
  const rt = (text,kind='') => transcript.push({k:'runtime',t:text,kind});
  const player = text => transcript.push({k:'player',t:text});

  function advance(minutes,fatigue=0,reason='activity'){
    state.minutes += minutes;
    state.fatigue = Math.max(0,Math.min(10,state.fatigue + fatigue));
    rt(`TIME +${minutes} min · fatigue ${fatigue>=0?'+':''}${fatigue} · ${reason}.`);
  }

  function updateStory(){
    if(state.location==='market') state.story.goals.market=true;
    if(state.location==='bakery') state.story.goals.bakery=true;
    if(state.location==='center'&&state.story.goals.market&&state.story.goals.bakery) state.story.goals.return=true;
    const g=state.story.goals;
    if(g.market&&g.bakery&&g.return&&state.story.status!=='complete'){
      state.story.phase='complete';state.story.status='complete';state.aiTask=null;
      rt('STORY BEAT complete: both test scenes visited and the anchor regained.','good');
      narr('You return to Hollowmere with the morning shaped by the choices you made along the way.');
    } else if(state.story.status==='active'&&(g.market||g.bakery)) state.story.phase='exploration';
    if(state.minutes>=720&&state.story.status==='active') state.story.phase='late-morning';
  }

  function allowedObjectives(){
    const g=state.story.goals, out=[];
    if(!g.market) out.push({key:'visit-market',label:'Visit the market scene'});
    if(!g.bakery) out.push({key:'visit-bakery',label:'Visit the bakery scene'});
    if(g.market&&g.bakery&&!g.return) out.push({key:'return-center',label:'Return to Hollowmere after both scenes'});
    return out;
  }

  function aiPayload(inputText='',resolvedOutcome=null){
    const s=scene();
    return {
      input:inputText,
      controlMode:state.mode,
      goal:state.goal,
      scene:{location:s.name,description:s.text,time:clock(),fatigue:`${state.fatigue}/${state.maxFatigue}`,health:`${state.health}/${state.maxHealth}`,present:s.present,exits:s.exits.map(x=>x.label),items:s.items},
      story:{title:state.story.title,phase:state.story.phase,status:state.story.status,goals:state.story.goals},
      allowedObjectives:allowedObjectives(),
      resolvedOutcome,
      history:Session.history(transcript,inputText)
    };
  }

  async function liveNarrate(text, resolvedOutcome=null){
    if(!window.PraxisAI?.hasToken()) return false;
    const epoch = ++requestEpoch;
    activeRequest = new AbortController();
    aiBusy=true;render();
    try{
      const result=await window.PraxisAI.turn(aiPayload(text,resolvedOutcome),activeRequest.signal);
      if(epoch !== requestEpoch) return true;
      if(typeof result?.narration !== 'string' || !result.narration.trim()) throw new Error('The narrator returned no text.');
      narr(result.narration);
      rt(`NovelAI narration accepted · ${result.model}. No authoritative state was changed by the model.`,'ai');
      return true;
    }catch(error){
      if(epoch !== requestEpoch || error.name === 'AbortError') return true;
      rt(`AI pipe failed: ${error.message}`,'bad');
      return false;
    }finally{
      if(epoch === requestEpoch){activeRequest=null;aiBusy=false;render()}
    }
  }

  function pauseAI(){
    requestEpoch++;
    activeRequest?.abort();activeRequest=null;aiBusy=false;
    rt('AI paused. Any action already resolved stays recorded; unfinished narration was discarded.');
    render();
  }

  async function fullAI(){
    if(aiBusy || pendingMove) return;
    const goal=input.value.trim() || state.goal;
    if(!goal){$('#modeHint').textContent='Give your character a goal first.';input.focus();return}
    if(!window.PraxisAI?.hasToken()){openAiSetup('Connect NovelAI before letting AI choose an action.');return}
    state.goal=goal;input.value='';saveSession();
    const allowed=Session.choices(state.location,scenes);
    const epoch=++requestEpoch;
    activeRequest=new AbortController();aiBusy=true;render();
    try{
      const result=await window.PraxisAI.action({...aiPayload(),goal,allowedActions:allowed},activeRequest.signal);
      if(epoch !== requestEpoch) return;
      const chosen=result?.accepted && allowed.find(a=>a.key===result.actionKey);
      if(!chosen){rt(`AI action rejected: ${result?.rejection||'not available in this scene'}.`,'bad');return}
      activeRequest=null;aiBusy=false;
      rt(`AI chose: ${chosen.description}.`,'ai');
      if(chosen.kind==='move') await move(chosen.to,`I travel to ${scenes[chosen.to].name}.`,true);
      else await localAction(chosen.kind);
    }catch(error){
      if(epoch === requestEpoch && error.name !== 'AbortError') rt(`AI action selection failed: ${error.message}`,'bad');
    }finally{
      if(epoch === requestEpoch){activeRequest=null;aiBusy=false;render()}
    }
  }

  async function askDirector(){
    const allowed=allowedObjectives();
    if(!allowed.length){rt('Story Director has no open runtime-approved objectives.','good');return render()}
    if(!window.PraxisAI?.hasToken()){openAiSetup('Connect NovelAI before asking the Story Director.');return}
    const epoch=++requestEpoch;activeRequest=new AbortController();
    aiBusy=true;render();
    try{
      const result=await window.PraxisAI.director({...aiPayload(),allowedObjectives:allowed},activeRequest.signal);
      if(epoch!==requestEpoch)return;
      if(!result.accepted||!result.task){rt(`AI task rejected by Praxis: ${result.rejection||'invalid task proposal'}.`,'bad');return}
      if(!allowed.some(x=>x.key===result.task.objectiveKey)){rt('AI task rejected: objective is no longer valid.','bad');return}
      state.aiTask=result.task;
      rt(`Story Director selected runtime-approved objective ${result.task.objectiveKey}.`,'good');
      narr(`${result.task.title}: ${result.task.briefing}`);
    }catch(error){if(epoch===requestEpoch&&error.name!=='AbortError')rt(`Story Director failed: ${error.message}`,'bad')}
    finally{if(epoch===requestEpoch){activeRequest=null;aiBusy=false;render()}}
  }

  function renderLog(){
    log.innerHTML=transcript.map(x=>x.k==='player'?`<div class="turn player"><div class="who">You</div><p>${esc(x.t)}</p></div>`:x.k==='runtime'?`<div class="turn runtime ${esc(x.kind||'')}">⚙ ${esc(x.t)}</div>`:`<div class="turn narr"><div class="who">Narrator</div><p>${esc(x.t)}</p></div>`).join('');
    log.scrollTop=log.scrollHeight;
  }

  function scenePanel(){
    const s=scene();
    return `<div class="section"><h3>Current scene</h3><div class="card"><b>${esc(s.name)}</b><div class="small">${esc(s.text)}</div></div></div><div class="section"><h3>Scene presence</h3>${s.present.map(x=>`<div class="row"><span>${esc(x)}</span><span>present</span></div>`).join('')}</div><div class="section"><h3>Free local actions</h3><div class="actions"><button class="btn" data-act="look">Look · 2 min</button><button class="btn" data-act="talk">Talk · 5 min</button><button class="btn" data-act="explore">Explore · 15 min · +1 fatigue</button><button class="btn" data-act="rest">Rest · 30 min · -3 fatigue</button></div></div><div class="section"><h3>Movement</h3>${s.exits.map(e=>`<div class="card"><b>${esc(e.label)}</b><div class="small">10 min · +1 fatigue${state.fatigue>=8?' · Endurance roll':''}</div><button class="btn primary" data-act="move" data-to="${e.to}">${state.fatigue>=8?'🎲 Attempt move':'Move'}</button></div>`).join('')}</div>`;
  }

  function storyPanel(){
    const g=state.story.goals, mark=(v,t)=>`<div class="row"><span>${v?'✓':'○'} ${t}</span><span>${v?'done':'open'}</span></div>`;
    const task=state.aiTask?`<div class="card task"><b>${esc(state.aiTask.title)}</b><div class="small">${esc(state.aiTask.briefing)}</div><div class="row"><span>Objective</span><span>${esc(state.aiTask.objectiveKey)}</span></div></div>`:'<div class="card small">No AI-delivered task yet. The director may only choose from objectives that the Praxis rail currently allows.</div>';
    return `<div class="section"><h3>Optional story milestones</h3><div class="card"><b>${esc(state.story.title)}</b><div class="small">Optional milestones. Explore freely and ask for guidance when you want it.</div></div>${mark(g.market,'Visit the market scene')}${mark(g.bakery,'Visit the bakery scene')}${mark(g.return,'Return after both')}</div><div class="section"><h3>Story Director</h3>${task}<button class="btn primary" data-act="director" ${aiBusy?'disabled':''}>${aiBusy?'AI working...':'Ask for next task'}</button></div><div class="row"><span>Phase</span><span>${state.story.phase}</span></div><div class="row"><span>Clock</span><span>${clock()}</span></div>`;
  }

  function youPanel(){return `<div class="section"><h3>Player state</h3><div class="card"><b>Fatigue ${state.fatigue}/10</b><div class="meter"><i style="width:${state.fatigue*10}%"></i></div></div><div class="card"><b>Health ${state.health}/10</b><div class="meter"><i style="width:${state.health*10}%"></i></div></div><div class="row"><span>Time</span><span>${clock()}</span></div><div class="row"><span>Turn</span><span>${state.turn}</span></div>${state.lastRoll?`<div class="row"><span>Last roll</span><span>${state.lastRoll.total} vs ${state.lastRoll.dc}</span></div>`:''}</div>`}

  function runtimePreview(){const s=scene();return [`PRAXIS SCENE STATE`,`Story: ${state.story.title}`,`Phase: ${state.story.phase}`,`Location: ${s.name}`,`Time: ${clock()}`,`Fatigue: ${state.fatigue}/10`,`Present: ${s.present.join(', ')}`,`Allowed objectives: ${allowedObjectives().map(x=>x.key).join(', ')||'none'}`,``,`Only this active slice is sent to the narrator.`].join('\n')}

  function render(){
    renderLog();
    $('#title').textContent=scene().name;$('#subtitle').textContent=`${scene().sub} · ${clock()} · fatigue ${state.fatigue}/10`;
    $('#p-scene').innerHTML=scenePanel();$('#p-story').innerHTML=storyPanel();$('#p-you').innerHTML=youPanel();
    $('#p-pack').innerHTML='<div class="card small">Inventory/economy remains intentionally empty in this slice. AI is not allowed to invent possessions.</div>';
    $('#p-state').innerHTML=`<div class="section"><h3>Narrator context preview</h3><pre>${esc(runtimePreview())}</pre></div><div class="section"><h3>Prototype state</h3><pre>${esc(JSON.stringify(state,null,2))}</pre></div><div class="section"><h3>Recent runtime events</h3><div class="runtime-list">${transcript.filter(t=>t.k==='runtime').slice(-12).map(t=>esc(t.t)).join('\n\n')}</div></div><button class="btn" data-act="reset">Reset slice</button>`;
    const mode=Session.MODES[state.mode];
    $('#controlMode').value=state.mode;
    $('#controlMode').disabled=aiBusy || Boolean(pendingMove);
    $('#modeHint').textContent=mode.hint;
    input.placeholder=mode.placeholder;
    $('#send').textContent=state.mode==='full'?'Set goal':'Send';
    $('#send').disabled=aiBusy || Boolean(pendingMove) || !input.value.trim();
    $('#aiStep').hidden=state.mode!=='full';
    $('#aiStep').disabled=aiBusy || Boolean(pendingMove);
    $('#pauseAI').hidden=!aiBusy;
    $('#goalLine').textContent=state.mode==='full' && state.goal ? `Goal: ${state.goal}` : '';
    saveSession();
    $('#saveStatus').textContent=saveWarning || 'Saved on this browser';
    $('#aiStatus').textContent=window.PraxisAI?.hasToken()?`AI connected · ${window.PraxisAI.getModel()}`:'AI disconnected';
    $('#aiStatus').classList.toggle('off',!window.PraxisAI?.hasToken());
    document.querySelectorAll('[data-act]').forEach(button=>{button.onclick=handleAction;button.disabled=aiBusy || Boolean(pendingMove)});
  }

  async function localAction(kind,text=null){
    if(aiBusy || pendingMove) return;
    const actions={look:[2,0,'I look around carefully.'],talk:[5,0,'I start a conversation with someone present.'],explore:[15,1,'I explore the current scene.'],rest:[30,-3,'I rest here for a while.'],freeform:[5,0,text]};
    const spec=actions[kind];if(!spec)return;
    const prompt=text||spec[2];
    player(prompt);state.turn++;advance(spec[0],spec[1],kind);updateStory();
    const outcome=`${kind} in ${scene().name}. Time advanced ${spec[0]} minutes; fatigue is ${state.fatigue}/10. Location, health and belongings are unchanged.`;
    if(!await liveNarrate(prompt,outcome)) {
      if(kind==='look') narr(scene().text);
      else if(kind==='rest') narr('You rest while time passes and recover some energy.');
      else rt('Action recorded. Connect NovelAI for narration and dialogue.','ai');
    }
    render();
  }

  async function move(to,text=null,automatic=false){
    if(aiBusy || pendingMove) return;
    if(!scene().exits.some(e=>e.to===to)){rt('Travel rejected: this destination is not a current exit.','bad');render();return}
    if(state.fatigue>=8){pendingMove={to,text};$('#die').textContent='?';$('#roll').classList.add('open');render();if(automatic)await resolveRoll();return}
    await commitMove(to,text);
  }

  async function commitMove(to,text=null){
    if(!scene().exits.some(e=>e.to===to)){rt('Travel rejected: the route is no longer available.','bad');render();return}
    const from=scene().name;
    player(text||`I move from ${from} to ${scenes[to].name}.`);
    state.location=to;if(!state.visited.includes(to))state.visited.push(to);state.turn++;advance(10,1,`move from ${from}`);
    const outcome=`MOVE validated from ${from} to ${scenes[to].name}. The destination is now scene-present. Health and belongings are unchanged.`;
    rt(outcome,'good');updateStory();
    if(!await liveNarrate(text||`I move from ${from} to ${scenes[to].name}.`,outcome)) narr(scenes[to].text);
    render();
  }

  async function resolveRoll(){
    if(!pendingMove || aiBusy)return;
    const {to,text}=pendingMove;pendingMove=null;$('#roll').classList.remove('open');
    const d20=Math.floor(Math.random()*20)+1,total=d20+2,dc=12;
    state.lastRoll={d20,total,dc,success:total>=dc};
    if(total>=dc){rt(`Endurance SUCCESS: d20 ${d20} + 2 = ${total}.`,'good');await commitMove(to,text)}
    else{
      const prompt=text||'I try to push onward despite my exhaustion.';
      player(prompt);state.turn++;advance(5,0,'failed exhausted movement');updateStory();
      rt(`Endurance FAILED: ${total} vs ${dc}. Movement rejected.`,'bad');
      if(!await liveNarrate(prompt,`Endurance FAILED: ${total} vs ${dc}. Movement does not occur. No damage or item change.`)) narr('You stop and gather yourself instead of forcing the next step.');
      render();
    }
  }

  async function freeText(text){
    if(aiBusy || pendingMove)return;
    const action=Session.classify(text,state.location,scenes);
    if(action.kind==='move')return move(action.to,text);
    if(action.kind==='unresolved-travel'){
      player(text);rt(`This route is not mapped in the current slice. Available exits: ${scene().exits.map(e=>e.label).join(', ')}. Your location and time remain unchanged.`,'bad');render();return;
    }
    await localAction(action.kind,text);
  }

  function handleAction(event){
    if(aiBusy || pendingMove)return;
    const action=event.currentTarget.dataset.act;
    if(action==='move') return move(event.currentTarget.dataset.to);
    if(action==='director') return askDirector();
    if(['look','talk','explore','rest'].includes(action)) return localAction(action);
    if(action==='reset'){
      if(!window.confirm('Start this slice again? This replaces your saved character state and writing.'))return;
      state=freshState();input.value='';pendingMove=null;saveBlocked=false;saveWarning='';
      transcript.splice(0,transcript.length,{k:'narr',t:'Morning settles over Hollowmere.'},{k:'runtime',t:'Praxis reset the Hollowmere slice.',kind:'good'});render();
    }
  }

  function openAiSetup(message=''){$('#aiError').textContent=message;$('#token').value='';$('#aiModal').classList.add('open')}

  async function connectAI(){
    const token=$('#token').value.trim();$('#aiError').textContent='';
    if(!token){$('#aiError').textContent='Paste a Persistent API token first.';return}
    window.PraxisAI.setToken(token);
    try{
      const response=await window.PraxisAI.models();
      const select=$('#model');select.innerHTML='';
      const models=Array.isArray(response?.data)?response.data:[];
      if(!models.length){select.innerHTML='<option value="glm-4-6">glm-4-6</option>'}
      else models.forEach(item=>{const id=item?.id||item?.name;if(id){const option=document.createElement('option');option.value=id;option.textContent=id;select.appendChild(option)}});
      if([...select.options].some(x=>x.value==='glm-4-6')) select.value='glm-4-6';
      window.PraxisAI.setModel(select.value||'glm-4-6');
      rt(`NovelAI connected. Available models: ${models.length||'default model only'}.`,'good');
      $('#token').value='';$('#aiModal').classList.remove('open');render();
    }catch(error){window.PraxisAI.clearToken();$('#aiError').textContent=error.message;render()}
  }

  $('#send').onclick=()=>{
    const value=input.value.trim();if(!value||aiBusy||pendingMove)return;
    input.value='';
    if(state.mode==='full'){state.goal=value;rt('Character goal updated. Use Let AI act for one step.');render()}
    else freeText(value);
  };
  input.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();$('#send').click()}};
  input.oninput=()=>{saveSession();$('#send').disabled=aiBusy||Boolean(pendingMove)||!input.value.trim()};
  $('#controlMode').onchange=event=>{if(aiBusy||pendingMove)return;state.mode=event.target.value;render()};
  $('#aiStep').onclick=fullAI;
  $('#pauseAI').onclick=pauseAI;
  document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.panel').forEach(panel=>panel.classList.toggle('active',panel.id==='p-'+tab.dataset.panel))});
  $('#cancelRoll').onclick=()=>{pendingMove=null;$('#roll').classList.remove('open');render()};
  $('#rollBtn').onclick=resolveRoll;
  $('#aiSetup').onclick=()=>{if(!aiBusy)openAiSetup()};$('#closeAI').onclick=()=>$('#aiModal').classList.remove('open');$('#connectAI').onclick=connectAI;
  $('#disconnectAI').onclick=()=>{if(aiBusy)pauseAI();window.PraxisAI.clearToken();$('#token').value='';rt('NovelAI disconnected. The token was discarded from page memory.','ai');$('#aiModal').classList.remove('open');render()};
  $('#model').onchange=event=>window.PraxisAI.setModel(event.target.value);
  document.querySelectorAll('[data-mobile]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-mobile]').forEach(x=>x.classList.toggle('active',x===button));if(button.dataset.mobile==='chat')side.classList.remove('open');else{side.classList.add('open');document.querySelector(`[data-panel="${button.dataset.mobile}"]`)?.click()}});
  render();
})();
