/* ============================================================
 * main.js —— 入口：屏幕流转 / 选将 / 剧情 / 启动（原创实现）
 * ============================================================ */
"use strict";

const PARAMS = new URLSearchParams(location.search);

function showScreen(id){
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

/* ---------- 选将画面 ---------- */
const heroPick = { hero: null, role: "random" };

function buildHeroScreen(){
  const grid = document.getElementById("hero-grid");
  grid.innerHTML = "";
  for(const h of HEROES){
    const el = document.createElement("div");
    el.className = "hero-card";
    el.dataset.hid = h.id;
    el.innerHTML = `
      <div class="hero-hp">${Array.from({length: h.hp}, () => "<i></i>").join("")}</div>
      <div class="hero-portrait" style="background:linear-gradient(160deg, ${h.color}44, #241b10 70%)">${h.name[0]}<div class="portrait-art" style="background-image:url('${heroArtURL(h.id)}')"></div></div>
      <div class="hero-name">${h.name}</div>
      <div class="hero-title">「${h.title}」</div>
      <div class="hero-skill"><b>【${h.skill}】</b>${h.skillDesc}</div>`;
    el.onclick = () => {
      heroPick.hero = h.id;
      grid.querySelectorAll(".hero-card").forEach(c => c.classList.remove("selected"));
      el.classList.add("selected");
      document.getElementById("btn-hero-confirm").disabled = false;
    };
    grid.appendChild(el);
  }
  const ro = document.getElementById("role-options");
  ro.innerHTML = "";
  for(const [key, r] of Object.entries({ random:{name:"随机"}, zhu:ROLES.zhu, zhong:ROLES.zhong, fan:ROLES.fan, nei:ROLES.nei })){
    const el = document.createElement("div");
    el.className = "role-opt" + (key === "random" ? " on" : "");
    el.textContent = r.name;
    el.dataset.role = key;
    el.onclick = () => {
      heroPick.role = key;
      ro.querySelectorAll(".role-opt").forEach(x => x.classList.remove("on"));
      el.classList.add("on");
    };
    ro.appendChild(el);
  }
}

/* ---------- 剧情画面 ---------- */
function showStory(role){
  const r = ROLES[role];
  const card = document.getElementById("story-role-card");
  card.innerHTML = `
    <div class="story-role-big" style="color:${r.hex};text-shadow:0 0 30px ${r.hex}88">${r.name}</div>
    <div class="story-role-sub" style="color:#f0dfae">${ROLE_GOAL[role]}</div>`;
  card.style.cssText = `background:linear-gradient(165deg, ${r.hex}66, #1a1208 75%);border:3px solid ${r.hex};box-shadow:0 0 50px ${r.hex}55;`;
  showScreen("screen-story");

  const textEl = document.getElementById("story-text");
  const lines = ROLE_STORY[role];
  const full = lines.join("\n");
  // 自动测试：直接跳过打字机
  if(PARAMS.get("autotest")){ textEl.textContent = full; goBtn(); return; }
  textEl.textContent = "";
  let i = 0;
  const timer = setInterval(() => {
    textEl.textContent = full.slice(0, ++i);
    if(i % 3 === 0) SFX.draw();
    if(i >= full.length){ clearInterval(timer); goBtn(); }
  }, 45);
  function goBtn(){
    const btn = document.getElementById("btn-story-go");
    btn.classList.remove("hidden");
    btn.onclick = () => { clearInterval(timer); startGame(role); };
  }
}

/* ---------- 启动一局 ---------- */
async function startGame(role, heroId){
  showScreen("screen-game");
  newGame({ role, hero: heroId || null });
  // 观战加速：玩家死亡后
  const watch = setInterval(() => {
    if(!G) { clearInterval(watch); return; }
    G.fast = !!PARAMS.get("autotest") || G.humanDeadFast;
  }, 500);
  UI.renderAll();
  log(`◆ 群雄逐鹿 · 5 人身份局开局。你是 <b style="color:${ROLES[role].hex}">${ROLES[role].name}</b>（${G.me.hero.name}）。`);
  log("规则提示：主公与忠臣需诛灭反贼、内奸；反贼目标为主公；内奸要做最后幸存者。");
  if(!PARAMS.get("autotest")) SFX.init();
  await DLY(600);
  G.turnPlayer = G.zhu;
  await gameLoop();
}

/* ---------- 结算再来一局 ---------- */
document.getElementById("btn-again").onclick = () => {
  G = null;
  document.getElementById("btn-ai").classList.remove("on");
  const hb = document.getElementById("btn-hint");
  try{ hb.classList.toggle("on", localStorage.getItem("sgk_ai_hint") !== "0"); }catch(e){ hb.classList.add("on"); }
  refreshReplayLast();
  document.getElementById("log-list").innerHTML = "";
  document.title = "三国杀 · 群雄逐鹿";
  showScreen("screen-hero");
};

/* ---------- 事件绑定 ---------- */
document.getElementById("btn-start").onclick = () => {
  SFX.init();
  showScreen("screen-hero");
};
document.getElementById("btn-hero-confirm").onclick = () => {
  if(!heroPick.hero) return;
  // 按真实概率抽身份：1主公 / 1忠臣 / 2反贼 / 1内奸
  const realRole = heroPick.role === "random"
    ? ["zhu","zhong","fan","fan","nei"][Math.floor(Math.random() * 5)]
    : heroPick.role;
  heroPick.realRole = realRole;
  showStory(realRole);
};
/* AI 提示开关（教练模式） */
document.getElementById("btn-hint").onclick = () => {
  if(!G) return;
  G.aiHint = !G.aiHint;
  try{ localStorage.setItem("sgk_ai_hint", G.aiHint ? "1" : "0"); }catch(e){}
  const btn = document.getElementById("btn-hint");
  btn.classList.toggle("on", G.aiHint);
  btn.title = G.aiHint ? "AI 提示已开启：出牌/响应时提供分析建议（点击关闭）" : "AI 提示已关闭（点击开启）";
  if(G.aiHint && G.phase === "play" && G.turnPlayer === G.me && G.me.human && !G.aiDelegated) UI.renderAll(true);
  else UI.hideAdvice();
};

/* AI 代打开关 */
document.getElementById("btn-ai").onclick = () => {
  if(!G || G.over || !G.me.alive) return;
  G.aiDelegated = !G.aiDelegated;
  G.me.human = !G.aiDelegated;
  const btn = document.getElementById("btn-ai");
  btn.classList.toggle("on", G.aiDelegated);
  btn.title = G.aiDelegated ? "AI 代打中：点击切回手动操作" : "AI 代打：开启后你的回合由 AI 自动出牌，可随时切回";
  log(G.aiDelegated
    ? `🤖 <b>AI 代打已开启</b> — 你的回合将由 AI 自动出牌，随时点击 🤖 切回手动。`
    : `🖐️ 已切回<b>手动操作</b>。`);
  if(G.aiDelegated) aiTakeover();
};

document.getElementById("btn-mute").onclick = (e) => {
  const off = SFX.toggle();
  e.currentTarget.classList.toggle("off", off);
  e.currentTarget.textContent = off ? "🔇" : "🔊";
};

/* ---------- 全局错误捕获（自测用） ---------- */
window.onerror = (msg, src, line, col, err) => {
  const box = document.getElementById("error-box");
  box.classList.remove("hidden");
  box.textContent += `[ERR] ${msg} @ ${src}:${line}:${col}\n${err && err.stack ? err.stack.split("\n").slice(0,4).join("\n") : ""}\n`;
  document.title = "AUTOTEST_ERROR " + msg;
};
// 未处理的 Promise 拒绝：不会触发 onerror，但同样会静默挂死游戏，必须亮出来
addEventListener("unhandledrejection", e => {
  const r = e.reason;
  const box = document.getElementById("error-box");
  box.classList.remove("hidden");
  box.textContent += `[REJECT] ${r && r.stack ? r.stack.split("\n").slice(0,4).join("\n") : r}\n`;
  document.title = "AUTOTEST_ERROR " + (r && r.message ? r.message : "unhandled rejection");
});

/* ---------- 启动 ---------- */
buildHeroScreen();

/* 预热卡牌/武将插画缓存（选将阶段静默加载，进入对局零等待） */
(function preloadArt(){
  Object.values(CARD_ART).forEach(url => { const i = new Image(); i.src = url; });
  HEROES.forEach(h => { const i = new Image(); i.src = heroArtURL(h.id); });
})();

/* ---------- 玩法说明 ---------- */
const RULES_HTML = `
  <b>身份</b>：主公与忠臣要诛灭反贼、内奸；反贼要斩杀主公；内奸要做最后的幸存者。只有你的身份明置，主公身份全场可见。<br>
  <b>回合流程</b>：判定阶段（结算乐不思蜀/闪电）→ 摸 2 张牌 → 出牌阶段 → 弃牌阶段（手牌上限 = 当前体力）。<br>
  <b>杀与闪</b>：【杀】对攻击范围内一名角色造成 1 点伤害，对方可用【闪】抵消；每回合默认只能出一张【杀】。<br>
  <b>距离</b>：按存活人数环形计算，相邻为 1；进攻马 -1、防御马 +1，最小为 1。<br>
  <b>濒死</b>：体力降到 0 时，从自己开始轮流询问【桃】（或【酒】自救），无人救则阵亡并翻开身份。<br>
  <b>判定</b>：乐不思蜀判定非红桃则跳过出牌阶段；闪电判定黑桃劈 3 点雷电伤害，否则移给下家。<br>
  <b>悬赏</b>：击杀反贼者摸三张牌；主公误杀忠臣需弃置所有牌。<br>
  <b>提示</b>：悬停手牌可查看牌面说明；出牌前再次点击已选手牌可切换用法（如关羽的红牌视为【杀】）。`;

document.getElementById("rules-body").innerHTML = RULES_HTML;
document.getElementById("btn-rules").onclick = () => {
  UI.modal({
    title: "玩法说明",
    desc: `<div style="text-align:left;max-width:640px;font-size:13px;line-height:2;color:#cbb98d">${RULES_HTML}</div>`,
    btns: [{ label:"知道了", primary:true }],
  });
};

/* ---------- 回放入口 ---------- */
document.getElementById("btn-replay").onclick = () => {
  if(G && G.replayData) RP.open(G.replayData, { autoplay:true });
};
function refreshReplayLast(){
  const saved = localStorage.getItem("sgk_replay_last");
  document.getElementById("btn-replay-last").classList.toggle("hidden", !saved);
}
document.getElementById("btn-replay-last").onclick = () => {
  const saved = localStorage.getItem("sgk_replay_last");
  if(saved) RP.open(saved, { autoplay:true });
};
refreshReplayLast();

/* ---------- 战绩统计（localStorage，隐私模式下静默失败） ---------- */
function loadStats(){
  try{ return JSON.parse(localStorage.getItem("sgk_stats")) || { games:0, wins:0 }; }
  catch(e){ return { games:0, wins:0 }; }
}
function recordStats(win){
  const s = loadStats();
  s.games++; if(win) s.wins++;
  try{ localStorage.setItem("sgk_stats", JSON.stringify(s)); }catch(e){}
  renderStats();
refreshReplayLast();
try{ document.getElementById("btn-hint").classList.toggle("on", localStorage.getItem("sgk_ai_hint") !== "0"); }catch(e){ document.getElementById("btn-hint").classList.add("on"); }

/* ---------- 小屏适配：整体等比缩放 ---------- */
}
function renderStats(){
  const s = loadStats();
  const el = document.getElementById("stats-line");
  if(el) el.innerHTML = s.games > 0
    ? `既往征战 <b>${s.games}</b> 局 · 胜 <b>${s.wins}</b> 场`
    : `乱世将启 · 静候新主`;
}
renderStats();
refreshReplayLast();
try{ document.getElementById("btn-hint").classList.toggle("on", localStorage.getItem("sgk_ai_hint") !== "0"); }catch(e){ document.getElementById("btn-hint").classList.add("on"); }

/* ---------- 小屏适配：整体等比缩放 ---------- */

/* ---------- 小屏适配：整体等比缩放 ---------- */
function fitScale(){
  const s = Math.min(1, innerWidth / 1180, innerHeight / 760);
  document.documentElement.style.setProperty("--app-scale", s.toFixed(3));
}
addEventListener("resize", fitScale);
fitScale();

/* 调试/演示直达参数：?screen=hero | ?screen=story&role=zhu | ?screen=game&hero=guanyu&role=zhu */
(function(){
  const scr = PARAMS.get("screen");
  if(!scr) return;
  const role = PARAMS.get("role") || "random";
  const realRole = role === "random" ? ["zhu","zhong","fan","fan","nei"][Math.floor(Math.random() * 5)] : role;
  if(scr === "hero"){ showScreen("screen-hero"); return; }
  if(scr === "story"){ showStory(realRole); return; }
  if(scr === "game"){
    const hid = PARAMS.get("hero");
    if(hid){ const h = HEROES.find(x => x.id === hid); if(h) heroPick.hero = hid; }
    heroPick.realRole = realRole;
    startGame(realRole, heroPick.hero);
  }
})();

/* 自动测试模式：全自动 AI 对局 */
if(PARAMS.get("autotest")){
  window.__noFx = true;
  window.__throttleRender = true; // 极速模式：动画与渲染全节流
  SFX.toggle(); // 静音，省掉音频开销
  G = null;
  showScreen("screen-game");
  newGame({ role: "random" });
  G.autotest = true; G.fast = true; G.turbo = true;
  // 把"人类"也交给 AI
  G.me.human = false;
  const roles = G.players.map(p => `${p.name}=${ROLES[p.role].name}(${p.hero.name})`).join(" ");
  log(`AUTOTEST 开局：${roles}`);
  G.turnPlayer = G.zhu;
  gameLoop();
}

/* UI 冒烟测试：真实 DOM 点击模拟玩家操作（选牌/选目标/确认/响应/弹窗） */
if(PARAMS.get("uitest")){
  window.__noFx = true; // 跳过动画 DOM，但保留完整 UI 渲染（点击依赖真实元素）
  showScreen("screen-game");
  newGame({ role: "random" });
  G.fast = true; // 压缩动画延时，让冒烟能覆盖更多轮次
  G.turnPlayer = G.zhu;
  gameLoop();
  let actions = 0, played = 0;
  const timer = setInterval(() => {
    if(G.over || actions++ > 3000){ clearInterval(timer); document.title = "UITEST_DONE actions=" + actions; return; }
    const $ = id => document.getElementById(id);
    const modalBtn = document.querySelector("#modal-root.show .modal-btns button");
    const modalCard = document.querySelector("#modal-root.show .modal-cards .gcard");
    if(actions === 500 || actions === 1100){ document.getElementById("btn-ai").click(); return; }
    // 响应面板优先（要闪/桃/无懈等）：有可用牌就出第一张，否则放弃
    if(UI.S.mode === "respond"){
      const respCard = document.querySelector(".hcard.usable");
      if(respCard) respCard.click(); else if(!$("btn-cancel").classList.contains("hidden")) $("btn-cancel").click();
      return;
    }
    if(modalCard){ modalCard.click(); return; }
    if(modalBtn){ modalBtn.click(); return; }
    if(UI.S.mode === "selectTarget" && UI.S.skillPending){
      // 技能进行中：按技能要求推进（选牌→选目标→确认），推不动就取消
      const sp = UI.S.skillPending;
      const needCard = sp.cards.length === 0; // 三种技能都先要一张牌
      const needTargets = sp.skill === "rende" ? sp.targets.length < 1 : sp.skill === "lijian" ? sp.targets.length < 2 : false;
      if(needCard){
        const c = document.querySelector(".hcard.usable:not(.disabled)");
        if(c){ c.click(); return; }
      }
      if(needTargets){
        const seat = document.querySelector(".seat.selectable");
        if(seat){ seat.click(); return; }
      }
      const canConfirm = (sp.skill === "zhiheng" && sp.cards.length > 0) ||
        (sp.skill === "rende" && sp.cards.length >= 1 && sp.targets.length === 1) ||
        (sp.skill === "lijian" && sp.cards.length === 1 && sp.targets.length === 2);
      if(canConfirm && !$("btn-use").classList.contains("hidden")){ $("btn-use").click(); return; }
      $("btn-cancel").click();
      return;
    }
    if(UI.S.mode === "selectTarget"){
      if(UI.S.targets.size > 0 && !$("btn-use").classList.contains("hidden")){ $("btn-use").click(); return; }
      const seat = document.querySelector(".seat.selectable");
      if(seat){ seat.click(); return; }
      $("btn-cancel").click();
      return;
    }
    if(UI.S.mode === "play"){
      const skillBtn = document.querySelector("#skill-btns .skill-btn:not(:disabled)");
      if(skillBtn && played < 3000 && played % 9 === 3){ played++; skillBtn.click(); return; }
      const usable = document.querySelector(".hcard.usable:not(.disabled)");
      if(usable && played < 3000){ played++; usable.click(); return; }
      if(!$("btn-endturn").disabled) $("btn-endturn").click();
    }
  }, 25);
}
