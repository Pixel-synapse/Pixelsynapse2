/**
 * Pixel Synapse — Extended Multiplayer Server
 * Economy · Jobs · NPC AI · Shop · Reputation · Gossip
 * Stack: Express + Socket.io  |  Run: node server/server.js
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, '../client')));

const WORLD_W = 800;
const WORLD_H = 600;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const COLORS = ['#4fc3f7','#81c784','#ffb74d','#f06292','#ce93d8','#80cbc4','#fff176','#ff8a65'];
const ADJS   = ['Swift','Bold','Keen','Calm','Bright','Wild','Shy','Sharp'];
const NOUNS  = ['Fox','Wolf','Hawk','Bear','Lynx','Raven','Otter','Pike'];
const randColor = () => pick(COLORS);
const randName  = () => pick(ADJS) + pick(NOUNS);

// ─────────────────────────────────────────────
// PLAYER STATE
// { id, x, y, name, color, coins, reputation, hat }
// ─────────────────────────────────────────────
const players = {};

// ─────────────────────────────────────────────
// NPC DEFINITIONS
// ─────────────────────────────────────────────
const NPCS = {
  mira: {
    id:'mira', name:'Mira', role:'shopkeeper', color:'#E8A598',
    x:140, y:110, homeX:140, homeY:110, mood:'happy',
    lines:{
      happy:  ["Welcome! Browse my wares.","Great day for business!","Can I interest you in something?"],
      neutral:["Hello there.","What can I do for you?","Looking for something?"],
      grumpy: ["Hmm. What do you want.","Don't waste my time.","..."],
    },
    gossip:{
      high:   ["That one? Very trustworthy — I've heard great things.","They helped someone earlier. Decent person."],
      low:    ["Watch your pockets around that one.","I've heard they've been causing trouble lately."],
      neutral:["New around here, are they?","Haven't heard much about them yet."],
    },
    memory:[],
  },
  kai: {
    id:'kai', name:'Kai', role:'worker', color:'#44aaff',
    x:620, y:190, homeX:620, homeY:190, mood:'neutral',
    lines:{
      happy:  ["Need a job? I've got work!","Good to see a reliable face.","You're exactly who I needed."],
      neutral:["Got a job for you if you want.","Work's steady. Interested?","Hey — want to earn some coins?"],
      grumpy: ["Not sure you're up for this.","Last person let me down.","Fine. But don't mess it up."],
    },
    gossip:{
      high:   ["They completed a job for me. Solid worker.","Dependable. I'd hire them again without hesitation."],
      low:    ["Unreliable type, if you ask me.","They look like trouble."],
      neutral:["Can't say I know them well yet.","They seem alright, I suppose."],
    },
    memory:[],
  },
  sol: {
    id:'sol', name:'Sol', role:'gossip', color:'#ffcc44',
    x:400, y:300, homeX:400, homeY:300, mood:'happy',
    lines:{
      happy:  ["Oh! Did you hear the latest?","Sit down! I have stories.","You won't believe what I just saw!"],
      neutral:["Hello. Heard anything interesting?","The town's been quiet... mostly.","Got a minute to chat?"],
      grumpy: ["Not now. I'm thinking.","...leave me alone.","Ugh. What."],
    },
    gossip:{
      high:   ["Everyone's talking about them — in a good way!","Word is they're one of the good ones around here."],
      low:    ["Between you and me? Trouble.","I've been hearing things. Not good things at all."],
      neutral:["Fresh face. The jury's still out.","Could go either way with that one."],
    },
    memory:[],
  },
  bram: {
    id:'bram', name:'Bram', role:'guard', color:'#8D6E63',
    x:80, y:400, homeX:80, homeY:400, mood:'neutral',
    lines:{
      happy:  ["All clear! Good day to you.","Town's safe. Thanks to people like you.","Keep up the good work."],
      neutral:["Stay out of trouble.","Move along.","Everything in order?"],
      grumpy: ["HALT. State your business.","I'm watching you.","Don't try anything."],
    },
    gossip:{
      high:   ["Upstanding citizen. I've verified it personally.","No record of trouble. Good standing."],
      low:    ["I've got my eye on that one.","They're on my watch list."],
      neutral:["Nothing to report. Yet.","Standard check. Move along."],
    },
    memory:[],
  },
  ivy: {
    id:'ivy', name:'Ivy', role:'trader', color:'#81C784',
    x:660, y:480, homeX:660, homeY:480, mood:'happy',
    lines:{
      happy:  ["Fresh goods today!","Every flower has a story.","Come, take a look!"],
      neutral:["What are you looking for?","Herbs, seeds, flowers — all here.","Good day."],
      grumpy: ["These aren't cheap, you know.","Handle with care.","...fine, look around."],
    },
    gossip:{
      high:   ["They bought from me fairly. Good person.","I like them. Honest eyes."],
      low:    ["Something's off about that one.","My plants wilt when they're near. Strange."],
      neutral:["Never bought anything. Browsed once.","Quiet type. Hard to read."],
    },
    memory:[],
  },
};

// ─────────────────────────────────────────────
// SHOP ITEMS (available from shopkeeper + trader)
// ─────────────────────────────────────────────
const SHOP_ITEMS = [
  { id:'hat',       name:'🎩 Top Hat',       price:10, desc:'A distinguished hat.' },
  { id:'color_red', name:'🔴 Red Tint',       price:5,  desc:'Change your colour.',  colorVal:'#ff4444' },
  { id:'color_blu', name:'🔵 Blue Tint',      price:5,  desc:'Change your colour.',  colorVal:'#44aaff' },
  { id:'color_grn', name:'🟢 Green Tint',     price:5,  desc:'Change your colour.',  colorVal:'#44ff88' },
  { id:'color_pur', name:'🟣 Purple Tint',    price:5,  desc:'Change your colour.',  colorVal:'#cc88ff' },
  { id:'rep_boost', name:'⭐ Reputation +5', price:25, desc:'Buy goodwill in town.' },
];

// ─────────────────────────────────────────────
// JOB DEFINITIONS
// ─────────────────────────────────────────────
const JOB_POOL = [
  { id:'j_mira', label:'Deliver a message to Mira',  desc:'Find Mira and press E.',        target:'mira', reward:{ coins:15, rep:2 } },
  { id:'j_ivy',  label:'Take a package to Ivy',      desc:'Find Ivy and press E.',          target:'ivy',  reward:{ coins:12, rep:2 } },
  { id:'j_bram', label:'Report in to Bram',          desc:'Find Bram the guard and press E.',target:'bram', reward:{ coins:10, rep:3 } },
  { id:'j_sol',  label:'Bring news to Sol',          desc:'Find Sol in the square.',        target:'sol',  reward:{ coins:8,  rep:2 } },
  { id:'j_wait', label:'Guard the fountain (10s)',   desc:'Stand by the fountain for 10s.', target:null,   reward:{ coins:20, rep:1 },
    zone:{ x:400, y:300, r:55 }, timedSec:10 },
];

const activeJobs = {};  // socketId → { job, startedAt, waitStart }

function assignJob(socketId) {
  if (activeJobs[socketId]) return activeJobs[socketId].job;
  const job = pick(JOB_POOL);
  activeJobs[socketId] = { job, startedAt: Date.now(), waitStart: null };
  return job;
}

function completeJob(socketId) {
  const entry = activeJobs[socketId];
  if (!entry) return null;
  const { job } = entry;
  delete activeJobs[socketId];
  const p = players[socketId];
  if (!p) return null;
  p.coins      = (p.coins      || 0) + job.reward.coins;
  p.reputation = (p.reputation || 0) + job.reward.rep;
  return { job, newCoins: p.coins, newRep: p.reputation };
}

// ─────────────────────────────────────────────
// NPC INTERACTION
// Returns dialogue + optional job + optional shop flag
// ─────────────────────────────────────────────
function handleNpcInteract(socketId, npcId) {
  const npc = NPCS[npcId];
  const p   = players[socketId];
  if (!npc || !p) return null;

  const rep = p.reputation || 0;

  // Pick mood-appropriate line, shifted by reputation
  let moodKey = npc.mood;
  if (rep >= 10 && moodKey !== 'happy')  moodKey = 'happy';
  if (rep <= -5  && moodKey !== 'grumpy') moodKey = 'grumpy';
  const line = pick(npc.lines[moodKey] || npc.lines.neutral);

  // Memory
  npc.memory.push({ player: p.name, at: Date.now() });
  if (npc.memory.length > 20) npc.memory.shift();

  // Gossip — 35% chance this NPC gossips about the player to nearby others
  let gossipText = null;
  if (Math.random() < 0.35) {
    const tier = rep >= 10 ? 'high' : rep <= -5 ? 'low' : 'neutral';
    gossipText = pick(npc.gossip[tier]);
  }

  // Job offer (worker / guard roles, player has no active job)
  let jobOffer = null;
  if ((npc.role === 'worker' || npc.role === 'guard') && !activeJobs[socketId]) {
    jobOffer = assignJob(socketId);
  }

  // Shop available from shopkeeper + trader
  const shopAvail = npc.role === 'shopkeeper' || npc.role === 'trader';

  return { npcId, npcName: npc.name, mood: npc.mood, line, jobOffer, shopAvail, gossipText };
}

// ─────────────────────────────────────────────
// NPC WORLD TICKS
// ─────────────────────────────────────────────

// Mood shifts based on average town reputation
function tickMoods() {
  const pArr = Object.values(players);
  const avg  = pArr.length
    ? pArr.reduce((s, p) => s + (p.reputation || 0), 0) / pArr.length : 0;
  for (const npc of Object.values(NPCS)) {
    const r = Math.random();
    if      (avg >  15) npc.mood = r < 0.65 ? 'happy'   : 'neutral';
    else if (avg < -10) npc.mood = r < 0.60 ? 'grumpy'  : 'neutral';
    else                npc.mood = r < 0.40 ? 'happy' : r < 0.75 ? 'neutral' : 'grumpy';
  }
}

// NPCs wander within a radius of their home position
function tickMovement() {
  for (const npc of Object.values(NPCS)) {
    const dx = Math.round((Math.random() - 0.5) * 90);
    const dy = Math.round((Math.random() - 0.5) * 70);
    npc.x = clamp(npc.homeX + dx, 20, WORLD_W - 20);
    npc.y = clamp(npc.homeY + dy, 20, WORLD_H - 20);
  }
  io.emit('npcPositions', Object.values(NPCS).map(n => ({
    id: n.id, x: n.x, y: n.y, mood: n.mood,
  })));
}

// Random NPC ambient speech
function tickSpeech() {
  const npc  = pick(Object.values(NPCS));
  const line = pick(npc.lines[npc.mood] || npc.lines.neutral);
  io.emit('npcSpeech', { id: npc.id, name: npc.name, text: line });
}

setInterval(tickMoods,    18000);  // mood shifts every 18s
setInterval(tickMovement,  6000);  // NPCs wander every 6s
setInterval(tickSpeech,    9000);  // ambient speech every 9s

// ─────────────────────────────────────────────
// SOCKET
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
  // ── JOIN ──
  const player = {
    id:         socket.id,
    x:          100 + Math.floor(Math.random() * (WORLD_W - 200)),
    y:          100 + Math.floor(Math.random() * (WORLD_H - 200)),
    color:      randColor(),
    name:       randName(),
    coins:      50,
    reputation: 0,
    hat:        false,
  };
  players[socket.id] = player;
  console.log(`[+] ${player.name} joined (${Object.keys(players).length} online)`);

  socket.emit('init', {
    player,
    players,
    npcs:      Object.values(NPCS).map(n => ({ id:n.id, name:n.name, color:n.color, role:n.role, x:n.x, y:n.y, mood:n.mood })),
    shopItems: SHOP_ITEMS,
  });
  socket.broadcast.emit('newPlayer', player);

  // ── MOVEMENT + TIMED JOB CHECK ──
  socket.on('playerMovement', (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = Math.round(clamp(data.x, 8, WORLD_W - 8));
    p.y = Math.round(clamp(data.y, 8, WORLD_H - 8));
    socket.broadcast.emit('playerMoved', { id: socket.id, x: p.x, y: p.y });

    // Timed zone job (fountain guard)
    const pj = activeJobs[socket.id];
    if (pj?.job?.zone) {
      const z  = pj.job.zone;
      const inZone = Math.hypot(p.x - z.x, p.y - z.y) < z.r;
      if (inZone) {
        if (!pj.waitStart) pj.waitStart = Date.now();
        else if (Date.now() - pj.waitStart >= pj.job.timedSec * 1000) {
          const result = completeJob(socket.id);
          if (result) {
            socket.emit('jobComplete', result);
            socket.broadcast.emit('playerStats', { id: socket.id, coins: p.coins, reputation: p.reputation });
          }
        }
      } else {
        pj.waitStart = null;
      }
    }
  });

  // ── NPC INTERACT ──
  socket.on('npcInteract', (npcId) => {
    const result = handleNpcInteract(socket.id, npcId);
    if (!result) return;
    socket.emit('npcResponse', result);

    // Spread gossip to nearby players
    if (result.gossipText) {
      const p = players[socket.id];
      for (const [sid, other] of Object.entries(players)) {
        if (sid === socket.id) continue;
        if (dist(p, other) < 350) {
          io.to(sid).emit('npcGossip', {
            npcName: result.npcName,
            about:   p.name,
            text:    result.gossipText,
          });
        }
      }
    }

    // Delivery job completion
    const pj = activeJobs[socket.id];
    if (pj && pj.job.target === npcId) {
      const result2 = completeJob(socket.id);
      if (result2) {
        socket.emit('jobComplete', result2);
        const p = players[socket.id];
        socket.broadcast.emit('playerStats', { id: socket.id, coins: p.coins, reputation: p.reputation });
      }
    }
  });

  // ── REQUEST JOB ──
  socket.on('requestJob', () => {
    if (activeJobs[socket.id]) {
      socket.emit('jobStatus', { current: activeJobs[socket.id].job });
      return;
    }
    const job = assignJob(socket.id);
    socket.emit('jobAssigned', { job });
  });

  // ── BUY ITEM ──
  socket.on('buyItem', ({ itemId }) => {
    const p    = players[socket.id];
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!p || !item) return socket.emit('buyResult', { ok:false, error:'Item not found' });
    if ((p.coins || 0) < item.price) return socket.emit('buyResult', { ok:false, error:'Not enough coins' });

    p.coins -= item.price;
    if (item.colorVal)          p.color = item.colorVal;
    if (item.id === 'hat')      p.hat   = true;
    if (item.id === 'rep_boost') p.reputation = (p.reputation || 0) + 5;

    socket.emit('buyResult', { ok:true, item, newCoins: p.coins, newRep: p.reputation, newColor: p.color });
    socket.broadcast.emit('playerStats', { id: socket.id, coins: p.coins, reputation: p.reputation, color: p.color });
  });

  // ── CHAT ──
  socket.on('chatMessage', (text) => {
    if (!text || typeof text !== 'string') return;
    const safe = text.slice(0, 120).replace(/</g, '&lt;');
    io.emit('chatMessage', { id: socket.id, name: players[socket.id]?.name || '?', text: safe });

    // Spam detection — minor rep hit if many messages quickly
    const p = players[socket.id];
    if (p) {
      p._lastMsgs = (p._lastMsgs || []).filter(t => Date.now() - t < 5000);
      p._lastMsgs.push(Date.now());
      if (p._lastMsgs.length >= 6) {
        p.reputation = (p.reputation || 0) - 1;
        socket.emit('repUpdate', { reputation: p.reputation, delta: -1, reason: 'Spamming chat' });
      }
    }
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    console.log(`[-] ${players[socket.id]?.name} left`);
    delete players[socket.id];
    delete activeJobs[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮  Pixel Synapse → http://localhost:${PORT}`));
