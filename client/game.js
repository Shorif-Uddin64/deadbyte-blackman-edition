// game.js
console.log("✅ DEADBYTE game.js FINAL (Music toggle + Gunshot always + Voice + Robot + Bullets)");

const socket = io();

// ===============================
// DOM
// ===============================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const modeSelect = document.getElementById("modeSelect");
const roomInput = document.getElementById("roomInput");
const nameSelect = document.getElementById("nameSelect");
const joinBtn = document.getElementById("joinBtn");
const restartBtn = document.getElementById("restartBtn");

const soundToggle = document.getElementById("soundToggle");
const volumeSlider = document.getElementById("volumeSlider");
const voiceToggle = document.getElementById("voiceToggle");

const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const emojiPanel = document.getElementById("emojiPanel");

// ===============================
// Constants
// ===============================
const FIXED_NAMES = ["Blackman", "Yeasin", "Lamia", "Foyazi", "Minhaz", "Shahrin"];
const WORLD = { w: 900, h: 520 };

const PLAYER_R = 16;
const MOVE_SPEED = 2.2;

// ===============================
// State
// ===============================
let myId = "";
let myName = "";
let mode = "group";
let currentRoom = "";

let players = {};        // server players: {socketId:{name,life}}
let posCache = {};       // local positions for group render

let solo = { active: false, me: null, bots: [] };

let keys = {};
let mouse = { x: WORLD.w / 2, y: WORLD.h / 2 };

// ===============================
// Bullets (visual)
// ===============================
let bullets = [];
const BULLET_SPEED = 11;
const BULLET_LIFE = 18;

// ===============================
// Chat
// ===============================
function addChatLine(text) {
  const div = document.createElement("div");
  div.className = "chatMsg";
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function sendChat(msg) {
  msg = (msg || "").trim();
  if (!msg) return;

  const prefix = myName ? `${myName}: ` : "";
  const full = prefix + msg;

  if (mode === "group" && currentRoom) {
    socket.emit("chatMessage", { roomCode: currentRoom, message: full });
  } else {
    addChatLine(full);
  }
}

sendBtn.addEventListener("click", () => {
  sendChat(chatInput.value);
  chatInput.value = "";
  chatInput.focus();
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendChat(chatInput.value);
    chatInput.value = "";
  }
});

socket.on("chatMessage", (message) => addChatLine(message));

// ===============================
// Emoji Panel
// ===============================
const EMOJIS = ["😀", "😂", "😈", "😱", "🔥", "💀", "👻", "❤️", "👍", "👎", "🎯", "⚡"];
emojiPanel.innerHTML = "";
EMOJIS.forEach((e) => {
  const b = document.createElement("button");
  b.className = "emojiBtn";
  b.textContent = e;
  b.onclick = () => sendChat(e);
  emojiPanel.appendChild(b);
});

// ===============================
// Sound System
// - Music toggle controls ONLY background music + ambient
// - Gunshot ALWAYS works (even if music is OFF)
// ===============================
const bgMusic = new Audio("assets/horror.mp3");
bgMusic.loop = true;

// ✅ Original gunshot mp3 (you placed it)
const gunMp3 = new Audio("assets/gunshot.mp3");
gunMp3.preload = "auto";

let audioCtx = null;
let ambientTimer = null;

// ✅ musicEnabled: background music + ambient only
let musicEnabled = false;

function getVol() {
  return Math.max(0, Math.min(1, Number(volumeSlider.value) / 100));
}

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

async function enableMusic() {
  musicEnabled = true;
  soundToggle.classList.remove("off");
  soundToggle.classList.add("on");
  soundToggle.textContent = "ON";

  // unlock webaudio so ambient works
  ensureAudioCtx();
  if (audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch (e) {}
  }

  // start background music
  bgMusic.volume = getVol();
  try { await bgMusic.play(); } catch (e) {}

  startAmbient();
}

function disableMusic() {
  musicEnabled = false;
  soundToggle.classList.remove("on");
  soundToggle.classList.add("off");
  soundToggle.textContent = "OFF";

  bgMusic.pause();
  stopAmbient();
}

soundToggle.addEventListener("click", async () => {
  if (!musicEnabled) await enableMusic();
  else disableMusic();
});

// volume affects BOTH music & gunshot
volumeSlider.addEventListener("input", () => {
  bgMusic.volume = getVol();
});

function startAmbient() {
  stopAmbient();
  ensureAudioCtx();

  ambientTimer = setInterval(() => {
    // ✅ ambient only when musicEnabled ON
    if (!musicEnabled || !audioCtx) return;

    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = 110 + Math.random() * 90;
    g.gain.value = 0.0001;

    o.connect(g);
    g.connect(audioCtx.destination);

    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.0001 + 0.02 * getVol(), t + 0.02);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.22);

    o.start(t);
    o.stop(t + 0.25);
  }, 900);
}

function stopAmbient() {
  if (ambientTimer) clearInterval(ambientTimer);
  ambientTimer = null;
}

// ✅ Gunshot mp3: works even if music is OFF
async function playGunshot() {
  // unlock (needed in some browsers)
  ensureAudioCtx();
  if (audioCtx && audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch(e) {}
  }

  try {
    // clone so rapid fire doesn't cut itself
    const s = gunMp3.cloneNode(true);
    s.volume = getVol();
    await s.play();
  } catch (e) {}
}

// ===============================
// Voice Chat (WebRTC, Group mode only)
// ===============================
let voiceEnabled = false;
let localStream = null;
const peers = new Map();        // peerId => RTCPeerConnection
const remoteAudios = new Map(); // peerId => HTMLAudioElement

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

async function startVoice() {
  if (voiceEnabled) return;

  if (mode !== "group" || !currentRoom) {
    addChatLine("⚠️ Voice works only in Group mode after joining a room.");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    addChatLine("❌ Mic permission denied. Allow microphone and try again.");
    return;
  }

  voiceEnabled = true;
  voiceToggle.classList.remove("off");
  voiceToggle.classList.add("on");
  voiceToggle.textContent = "ON";
  addChatLine("🎙️ Voice ON (Group).");

  socket.emit("voice-ready", { roomCode: currentRoom }); // harmless if server ignores
}

function stopVoice() {
  voiceEnabled = false;
  voiceToggle.classList.remove("on");
  voiceToggle.classList.add("off");
  voiceToggle.textContent = "OFF";

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  for (const [peerId, pc] of peers.entries()) {
    try { pc.close(); } catch(e) {}
  }
  peers.clear();

  for (const [peerId, a] of remoteAudios.entries()) {
    try { a.pause(); } catch(e) {}
    try { a.remove(); } catch(e) {}
  }
  remoteAudios.clear();

  addChatLine("🔇 Voice OFF.");
}

voiceToggle.addEventListener("click", async () => {
  if (!voiceEnabled) await startVoice();
  else stopVoice();
});

function ensurePeerConnection(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit("voice-ice", { to: peerId, candidate: ev.candidate });
    }
  };

  pc.ontrack = (ev) => {
    let audio = remoteAudios.get(peerId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.controls = false;
      audio.style.display = "none";
      document.body.appendChild(audio);
      remoteAudios.set(peerId, audio);
    }
    audio.srcObject = ev.streams[0];
  };

  peers.set(peerId, pc);
  return pc;
}

async function callPeer(peerId) {
  if (!voiceEnabled || !localStream) return;
  const pc = ensurePeerConnection(peerId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("voice-offer", { to: peerId, offer });
}

socket.on("peersInRoom", async ({ peers: peerList }) => {
  if (!voiceEnabled) return;
  for (const peerId of peerList) {
    if (myId && peerId && myId < peerId) {
      await callPeer(peerId);
    }
  }
});

socket.on("peerJoined", async ({ peerId }) => {
  if (!voiceEnabled) return;
  if (myId && peerId && myId < peerId) {
    await callPeer(peerId);
  }
});

socket.on("peerLeft", ({ peerId }) => {
  const pc = peers.get(peerId);
  if (pc) {
    try { pc.close(); } catch(e) {}
    peers.delete(peerId);
  }
  const a = remoteAudios.get(peerId);
  if (a) {
    try { a.pause(); } catch(e) {}
    try { a.remove(); } catch(e) {}
    remoteAudios.delete(peerId);
  }
  addChatLine(`👤 Peer left voice: ${peerId.slice(0, 5)}...`);
});

socket.on("voice-offer", async ({ from, offer }) => {
  if (!voiceEnabled || !localStream) return;
  const pc = ensurePeerConnection(from);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("voice-answer", { to: from, answer });
});

socket.on("voice-answer", async ({ from, answer }) => {
  const pc = peers.get(from);
  if (!pc) return;
  await pc.setRemoteDescription(answer);
});

socket.on("voice-ice", async ({ from, candidate }) => {
  const pc = peers.get(from);
  if (!pc) return;
  try { await pc.addIceCandidate(candidate); } catch(e) {}
});

// ===============================
// Socket Basics
// ===============================
socket.on("connect", () => {
  myId = socket.id;
  console.log("Connected:", myId);
});

socket.on("roomFull", () => alert("Room is full (max 6)!"));
socket.on("nameTaken", () => alert("This name is already taken in this room!"));

socket.on("updatePlayers", (serverPlayers) => {
  if (mode !== "group") return;
  players = serverPlayers || {};
  for (const id in players) {
    if (!posCache[id]) posCache[id] = randomSpawn();
  }
});

// ===============================
// Join / Restart (unlock audio on click)
// ===============================
joinBtn.addEventListener("click", async () => {
  ensureAudioCtx();
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  mode = modeSelect.value;

  myName = (nameSelect.value || "").trim();
  if (!FIXED_NAMES.includes(myName)) {
    alert("Select name from dropdown!");
    return;
  }

  if (mode === "group") {
    const roomCode = (roomInput.value || "").trim();
    if (!roomCode) {
      alert("Enter Room Code!");
      return;
    }

    currentRoom = roomCode;
    solo.active = false;
    solo.me = null;
    solo.bots = [];
    bullets = [];

    socket.emit("joinRoom", { roomCode, name: myName });
    addChatLine(`— joined room ${roomCode} as ${myName} —`);

    if (voiceEnabled) {
      stopVoice();
      await startVoice();
    }

  } else {
    currentRoom = "";
    if (voiceEnabled) stopVoice();
    startSolo();
  }
});

restartBtn.addEventListener("click", () => {
  players = {};
  posCache = {};
  solo = { active: false, me: null, bots: [] };
  bullets = [];
  addChatLine("— restarted —");
});

// ===============================
// Typing Guard (FIX F CONFLICT)
// ===============================
function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

// ===============================
// Input
// ===============================
window.addEventListener("keydown", (e) => {
  // ✅ typing safe (no move / no shoot)
  if (isTyping()) return;

  keys[e.key.toLowerCase()] = true;

  if (e.key.toLowerCase() === "f") {
    e.preventDefault();
    shoot();
  }
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = WORLD.w / rect.width;
  const sy = WORLD.h / rect.height;
  mouse.x = (e.clientX - rect.left) * sx;
  mouse.y = (e.clientY - rect.top) * sy;
});

// ===============================
// Helpers
// ===============================
function randomSpawn() {
  return {
    x: 60 + Math.random() * (WORLD.w - 120),
    y: 60 + Math.random() * (WORLD.h - 120),
  };
}

function getGroupMe() {
  if (!players[myId]) return null;
  if (!posCache[myId]) posCache[myId] = randomSpawn();
  return { id: myId, ...players[myId], ...posCache[myId] };
}

function setGroupMePos(x, y) {
  if (!posCache[myId]) posCache[myId] = randomSpawn();
  posCache[myId].x = x;
  posCache[myId].y = y;
}

function groupPlayerList() {
  const list = [];
  for (const id in players) {
    if (!posCache[id]) posCache[id] = randomSpawn();
    list.push({ id, ...players[id], ...posCache[id] });
  }
  return list;
}

// ===============================
// Bullets
// ===============================
function spawnBullet(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const vx = (dx / len) * BULLET_SPEED;
  const vy = (dy / len) * BULLET_SPEED;
  bullets.push({ x: fromX, y: fromY, vx, vy, life: BULLET_LIFE });
}

function updateAndDrawBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    b.x += b.vx;
    b.y += b.vy;
    b.life -= 1;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (
      b.life <= 0 ||
      b.x < -50 || b.y < -50 ||
      b.x > WORLD.w + 50 || b.y > WORLD.h + 50
    ) {
      bullets.splice(i, 1);
    }
  }
}

// ===============================
// Shooting (hitscan + visible bullet + mp3 gunshot)
// ===============================
function shoot() {
  playGunshot();

  if (mode === "group") {
    if (!currentRoom) return;
    const me = getGroupMe();
    if (!me) return;

    spawnBullet(me.x, me.y, mouse.x, mouse.y);

    const all = groupPlayerList();
    const hitId = hitscanFindTarget(me, all);
    if (hitId) {
      socket.emit("playerHit", { roomCode: currentRoom, targetId: hitId });
    }

  } else if (solo.active) {
    const me = solo.me;
    if (!me) return;

    spawnBullet(me.x, me.y, mouse.x, mouse.y);

    const hitBotId = hitscanFindTarget(me, solo.bots.map((b) => ({ id: b.id, ...b })));
    if (hitBotId) {
      const bot = solo.bots.find((b) => b.id === hitBotId);
      if (bot && bot.life > 0) {
        bot.life -= 1;
        if (bot.life < 0) bot.life = 0;
      }
    }
  }
}

function hitscanFindTarget(me, list) {
  const dx = mouse.x - me.x;
  const dy = mouse.y - me.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;

  let bestId = null;
  let bestProj = 1e9;

  for (const p of list) {
    if (!p) continue;
    if (mode === "group" && p.id === myId) continue;
    if (p.life <= 0) continue;

    const tx = p.x - me.x;
    const ty = p.y - me.y;

    const proj = tx * ux + ty * uy;
    if (proj < 0) continue;

    const px = tx - proj * ux;
    const py = ty - proj * uy;
    const dist = Math.hypot(px, py);

    if (dist < 18 && proj < bestProj) {
      bestProj = proj;
      bestId = p.id;
    }
  }
  return bestId;
}

// ===============================
// Solo Mode
// ===============================
function startSolo() {
  solo.active = true;
  bullets = [];

  const s = randomSpawn();
  solo.me = { id: "me", name: myName, x: s.x, y: s.y, life: 200 };

  solo.bots = [];
  for (let i = 0; i < 5; i++) {
    const b = randomSpawn();
    solo.bots.push({ id: "bot" + i, name: "Bot-" + (i + 1), x: b.x, y: b.y, life: 200 });
  }

  addChatLine("— single mode: 1 player + 5 bots —");
}

function botAI() {
  if (!solo.active) return;
  const me = solo.me;

  for (const b of solo.bots) {
    if (b.life <= 0) continue;

    const dx = me.x - b.x;
    const dy = me.y - b.y;
    const d = Math.hypot(dx, dy) || 1;

    const step = 1.6;
    b.x += (dx / d) * step;
    b.y += (dy / d) * step;

    if (d < 210 && Math.random() < 0.03) {
      if (me.life > 0) {
        me.life -= 1;
        if (me.life < 0) me.life = 0;
      }
    }
  }
}

// ===============================
// Movement
// ===============================
function move() {
  let me = null;

  if (mode === "group") {
    me = getGroupMe();
    if (!me) return;
  } else if (solo.active) {
    me = solo.me;
  } else return;

  let vx = 0, vy = 0;
  if (keys["w"] || keys["arrowup"]) vy -= 1;
  if (keys["s"] || keys["arrowdown"]) vy += 1;
  if (keys["a"] || keys["arrowleft"]) vx -= 1;
  if (keys["d"] || keys["arrowright"]) vx += 1;
  const l = Math.hypot(vx, vy) || 1;

  vx = (vx / l) * MOVE_SPEED;
  vy = (vy / l) * MOVE_SPEED;

  me.x = Math.max(PLAYER_R, Math.min(WORLD.w - PLAYER_R, me.x + vx));
  me.y = Math.max(PLAYER_R, Math.min(WORLD.h - PLAYER_R, me.y + vy));

  if (mode === "group") {
    setGroupMePos(me.x, me.y);
  } else {
    solo.me.x = me.x;
    solo.me.y = me.y;
  }
}

// ===============================
// Background Render
// ===============================
function drawGrid() {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#111827";
  for (let x = 0; x <= WORLD.w; x += 45) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.h);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD.h; y += 45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFog() {
  const g = ctx.createRadialGradient(WORLD.w * 0.3, WORLD.h * 0.3, 50, WORLD.w * 0.5, WORLD.h * 0.5, 520);
  g.addColorStop(0, "rgba(255,255,255,0.00)");
  g.addColorStop(1, "rgba(120,130,140,0.18)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
}

function drawAimLine(me) {
  const dx = mouse.x - me.x;
  const dy = mouse.y - me.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;

  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(me.x, me.y);
  ctx.lineTo(me.x + ux * 120, me.y + uy * 120);
  ctx.stroke();
  ctx.restore();
}

// ===============================
// Robot Player Drawing
// ===============================
function roundRect(x, y, w, h, r, fillColor, strokeColor, dead) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();

  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.strokeStyle = dead ? "rgba(160,160,160,0.35)" : strokeColor;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawPlayer(p, isMe = false) {
  const dead = p.life <= 0;

  const tintMap = {
    Yeasin: "#2563eb",
    Lamia: "#db2777",
    Foyazi: "#f97316",
    Minhaz: "#16a34a",
    Shahrin: "#7c3aed",
    Blackman: "#000000",
  };

  const tint = tintMap[p.name] || "#334155";
  const body = p.name === "Blackman" ? "#0b0f14" : "#1f2937";

  ctx.save();
  ctx.globalAlpha = dead ? 0.35 : 1;

  ctx.beginPath();
  ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
  ctx.fillStyle = isMe ? "rgba(15,23,42,0.18)" : "rgba(30,41,59,0.12)";
  ctx.fill();

  const headW = 28, headH = 18;
  const bodyW = 34, bodyH = 22;

  const headX = p.x - headW / 2;
  const headY = p.y - 22;

  const bodyX = p.x - bodyW / 2;
  const bodyY = p.y - 4;

  ctx.strokeStyle = dead ? "rgba(160,160,160,0.4)" : tint;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, headY);
  ctx.lineTo(p.x, headY - 10);
  ctx.stroke();

  ctx.fillStyle = dead ? "rgba(180,180,180,0.4)" : tint;
  ctx.beginPath();
  ctx.arc(p.x, headY - 12, 3, 0, Math.PI * 2);
  ctx.fill();

  roundRect(headX, headY, headW, headH, 7, body, tint, dead);

  ctx.fillStyle = dead ? "rgba(200,200,200,0.4)" : "#e5e7eb";
  ctx.fillRect(p.x - 8, headY + 7, 5, 4);
  ctx.fillRect(p.x + 3, headY + 7, 5, 4);

  roundRect(bodyX, bodyY, bodyW, bodyH, 8, body, tint, dead);

  ctx.fillStyle = dead ? "rgba(200,200,200,0.25)" : tint;
  ctx.fillRect(p.x - 6, bodyY + 7, 12, 6);

  ctx.strokeStyle = dead ? "rgba(160,160,160,0.35)" : tint;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bodyX - 6, bodyY + 8);
  ctx.lineTo(bodyX, bodyY + 14);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(bodyX + bodyW + 6, bodyY + 8);
  ctx.lineTo(bodyX + bodyW, bodyY + 14);
  ctx.stroke();

  ctx.font = "bold 12px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#0f172a";
  const label = dead ? `${p.name} (dead)` : p.name;
  ctx.fillText(label, p.x, headY - 6);

  ctx.font = "12px system-ui";
  ctx.fillStyle = "#334155";
  ctx.textBaseline = "top";
  ctx.fillText(`❤️ ${p.life}`, p.x, bodyY + bodyH + 10);

  ctx.restore();
}

// ===============================
// Main loop
// ===============================
function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawFog();

  move();
  if (solo.active) botAI();

  if (mode === "group") {
    const list = groupPlayerList();
    const me = getGroupMe();
    for (const p of list) drawPlayer(p, p.id === myId);
    if (me) drawAimLine(me);
  } else if (solo.active) {
    for (const b of solo.bots) drawPlayer(b, false);
    drawPlayer(solo.me, true);
    drawAimLine(solo.me);
  } else {
    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,0.8)";
    ctx.font = "bold 22px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Select Name → Join (Group) or Start (Single)", WORLD.w / 2, WORLD.h / 2);
    ctx.restore();
  }

  updateAndDrawBullets();

  requestAnimationFrame(loop);
}

addChatLine("✅ READY. Select Name, choose Mode, then Join.");
loop();
