/* ============================================================
 * fx.js —— 视觉特效 + Web Audio 音效（全部原创实现）
 * ============================================================ */
"use strict";

const FX = (() => {
  let layer = null;
  function L(){ return layer || (layer = document.getElementById("fx-layer")); }
  // 自动测试模式：跳过所有视觉特效
  const NOFX = () => !!window.__noFx;

  const r = (a,b) => a + Math.random() * (b - a);

  /* ---------- 坐标工具 ---------- */
  function centerOf(el){
    if(!el) return { x: innerWidth / 2, y: innerHeight / 2 };
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }

  /* ---------- 卡牌飞行 ---------- */
  function cardHTML(card, cls){
    return cardFaceHTML(card, cls);
  }

  function flyCard(card, fromEl, toEl, opt = {}){
    if(NOFX()) return Promise.resolve();
    return new Promise(resolve => {
      // opt.fromPoint / opt.toPoint 优先：手牌结算时元素已重绘移除，
      // 展示卡需在飞行到达后才出现（终点用坐标而非元素）
      const from = opt.fromPoint || centerOf(fromEl), to = opt.toPoint || centerOf(toEl);
      const el = document.createElement("div");
      el.className = "fx-fly";
      el.innerHTML = cardHTML(card, opt.cls || "");
      el.style.cssText += `left:0;top:0;`;
      L().appendChild(el);
      const w = el.offsetWidth || 108, h = el.offsetHeight || 150;
      el.style.transform = `translate(${from.x - w/2}px, ${from.y - h/2}px) rotate(${r(-20,20)}deg) scale(${opt.fromScale || 1})`;
      void el.offsetWidth;
      const dur = opt.dur || 560;
      el.style.transition = `transform ${dur}ms cubic-bezier(.35,.1,.3,1), opacity .3s`;
      el.style.transform = `translate(${to.x - w/2}px, ${to.y - h/2}px) rotate(0deg) scale(${opt.toScale || 1})`;
      setTimeout(() => { el.remove(); resolve(); }, dur + 30);
    });
  }

  /* ---------- 弹出大字（杀！闪！…） ---------- */
  function word(text, color, small){
    if(NOFX()) return;
    const el = document.createElement("div");
    el.className = "fx-word" + (small ? " small" : "");
    el.textContent = text;
    el.style.color = color || "#f0d878";
    L().appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  /* ---------- 伤害 / 治疗数字 ---------- */
  function numberAt(el, text, heal){
    if(NOFX()) return;
    const c = centerOf(el);
    const el2 = document.createElement("div");
    el2.className = "fx-dmg" + (heal ? " fx-heal" : "");
    el2.textContent = text;
    el2.style.left = (c.x + r(-24, 24)) + "px";
    el2.style.top = (c.y - 30) + "px";
    L().appendChild(el2);
    setTimeout(() => el2.remove(), 1150);
  }

  /* ---------- 全屏闪色 ---------- */
  function flash(color, dur){
    if(NOFX()) return;
    const el = document.createElement("div");
    el.className = "fx-flash";
    el.style.background = color;
    if(dur) el.style.animationDuration = dur + "ms";
    L().appendChild(el);
    setTimeout(() => el.remove(), dur || 450);
  }

  /* ---------- 屏幕震动 ---------- */
  function shakeScreen(){
    const g = document.getElementById("game");
    if(!g) return;
    g.classList.remove("shake"); void g.offsetWidth; g.classList.add("shake");
    setTimeout(() => g.classList.remove("shake"), 450);
  }

  /* ---------- 粒子迸溅（血滴 / 花瓣 / 火花） ---------- */
  function particles(el, emoji, n, opt = {}){
    if(NOFX()) return;
    const c = centerOf(el);
    for(let i = 0; i < n; i++){
      const p = document.createElement("div");
      p.className = "fx-particle";
      p.textContent = emoji;
      const ang = r(0, Math.PI * 2), dist = r(50, 130);
      p.style.left = c.x + "px"; p.style.top = c.y + "px";
      p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      p.style.setProperty("--dy", (Math.sin(ang) * dist - (opt.up || 30)) + "px");
      p.style.setProperty("--rot", r(-180, 180) + "deg");
      p.style.fontSize = r(14, 26) + "px";
      L().appendChild(p);
      setTimeout(() => p.remove(), 1050);
    }
  }

  /* ---------- 格挡护盾 ---------- */
  function shieldAt(el){
    if(NOFX()) return;
    const c = centerOf(el);
    const s = document.createElement("div");
    s.className = "fx-shield";
    const d = 110;
    s.style.left = (c.x - d/2) + "px"; s.style.top = (c.y - d/2) + "px";
    s.style.width = d + "px"; s.style.height = d + "px";
    L().appendChild(s);
    setTimeout(() => s.remove(), 750);
  }

  /* ---------- 箭雨（万箭齐发） ---------- */
  function arrowRain(n = 12){
    if(NOFX()) return;
    for(let i = 0; i < n; i++){
      setTimeout(() => {
        const a = document.createElement("div");
        a.className = "fx-arrow";
        a.textContent = "➤";
        a.style.top = r(10, 70) + "vh";
        a.style.left = "0";
        L().appendChild(a);
        setTimeout(() => a.remove(), 750);
      }, i * 70);
    }
  }

  /* ---------- 落雷（闪电） ---------- */
  function boltAt(el){
    if(NOFX()) return;
    const c = centerOf(el);
    flash("rgba(200,225,255,.75)", 380);
    const b = document.createElement("div");
    b.className = "fx-lightning";
    b.style.setProperty("--lx", (c.x - 3) + "px");
    L().appendChild(b);
    setTimeout(() => b.remove(), 550);
  }

  /* ---------- 火焰上腾（南蛮） ---------- */
  function fireRise(n = 14){
    if(NOFX()) return;
    for(let i = 0; i < n; i++){
      setTimeout(() => {
        const f = document.createElement("div");
        f.className = "fx-fire";
        f.textContent = ["🔥","✦","🔥","💥"][i % 4];
        f.style.left = r(8, 88) + "vw";
        f.style.bottom = r(4, 30) + "vh";
        L().appendChild(f);
        setTimeout(() => f.remove(), 1150);
      }, i * 60);
    }
  }

  /* ---------- 游戏解说字幕 ---------- */
  let commentTimer = null;
  function comment(text){
    if(NOFX()) return;
    const el = document.getElementById("commentary");
    if(!el) return;
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    if(commentTimer) clearTimeout(commentTimer);
    commentTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  return { cardHTML, flyCard, word, numberAt, flash, shakeScreen,
           particles, shieldAt, arrowRain, boltAt, fireRise, centerOf, comment };
})();

/* ============================================================
 * 音效：Web Audio 实时合成，无外部资源
 * ============================================================ */
const SFX = (() => {
  let ctx = null, muted = false;

  function ensure(){
    if(!ctx){
      try{ ctx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ ctx = null; }
    }
    if(ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, { type = "sine", vol = .18, slide = 0, delay = 0 } = {}){
    if(muted) return;
    const c = ensure(); if(!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + .05);
  }

  function noise(dur, { vol = .2, delay = 0, hp = 400 } = {}){
    if(muted) return;
    const c = ensure(); if(!c) return;
    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0);
  }

  const api = {
    init: ensure,
    toggle(){ muted = !muted; return muted; },
    get muted(){ return muted; },
    sha(){ noise(.18, { vol:.3, hp:1200 }); tone(300, .16, { type:"sawtooth", vol:.14, slide:-220 }); },
    shan(){ tone(1900, .14, { type:"triangle", vol:.2 }); tone(2600, .1, { type:"sine", vol:.12, delay:.03 }); },
    tao(){ tone(660, .12, { vol:.16 }); tone(880, .16, { vol:.16, delay:.1 }); },
    jiu(){ tone(440, .1, { vol:.15 }); tone(330, .14, { vol:.15, delay:.08 }); },
    hurt(){ tone(110, .22, { type:"square", vol:.25, slide:-60 }); noise(.1, { vol:.18, hp:200 }); },
    heal(){ tone(520, .1, { vol:.14 }); tone(660, .1, { vol:.14, delay:.08 }); tone(880, .18, { vol:.14, delay:.16 }); },
    draw(){ noise(.06, { vol:.1, hp:2000 }); },
    equip(){ tone(520, .08, { type:"square", vol:.12 }); tone(700, .1, { type:"square", vol:.1, delay:.07 }); },
    trick(){ tone(740, .1, { type:"triangle", vol:.15, slide:200 }); },
    wuxie(){ tone(980, .1, { type:"sine", vol:.16 }); tone(780, .16, { type:"sine", vol:.14, delay:.07 }); },
    thunder(){ noise(.4, { vol:.4, hp:120 }); tone(70, .45, { type:"sawtooth", vol:.3, slide:-40 }); },
    fire(){ noise(.3, { vol:.22, hp:300 }); },
    arrows(){ for(let i=0;i<5;i++) noise(.05, { vol:.12, hp:2500, delay:i*.07 }); },
    duel(){ tone(220, .1, { type:"square", vol:.16 }); noise(.12, { vol:.25, hp:900, delay:.1 }); tone(180, .14, { type:"square", vol:.16, delay:.16 }); },
    die(){ tone(200, .5, { type:"sawtooth", vol:.2, slide:-150 }); },
    win(){ [523,659,784,1047].forEach((f,i) => tone(f, .28, { vol:.18, delay:i*.13 })); },
    lose(){ [392,330,262,196].forEach((f,i) => tone(f, .3, { vol:.16, delay:i*.16 })); },
    turn(){ tone(880, .08, { vol:.1 }); tone(1100, .1, { vol:.08, delay:.06 }); },
    judge(){ tone(1320, .08, { vol:.12 }); noise(.04, { vol:.08, hp:3000, delay:.05 }); },
  };
  // 高频音效节流：短时间重复触发时去重，避免刺耳的音效叠加
  const __last = {};
  for(const key of Object.keys(api)){
    if(key === "muted") continue; // 保留 getter
    const fn = api[key];
    api[key] = (...args) => {
      try{
        const now = performance.now();
        if(now - (__last[key] || 0) < 70) return;
        __last[key] = now;
        fn(...args);
      }catch(e){ /* 音效故障绝不能影响游戏逻辑 */ }
    };
  }
  return api;
})();

/* ---------- 卡牌插画资源 ---------- */
const CARD_ART = {};
["sha","shan","tao","jiu","wuzhong","wuxie","chai","shun","juedou","nanman",
 "wanjian","taoyuan","wugu","le","shandian","nulver","qinglong","guanshi","bagua",
 "chitu","dawan","dilu","jueying","zhaohuang"].forEach(k => {
  CARD_ART[k] = `assets/cards/art/${k}.jpg`;
});
function heroArtURL(heroId){ return `assets/cards/art/hero-${heroId}.jpg`; }

/* ---------- 卡牌 HTML 生成（手牌 / 飞行 / 弹窗共用） ---------- */
function suitColor(suit){ return (suit === "♥" || suit === "♦") ? "c-red" : "c-black"; }

function cardInnerHTML(card){
  const def = CARD_DEFS[card.key] || {};
  const suitBits = `<span class="suit ${suitColor(card.suit)}">${card.suit}</span>
    <span class="num ${suitColor(card.suit)}">${card.num}</span>`;
  // 插画模式：整卡面背景图 + 底部牌名条（图加载失败时透明回退到字面由 CSS 层保障）
  if(CARD_ART[card.key]){
    let faceCls = "n-art";
    if(card.key === "sha") faceCls = "t-sha";
    else if(card.key === "shan") faceCls = "t-shan";
    else if(card.key === "tao") faceCls = "t-tao";
    else if(card.key === "jiu") faceCls = "t-jiu";
    else if(card.cat === "delay") faceCls = "t-delay";
    else if(card.cat === "trick") faceCls = "t-trick";
    return `${suitBits}
      <div class="face-art" style="background-image:url('${CARD_ART[card.key]}')"></div>
      <div class="face-name-bar ${faceCls}${card.name.length > 2 ? " small" : ""}">${card.name}</div>
      <span class="cat-badge">${def.cat === "equip" ? (SLOT_NAMES[card.slot] || "") : (CAT[def.cat] ? CAT[def.cat].slice(0, 2) : "")}</span>`;
  }
  // 字面回退
  let faceCls = "t-basic";
  if(card.key === "sha") faceCls = "t-sha";
  else if(card.key === "shan") faceCls = "t-shan";
  else if(card.key === "tao") faceCls = "t-tao";
  else if(card.key === "jiu") faceCls = "t-jiu";
  else if(card.cat === "delay") faceCls = "t-delay";
  else if(card.cat === "trick") faceCls = "t-trick";
  else if(card.cat === "equip") faceCls = "t-equip";
  const small = card.name.length > 2 ? " small" : "";
  const badge = def.cat === "equip" ? (SLOT_NAMES[card.slot] || "") : (CAT[def.cat] ? CAT[def.cat].slice(0, 2) : "");
  return `${suitBits}
    <div class="face ${faceCls}${small}">${card.name}</div>
    <span class="cat-badge">${badge}</span>`;
}

function cardFaceHTML(card, cls){
  return `<div class="gcard ${cls || ""}">${cardInnerHTML(card)}</div>`;
}
