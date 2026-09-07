/* ============================================================
 * engine.js —— 游戏引擎：回合流程 / 出牌结算 / 濒死 / 胜负（原创实现）
 * ============================================================ */
"use strict";

let G = null;          // 全局游戏状态
const $ = id => document.getElementById(id);
const DLY = ms => new Promise(r => setTimeout(r, !G ? ms : G.turbo ? 0 : G.fast ? Math.min(ms, 8) : ms));

/* ================= 初始化 ================= */
function newGame(cfg){
  const roles = ["zhu","zhong","fan","fan","nei"];
  // 玩家指定身份
  if(cfg.role && cfg.role !== "random"){
    const i = roles.indexOf(cfg.role);
    roles.splice(i, 1);
    roles.unshift(cfg.role);
  } else {
    shuffle(roles);
  }
  const heroPool = shuffle(HEROES.slice());
  // 指定武将：把所选英雄调到玩家位（pid 0）
  if(cfg.hero){
    const hi = heroPool.findIndex(h => h.id === cfg.hero);
    if(hi >= 0){ const [picked] = heroPool.splice(hi, 1); heroPool.unshift(picked); }
  }
  const players = [];
  for(let i = 0; i < 5; i++){
    const hero = heroPool[i];
    const isZhu = roles[i] === "zhu";
    players.push({
      pid: i,
      name: hero.name,
      hero,
      role: roles[i],
      human: i === 0,
      maxHp: hero.hp + (isZhu ? 1 : 0),
      hp: hero.hp + (isZhu ? 1 : 0),
      hand: [], equip: { weapon:null, armor:null, "horse-":null, "horse+":null },
      judgeCards: [],
      alive: true, dead: false,
      shaUsed: 0, drunk: false, skillUsed: false,
      grudge: {}, reputation: null,
      isMyTurn: false,
    });
  }
  // 以主公为座位环起点重排座次（身份不变，仅换座位）
  const zhuIdx = players.findIndex(p => p.role === "zhu");
  const others = players.filter(p => p.pid !== zhuIdx);
  const ordered = [players[zhuIdx], ...others];
  ordered.forEach((p, i) => p.pid = i);

  G = {
    players: ordered,
    deck: buildDeck(),
    discard: [],
    turnPlayer: null,
    phase: "",
    round: 1,
    over: false,
    aiDelegated: false,
    aiHint: (() => { try{ return localStorage.getItem("sgk_ai_hint") !== "0"; }catch(e){ return true; } })(),
    zhu: ordered[0],
    me: ordered.find(p => p.human),
    fast: false,
    humanDeadFast: false,
  };
  for(const p of G.players){ drawCardsRaw(p, 4); }
  Rec.start(G.players);
  return G;
}

/* AI 代打接管：切换瞬间处理挂起中的人类交互
 * 出牌循环 → 哨兵重入 AI 决策；响应面板 → 放弃本次响应；
 * 弹窗（八卦/无懈/贯石斧/五谷）无法安全跳过 → 等玩家处理完当前选择后生效 */
function aiTakeover(){
  if(!G || G.over || !G.me || G.me.dead) return;
  if(G.phase === "play" && G.turnPlayer === G.me && UI.S.resolve &&
     (UI.S.mode === "play" || UI.S.mode === "selectTarget")){
    const r = UI.S.resolve;
    UI.cleanup();
    r({ type:"ai" });
    return;
  }
  if(UI.S.mode === "respond" && UI.S.resolve){
    const r = UI.S.resolve;
    UI.cleanup();
    r(null);
  }
}

/* 记仇账本 */
function addGrudge(target, source, amount){
  if(!target || !source || target.pid === source.pid || target.dead) return;
  target.grudge[source.pid] = (target.grudge[source.pid] || 0) + amount;
}

/* ================= 基础工具 ================= */
function nextAlive(p){
  const n = G.players.length;
  let i = p.pid;
  do { i = (i + 1) % n; } while(G.players[i].dead);
  return G.players[i];
}
function dist(a, b){
  // 按存活者座位环计算（原版规则：阵亡者不占位）
  const alive = G.players.filter(x => !x.dead);
  const ai = alive.indexOf(a), bi = alive.indexOf(b);
  let d = 1;
  if(ai >= 0 && bi >= 0 && alive.length > 1){
    const n = alive.length;
    d = Math.min((bi - ai + n) % n, (ai - bi + n) % n);
  } else {
    // 回退：固定环（调用方保证双方存活，理论上不触发）
    const N = G.players.length;
    d = Math.min((b.pid - a.pid + N) % N, (a.pid - b.pid + N) % N);
  }
  d += (b.equip["horse+"] ? 1 : 0) - (a.equip["horse-"] ? 1 : 0);
  return Math.max(1, d);
}
function attackRange(p){
  return (p.equip.weapon && CARD_DEFS[p.equip.weapon.key].range) || 1;
}
function drawCardsRaw(p, n){
  for(let i = 0; i < n; i++){
    if(G.deck.length === 0){
      if(G.discard.length === 0) return;
      G.deck = shuffle(G.discard.splice(0));
      log("牌堆已空，弃牌堆重新洗入牌堆。");
    }
    const c = G.deck.pop();
    if(!c) continue;
    p.hand.push(c);
  }
}
async function drawCards(p, n, silent){
  drawCardsRaw(p, n);
  if(!silent){
    SFX.draw();
    UI.renderAll();
    log(`<b>${p.name}</b> 摸了 ${n} 张牌。`);
    await DLY(300);
  }
  UI.renderAll();
}
function toDiscard(card){
  if(!card){ console.error("[toDiscard] 收到空牌，已忽略。调用栈：", new Error().stack); return; }
  G.discard.push(card);
}
function totalCards(p){
  return p.hand.length + Object.values(p.equip).filter(Boolean).length;
}

/* ================= 目标合法性 ================= */
function canUseAsSha(p, c){
  return c.key === "sha" || (p.hero.id === "guanyu" && SUIT_RED(c.suit));
}
function canUseAsShan(p, c){
  return c.key === "shan" || (p.hero.id === "zhaoyun" && c.key === "sha");
}
function canBeShaTarget(src, t){
  if(t.dead) return false;
  if(t.hero.id === "zhugeliang" && t.hand.length === 0) return false; // 空城
  return true;
}
function shaTargetsOf(p){
  return G.players.filter(x => x.pid !== p.pid && !x.dead && dist(p, x) <= attackRange(p) && canBeShaTarget(p, x));
}

/* 卡牌在该玩家手里的可用方式：[{key:'sha'|原key, targets:Set}] */
function cardUses(p, c){
  const out = [];
  const others = () => G.players.filter(x => !x.dead && x.pid !== p.pid);
  const addShaUse = () => {
    if(shaCountLeft(p) > 0 && shaTargetsOf(p).length)
      out.push({ key:"sha", targets:new Set(shaTargetsOf(p).map(x => x.pid)) });
  };
  switch(c.key){
    case "sha": addShaUse(); break;
    case "shan": break; // 响应牌
    case "tao":
      if(p.hp < p.maxHp) out.push({ key:"tao", targets:new Set() });
      break;
    case "jiu": out.push({ key:"jiu", targets:new Set() }); break;
    case "wuzhong": out.push({ key:"wuzhong", targets:new Set() }); break;
    case "chai": {
      const ts = others().filter(x => totalCards(x) > 0);
      if(ts.length) out.push({ key:"chai", targets:new Set(ts.map(x=>x.pid)) });
      break; }
    case "shun": {
      const ts = others().filter(x => dist(p,x) <= 1 && totalCards(x) > 0);
      if(ts.length) out.push({ key:"shun", targets:new Set(ts.map(x=>x.pid)) });
      break; }
    case "juedou": {
      const ts = others().filter(x => !(x.hero.id === "zhugeliang" && x.hand.length === 0));
      if(ts.length) out.push({ key:"juedou", targets:new Set(ts.map(x=>x.pid)) });
      break; }
    case "nanman": case "wanjian": case "taoyuan": case "wugu":
      out.push({ key:c.key, targets:new Set() }); break;
    case "le": {
      const ts = others().filter(x => !x.judgeCards.some(j => j.key === "le"));
      if(ts.length) out.push({ key:"le", targets:new Set(ts.map(x=>x.pid)) });
      break; }
    case "shandian":
      if(!p.judgeCards.some(j => j.key === "shandian")) out.push({ key:"shandian", targets:new Set() });
      break;
    default:
      if(c.cat === "equip") out.push({ key:c.key, targets:new Set() });
  }
  // 武圣：关羽的红色手牌可视为杀（延时锦囊、装备除外）
  if(p.hero.id === "guanyu" && SUIT_RED(c.suit) && c.cat !== "equip" && c.cat !== "delay" && c.key !== "sha" && !out.some(u => u.key === "sha")){
    addShaUse();
  }
  return out;
}
function shaCountLeft(p){
  if(p.hero.id === "zhangfei") return 99;
  if(p.equip.weapon?.key === "nulver") return 99;
  return 1 - p.shaUsed;
}

/* ================= 回合循环 ================= */
async function gameLoop(){
  let guard = 0;
  while(!G.over && guard++ < 500){
    const p = G.turnPlayer;
    if(!p.dead) await runTurn(p);
    if(checkOver()) break;
    G.turnPlayer = nextAlive(G.turnPlayer);
    if(G.turnPlayer.pid === G.zhu.pid) G.round++;
    UI.renderAll();
  }
}

async function runTurn(p){
  p.isMyTurn = true;
  p.shaUsed = 0; p.drunk = false; p.skillUsed = false;
  G.phase = "judge";
  UI.renderAll();
  SFX.turn();
  log(`—— <b>${p.name}</b> 的回合 ——`);
  FX.comment(`⚔ 轮到 ${p.name} 行动`);
  Rec.event("turn", { name: p.name });
  await DLY(p.human ? 200 : 700);

  // 判定阶段
  await judgePhase(p);
  if(G.over || p.dead){ p.isMyTurn = false; return; }

  // 摸牌阶段
  G.phase = "draw"; UI.renderAll();
  await drawCards(p, 2);
  if(G.over){ p.isMyTurn = false; return; }

  // 出牌阶段（乐不思蜀跳过）
  const le = p.judgeCards.find(c => c.key === "le");
  if(le){
    log(`<b>${p.name}</b> 乐不思蜀，跳过出牌阶段……`, "lg-purple");
    await DLY(700);
  } else {
    G.phase = "play"; UI.renderAll();
    await playPhase(p);
  }
  if(G.over){ p.isMyTurn = false; return; }

  // 弃牌阶段
  G.phase = "discard"; UI.renderAll();
  await discardPhase(p);
  p.isMyTurn = false;
}

/* ---------- 判定阶段 ---------- */
async function judgePhase(p){
  for(const jc of p.judgeCards.slice()){
    p.judgeCards = p.judgeCards.filter(x => x !== jc);
    UI.renderAll();
    SFX.judge();
    const card = flipTop();
    const isLe = jc.key === "le";
    const ok = isLe ? (card.suit !== "♥") : (card.suit === "♠");
    log(`<b>${p.name}</b> 对【${jc.name}】判定：<span class="${suitColor(card.suit)}">${card.suit}${card.num}</span> → ${ok ? "生效" : "失效"}`);
    FX.comment(`🎲 【${jc.name}】判定 ${card.suit}${card.num} — ${ok ? "生效！" : "失效"}`);
    Rec.event("judge", { card: { ...card }, ok, by: p.name, for: jc.name });
    await showJudgment(card, `【${jc.name}】判定`);
    await DLY(300);
    toDiscard(card);
    let passJc = true; // 判定牌本身是否移交他人（仅闪电失效时）
    if(isLe){
      if(ok){ log(`<b>${p.name}</b> 被乐不思蜀困住！`, "lg-purple"); }
    } else {
      if(ok){
        log(`⚡ 闪电劈中了 <b>${p.name}</b>！`, "lg-red");
        toDiscard(jc);
        passJc = false;
        await dealDamage(p, 3, null, null, { electric:true });
      } else {
        const nxt = nextAlive(p);
        if(nxt.pid !== p.pid){
          nxt.judgeCards.push(jc);
          log(`⚡ 闪电移交给 <b>${nxt.name}</b>。`);
          await FX.flyCard(jc, UI.seatElOf(p), UI.seatElOf(nxt));
          UI.renderAll();
          continue;
        }
      }
    }
    if(passJc) toDiscard(jc);
    UI.renderAll();
    if(G.over || p.dead) return;
  }
}
function flipTop(){
  if(G.deck.length === 0){
    if(G.discard.length === 0){ console.error("[flipTop] 牌堆与弃牌堆均已空"); return null; }
    G.deck = shuffle(G.discard.splice(0));
    log("牌堆已空，弃牌堆重新洗入。");
  }
  return G.deck.pop() || null;
}

/* ---------- 出牌阶段 ---------- */
async function playPhase(p){
  let guard = 0;
  while(!G.over && !p.dead && guard++ < 60){
    let act;
    if(p.human && !G.aiDelegated){
      UI.enterPlayMode();
      act = await new Promise(res => { UI.S.resolve = res; });
      if(act && act.type === "ai") continue; // 代打接管：重入 AI 决策
    } else {
      if(p.pid === G.me.pid && G.aiDelegated) UI.setHint("🤖 AI 代打中……");
      await DLY(650);
      act = AI.playAction(p);
    }
    if(!act || act.type === "end") break;
    if(act.type === "skill"){
      await performSkill(p, act);
    } else {
      await performCard(p, act.card, act.use || { key: act.card.key, target: act.target });
    }
    UI.renderAll();
  }
}

/* ---------- 弃牌阶段 ---------- */
async function discardPhase(p){
  const limit = Math.max(0, p.hp);
  const extra = p.hand.length - limit;
  if(extra <= 0) return;
  const cards = [];
  if(p.human){
    while(cards.length < extra && p.hand.length > 0 && p.human && !G.aiDelegated){
      const rest = extra - cards.length;
      let dPrompt = `弃牌阶段：手牌上限为体力值（${limit}），还需弃置 <b>${rest}</b> 张（已选 ${cards.length}/${extra}）`;
      if(G.aiHint){
        const adv = AI.adviseDiscard(p, rest);
        if(adv) dPrompt += `<div class="ai-resp-hint">${adv}</div>`;
      }
      const c = await UI.askRespond({
        cards: p.hand.slice(),
        prompt: dPrompt,
        allowCancel: false,
      });
      if(!c) continue;
      const i = p.hand.indexOf(c);
      if(i >= 0) p.hand.splice(i, 1);
      cards.push(c);
      UI.renderAll();
    }
  }
  if(!p.human || G.aiDelegated){
    // AI 代打（或整局 AI）补齐弃牌
    const picks = p.hand.slice().sort((a,b) => AI.discardScore(p,a) - AI.discardScore(p,b))
      .slice(0, Math.max(0, extra - cards.length));
    for(const c of picks){ const i = p.hand.indexOf(c); if(i >= 0) p.hand.splice(i, 1); cards.push(c); }
  }
  for(const c of cards) toDiscard(c);
  log(`<b>${p.name}</b> 弃置了 ${cards.length} 张牌（${cards.map(c => c.name).join("、")}）。`);
  UI.renderAll();
  await DLY(300);
}

/* ================= 出牌结算 ================= */
async function performCard(p, card, use){
  const key = use.key;
  const isVirtualSha = key === "sha" && card.key !== "sha";
  // 抓取起飞点：人类玩家从那张手牌的位置起飞，AI 从其人物座位起飞
  let launchPoint = null;
  if(p.human || p.pid === G.me.pid){
    const cardEl = document.querySelector(`.hcard[data-cid="${card.id}"]`);
    if(cardEl) launchPoint = FX.centerOf(cardEl);
  }
  if(!launchPoint) launchPoint = FX.centerOf(UI.seatElOf(p));
  const zoneIdx = p.hand.indexOf(card);
  if(zoneIdx >= 0) p.hand.splice(zoneIdx, 1);
  UI.renderAll();

  const announce = async () => {
    log(`<b>${p.name}</b> 使用 <b>${isVirtualSha ? "杀（" + card.name + "）" : "【" + card.name + "】"}` +
        (use.target && use.target.pid !== p.pid ? ` → <b>${use.target.name}</b>` : "") + `</b>`);
    const fromEl = UI.seatElOf(p);
    await FX.flyCard(card, fromEl, $("#center-stage"), { fromPoint: launchPoint, toScale: 1.45 });
    SFX.trick();
    const toTxt = use.target && use.target.pid !== p.pid ? `，直指 ${use.target.name}` : "";
    FX.comment(`${p.name} 打出【${card.name}】${toTxt}`);
    Rec.event("play", { card: { ...card }, src: p.name, target: use.target && use.target.pid !== p.pid ? use.target.name : null, virtual: isVirtualSha });
    await showCenterCard(card, use.target && use.target.pid !== p.pid ? `${p.name} → ${use.target.name}` : `${p.name} 打出`);
  };

  switch(key){
    case "sha": {
      p.shaUsed++;
      await announce();
      await resolveSha(p, use.target, card, isVirtualSha);
      toDiscard(card);
      break;
    }
    case "tao": {
      await announce();
      await healHp(p, 1, p);
      toDiscard(card);
      break;
    }
    case "jiu": {
      await announce();
      p.drunk = true;
      FX.word("醉！", "#e8a832", true);
      log(`<b>${p.name}</b> 饮酒，下一张【杀】伤害+1。`);
      SFX.jiu();
      UI.renderAll();
      await DLY(400);
      toDiscard(card);
      break;
    }
    case "wuzhong": {
      await announce();
      FX.word("无中生有", "#c9a227", true);
      await drawCards(p, 2);
      toDiscard(card);
      break;
    }
    case "chai": case "shun": {
      await announce();
      const t = use.target;
      if(totalCards(t) === 0) break;
      if(await askWuxieChain(card.name, p, t)){ toDiscard(card); break; }
      const pick = await chooseRemoval(p, t, key === "shun");
      if(!pick){ toDiscard(card); break; }
      if(pick === "hand" || pick.zone === "hand"){
        const lost = t.hand[Math.floor(Math.random() * t.hand.length)];
        t.hand.splice(t.hand.indexOf(lost), 1);
        if(key === "shun"){ p.hand.push(lost); log(`<b>${p.name}</b> 顺手牵走了 <b>${t.name}</b> 的一张手牌。`); }
        else { toDiscard(lost); log(`<b>${p.name}</b> 拆掉了 <b>${t.name}</b> 的一张手牌。`); }
        await FX.flyCard(lost, UI.seatElOf(t), key === "shun" ? UI.seatElOf(p) : $("#discard-pile"));
      } else {
        const eq = t.equip[pick.slot];
        t.equip[pick.slot] = null;
        if(key === "shun"){ p.hand.push(eq); log(`<b>${p.name}</b> 牵走了 <b>${t.name}</b> 的【${eq.name}】！`); }
        else { toDiscard(eq); log(`<b>${p.name}</b> 拆掉了 <b>${t.name}</b> 的【${eq.name}】！`); }
        await FX.flyCard(eq, UI.seatElOf(t), key === "shun" ? UI.seatElOf(p) : $("#discard-pile"));
      }
      if(key === "chai") SFX.hurt();
      UI.renderAll();
      toDiscard(card);
      addGrudge(t, p, 2);
      break;
    }
    case "juedou": {
      await announce();
      if(await askWuxieChain("决斗", p, use.target)) { toDiscard(card); break; }
      await resolveDuel(p, use.target, card);
      toDiscard(card);
      break;
    }
    case "nanman": case "wanjian": {
      await announce();
      if(key === "nanman") FX.fireRise(); else { FX.arrowRain(); SFX.arrows(); }
      await DLY(500);
      if(await askWuxieChain(card.name, p, null)) { toDiscard(card); break; }
      for(const t of G.players){
        if(t.pid === p.pid || t.dead) continue;
        if(await askWuxieChain(card.name, p, t, true)) continue;
        if(key === "nanman"){
          const sha = await askForCard(t, c => canUseAsSha(t, c), 1, `<b>${p.name}</b> 发动【南蛮入侵】— 请打出一张【杀】，否则受 1 点伤害（${t.name}）`, true, { scene:"nanman" });
          if(sha){
            FX.word("杀", "#e0665c", true);
            await FX.flyCard(sha, UI.seatElOf(t), $("#center-stage"), { toScale: 1.1 });
            toDiscard(sha); SFX.sha();
            await DLY(350);
          }
          else await dealDamage(t, 1, p, null, { trick: card.name });
        } else {
          const shan = await askForCard(t, c => canUseAsShan(t, c), 1, `<b>${p.name}</b> 发动【万箭齐发】— 请打出一张【闪】，否则受 1 点伤害（${t.name}）`, true, { scene:"wanjian" });
          if(shan){
            FX.shieldAt(UI.seatElOf(t));
            FX.word("闪", "#7fd4ff", true);
            await FX.flyCard(shan, UI.seatElOf(t), $("#center-stage"), { toScale: 1.1 });
            toDiscard(shan); SFX.shan();
            await DLY(350);
          }
          else await dealDamage(t, 1, p, null, { trick: card.name });
        }
        if(G.over) break;
      }
      toDiscard(card);
      break;
    }
    case "taoyuan": {
      await announce();
      if(await askWuxieChain("桃园结义", p, null)) { toDiscard(card); break; }
      FX.word("桃园结义", "#7fc97f", true);
      for(const t of G.players){
        if(!t.dead && t.hp < t.maxHp) await healHp(t, 1, p);
      }
      SFX.heal();
      toDiscard(card);
      break;
    }
    case "wugu": {
      await announce();
      if(await askWuxieChain("五谷丰登", p, null)) { toDiscard(card); break; }
      G._wuguInProgress = true; // 亮出的牌暂离各区域，测试审计跳过此过程
      const shown = [];
      for(let i = 0; i < G.players.filter(x => !x.dead).length; i++){
        const c = flipTop();
        if(c) shown.push(c);
      }
      if(shown.length){
        let cur = p;
        do {
          if(!cur.dead && shown.length){
            let pick;
            if(cur.human){
              pick = await new Promise(res => UI.modal({
                title:"五谷丰登", desc:"选择一张牌收入手中：", cards:shown,
                onPick:(c) => res(c),
              }));
            } else {
              pick = AI.wuguPick(cur, shown);
              await DLY(400);
            }
            if(!pick) break;
            shown.splice(shown.indexOf(pick), 1);
            cur.hand.push(pick);
            log(`<b>${cur.name}</b> 选择了【${pick.name}】。`);
            await FX.flyCard(pick, $("#center-stage"), UI.seatElOf(cur));
            UI.renderAll();
          }
          cur = nextAlive(cur);
        } while(cur.pid !== p.pid && shown.length);
      }
      for(const c of shown) toDiscard(c);
      G._wuguInProgress = false;
      toDiscard(card);
      break;
    }
    case "le": {
      await announce();
      const t = use.target;
      if(await askWuxieChain("乐不思蜀", p, t)) { toDiscard(card); break; }
      t.judgeCards.push(card);
      log(`<b>${t.name}</b> 的判定区放置了【乐不思蜀】。`, "lg-purple");
      addGrudge(t, p, 2);
      UI.renderAll();
      break;
    }
    case "shandian": {
      await announce();
      p.judgeCards.push(card);
      log(`<b>${p.name}</b> 的判定区放置了【闪电】。⚡`);
      UI.renderAll();
      break;
    }
    default:
      if(card.cat === "equip"){
        await announce();
        equipCard(p, card);
      }
  }
  UI.renderAll();
}

function equipCard(p, card){
  const old = p.equip[card.slot];
  if(old){ toDiscard(old); }
  p.equip[card.slot] = card;
  SFX.equip();
  log(`<b>${p.name}</b> 装备了【${card.name}】。`);
  UI.renderAll();
}

/* ---------- 杀的完整结算 ---------- */
async function resolveSha(src, target, card, isVirtual){
  SFX.sha();
  FX.word("杀！", "#e04a3f");
  await DLY(450);
  const need = (src.hero.id === "lvbu" ? 2 : 1);
  let dodged = true, shanCount = 0;
  const estDmg = 1 + (src.drunk ? 1 : 0);
  const dmgTxt = `${estDmg} 点${src.drunk ? "（酒杀）" : ""}`;
  while(shanCount < need){
    const shan = await askForCard(target, c => canUseAsShan(target, c), 1,
      `<b>${src.name}</b> 对你使用【杀】（伤害 ${dmgTxt}${need > 1 ? "，【无双】：需两张闪" : ""}）— 请出【闪】躲避（${target.name}）`, true, { allowBagua:true, src, scene:"sha" });
    if(shan === "bagua"){ shanCount++; log(`<b>${target.name}</b> 八卦阵判定生效，视为出【闪】。`); FX.comment(`${target.name} 的八卦阵显灵，视为【闪】！`); continue; }
    if(!shan){ dodged = false; break; }
    shanCount++;
    FX.shieldAt(UI.seatElOf(target));
    FX.word("闪！", "#7fd4ff", true);
    FX.comment(`🛡 ${target.name} 打出【${shan.name}】，闪过一劫！`);
    Rec.event("reply", { card: { ...shan }, src: target.name, for: "闪" });
    await FX.flyCard(shan, UI.seatElOf(target), $("#center-stage"), { toScale: 1.1 });
    toDiscard(shan);
    SFX.shan();
    UI.renderAll();
    await DLY(420);
  }
  if(dodged){
    // 青龙偃月刀：追杀
    if(src.equip.weapon?.key === "qinglong" && !src.dead && !target.dead){
      const again = await askForCard(src, c => canUseAsSha(src, c), 1, `【青龙偃月刀】发动！是否立刻再出一张【杀】？（${src.name}）`, true);
      if(again){
        log(`<b>${src.name}</b> 发动青龙偃月刀，追击一刀！`);
        UI.renderAll();
        await FX.flyCard(again, UI.seatElOf(src), UI.seatElOf(target));
        SFX.sha();
        toDiscard(again);
        await resolveSha(src, target, again, true);
        return;
      }
    }
    // 贯石斧：被闪抵消后可弃两张牌强行命中
    if(src.equip.weapon?.key === "guanshi" && !src.dead && (src.hand.length) >= 2 && (src.human && !G.aiDelegated ? await askHumanBool(src, "【贯石斧】发动：弃两张牌，令此【杀】依然命中？") : AI.wantPiercing(src))){
      const sacs = await takeTwoCardsForAxe(src);
      if(sacs){
        log(`<b>${src.name}</b> 弃置两张牌发动【贯石斧】，强行命中！`);
        await dealDamage(target, 1, src, card);
        return;
      }
    }
    log(`<b>${target.name}</b> 躲过了【杀】。`);
    return;
  }
  let dmg = 1;
  if(src.drunk){ dmg = 2; src.drunk = false; FX.word("酒杀！", "#e8a832", true); }
  await dealDamage(target, dmg, src, card);
  if(src.human && src.equip.weapon?.key === "qinglong") src._lastShaTarget = target;
}

async function takeTwoCardsForAxe(src){
  const pool = src.hand.slice();
  if(pool.length < 2) return null;
  const cards = [];
  if(src.human){
    while(cards.length < 2 && src.hand.length > 0){
      const c = await UI.askRespond({
        cards: src.hand.slice(),
        prompt:`【贯石斧】：弃置两张牌令【杀】强行命中（还需 ${2 - cards.length} 张）`,
        allowCancel: cards.length === 0,
      });
      if(!c) return null; // 放弃
      const i = src.hand.indexOf(c);
      if(i >= 0) src.hand.splice(i, 1);
      cards.push(c);
      UI.renderAll();
    }
    if(cards.length < 2){ for(const c of cards){ src.hand.push(c); } UI.renderAll(); return null; }
  } else {
    const picks = pool.sort((a,b) => AI.discardScore(src,a) - AI.discardScore(src,b)).slice(0, 2);
    for(const c of picks){ const i = src.hand.indexOf(c); if(i >= 0) src.hand.splice(i, 1); cards.push(c); }
  }
  for(const c of cards) toDiscard(c);
  UI.renderAll();
  return cards;
}
function countEquips(p){ return Object.values(p.equip).filter(Boolean).length; }

/* ---------- 决斗 ---------- */
async function resolveDuel(src, target, card){
  FX.word("决斗！", "#b39ae0");
  SFX.duel();
  await DLY(500);
  let cur = target, other = src;
  while(!G.over){
    const n = other.hero.id === "lvbu" ? 2 : 1; // 对面是吕布则需两张杀
    let played = true;
    for(let i = 0; i < n; i++){
      const sha = await askForCard(cur, c => canUseAsSha(cur, c), 1, `与 <b>${other.name}</b> 决斗中 — 请打出一张【杀】，否则受 1 点伤害（${cur.name}）`, true, { scene:"juedou" });
      if(!sha){ played = false; break; }
      FX.word("杀", "#e0665c", true);
      await FX.flyCard(sha, UI.seatElOf(cur), $("#center-stage"), { toScale: 1.1 });
      toDiscard(sha); SFX.sha();
      UI.renderAll();
      await DLY(400);
    }
    if(!played){
      FX.comment(`⚔ ${cur.name} 不敌，决斗落败！`);
      await dealDamage(cur, 1, other, card, { duel:true });
      break;
    }
    [cur, other] = [other, cur];
    if(G.over || cur.dead || other.dead) break;
  }
}

/* ---------- 伤害 / 治疗 ---------- */
async function dealDamage(t, n, src, card, opt = {}){
  if(t.dead || G.over) return;
  t.hp -= n;
  t._lastDamageSource = src && src.pid !== t.pid ? src : (t._lastDamageSource || null);
  UI.renderAll();
  const el = UI.seatElOf(t);
  el.classList.add("hurt");
  SFX.hurt();
  FX.shakeScreen();
  FX.numberAt(el, `-${n}`);
  FX.particles(el, opt.electric ? "⚡" : "💧", 5, { up: 50 });
  if(opt.electric) FX.boltAt(el);
  if(!t.human) setTimeout(() => el.classList.remove("hurt"), 520);
  log(`<span class="lg-red">💥 <b>${t.name}</b> 受到 ${n} 点${opt.electric ? "雷电" : opt.trick || ""}伤害${src && src.pid !== t.pid ? `（来自 <b>${src.name}</b>）` : ""}，剩余体力 ${Math.max(0, t.hp)}。</span>`);
  FX.comment(`💥 ${t.name} 中招！损失 ${n} 点${opt.electric ? "雷电" : ""}伤害（剩 ${Math.max(0, t.hp)}）`);
  Rec.event("damage", { n, target: t.name, src: src ? src.name : null, hp: Math.max(0, t.hp), electric: !!opt.electric });
  if(src && src.pid !== t.pid){
    addGrudge(t, src, n * 2);
    // 打主公者，全场皆知其反贼相；斩杀反贼相者，彰显忠义
    if(t.pid === G.zhu.pid) AI.markAntiZhu(src);
    else if(t.reputation === "anti") AI.markProZhu(src, t);
  }
  if(src && card && src.hero.id === "caocao" && src.pid !== t.pid && !src.dead){
    // 奸雄：获得造成伤害的牌
    const i = G.discard.indexOf(card);
    if(i >= 0){
      G.discard.splice(i, 1);
      src.hand.push(card);
      log(`<b>${src.name}</b> 发动【奸雄】，获得了【${card.name}】。`);
      await FX.flyCard(card, $("#discard-pile"), UI.seatElOf(src));
    }
  }
  await DLY(700);
  if(t.hp <= 0) await dying(t);
}

async function healHp(t, n, src){
  if(t.dead) return;
  const before = t.hp;
  t.hp = Math.min(t.maxHp, t.hp + n);
  if(t.hp === before) return;
  const el = UI.seatElOf(t);
  FX.numberAt(el, `+${t.hp - before}`, true);
  FX.particles(el, "💚", 3, { up: 40 });
  SFX.heal();
  log(`<b>${t.name}</b> 回复 ${t.hp - before} 点体力（${t.hp}/${t.maxHp}）。`, "lg-green");
  FX.comment(`💚 ${t.name} 回复 ${t.hp - before} 点体力（${t.hp}/${t.maxHp}）`);
  Rec.event("heal", { n: t.hp - before, target: t.name });
  UI.renderAll();
  await DLY(500);
}

/* ---------- 濒死 ---------- */
async function dying(t){
  log(`⚠️ <b>${t.name}</b> 濒死！`, "lg-red");
  FX.comment(`⚠️ ${t.name} 命悬一线！`);
  Rec.event("dying", { name: t.name });
  FX.flash("rgba(160,20,20,.35)", 500);
  let need = 1 - t.hp;
  let cur = t;
  let looped = 0;
  while(t.hp <= 0 && looped++ < 5 && !G.over){
    const saver = cur;
    if(!saver.dead){
      // AI 只救自己人；人类自行抉择
      const willing = saver.human ? true : AI.wantSave(saver, t);
      if(willing){
        const tao = await askForCard(saver,
          c => c.key === "tao" || (c.key === "jiu" && saver.pid === t.pid) || (saver.hero.id === "huatuo" && !saver.isMyTurn && SUIT_RED(c.suit) && saver.pid === t.pid),
          need, `请对濒死的 <b>${t.name}</b> 使用【桃】${saver.pid !== t.pid ? "" : "或【酒】"}（${saver.name}）`, true, { scene:"dying" });
        if(tao){
          await FX.flyCard(tao, UI.seatElOf(saver), UI.seatElOf(t));
          await healHp(t, 1, saver);
          toDiscard(tao);
          need = 1 - t.hp;
          if(need <= 0) break;
        }
      }
    }
    cur = nextAlive(cur);
    if(cur.pid === t.pid) looped = 10; // 转一圈无人救
  }
  if(t.hp <= 0) await die(t, t._lastDamageSource);
}

/* ---------- 死亡 ---------- */
async function die(p, killer){
  p.dead = true; p.alive = false;
  for(const c of p.hand.splice(0)) toDiscard(c);
  for(const c of p.judgeCards.splice(0)) toDiscard(c);
  for(const s of Object.keys(p.equip)){ if(p.equip[s]){ toDiscard(p.equip[s]); p.equip[s] = null; } }
  SFX.die();
  FX.particles(UI.seatElOf(p), "💀", 4, { up: 60 });
  log(`☠️ <b>${p.name}</b> 阵亡！身份是 —— <b style="color:${ROLES[p.role].hex}">${ROLES[p.role].name}</b>`);
  FX.comment(`☠️ ${p.name} 倒下了！身份揭晓：${ROLES[p.role].name}`);
  Rec.event("die", { name: p.name, role: p.role });
  UI.renderAll();
  await DLY(800);
  if(killer && !killer.dead){
    if(p.role === "fan"){
      log(`凶手 <b>${killer.name}</b> 斩杀反贼，摸三张牌！`);
      await drawCards(killer, 3);
    } else if(p.role === "zhong" && killer.pid === G.zhu.pid){
      log(`主公误杀忠臣！弃置所有牌以示哀悼。`);
      const kh = killer.hand.splice(0);
      for(const c of kh) toDiscard(c);
      for(const s of Object.keys(killer.equip)){ if(killer.equip[s]){ toDiscard(killer.equip[s]); killer.equip[s] = null; } }
      UI.renderAll();
    }
  }
  if(p.human){
    G.humanDeadFast = true;
    UI.setHint("你已阵亡，进入观战模式……");
  }
  checkOver();
}

/* ---------- 无懈可击（支持嵌套：无懈可以被无懈抵消，效果逐层反转） ----------
 * 返回 true = 原锦囊最终被抵消 */
async function askWuxieChain(trickName, source, target, depth = 0){
  if(!G.players.some(p => !p.dead && p.hand.some(c => c.key === "wuxie"))) return false;
  let cur = source;
  for(let i = 0; i < G.players.length; i++){
    const p = G.players[(source.pid + i) % G.players.length];
    if(p.dead || !p.hand.some(c => c.key === "wuxie")) continue;
    const want = p.human && !G.aiDelegated
      ? await askWuxieModal(p, depth === 0
          ? `【${trickName}】${target ? `（目标 ${target.name}）` : ""}即将生效 — 是否出【无懈可击】抵消？`
          : `这张【无懈可击】抵消了【${trickName}】 — 是否再出【无懈可击】反制（原锦囊将恢复生效）？`, trickName, target)
      : AI.wantWuxieNest(p, trickName, target, source, depth);
    if(!want) continue;
    const wx = p.hand.find(c => c.key === "wuxie");
    p.hand.splice(p.hand.indexOf(wx), 1);
    UI.renderAll();
    log(`<b>${p.name}</b> 打出并弃置【无懈可击】${depth > 0 ? "，反制了这张【无懈可击】" : ""}！`);
    FX.comment(`🛡 ${p.name} 打出【无懈可击】${depth > 0 ? "反制！" : "，化解了【" + trickName + "】"}`);
    Rec.event("reply", { src: p.name, for: "无懈可击", target: target ? target.name : null, counter: depth > 0 });
    await FX.flyCard(wx, UI.seatElOf(p), $("#center-stage"));
    FX.shieldAt($("#center-stage"));
    FX.word(depth > 0 ? "反制！" : "无懈可击", "#7fd4ff", true);
    SFX.wuxie();
    toDiscard(wx);
    await DLY(600);
    // 递归：这张无懈可被下一张无懈反制 → 效果反转
    const counterWuxie = await askWuxieChain(trickName, nextAlive(p), target, depth + 1);
    return !counterWuxie;
  }
  return false;
}

/* ---------- 拆/牵：选一张牌 ---------- */
async function chooseRemoval(src, t, isShun){
  const eqs = [];
  for(const s of Object.keys(t.equip)) if(t.equip[s]) eqs.push({ ...t.equip[s], zone:"equip", slot:s, zoneId:"eq:" + s });
  const hasHand = t.hand.length > 0;
  if(src.human){
    return new Promise(res => {
      const btns = [];
      UI.modal({
        title: isShun ? "顺手牵羊" : "过河拆桥",
        desc: `选择 <b>${t.name}</b> 的一张牌（手牌未知，共 ${t.hand.length} 张）：`,
        cards: eqs.map(e => ({ ...e })),
        btns: hasHand ? [{ label: `随机一张手牌（🂠×${t.hand.length}）`, primary:true, cb: () => res("hand") }] : [],
        onPick: (c, i) => res(eqs[i]),
      });
    });
  }
  const pick = AI.pickRemoval(src, t, eqs, t.hand.length);
  if(pick === "hand") return "hand";
  return eqs.find(e => e.zoneId === pick) || (hasHand ? "hand" : eqs[0] || null);
}

/* ================= 询问系统 ================= */
/* 卡牌在舞台中央放大停留展示（打出的牌 / 判定牌 / 响应牌），便于看清插画细节 */
async function showCenterCard(card, label = "", holdMs = 1300){
  const zone = document.getElementById("play-zone");
  if(!zone) return;
  const wrap = document.createElement("div");
  wrap.className = "played-card center-show judgment-show";
  wrap.innerHTML = cardFaceHTML(card) + (label ? `<div class="played-label">${label}</div>` : "");
  zone.appendChild(wrap);
  await DLY(holdMs);
  wrap.remove();
}
const showJudgment = (card, label) => showCenterCard(card, label, 1200);

/* 八卦阵判定：翻牌 → 停留展示 → 判定红/黑。返回是否生效 */
async function doBaguaJudge(p){
  const card = flipTop();
  const ok = SUIT_RED(card.suit);
  log(`<b>${p.name}</b> 八卦阵判定：<span class="${suitColor(card.suit)}">${card.suit}${card.num}</span> → ${ok ? "红色，视为【闪】！" : "黑色，失效。"}`);
  FX.comment(`🌀 八卦阵判定 ${card.suit}${card.num} — ${ok ? "视为【闪】！" : "失效"}`);
  await showJudgment(card, "八卦阵判定");
  toDiscard(card);
  UI.renderAll();
  return ok;
}

/* 人类的三选一：用闪 / 八卦判定 / 放弃 */
function askBaguaChoice(p, prompt, hasShan){
  return new Promise(res => {
    UI.modal({
      title: "八卦阵",
      desc: `${prompt}<br>${hasShan ? "你有【闪】可直接使用，也可以改为发动八卦阵赌判定。" : "你没有【闪】，可以发动八卦阵赌判定（红色视为闪）。"}`,
      btns: [
        ...(hasShan ? [{ label: "用【闪】", primary: true, cb: () => res("card") }] : []),
        { label: "八卦判定", primary: !hasShan, cb: () => res("bagua") },
        { label: "放 弃", cb: () => res("decline") },
      ],
    });
  });
}

/* 向 p 要一张符合条件的牌（响应场景）。成功则该牌自动离开手牌。
 * 返回 card / "bagua" / null */
async function askForCard(p, filter, count, prompt, allowDecline, opt = {}){
  const cands = p.hand.filter(filter);
  // 八卦阵：无论是否手握闪，都可以选择赌判定
  if(opt.allowBagua && p.equip.armor){
    if(p.human && !G.aiDelegated){
      const choice = await askBaguaChoice(p, prompt, cands.length >= count);
      if(choice === "bagua"){
        if(await doBaguaJudge(p)) return "bagua";
        // 判定失败：继续走手牌选择（若放弃则由下方 cands 流程处理）
      } else if(choice === "decline"){
        return null;
      }
    } else if(cands.length < count && Math.random() < .8){
      // AI：无闪才赌八卦
      if(await doBaguaJudge(p)) return "bagua";
    }
  }
  if(!cands.length) return null;
  let picked;
  if(p.human && !G.aiDelegated){
    let promptFull = prompt;
    if(G.aiHint && opt.scene){
      const adv = AI.adviseRespond(p, opt.scene, opt.src ? opt.src.name : null);
      if(adv) promptFull += `<div class="ai-resp-hint">${adv}</div>`;
    }
    picked = await UI.askRespond({ cards: cands, prompt: promptFull, allowCancel: allowDecline });
    if(!picked) return null;
  } else {
    await DLY(300);
    picked = cands[0];
  }
  const i = p.hand.indexOf(picked);
  if(i >= 0) p.hand.splice(i, 1);
  UI.renderAll();
  return picked;
}

async function askHumanBool(p, text, canDo = true){
  return new Promise(res => {
    UI.modal({
      title: "发动技能？",
      desc: text,
      btns: [
        ...(canDo ? [{ label:"发 动", primary:true, cb: () => res(true) }] : []),
        { label:"放 弃", cb: () => res(false) },
      ],
    });
  });
}

/* 无懈可击专用询问：显示持有张数与 AI 建议，出/不出 双按钮 */
function askWuxieModal(p, text, trickName, target){
  const cnt = p.hand.filter(c => c.key === "wuxie").length;
  let hint = "";
  if(G.aiHint && target){
    hint = AI.isFriend(p, target) || target.pid === p.pid
      ? `<div class="ai-resp-hint">💡 建议：出——${target.name} 是你的友方/自己，这张【${trickName}】对你们不利。</div>`
      : AI.isEnemy(p, target)
        ? `<div class="ai-resp-hint">💡 建议：不出——目标 ${target.name} 是你的敌对目标，让锦囊生效对你有利。</div>` : "";
  }
  return new Promise(res => {
    UI.modal({
      title: "无懈可击",
      desc: `${text}${hint}<br><span style="color:#a08e66">你手中有 ${cnt} 张【无懈可击】。</span>`,
      btns: [
        { label: "出【无懈可击】", primary: true, cb: () => res(true) },
        { label: "不 出", cb: () => res(false) },
      ],
    });
  });
}

/* ================= 技能结算 ================= */
async function performSkill(p, act){
  if(act.skill === "zhiheng"){
    p.skillUsed = true;
    for(const c of act.cards){ const i = p.hand.indexOf(c); if(i >= 0) p.hand.splice(i, 1); toDiscard(c); }
    UI.renderAll();
    FX.word("制衡", "#e8c832", true);
    FX.comment(`✨ ${p.name} 发动【制衡】，弃 ${act.cards.length} 张换 ${act.cards.length} 张`);
    Rec.event("skill", { src: p.name, skill: "制衡" });
    log(`<b>${p.name}</b> 发动【制衡】，弃置 ${act.cards.length} 张牌。`);
    await DLY(400);
    await drawCards(p, act.cards.length);
  }
  else if(act.skill === "rende"){
    p.skillUsed = true;
    for(const c of act.cards){ const i = p.hand.indexOf(c); if(i >= 0) p.hand.splice(i, 1); }
    const t = act.target;
    t.hand.push(...act.cards);
    UI.renderAll();
    FX.word("仁德", "#7fb3e0", true);
    FX.comment(`✨ ${p.name} 发动【仁德】，赠 ${act.cards.length} 张牌于 ${t.name}`);
    Rec.event("skill", { src: p.name, skill: "仁德", target: t.name });
    log(`<b>${p.name}</b> 发动【仁德】，将 ${act.cards.length} 张牌交给 <b>${t.name}</b>。`);
    await FX.flyCard(act.cards[0], UI.seatElOf(p), UI.seatElOf(t));
    if(act.cards.length >= 2) await healHp(p, 1, p);
  }
  else if(act.skill === "lijian"){
    p.skillUsed = true;
    const i = p.hand.indexOf(act.card); if(i >= 0) p.hand.splice(i, 1);
    toDiscard(act.card);
    const [a, b] = act.targets;
    UI.renderAll();
    FX.word("离间", "#d4507f", true);
    FX.comment(`✨ ${p.name} 发动【离间】，${a.name} 与 ${b.name} 反目成仇！`);
    Rec.event("skill", { src: p.name, skill: "离间", targets: [a.name, b.name] });
    log(`<b>${p.name}</b> 发动【离间】，弃置【${act.card.name}】，令 <b>${a.name}</b> 对 <b>${b.name}</b> 决斗！`);
    await DLY(500);
    if(await askWuxieChain("离间·决斗", p, b)) return;
    await resolveDuel(a, b, act.card);
  }
}

/* ================= 胜负 ================= */
function checkOver(){
  if(G.over) return true;
  const alive = G.players.filter(p => !p.dead);
  const zhuDead = G.zhu.dead;
  const fansAlive = alive.filter(p => p.role === "fan").length;
  const neiAlive = alive.filter(p => p.role === "nei").length;
  let winSide = null;
  if(zhuDead){
    winSide = (alive.length === 1 && neiAlive === 1) ? "nei" : "fan";
  } else if(fansAlive === 0 && neiAlive === 0){
    winSide = "zhu";
  }
  if(winSide){ G.over = true; G.winSide = winSide; finishGame(winSide); return true; }
  return false;
}

function finishGame(winSide){
  const me = G.me;
  const myWin = (winSide === "zhu" && (me.role === "zhu" || me.role === "zhong")) || winSide === me.role;
  const t = document.getElementById("result-title");
  t.textContent = myWin ? "大 获 全 胜" : "败 局 已 定";
  t.className = myWin ? "win" : "lose";
  const sub = document.getElementById("result-sub");
  const epilogues = {
    zhu: "反贼伏诛，内奸授首。汉室旗帜重立，山河再定——青史之上，必有汝名。",
    fan: "苍天已死！旧朝轰然倾覆，新的王座在废墟中升起。历史，由胜利者书写。",
    nei: "棋局终了，众人方知：笑到最后的，是那个始终沉默的人。天下，易主矣。",
    zhong: "主公安然无恙，而你浴血而立。忠义二字，从来不是史书里的轻描淡写。",
  };
  const sideName = ({ zhu:"主公方", fan:"反贼", nei:"内奸" })[winSide];
  sub.innerHTML = `${winSide === "zhu" ? "主公方" : sideName}获胜！<br>${epilogues[myWin ? me.role : "zhong"]}`;
  const roles = document.getElementById("result-roles");
  roles.innerHTML = G.players.map(p => `
    <div class="rr-card ${p.dead ? "dead" : ""} ${p.pid === me.pid ? "me" : ""}" style="animation-delay:${p.pid * .12}s">
      <div class="rr-hero">${p.hero.name}</div>
      <div class="rr-role" style="color:${ROLES[p.role].hex}">${ROLES[p.role].name}${p.pid === me.pid ? "（你）" : ""}</div>
    </div>`).join("");
  if(myWin) SFX.win(); else SFX.lose();
  document.title = myWin ? "三国杀 · 胜利" : "三国杀 · 失败";
  const replayData = Rec.finish(winSide);
  if(replayData){
    G.replayData = replayData;
    try{ localStorage.setItem("sgk_replay_last", JSON.stringify(replayData)); }catch(e){ /* 超限则跳过持久化 */ }
  }
  // 自动化验证通道：?autotest=1&autoplay=1 结束后自动进入回放播放
  if(G.autotest && replayData && location.search.includes("autoplay")){
    setTimeout(() => RP.open(replayData, { autoplay:true }), 200);
  }
  if(G.autotest) document.title = "AUTOTEST_DONE winner=" + winSide;
  else if(typeof recordStats === "function") recordStats(myWin);
  setTimeout(() => showScreen("screen-result"), G.fast ? 300 : 1600);
}
