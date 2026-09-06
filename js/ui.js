/* ============================================================
 * ui.js —— 渲染 + 玩家交互（原创实现）
 * ============================================================ */
"use strict";

const UI = (() => {
  const $ = id => document.getElementById(id);

  const S = {
    mode: "idle",          // idle | play | selectTarget | respond | modal
    selCard: null,         // 选中的手牌
    asSha: false,          // 武圣：视为杀
    targets: new Set(),    // 已选目标 pid
    resolve: null,         // 交互 Promise resolve
    respondSpec: null,     // 响应面板参数
    skillPending: null,    // 技能进行中 {skill, cards:[]}
  };

  /* =============== 渲染 =============== */
  let __lastRender = 0;
  function renderAll(force){
    if(!G) return;
    // 自动测试：节流渲染，只保证日志正确；关键交互（force=true）必须立即渲染
    if(window.__noFx && !force){
      const now = performance.now();
      if(now - __lastRender < 120 && !G.over) return;
      __lastRender = now;
    }
    renderTop();
    renderOthers();
    renderSelf();
    renderHand();
    renderPiles();
    renderSkillBtns();
    $("spectate-tip").classList.toggle("hidden", G.me.dead ? false : true);
  }

  function renderTop(){
    $("round-info").innerHTML = `第 <b>${G.round}</b> 轮`;
    $("deck-count").textContent = G.deck.length;
    const tp = G.turnPlayer;
    $("turn-banner").textContent = tp ? `⚔ ${tp.name} 的回合 · ${phaseName(G.phase)}` : "——";
  }
  function phaseName(ph){
    return ({ judge:"判定阶段", draw:"摸牌阶段", play:"出牌阶段", discard:"弃牌阶段" })[ph] || "";
  }

  function heroColor(p){ return p.hero.color || "#6b5a36"; }

  function renderOthers(){
    const box = $("others-row");
    box.innerHTML = "";
    for(const p of G.players){
      if(p.pid === G.me.pid) continue;
      box.appendChild(seatEl(p));
    }
  }

  function seatEl(p){
    const el = document.createElement("div");
    el.className = "seat" + (p.pid === G.turnPlayer?.pid ? " turn" : "") + (p.dead ? " dead" : "");
    el.dataset.pid = p.pid;
    if(S.mode === "selectTarget" && S.validTargets?.has(p.pid)){
      el.classList.add("selectable");
      if(S.targets.has(p.pid)) el.classList.add("selected-target");
    }
    const roleTag = p.pid === G.zhu.pid
      ? `<div class="role-tag r-zhu">主</div>`
      : (p.dead ? "" : `<div class="role-tag r-unknown">?</div>`);
    const hpDots = Array.from({length: p.maxHp}, (_, i) =>
      `<i class="${i < p.hp ? "on" : "off"}"></i>`).join("");
    const judges = p.judgeCards.map(c =>
      `<span class="jm-${c.key === "le" ? "le" : "shandian"}">${c.name}</span>`).join("");
    const equips = [];
    if(p.equip.weapon) equips.push(`<span>⚔${p.equip.weapon.name}</span>`);
    if(p.equip.armor) equips.push(`<span>🛡${p.equip.armor.name}</span>`);
    if(p.equip["horse-"]) equips.push(`<span>🐎${p.equip["horse-"].name}</span>`);
    if(p.equip["horse+"]) equips.push(`<span>🏇${p.equip["horse+"].name}</span>`);
    const status = [];
    if(p.drunk) status.push(`<span title="醉酒：下一张杀伤害+1">🍺</span>`);
    if(p.reputation === "anti" && !p.dead) status.push(`<span title="已暴露敌意">🎯</span>`);
    el.innerHTML = `
      ${roleTag}
      <div class="hero-portrait" style="color:${heroColor(p)};text-shadow:0 0 18px ${heroColor(p)}">${p.hero.name[0]}</div>
      <div class="hero-name">${p.hero.name}</div>
      <div class="hero-skill-tag">〔${p.hero.skill}〕</div>
      <div class="hp-row">${hpDots}</div>
      <div class="hand-count">🂠 × ${p.hand.length}</div>
      <div class="equip-mini">${equips.join("")}</div>
      <div class="judge-marks">${judges}</div>
      <div class="status-icons">${status.join("")}</div>
      <div class="role-reveal"><b style="color:${ROLES[p.role].hex}">${ROLES[p.role].name}</b></div>`;
    el.onclick = () => onSeatClick(p, el);
    return el;
  }

  function renderSelf(){
    const p = G.me;
    const box = $("self-hero");
    const hpDots = Array.from({length: p.maxHp}, (_, i) =>
      `<i class="${i < p.hp ? "on" : "off"}"></i>`).join("");
    const eq = slot => p.equip[slot]
      ? `<div class="eq-slot filled" title="${p.equip[slot].name}：${CARD_DEFS[p.equip[slot].key].desc}"><b>${p.equip[slot].name}</b>${SLOT_NAMES[slot]}</div>`
      : `<div class="eq-slot">${SLOT_NAMES[slot]}</div>`;
    const judges = p.judgeCards.map(c =>
      `<span class="jm-${c.key === "le" ? "le" : "shandian"}" style="background:linear-gradient(160deg,${c.key==="le"?"#8a4fd0,#5a2d9e":"#e8c832,#b8860b"});color:${c.key==="shandian"?"#3a2c00":"#fff"}">${c.name}</span>`).join("");
    box.innerHTML = `
      <div class="self-card ${p.pid === G.turnPlayer?.pid ? "turn" : ""}" id="self-card-el">
        <div class="self-role" style="background:${ROLES[p.role].hex}">${ROLES[p.role].name}</div>
        <div class="self-portrait" style="color:${heroColor(p)};text-shadow:0 0 16px ${heroColor(p)}">${p.hero.name[0]}</div>
        <div class="self-info">
          <div class="self-name">${p.hero.name}</div>
          <div class="self-skill">〔${p.hero.skill}〕${p.hero.skillDesc}</div>
          <div id="self-hp">${hpDots}<span class="hp-text">${p.hp}/${p.maxHp}${p.drunk ? "　🍺醉" : ""}</span></div>
        </div>
      </div>
      <div id="self-judge">${judges}</div>
      <div id="self-equip">${eq("weapon")}${eq("armor")}${eq("horse-")}${eq("horse+")}</div>`;
  }

  /* ---------- 牌面说明浮层 ---------- */
  let tipEl = null;
  function showCardTip(card, target){
    if(!tipEl){
      tipEl = document.createElement("div");
      tipEl.className = "card-tip";
      document.body.appendChild(tipEl);
    }
    const def = CARD_DEFS[card.key] || {};
    const slotLine = def.cat === "equip"
      ? `${SLOT_NAMES[def.slot] || ""}${def.range ? " · 攻击范围 " + def.range : ""}`
      : (CAT[def.cat] ? CAT[def.cat] : "");
    tipEl.innerHTML = `
      <div class="ct-name"><span class="${suitColor(card.suit)}">${card.suit}${card.num}</span> ${card.name}</div>
      <div class="ct-slot">${slotLine}</div>
      <div class="ct-desc">${def.desc || ""}</div>`;
    const r = target.getBoundingClientRect();
    const w = 224;
    tipEl.style.left = Math.min(innerWidth - w - 10, Math.max(8, r.left + r.width / 2 - w / 2)) + "px";
    tipEl.style.top = Math.max(8, r.top - 10 - 118) + "px";
    tipEl.classList.add("show");
  }
  function hideCardTip(){
    if(tipEl) tipEl.classList.remove("show");
  }

  function renderHand(){
    const box = $("hand-cards");
    box.innerHTML = "";
    const p = G.me;
    const n = p.hand.length;
    // 扇形间距：随容器宽度自适应，确保手牌不越过行动列
    const wrapW = ($("hand-cards").clientWidth || 660);
    const spread = Math.max(40, Math.min(96, (wrapW - 140) / Math.max(n, 1)));
    const total = spread * (n - 1);
    const respondCards = S.respondSpec
      ? (typeof S.respondSpec.cards === "function" ? S.respondSpec.cards() : S.respondSpec.cards)
      : null;
    p.hand.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "hcard";
      el.innerHTML = cardInnerHTML(c);
      el.style.left = `calc(50% - ${total/2 + 54}px + ${i * spread}px)`;
      el.style.transform = `rotate(${(i - (n-1)/2) * Math.min(2.5, 12/n)}deg)`;
      el.dataset.cid = c.id;
      if(S.respondSpec){
        const ok = respondCards && respondCards.includes(c);
        el.classList.add(ok ? "usable" : "disabled");
      } else if(S.mode === "play" || S.mode === "selectTarget"){
        el.classList.add("usable");
        if(S.skillPending && !S.skillPending.cards.includes(c)) el.classList.add("disabled");
        if(S.selCard === c) el.classList.add("selected");
      } else {
        el.classList.add("disabled");
      }
      el.onclick = () => onHandClick(c, el);
      el.onmouseenter = () => showCardTip(c, el);
      el.onmouseleave = hideCardTip;
      box.appendChild(el);
    });
  }

  function renderPiles(){
    const d = $("deck-pile");
    d.innerHTML = `<div class="pile-stack"><div class="pile-back"></div><div class="pile-num">牌堆 ${G.deck.length}</div></div>`;
    const dis = $("discard-pile");
    const last = G.discard.slice(-3);
    dis.innerHTML = `<div class="pile-stack"><div id="discard-stack">${
      last.map(c => cardFaceHTML(c)).join("")}</div><div class="pile-num">弃牌 ${G.discard.length}</div></div>`;
  }

  function renderSkillBtns(){
    const box = $("skill-btns");
    box.innerHTML = "";
    if(G.phase !== "play" || !G.me.alive || G.turnPlayer?.pid !== G.me.pid || S.mode === "respond") return;
    const p = G.me, h = p.hero.id;
    const mk = (label, cb, disabled) => {
      const b = document.createElement("button");
      b.className = "skill-btn"; b.textContent = label;
      b.disabled = !!disabled;
      b.onclick = cb;
      box.appendChild(b);
    };
    if(h === "sunquan" && !p.skillUsed && p.hand.length >= 1)
      mk("制衡", () => startSkill("zhiheng"));
    if(h === "liubei" && !p.skillUsed && p.hand.length >= 1)
      mk("仁德", () => startSkill("rende"));
    if(h === "diaochan" && !p.skillUsed && p.hand.length >= 1)
      mk("离间", () => startSkill("lijian"));
  }

  function setHint(html){
    $("hint-text").innerHTML = html;
  }
  function setButtons({ use, cancel, endturn }){
    $("btn-use").classList.toggle("hidden", !use);
    $("btn-cancel").classList.toggle("hidden", !cancel);
    $("btn-endturn").disabled = !endturn;
  }

  /* =============== 交互：出牌阶段 =============== */
  function enterPlayMode(){
    S.mode = "play"; S.selCard = null; S.asSha = false; S.targets.clear(); S.skillPending = null;
    setHint("出牌阶段：点击一张手牌，再点击目标角色头像（发光者可选）。");
    setButtons({ cancel:false, endturn:true });
    renderAll();
  }

  function onHandClick(card, el){
    if(S.mode === "respond"){
      const valid = typeof S.respondSpec.cards === "function" ? S.respondSpec.cards() : S.respondSpec.cards;
      if(!valid.includes(card)) return;
      const r = S.resolve; cleanup(); r(card); return;
    }
    if(S.mode !== "play" && S.mode !== "selectTarget") return;
    if(S.skillPending){
      const sp = S.skillPending;
      const idx = sp.cards.indexOf(card);
      if(idx >= 0) sp.cards.splice(idx, 1);
      else {
        if(sp.skill === "lijian" && sp.cards.length >= 1) return;
        sp.cards.push(card);
      }
      renderAll(); updateSkillHint(); return;
    }
    // 已选中状态下再点同一张 → 切换用途（如关羽红牌：视为杀 / 原用途）
    if(S.mode === "selectTarget" && S.selCard === card && S.currentUses && S.currentUses.length > 1){
      S.useIdx = ((S.useIdx || 0) + 1) % S.currentUses.length;
      S.pendingUse = S.currentUses[S.useIdx];
      S.targets.clear();
      setHint(`用途切换为：${useLabel(card, S.pendingUse)} — 请点击目标角色。`);
      setButtons({ use:true, cancel:true, endturn:false });
      renderAll();
      return;
    }
    S.selCard = (S.selCard === card) ? null : card;
    S.targets.clear();
    if(S.selCard){
      const uses = cardUses(G.me, S.selCard);
      if(uses.length === 0){ S.selCard = null; setHint(`<b>${card.name}</b>：当前无法使用。`); renderAll(); return; }
      S.currentUses = uses; S.useIdx = 0;
      if(uses.length === 1 && uses[0].targets.size === 0){
        const u = uses[0]; S.selCard = null;
        const r = S.resolve; cleanup(); r({ type:"card", card, use:{ key:u.key, target:null } }); return;
      }
      S.mode = "selectTarget";
      S.pendingUse = uses[0];
      setHint(`已选 <b>${card.name}</b>（${useLabel(card, S.pendingUse)}）— 请点击目标角色${uses.length > 1 ? "；再次点击此牌可切换用法" : ""}，或点【取消】。`);
      setButtons({ use:true, cancel:true, endturn:false });
    } else {
      S.mode = "play";
      setHint("出牌阶段：点击一张手牌，再点击目标角色头像。");
      setButtons({ cancel:false, endturn:true });
    }
    renderAll();
  }

  function useLabel(card, use){
    return use.key === card.key ? `【${card.name}】` : `视为【${CARD_DEFS[use.key].name}】`;
  }

  function onSeatClick(p, el){
    if(S.mode !== "selectTarget") return;
    const valid = S.pendingUse?.targets || S.validTargets;
    if(!valid?.has(p.pid)) return;
    if(S.skillPending){
      const sp = S.skillPending;
      if(!sp.targets) sp.targets = [];
      if(sp.targets.includes(p)) sp.targets = sp.targets.filter(x => x !== p);
      else sp.targets.push(p);
      renderAll(); updateSkillHint(); return;
    }
    S.targets.clear(); S.targets.add(p.pid);
    S.pendingTarget = p;
    setHint(`目标：<b>${p.name}</b> — 点击【出牌】生效，或重新选择。`);
    setButtons({ use:true, cancel:true, endturn:false });
    renderAll();
  }

  function updateSkillHint(){
    const sp = S.skillPending;
    if(!sp) return;
    if(sp.skill === "zhiheng")
      setHint(`【制衡】已选 ${sp.cards.length} 张牌 — 点击【出牌】执行（弃置并摸等量牌）。`);
    else if(sp.skill === "rende")
      setHint(`【仁德】已选 ${sp.cards.length} 张 — 请点击一名其他角色头像交付。`);
    else if(sp.skill === "lijian"){
      const needCard = sp.cards.length === 0;
      const needT = (sp.targets?.length || 0) < 2;
      setHint(`【离间】${needCard ? "先点击一张手牌作为弃牌；" : ""}${needT ? "再点击两名男性角色（第一位先出杀）。" : "点击【出牌】执行。"}`);
    }
    setButtons({ use:(sp.skill === "zhiheng" && sp.cards.length > 0) || (sp.skill === "lijian" && sp.cards.length === 1 && sp.targets?.length === 2), cancel:true, endturn:false });
  }

  function startSkill(skill){
    if(S.mode !== "play") return;
    S.skillPending = { skill, cards:[], targets:[] };
    S.mode = "selectTarget";
    S.validTargets = new Set(G.players.filter(x => !x.dead && x.pid !== G.me.pid).map(x => x.pid));
    updateSkillHint();
    renderAll();
  }

  /* 确认按钮（出牌 / 技能执行） */
  $("btn-use").onclick = () => {
    const r = S.resolve; if(!r) return;
    if(S.skillPending){
      const sp = S.skillPending;
      if(sp.skill === "zhiheng" && sp.cards.length){ cleanup(); r({ type:"skill", skill:"zhiheng", cards:sp.cards }); return; }
      if(sp.skill === "rende" && sp.cards.length && sp.targets?.length === 1){ cleanup(); r({ type:"skill", skill:"rende", cards:sp.cards, target:sp.targets[0] }); return; }
      if(sp.skill === "lijian" && sp.cards.length === 1 && sp.targets?.length === 2){ cleanup(); r({ type:"skill", skill:"lijian", card:sp.cards[0], targets:sp.targets }); return; }
      return;
    }
    if(S.selCard && S.pendingUse){
      const needTarget = S.pendingUse.targets.size > 0;
      const target = needTarget ? G.players.find(x => x.pid === [...S.targets][0]) : null;
      if(needTarget && !target){ setHint("请先点击选择一个目标角色！"); return; }
      const card = S.selCard, useKey = S.pendingUse.key;
      cleanup();
      r({ type:"card", card, use:{ key:useKey, target } });
      return;
    }
    setHint("请先选择一张手牌。");
  };

  /* 结束回合 */
  $("btn-endturn").onclick = () => {
    if(UI.S.mode !== "play" && UI.S.mode !== "selectTarget") return;
    const r = S.resolve;
    S.selCard = null; S.skillPending = null; S.targets.clear();
    cleanup();
    if(r) r({ type:"end" });
  };

  /* 取消 */
  $("btn-cancel").onclick = () => {
    if(S.mode === "respond"){
      const r = S.resolve; cleanup(); r(null); return;
    }
    S.selCard = null; S.skillPending = null; S.targets.clear();
    S.mode = "play";
    setHint("出牌阶段：点击一张手牌，再点击目标角色头像。");
    setButtons({ cancel:false, endturn:true });
    renderAll();
  };

  /* =============== 响应面板（要闪/桃/无懈等） =============== */
  function askRespond(spec){
    return new Promise(resolve => {
      S.mode = "respond";
      S.respondSpec = spec;
      S.resolve = resolve;
      setHint(spec.prompt);
      setButtons({ cancel: spec.allowCancel, endturn:false });
      renderAll(true);
    });
  }

  function cleanup(){
    S.mode = "idle"; S.selCard = null; S.respondSpec = null;
    S.skillPending = null; S.resolve = null; S.pendingUse = null; S.pendingTarget = null;
    S.targets.clear();
    setHint(""); setButtons({});
    renderAll(true);
  }

  /* =============== 通用弹窗 =============== */
  function modal({ title, desc, cards, onPick, btns }){
    const root = $("modal-root");
    root.innerHTML = `<div class="modal">
      <h3>${title}</h3>
      ${desc ? `<p>${desc}</p>` : ""}
      ${cards ? `<div class="modal-cards">${cards.map((c,i) => cardFaceHTML(c)).join("")}</div>` : ""}
      <div class="modal-btns"></div>
    </div>`;
    const btnBox = root.querySelector(".modal-btns");
    (btns || []).forEach(b => {
      const el = document.createElement("button");
      el.className = b.primary ? "btn-main" : "btn-sm";
      el.style.fontSize = "16px";
      el.textContent = b.label;
      el.onclick = () => { root.classList.remove("show"); root.innerHTML = ""; b.cb && b.cb(); };
      btnBox.appendChild(el);
    });
    if(cards && onPick){
      root.querySelectorAll(".modal-cards .gcard").forEach((el, i) => {
        el.onclick = () => { root.classList.remove("show"); root.innerHTML = ""; onPick(cards[i], i); };
      });
    }
    root.classList.add("show");
  }

  /* =============== 日志 =============== */
  function logLine(html){
    const box = $("log-list");
    const el = document.createElement("div");
    el.className = "log-line";
    el.innerHTML = html;
    box.appendChild(el);
    while(box.children.length > 80) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  function seatElOf(p){
    if(p.pid === G.me.pid) return $("self-card-el");
    return document.querySelector(`.seat[data-pid="${p.pid}"]`);
  }

  return { S, renderAll, enterPlayMode, askRespond, modal, logLine,
           setHint, setButtons, seatElOf, $ };
})();

function log(html, cls){
  UI.logLine(cls ? `<span class="${cls}">${html}</span>` : html);
}
