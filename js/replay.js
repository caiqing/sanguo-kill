/* ============================================================
 * replay.js —— 对局回放器（事件流逐帧重演，原创实现）
 * 数据：Rec 产出的事件流（每事件附全局面快照）
 * ============================================================ */
"use strict";

const RP = {
  active: false,
  data: null, events: [], meta: null,
  idx: -1,
  playing: false, timer: null, speed: 1,
  fakeG: null,
  savedG: null,

  /* 打开一段录像（对象或 JSON 字符串）。opt.autoplay 自动播放 */
  open(src, opt = {}){
    try{
      this.data = typeof src === "string" ? JSON.parse(src) : src;
    }catch(e){ log("⚠ 回放数据损坏。"); return; }
    if(!this.data || !Array.isArray(this.data.events) || !this.data.events.length){
      log("⚠ 没有可回放的录像。"); return;
    }
    this.events = this.data.events;
    this.meta = this.data.meta;
    this.idx = -1;
    this.active = true;
    this.playing = false;
    this.speed = 1;
    if(this.timer) clearInterval(this.timer);

    this.savedG = G;
    this.applyTo(0);
    showScreen("screen-game");
    document.getElementById("replay-bar").classList.remove("hidden");
    const seek = document.getElementById("rp-seek");
    seek.max = String(this.events.length - 1);
    seek.value = "0";
    document.getElementById("rp-pos").textContent = `1 / ${this.events.length}`;
    UI.setHint(`▶ 回放模式：${this.meta.winSide ? ({ zhu:"主公方", fan:"反贼", nei:"内奸" })[this.meta.winSide] + "获胜" : ""} · 共 ${this.events.length} 步`);
    UI.setButtons({});
    if(opt.autoplay) this.play();
  },

  exit(){
    this.playing = false;
    if(this.timer) clearInterval(this.timer);
    this.active = false;
    document.getElementById("replay-bar").classList.add("hidden");
    const zone = document.getElementById("play-zone");
    if(zone) zone.innerHTML = "";
    G = this.savedG;
    this.savedG = null;
    UI.cleanup();
    UI.renderAll();
    showScreen("screen-result");
  },

  /* 从快照构造渲染用伪 G，替换全局 G 供 UI 渲染 */
  applyTo(i){
    if(i < 0 || i >= this.events.length) return;
    this.idx = i;
    const ev = this.events[i], snap = ev.snap;
    const players = snap.players.map(p => ({
      pid: p.pid, name: p.name, role: p.role,
      hero: HEROES.find(h => h.id === (this.meta.seats.find(x => x.pid === p.pid) || {}).heroId)
            || { id: p.pid, name: p.name, color: "#8a8f98", skill: "", skillDesc: "" },
      human: false,
      hp: p.hp, maxHp: p.maxHp, dead: p.dead, drunk: p.drunk,
      hand: p.hand.slice(),
      equip: { weapon: p.equip.weapon, armor: p.equip.armor, "horse-": p.equip["horse-"], "horse+": p.equip["horse+"] },
      judgeCards: p.judge.slice(),
      grudge: {}, shaUsed: 0, skillUsed: false, reputation: null,
    }));
    this.fakeG = {
      players,
      round: snap.round,
      phase: snap.phase,
      turnPlayer: players.find(p => p.pid === snap.turnPid) || null,
      zhu: players.find(p => p.role === "zhu"),
      me: players.find(p => p.pid === this.meta.mePid) || players[0],
      deck: { length: snap.deckN },
      discard: { length: snap.discardN, slice(){ return snap.discardTop.slice(-3); } },
      over: false,
      fast: true,
    };
    G = this.fakeG;
    UI.renderAll(true);

    // 事件视觉：展示卡锚定到当事人座位位置
    const zone = document.getElementById("play-zone");
    if(zone && ev.t === "init"){ zone.innerHTML = ""; }
    if((ev.t === "play" || ev.t === "judge" || ev.t === "reply") && ev.d.card){
      const srcName = ev.d.src || ev.d.by;
      const srcP = this.fakeG.players.find(x => x.name === srcName);
      const anchor = srcP ? UI.seatElOf(srcP) : document.getElementById("center-stage");
      const stage = document.getElementById("center-stage");
      const a = anchor || stage;
      const ar = a.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const w = 168, h = 233;
      let x = ar.left + ar.width / 2 - w / 2;
      x = Math.max(sr.left + 8, Math.min(sr.right - w - 8, x));
      const y = Math.max(sr.top + 8, sr.top + sr.height / 2 - h / 2);
      const label = ev.t === "play"
        ? `${ev.d.src}${ev.d.target ? " → " + ev.d.target : ""} 打出`
        : ev.t === "judge" ? `${ev.d.by} 判定` : `${ev.d.src} 打出`;
      let wrap = zone.querySelector(".center-show");
      if(!wrap){ wrap = document.createElement("div"); wrap.className = "played-card center-show judgment-show"; wrap.style.cssText = `position:fixed;z-index:5;`; zone.appendChild(wrap); }
      wrap.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:5;`;
      wrap.innerHTML = cardFaceHTML(ev.d.card) + `<div class="played-label">${label}</div>`;
    }

    // 每事件特效与音效
    if(ev.t === "damage"){
      const t = this.fakeG.players.find(p => p.name === ev.d.target);
      if(t){ FX.numberAt(UI.seatElOf(t), `-${ev.d.n}`); FX.shakeScreen(); SFX.hurt(); }
    } else if(ev.t === "heal"){
      const t = this.fakeG.players.find(p => p.name === ev.d.target);
      if(t){ FX.numberAt(UI.seatElOf(t), `+${ev.d.n}`, true); SFX.heal(); }
    } else if(ev.t === "die"){
      SFX.die();
    } else if(ev.t === "judge"){
      SFX.judge();
    } else if(ev.t === "play" || ev.t === "reply"){
      SFX.trick();
    }
    FX.comment(ev.text);
    const logBox = document.getElementById("log-list");
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = ev.html || ev.text;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;

    document.getElementById("rp-seek").value = String(i);
    document.getElementById("rp-pos").textContent = `${i + 1} / ${this.events.length}`;
  },

  step(dir){
    const next = this.idx + dir;
    if(next < -1 || next >= this.events.length) return;
    if(next === -1){ this.applyTo(0); this.idx = 0; return; }
    this.applyTo(next);
    if(this.idx >= this.events.length - 1) this.pause();
  },

  play(){
    if(this.idx >= this.events.length - 1) this.applyTo(0);
    this.playing = true;
    document.getElementById("rp-play").textContent = "⏸";
    const tick = () => {
      if(!this.playing) return;
      this.step(1);
      if(this.idx >= this.events.length - 1){ this.pause(); return; }
    };
    this.timer = setInterval(tick, Math.max(120, 850 / this.speed));
  },

  pause(){
    this.playing = false;
    if(this.timer) clearInterval(this.timer);
    const b = document.getElementById("rp-play");
    if(b) b.textContent = "▶";
  },

  toggle(){ this.playing ? this.pause() : this.play(); },

  cycleSpeed(){
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
    document.getElementById("rp-speed").textContent = this.speed + "x";
    if(this.playing){ this.pause(); this.play(); }
  },

  jump(delta){
    this.pause();
    this.applyTo(Math.max(0, Math.min(this.events.length - 1, this.idx + delta)));
  },
};
