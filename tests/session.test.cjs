const assert = require('node:assert/strict');
const {test} = require('node:test');
const Session = require('../prototype/praxis-session.js');
const scenes = {center:{name:'Hollowmere',exits:[{to:'market',label:'Market'},{to:'bakery',label:'Bakery'}]},market:{name:'Hollowmere · Market',exits:[{to:'center',label:'Return to Hollowmere'}]},bakery:{name:'Hollowmere · Bakery',exits:[{to:'center',label:'Return to Hollowmere'}]}};

test('travel precedes looking and preserves dialogue about destinations',()=>{
  assert.deepEqual(Session.classify('Go to the bakery and look around','center',scenes),{kind:'move',to:'bakery'});
  assert.deepEqual(Session.classify('I ask about the bakery','center',scenes),{kind:'talk'});
  assert.deepEqual(Session.classify('Go south and look for food','center',scenes),{kind:'unresolved-travel'});
  assert.deepEqual(Session.classify('Return to Hollowmere','market',scenes),{kind:'move',to:'center'});
  assert.deepEqual(Session.classify('I do not go to the bakery','center',scenes),{kind:'freeform'});
});

test('AI choices contain only exits from the current scene',()=>{
  assert.deepEqual(Session.choices('market',scenes).filter(a=>a.kind==='move').map(a=>a.to),['center']);
});

test('current input is included once even when a story milestone follows it',()=>{
  const turns=[{k:'narr',t:'Before'},{k:'player',t:'Go back'},{k:'runtime',t:'move'},{k:'narr',t:'Milestone'}];
  assert.equal(Session.history(turns,'Go back').filter(t=>t.content==='Go back').length,0);
  assert.equal(Session.history(turns).filter(t=>t.content==='Go back').length,1);
  assert.equal(turns.length,4);
});

test('save validation rejects incompatible or broken state and preserves the draft',()=>{
  const data={schema:1,state:{location:'center',minutes:480,fatigue:0,maxFatigue:10,health:10,maxHealth:10,turn:1,mode:'assisted',goal:'',inventory:[],visited:['center'],aiTask:null,lastRoll:null,story:{title:'Morning',phase:'arrival',status:'active',goals:{market:false,bakery:false,return:false}}},transcript:[],draft:'My unfinished\nwriting'};
  assert.equal(Session.decode(JSON.stringify(data),scenes).draft,data.draft);
  data.state.health=500;
  assert.throws(()=>Session.decode(JSON.stringify(data),scenes));
  data.state.health=10;data.state.location='unmapped';
  assert.throws(()=>Session.decode(JSON.stringify(data),scenes));
  assert.throws(()=>Session.decode('{broken',scenes));
});
