/* Session and intent helpers for the existing browser prototype. */
(function(root) {
  const MODES = {
    manual: {label:'Manual', hint:'Write your actions and dialogue. AI responds as the world and other characters.', placeholder:'Write what you do or say…'},
    assisted: {label:'Assisted AI', hint:'Give an intention. AI fills in the details and leaves important choices to you.', placeholder:'Give an intention, such as “Go to the market and look around”…'},
    full: {label:'Full AI', hint:'Give a goal. Let AI choose one action at a time; take over whenever you want.', placeholder:'What should your character try to achieve?'}
  };
  const STORAGE_KEY = 'hw-praxis-session-v1';
  function classify(text, location, scenes) {
    const q = text.trim().toLowerCase();
    // Dialogue about a place is not a request to travel there. Travel has precedence
    // over incidental verbs such as "look" in "go to the bakery and look around".
    const travel = /^(?:i\s+)?(?:go|head|walk|travel|move|return|leave|enter|visit)\b/.test(q);
    if(travel) {
      const exits = scenes[location].exits;
      const named = exits.find(e => q.includes(scenes[e.to].name.toLowerCase().split(' · ').pop()) ||
        (e.to === 'center' && /\b(back|return|center|hollowmere)\b/.test(q)));
      if(named) return {kind:'move', to:named.to};
      return {kind:'unresolved-travel'};
    }
    if(/^(?:i\s+)?(?:rest|sit|relax)\b/.test(q)) return {kind:'rest'};
    if(/^(?:i\s+)?(?:look|inspect|observe)\b/.test(q)) return {kind:'look'};
    if(/^(?:i\s+)?(?:explore|search|wander)\b/.test(q)) return {kind:'explore'};
    if(/^(?:i\s+)?(?:talk|ask|tell|say|speak)\b/.test(q)) return {kind:'talk'};
    return {kind:'freeform'};
  }
  function choices(location, scenes) {
    return [
      {key:'look',kind:'look',description:'Look around the current scene'},
      {key:'talk',kind:'talk',description:'Talk to someone present'},
      {key:'explore',kind:'explore',description:'Explore the current scene'},
      {key:'rest',kind:'rest',description:'Rest and recover energy'},
      ...scenes[location].exits.map(e=>({key:`move-${e.to}`,kind:'move',to:e.to,description:`Travel to ${e.label}`}))
    ];
  }
  function decode(raw, scenes) {
    const data = JSON.parse(raw);
    const s = data?.state;
    if(data?.schema !== 1 || !s || !Object.hasOwn(scenes,s.location) || !Object.hasOwn(MODES,s.mode)) throw new Error('Unsupported saved session.');
    for(const key of ['minutes','fatigue','health','turn']) {
      if(!Number.isFinite(s[key]) || s[key] < 0) throw new Error('Invalid saved character state.');
    }
    if(!Number.isInteger(s.turn) || s.turn < 1 || !Number.isInteger(s.minutes) ||
      s.maxFatigue !== 10 || s.maxHealth !== 10 || s.fatigue > 10 || s.health > 10 ||
      !Array.isArray(s.inventory) || !Array.isArray(s.visited) || s.visited.some(id=>!Object.hasOwn(scenes,id)) ||
      !s.story || !s.story.goals || ['market','bakery','return'].some(k=>typeof s.story.goals[k] !== 'boolean')) {
      throw new Error('Invalid saved character state.');
    }
    if(typeof s.goal !== 'string' || typeof data.draft !== 'string' || !Array.isArray(data.transcript) ||
      data.transcript.some(t=>!['player','narr','runtime'].includes(t.k) || typeof t.t !== 'string')) {
      throw new Error('Invalid saved writing.');
    }
    if(s.lastRoll !== null && (!s.lastRoll || !Number.isFinite(s.lastRoll.total) || !Number.isFinite(s.lastRoll.dc))) {
      throw new Error('Invalid saved roll.');
    }
    if(s.aiTask !== null && (!s.aiTask || ['title','briefing','objectiveKey'].some(k=>typeof s.aiTask[k] !== 'string'))) {
      throw new Error('Invalid saved task.');
    }
    if(typeof s.story.title !== 'string' || !['arrival','exploration','complete','late-morning'].includes(s.story.phase) ||
      !['active','complete'].includes(s.story.status)) throw new Error('Invalid saved story.');
    return data;
  }
  function history(transcript, currentInput='') {
    // The current input is sent separately. Never duplicate it in history.
    const turns = transcript.filter(t=>t.k==='player'||t.k==='narr');
    const lastPlayer = turns.findLastIndex(t=>t.k==='player');
    if(currentInput && lastPlayer >= 0 && turns[lastPlayer].t === currentInput) turns.splice(lastPlayer,1);
    return turns.slice(-12).map(t=>({role:t.k==='player'?'user':'assistant',content:t.t}));
  }
  const api = {MODES, STORAGE_KEY, classify, choices, decode, history};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PraxisSession = api;
})(typeof window === 'undefined' ? globalThis : window);
