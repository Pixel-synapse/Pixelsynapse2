/**
 * Pixel Synapse — Extended Client
 * Economy · Jobs · NPC AI · Shop · Reputation · Gossip
 */

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const WORLD_W     = 800;
const WORLD_H     = 600;
const PLAYER_SIZE = 14;
const NPC_SIZE    = 13;
const SPEED       = 180;
const SEND_RATE   = 40;
const LERP        = 0.18;
const INTERACT_R  = 64;   // pixels to trigger E-interact

// ─────────────────────────────────────────────
// SOCKET
// ─────────────────────────────────────────────
const socket = io();   // auto-connects to same host

socket.on('connect', () => {
  document.getElementById('status').textContent = `Connected · ${socket.id.slice(0,8)}…`;
});
socket.on('disconnect', () => {
  document.getElementById('status').textContent = 'Disconnected — refresh to reconnect';
  document.getElementById('status').style.color = '#ff4444';
});

// ─────────────────────────────────────────────
// LOCAL STATE
// ─────────────────────────────────────────────
let myId    = null;
let myCoins = 50;
let myRep   = 0;
let myName  = '—';
let activeJob   = null;   // current job object
let jobWaitStart= null;   // for timed zone jobs
let shopItems   = [];     // received from server
let dialogueOpen= false;
let shopOpen    = false;

// ─────────────────────────────────────────────
// HUD helpers
// ─────────────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-name').textContent  = myName;
  document.getElementById('hud-coins').textContent = `◈ ${myCoins} coins`;
  document.getElementById('hud-rep').textContent   = `★ ${myRep} rep`;
}

function setJobHUD(job) {
  const el = document.getElementById('job-panel');
  if (!job) {
    el.style.display = 'none';
    document.getElementById('hud-job').textContent = 'No active job';
    return;
  }
  el.style.display = 'block';
  document.getElementById('hud-job').textContent   = job.label;
  document.getElementById('job-label').textContent = job.label;
  document.getElementById('job-desc').textContent  = job.desc;
  document.getElementById('job-timer').textContent = '';
}

// Floating reward popup above a screen position
function floatReward(text, color, x, y) {
  const wrap = document.getElementById('game-wrap');
  const el   = document.createElement('div');
  el.className   = 'float-popup';
  el.textContent = text;
  el.style.color = color;
  el.style.left  = (x - 20) + 'px';
  el.style.top   = (y - 30) + 'px';
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

// Log line in chat panel
function chatLog(html, cls) {
  const log  = document.getElementById('chat-log');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.innerHTML = html;
  log.appendChild(line);
  while (log.children.length > 60) log.children[0].remove();
  log.scrollTop = log.scrollHeight;
}

// ─────────────────────────────────────────────
// SHOP UI
// ─────────────────────────────────────────────
function openShop() {
  if (dialogueOpen) closeDialogue();
  shopOpen = true;
  const panel = document.getElementById('shop-panel');
  panel.style.display = 'block';
  document.getElementById('shop-coins').textContent = `◈ ${myCoins} coins available`;
  const list = document.getElementById('shop-items');
  list.innerHTML = shopItems.map(item => `
    <div class="shop-item">
      <span class="shop-item-name">${item.name}</span>
      <span>
        <span class="shop-item-price">${item.price}c</span>
        <button class="shop-buy" onclick="doBuy('${item.id}')"
          ${myCoins < item.price ? 'disabled' : ''}>BUY</button>
      </span>
    </div>`).join('');
}

function closeShop() {
  shopOpen = false;
  document.getElementById('shop-panel').style.display = 'none';
}

function doBuy(itemId) {
  socket.emit('buyItem', { itemId });
}

// ─────────────────────────────────────────────
// DIALOGUE UI
// ─────────────────────────────────────────────
function openDialogue(npcName, line, jobOffer, shopAvail) {
  dialogueOpen = true;
  document.getElementById('dialogue-box').style.display = 'block';
  document.getElementById('dialogue-npc').textContent   = npcName.toUpperCase();
  document.getElementById('dialogue-text').textContent  = line;

  const btns = document.getElementById('dialogue-btns');
  btns.innerHTML = '';

  if (jobOffer) {
    const b = document.createElement('button');
    b.className = 'dlg-btn job';
    b.textContent = `▸ Accept: ${jobOffer.label}`;
    b.onclick = () => { activeJob = jobOffer; setJobHUD(jobOffer); closeDialogue();
      chatLog(`<span class="cs">Job accepted: ${jobOffer.label}</span>`); };
    btns.appendChild(b);
  }

  if (shopAvail) {
    const b = document.createElement('button');
    b.className = 'dlg-btn shop';
    b.textContent = '⚑ Open Shop';
    b.onclick = () => { closeDialogue(); openShop(); };
    btns.appendChild(b);
  }

  const close = document.createElement('button');
  close.className = 'dlg-btn close';
  close.textContent = 'ESC';
  close.onclick = closeDialogue;
  btns.appendChild(close);
}

function closeDialogue() {
  dialogueOpen = false;
  document.getElementById('dialogue-box').style.display = 'none';
}

// ESC key
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (shopOpen)    { closeShop();    return; }
    if (dialogueOpen){ closeDialogue();return; }
  }
});

// ─────────────────────────────────────────────
// PHASER SCENE
// ─────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  create() {
    this._buildWorld();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd    = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W, down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A, right: Phaser.Input.Keyboard.KeyCodes.D,
    });
    this.eKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // Phaser objects
    this.myPlayer     = null;
    this.myNameTag    = null;
    this._myBubble    = null;
    this.otherPlayers = {};  // id → { sprite, nameTag, bubble, targetX, targetY }
    this.npcSprites   = {};  // npcId → { sprite, nameTag, bubble }
    this._lastSend    = 0;
    this._nearbyNpc   = null;  // id of NPC in interact range

    this._bindSocket();
    this._bindChat();
  }

  // ── World ──────────────────────────────────
  _buildWorld() {
    const g = this.add.graphics();
    g.fillStyle(0x08080f); g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.lineStyle(1, 0x0e0e20, 0.5);
    for (let x = 0; x <= WORLD_W; x += 32) g.lineBetween(x, 0, x, WORLD_H);
    for (let y = 0; y <= WORLD_H; y += 32) g.lineBetween(0, y, WORLD_W, y);

    // Town square
    g.fillStyle(0x14121e); g.fillRect(280, 200, 240, 200);
    g.lineStyle(1, 0x2a2840); g.strokeRect(280, 200, 240, 200);

    // Fountain (timed job zone)
    g.fillStyle(0x1a2a3a); g.fillCircle(400, 300, 30);
    g.fillStyle(0x88ccff, 0.35); g.fillCircle(400, 300, 20);
    this.add.text(400, 274, '⛲ FOUNTAIN', { fontSize:'7px', fontFamily:'Courier New', color:'#1a2a3a' }).setOrigin(0.5);

    // Roads
    g.fillStyle(0x10101a);
    g.fillRect(0, WORLD_H/2 - 14, WORLD_W, 28);
    g.fillRect(WORLD_W/2 - 14, 0, 28, WORLD_H);

    // Corner zones
    const zones = [
      { x:10,  y:10,  w:120, h:85,  col:0x181824, lbl:'WORKSHOP', sub:'[Kai - Jobs]'  },
      { x:10,  y:505, w:110, h:85,  col:0x18180d, lbl:'CAFÉ',     sub:'[Mira - Shop]' },
      { x:670, y:10,  w:120, h:85,  col:0x141a14, lbl:'MARKET',   sub:'[Ivy - Trade]' },
      { x:670, y:505, w:120, h:85,  col:0x1a1418, lbl:'TOWN HALL',sub:'[Bram]'        },
    ];
    zones.forEach(z => {
      g.fillStyle(z.col); g.fillRect(z.x, z.y, z.w, z.h);
      g.lineStyle(1, 0x2a2840); g.strokeRect(z.x, z.y, z.w, z.h);
      this.add.text(z.x + z.w/2, z.y + z.h/2 - 6, z.lbl, { fontSize:'8px', fontFamily:'Courier New', color:'#2a2840' }).setOrigin(0.5);
      this.add.text(z.x + z.w/2, z.y + z.h/2 + 7, z.sub, { fontSize:'6px', fontFamily:'Courier New', color:'#1e1e2e' }).setOrigin(0.5);
    });

    this.add.text(WORLD_W/2, 180, 'PIXEL SYNAPSE', { fontSize:'10px', fontFamily:'Courier New', color:'#181828', letterSpacing:4 }).setOrigin(0.5);
  }

  // ── Sprite factories ────────────────────────
  _makePlayerSprite(x, y, color, isMe) {
    const col = Phaser.Display.Color.HexStringToColor(color).color;
    const g   = this.add.graphics();
    g.fillStyle(col); g.fillRect(-PLAYER_SIZE/2, -PLAYER_SIZE/2, PLAYER_SIZE, PLAYER_SIZE);
    g.fillStyle(0xffffff, 0.15); g.fillRect(-PLAYER_SIZE/2+2, -PLAYER_SIZE/2+2, PLAYER_SIZE-4, 4);
    g.lineStyle(isMe ? 2 : 1, isMe ? 0xffffff : col, isMe ? 0.9 : 0.45);
    g.strokeRect(-PLAYER_SIZE/2, -PLAYER_SIZE/2, PLAYER_SIZE, PLAYER_SIZE);
    const key = `pl_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    g.generateTexture(key, PLAYER_SIZE + 4, PLAYER_SIZE + 4); g.destroy();
    const spr = this.physics.add.sprite(x, y, key);
    spr.setCollideWorldBounds(true).setDepth(10);
    return spr;
  }

  _makeNpcSprite(npc) {
    const col = Phaser.Display.Color.HexStringToColor(npc.color || '#aabbff').color;
    const g   = this.add.graphics();
    // Diamond shape for NPCs
    g.fillStyle(col);
    g.fillTriangle(0, -NPC_SIZE/2, -NPC_SIZE/2, NPC_SIZE/2, NPC_SIZE/2, NPC_SIZE/2);
    g.fillTriangle(0, NPC_SIZE/2, -NPC_SIZE/2, -NPC_SIZE/2, NPC_SIZE/2, -NPC_SIZE/2);
    g.lineStyle(1, col, 0.5);
    g.strokeRect(-NPC_SIZE/2, -NPC_SIZE/2, NPC_SIZE, NPC_SIZE);
    const key = `npc_${npc.id}`;
    g.generateTexture(key, NPC_SIZE + 4, NPC_SIZE + 4); g.destroy();
    const spr = this.add.image(npc.x, npc.y, key).setDepth(8);
    return spr;
  }

  _makeTag(sprite, text, color, depth = 11) {
    return this.add.text(sprite.x, sprite.y - PLAYER_SIZE - 5, text, {
      fontSize:'8px', fontFamily:'Courier New', color, stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5, 1).setDepth(depth);
  }

  _makeBubble(x, y, text) {
    return this.add.text(x, y - PLAYER_SIZE - 22, text, {
      fontSize:'9px', fontFamily:'Courier New', color:'#ccdde8',
      backgroundColor:'#0a0a14', padding:{x:5, y:3}, stroke:'#1a1a2a', strokeThickness:1,
    }).setOrigin(0.5, 1).setDepth(13);
  }

  // ── Socket bindings ─────────────────────────
  _bindSocket() {
    // Init — receive self + world
    socket.on('init', ({ player, players, npcs, shopItems: items }) => {
      myId    = player.id;
      myCoins = player.coins;
      myRep   = player.reputation;
      myName  = player.name;
      shopItems = items;
      updateHUD();

      // Spawn self
      this.myPlayer  = this._makePlayerSprite(player.x, player.y, '#44ff88', true);
      this.myNameTag = this._makeTag(this.myPlayer, player.name + ' ◀', '#ffffff');

      // Spawn other players
      for (const [id, p] of Object.entries(players)) {
        if (id !== myId) this._addOtherPlayer(p);
      }
      document.getElementById('player-count').textContent = `● ${Object.keys(players).length} online`;

      // Spawn NPCs
      for (const npc of npcs) this._spawnNpc(npc);

      chatLog(`<span class="cs">· Welcome, ${player.name}! You have ${player.coins} coins.</span>`);
    });

    socket.on('newPlayer', p => {
      this._addOtherPlayer(p);
      const n = Object.keys(this.otherPlayers).length + 1;
      document.getElementById('player-count').textContent = `● ${n} online`;
      chatLog(`<span class="cs">· ${p.name} joined</span>`);
    });

    socket.on('playerMoved', ({ id, x, y }) => {
      const op = this.otherPlayers[id];
      if (op) { op.targetX = x; op.targetY = y; }
    });

    socket.on('playerDisconnected', id => {
      const op = this.otherPlayers[id];
      if (op) {
        chatLog(`<span class="cs">· ${op.name} left</span>`);
        op.sprite?.destroy(); op.nameTag?.destroy(); op.bubble?.destroy();
        delete this.otherPlayers[id];
        const n = Object.keys(this.otherPlayers).length + 1;
        document.getElementById('player-count').textContent = `● ${n} online`;
      }
    });

    // playerStats — coins/rep/color updated for another player
    socket.on('playerStats', ({ id, coins, reputation, color }) => {
      if (id === myId) {
        myCoins = coins ?? myCoins;
        myRep   = reputation ?? myRep;
        updateHUD();
      } else {
        const op = this.otherPlayers[id];
        if (op && color && color !== op.color) {
          // Respawn sprite with new color
          op.sprite?.destroy(); op.nameTag?.destroy();
          op.sprite  = this._makePlayerSprite(op.targetX, op.targetY, color, false);
          op.nameTag = this._makeTag(op.sprite, op.name, color);
          op.color   = color;
        }
      }
    });

    // NPC positions tick
    socket.on('npcPositions', (list) => {
      for (const { id, x, y, mood } of list) {
        const entry = this.npcSprites[id];
        if (!entry) continue;
        // Tween to new position
        this.tweens.add({ targets: entry.sprite, x, y, duration: 1200, ease: 'Sine.easeInOut' });
        entry.x = x; entry.y = y;
        // Mood indicator color on name tag
        const moodCol = mood === 'happy' ? '#44ff88' : mood === 'grumpy' ? '#ff6644' : '#aabbff';
        entry.nameTag?.setColor(moodCol);
      }
    });

    // NPC ambient speech bubble
    socket.on('npcSpeech', ({ id, name, text }) => {
      const entry = this.npcSprites[id];
      if (!entry) return;
      this._showNpcBubble(id, text);
      chatLog(`<span style="color:#aabbff;">${name}:</span> <span class="cs">${text}</span>`);
    });

    // NPC response to E-interact
    socket.on('npcResponse', ({ npcId, npcName, mood, line, jobOffer, shopAvail }) => {
      openDialogue(npcName, line, jobOffer, shopAvail);
      if (jobOffer) activeJob = null; // will be set when accepted
    });

    // NPC gossip heard by nearby players
    socket.on('npcGossip', ({ npcName, about, text }) => {
      chatLog(`<span class="cg">· ${npcName} (about ${about}): "${text}"</span>`);
    });

    // Job assigned / status
    socket.on('jobAssigned', ({ job }) => {
      activeJob = job; setJobHUD(job);
      chatLog(`<span class="cs">· Job assigned: ${job.label}</span>`);
    });
    socket.on('jobStatus', ({ current }) => {
      activeJob = current; setJobHUD(current);
    });

    // Job complete — reward!
    socket.on('jobComplete', ({ job, newCoins, newRep }) => {
      const old = myCoins;
      myCoins = newCoins; myRep = newRep;
      activeJob = null; setJobHUD(null); updateHUD();

      // Float rewards over player
      const sp = this.myPlayer;
      if (sp) {
        floatReward(`+${job.reward.coins} coins`, '#ffcc44', sp.x, sp.y);
        floatReward(`+${job.reward.rep} rep`, '#44ff88', sp.x + 30, sp.y - 10);
      }
      chatLog(`<span class="cs">· Job complete! +${job.reward.coins} coins +${job.reward.rep} rep</span>`);
    });

    // Buy result
    socket.on('buyResult', ({ ok, item, newCoins, newRep, newColor, error }) => {
      if (!ok) { chatLog(`<span style="color:#ff4444">· ${error}</span>`); return; }
      myCoins = newCoins; myRep = newRep ?? myRep; updateHUD();
      if (newColor) {
        // Update own sprite color
        const sp = this.myPlayer;
        if (sp) {
          const x = sp.x, y = sp.y;
          sp.destroy(); this.myNameTag?.destroy();
          this.myPlayer  = this._makePlayerSprite(x, y, newColor, true);
          this.myNameTag = this._makeTag(this.myPlayer, myName + ' ◀', '#ffffff');
        }
      }
      closeShop();
      floatReward(`Bought ${item.name}`, '#ffcc44', this.myPlayer?.x ?? 400, this.myPlayer?.y ?? 300);
      chatLog(`<span class="cs">· Bought ${item.name} for ${item.price} coins</span>`);
      document.getElementById('shop-coins').textContent = `◈ ${myCoins} coins available`;
    });

    // Reputation update (spam penalty etc.)
    socket.on('repUpdate', ({ reputation, delta, reason }) => {
      myRep = reputation; updateHUD();
      chatLog(`<span style="color:#ff6644">· Rep ${delta} (${reason})</span>`);
    });

    // Chat
    socket.on('chatMessage', ({ id, name, text }) => {
      const isMe = id === myId;
      chatLog(`<span class="${isMe ? 'cn' : ''}" style="color:${isMe?'#44ff88':'#4fc3f7'}">${name}:</span> <span class="ct">${text}</span>`);
      if (isMe) this._showPlayerBubble('me', this.myPlayer, text);
      else {
        const op = this.otherPlayers[id];
        if (op) this._showPlayerBubble(id, op.sprite, text);
      }
    });
  }

  // ── NPC spawning ────────────────────────────
  _spawnNpc(npc) {
    const sprite  = this._makeNpcSprite(npc);
    const nameTag = this.add.text(npc.x, npc.y - NPC_SIZE - 5, npc.name, {
      fontSize:'8px', fontFamily:'Courier New', color: npc.color || '#aabbff',
      stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5, 1).setDepth(9);
    const roleTag = this.add.text(npc.x, npc.y - NPC_SIZE - 14, `[${npc.role}]`, {
      fontSize:'6px', fontFamily:'Courier New', color:'#334',
      stroke:'#000', strokeThickness:1,
    }).setOrigin(0.5, 1).setDepth(9);
    this.npcSprites[npc.id] = { sprite, nameTag, roleTag, bubble:null, x: npc.x, y: npc.y, id: npc.id, name: npc.name };
  }

  _showNpcBubble(npcId, text) {
    const entry = this.npcSprites[npcId];
    if (!entry) return;
    entry.bubble?.destroy();
    const bub = this._makeBubble(entry.x, entry.y - 10, text);
    entry.bubble = bub;
    this.time.delayedCall(4000, () => { bub?.destroy(); if (entry.bubble === bub) entry.bubble = null; });
  }

  // ── Player management ───────────────────────
  _addOtherPlayer(p) {
    const sprite  = this._makePlayerSprite(p.x, p.y, p.color || '#4fc3f7', false);
    const nameTag = this._makeTag(sprite, p.name, p.color || '#4fc3f7');
    this.otherPlayers[p.id] = { sprite, nameTag, bubble:null, targetX:p.x, targetY:p.y, name:p.name, color:p.color };
  }

  _showPlayerBubble(id, sprite, text) {
    if (!sprite) return;
    const isMe  = id === 'me';
    const entry = isMe ? null : this.otherPlayers[id];
    const old   = isMe ? this._myBubble : entry?.bubble;
    old?.destroy();
    const bub = this._makeBubble(sprite.x, sprite.y, text);
    if (isMe) this._myBubble = bub;
    else if (entry) entry.bubble = bub;
    this.time.delayedCall(4000, () => {
      bub?.destroy();
      if (isMe && this._myBubble === bub) this._myBubble = null;
      else if (entry?.bubble === bub) entry.bubble = null;
    });
  }

  // ── Chat input ──────────────────────────────
  _bindChat() {
    const input = document.getElementById('chat-input');
    const send  = () => {
      const t = input.value.trim(); if (!t) return;
      socket.emit('chatMessage', t); input.value = '';
    };
    document.getElementById('chat-send').addEventListener('click', send);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(e.key)) e.stopPropagation();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Enter' && document.activeElement !== input && !dialogueOpen && !shopOpen) {
        e.preventDefault(); input.focus();
      }
    });
  }

  // ── Interact proximity check ─────────────────
  _findNearbyNpc(px, py) {
    let closest = null, closestDist = INTERACT_R;
    for (const entry of Object.values(this.npcSprites)) {
      const d = Math.hypot(px - entry.x, py - entry.y);
      if (d < closestDist) { closestDist = d; closest = entry; }
    }
    return closest;
  }

  // ── Update ──────────────────────────────────
  update(time) {
    if (!this.myPlayer) return;

    const chatFocused = document.activeElement === document.getElementById('chat-input');
    const blocked     = dialogueOpen || shopOpen || chatFocused;

    // Movement
    let vx = 0, vy = 0;
    if (!blocked) {
      if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -SPEED;
      if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  SPEED;
      if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -SPEED;
      if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  SPEED;
      if (vx && vy) { vx *= 0.707; vy *= 0.707; }
    }
    this.myPlayer.setVelocity(vx, vy);

    const sp = this.myPlayer;
    this.myNameTag?.setPosition(sp.x, sp.y - PLAYER_SIZE - 5);
    this._myBubble?.setPosition(sp.x, sp.y - PLAYER_SIZE - 22);

    // Emit position
    if (time - this._lastSend > SEND_RATE && (vx || vy)) {
      socket.emit('playerMovement', { x: Math.round(sp.x), y: Math.round(sp.y) });
      this._lastSend = time;

      // Timed job zone check
      if (activeJob?.zone) {
        const z  = activeJob.zone;
        const inZone = Math.hypot(sp.x - z.x, sp.y - z.y) < z.r;
        if (inZone) {
          if (!jobWaitStart) jobWaitStart = time;
          const elapsed = Math.floor((time - jobWaitStart) / 1000);
          const remain  = activeJob.timedSec - elapsed;
          document.getElementById('job-timer').textContent = remain > 0 ? `⏱ ${remain}s remaining…` : '✓ Complete!';
        } else {
          if (jobWaitStart) { document.getElementById('job-timer').textContent = 'Left zone — restart!'; }
          jobWaitStart = null;
        }
      }
    }

    // Interpolate other players
    for (const op of Object.values(this.otherPlayers)) {
      if (!op.sprite || op.targetX === undefined) continue;
      op.sprite.x = Phaser.Math.Linear(op.sprite.x, op.targetX, LERP);
      op.sprite.y = Phaser.Math.Linear(op.sprite.y, op.targetY, LERP);
      op.nameTag?.setPosition(op.sprite.x, op.sprite.y - PLAYER_SIZE - 5);
      op.bubble?.setPosition(op.sprite.x, op.sprite.y - PLAYER_SIZE - 22);
    }

    // NPC label positions track tweened sprite
    for (const entry of Object.values(this.npcSprites)) {
      entry.nameTag?.setPosition(entry.sprite.x, entry.sprite.y - NPC_SIZE - 5);
      entry.roleTag?.setPosition(entry.sprite.x, entry.sprite.y - NPC_SIZE - 14);
      entry.bubble?.setPosition(entry.sprite.x, entry.sprite.y - NPC_SIZE - 22);
      // Keep internal x/y synced to tweened position
      entry.x = entry.sprite.x;
      entry.y = entry.sprite.y;
    }

    // Proximity prompt
    if (!blocked) {
      const nearby = this._findNearbyNpc(sp.x, sp.y);
      this._nearbyNpc = nearby?.id ?? null;
      const prompt = document.getElementById('interact-prompt');
      if (nearby) {
        prompt.style.display = 'block';
        document.getElementById('prompt-npc-name').textContent = nearby.name;
      } else {
        prompt.style.display = 'none';
      }

      // E key
      if (Phaser.Input.Keyboard.JustDown(this.eKey) && this._nearbyNpc) {
        socket.emit('npcInteract', this._nearbyNpc);
      }
    } else {
      document.getElementById('interact-prompt').style.display = 'none';
    }
  }
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
new Phaser.Game({
  type: Phaser.AUTO, width: WORLD_W, height: WORLD_H,
  parent: 'game', backgroundColor: '#08080f',
  pixelArt: true, roundPixels: true,
  physics: { default:'arcade', arcade:{ gravity:{y:0}, debug:false } },
  scene: [GameScene],
});
