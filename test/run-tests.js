/* ============================================================
 * run-tests.js —— 无头逻辑回归测试（Node 直接跑引擎）
 * 用法：node test/run-tests.js [局数]
 * 校验：整局无异常、正常分出胜负、牌数守恒
 * ============================================================ */
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

/* ---------- DOM stub ---------- */
function makeEl(){
  return {
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    style: {}, dataset: {},
    innerHTML: "", textContent: "",
    appendChild(){}, remove(){},
    querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
    onclick: null, scrollTop: 0, scrollHeight: 0,
    children: [], firstChild: null,
    offsetWidth: 100, offsetHeight: 150,
    getBoundingClientRect(){ return { left: 0, top: 0, width: 100, height: 100 }; },
  };
}
global.document = {
  getElementById(){ return makeEl(); },
  querySelector(){ return makeEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
};
global.window = global;
global.location = { search: "" };
global.performance = { now: () => Date.now() };
global.innerWidth = 1440; global.innerHeight = 900;

/* ---------- 测试日志 ---------- */
const testLogs = [];
let captureLogs = false;

/* ---------- UI stub（注入到游戏代码之前） ---------- */
const uiStub = `
const UI = {
  S: { resolve: null },
  renderAll(){},
  enterPlayMode(){},
  cleanup(){},
  setHint(){}, setButtons(){},
  seatElOf(){ return document.createElement(); },
  logLine(html){
    if(global.traceCheck) global.traceCheck(String(html).replace(/<[^>]+>/g, ""));
  },
  modal(){},
  askRespond(){ return Promise.resolve(null); },
};
function log(html, cls){ UI.logLine(html); }
`;

const fxStub = `
const FX = {
  cardHTML(){ return ""; },
  flyCard(){ return Promise.resolve(); },
  word(){}, numberAt(){}, flash(){}, shakeScreen(){},
  particles(){}, shieldAt(){}, arrowRain(){}, boltAt(){}, fireRise(){},
  comment(){},
  centerOf(){ return { x: 0, y: 0 }; },
};
function suitColor(){ return "c-black"; }
function cardInnerHTML(){ return ""; }
function cardFaceHTML(){ return ""; }
const SFX = new Proxy({}, { get: () => () => {} });
Object.defineProperty(SFX, "muted", { get(){ return true; } });
`;

const files = ["js/data.js", "js/ai.js", "js/engine.js"];
let code = uiStub + fxStub;
// 种子化随机数：同一 seed 完整复现同一局
code += `
let __rng = Math.random;
function __seed(s){ let a = s >>> 0; __rng = function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
global.__setSeed = __seed;
`;
for(const f of files){
  code += "\n;\n" + fs.readFileSync(path.join(ROOT, f), "utf8").split("Math.random()").join("__rng()");
}
// Node 测试：把引擎延时函数短路为同步微任务，提速数百倍
code = code.replace(
  "const DLY = ms => new Promise(r => setTimeout(r, !G ? ms : G.turbo ? 0 : G.fast ? Math.min(ms, 8) : ms));",
  "const DLY = ms => Promise.resolve();"
);
// 检测重复弃牌（同一张牌被丢两次 = 牌凭空复制）+ 全量移动审计
code = code.replace(
  "function toDiscard(card){\n  G.discard.push(card);\n}",
  `function toDiscard(card){
  if(!card) throw new Error("toDiscard(null)");
  if(G.discard.includes(card)) throw new Error("DOUBLE DISCARD: " + card.name);
  G.discard.push(card);
  if(global.__mv) global.__mv("toDiscard(idx=" + G.discard.indexOf(card) + " obj=" + (G.discard[G.discard.length-1] === card) + ")", card);
}`
);
// 五谷 pick / askForCard 响应的移动打点 + 洗牌打点（split/join 免疫缩进差异）
code = code.split("cur.hand.push(pick);").join(`cur.hand.push(pick);
      if(global.__mv) global.__mv("wuguPush->" + cur.name, pick);`);
code = code.split("  if(zoneIdx >= 0) p.hand.splice(zoneIdx, 1);").join(`  if(zoneIdx >= 0) p.hand.splice(zoneIdx, 1);
  if(global.__mv) global.__mv("performSplice@" + p.name + " key=" + (use && use.key), card);`);
code = code.split("      await resolveSha(p, use.target, card, isVirtualSha);\n      toDiscard(card);").join(`      await resolveSha(p, use.target, card, isVirtualSha);
      if(global.__mv) global.__mv("caseSha-toDiscard前 card=" + card.id + " over=" + G.over, card);
      toDiscard(card);`);
code = code.split("G.discard.splice(i, 1);").join(`{ if(global.__mv) global.__mv("奸雄splice", card); G.discard.splice(i, 1); }`);
code = code.replace(
  "  const i = p.hand.indexOf(picked);\n  if(i >= 0) p.hand.splice(i, 1);\n  UI.renderAll();\n  return picked;",
  `  const i = p.hand.indexOf(picked);
  if(i >= 0) p.hand.splice(i, 1);
  if(global.__mv) global.__mv("askForCard@" + p.name, picked);
  UI.renderAll();
  return picked;`
);
code = code.replace(
  /G\.deck = shuffle\(G\.discard\.splice\(0\)\);\n(\s*)log\("牌堆已空，弃牌堆重新洗入。"\);/g,
  `const __shuffled = G.discard.splice(0);
if(global.__mv) __shuffled.forEach(c => global.__mv("shuffled->deck", c));
G.deck = shuffle(__shuffled);
$1log("牌堆已空，弃牌堆重新洗入。");`
);
code = code.split("p.hand.push(G.deck.pop());").join(`{ const __c = G.deck.pop(); if(global.__mv) global.__mv("deckPop->hand", __c); p.hand.push(__c); }`);
code = code.split("return G.deck.pop();").join(`{ const __c = G.deck.pop(); if(global.__mv) global.__mv("deckPop->flipTop", __c); return __c; }`);
code = code.replace(
  "      G.discard.splice(i, 1);\n      src.hand.push(card);",
  `      if(global.__mv) global.__mv("奸雄splice i=" + i + " lenBefore=" + G.discard.length, card);
      G.discard.splice(i, 1);
      src.hand.push(card);`
);
global.__moves = [];
global.__mv = (op, card) => {
  if(card && card.id) global.__moves.push(`${card.name}#${card.id} ${op} len=${(typeof G !== "undefined" && G && G.discard) ? G.discard.length : "?"} [${global.testLogs[global.testLogs.length-1] || ""}]`);
};
// 回合开始时校验全牌守恒
code = code.replace(
  "async function runTurn(p){\n  p.isMyTurn = true;",
  `async function runTurn(p){
  if(global.consistencyCheck) global.consistencyCheck();
  p.isMyTurn = true;`
);
global.consistencyCheck = () => {
  const g = G;
  const total = totalCardsInWorld(g);
  if(total !== g._total){
    const zones = new Set([...g.deck, ...g.discard]);
    for(const p of g.players){ p.hand.forEach(c => zones.add(c)); Object.values(p.equip).forEach(c => c && zones.add(c)); p.judgeCards.forEach(c => zones.add(c)); }
    const lost = (g._allCards || []).filter(c => !zones.has(c)).map(c => `${c.name}#${c.id}`);
    console.error(`\n!!! 牌数不守恒: ${total}/${g._total} @ 轮 ${g.round}，${g.turnPlayer?.name} 回合前。丢失: ${lost.join(", ") || "?"}`);
    // 引用级核对：丢失牌到底在不在各区
    for(const l of lost){
      const id = parseInt(l.split("#")[1]);
      const card = g._allCards.find(c => c.id === id);
      if(!card){ console.error(`  ${l}: _allCards 里无此 id`); continue; }
      console.error(`  ${l}: deck=${g.deck.indexOf(card)} discard=${g.discard.indexOf(card)}`);
      const inDiscardById = g.discard.filter(c => c.id === id);
      console.error(`  discard 中同 id 对象数: ${inDiscardById.length}`);
      const dump = arr => arr.map(c => c ? c.id : "null").join(",");
      console.error(`  deck.ids: ${dump(g.deck)}`);
      console.error(`  discard.ids: ${dump(g.discard)}`);
      for(const p of g.players) console.error(`  ${p.name}.hand.ids: ${dump(p.hand)} equip:${Object.values(p.equip).filter(Boolean).map(c=>c.id)} judge:${p.judgeCards.map(c=>c.id)}`);
      console.error("discard 长度变化轨迹:");
      console.error((global._lenLog || []).map(l => "  " + l).join("\n"));
      for(const p of g.players){
        console.error(`    ${p.name}: hand=${p.hand.indexOf(card)} judge=${p.judgeCards.indexOf(card)} equipHas=${Object.values(p.equip).includes(card)}`);
      }
      const mv = global.__moves.filter(m => m.includes("#" + id + " "));
      console.error(mv.map(m => "  [移动] " + m).join("\n"));
    }
    console.error("最近 25 条日志:");
    console.error(global.testLogs.slice(-25).join("\n"));
    throw new Error("consistency broken");
  }
};
// 每条日志粒度的守恒追踪：允许牌在"离手→入区"间的瞬时波动，只抓持续缺失
global._missStreak = 0;
global._missLine = "";
global.traceCheck = (line) => {
  if(global.captureLogs) global.testLogs.push(line);
  // 追踪 discard 长度变化与 #25 的在场状态
  if(global._traceOn && G && G.discard){
    const len = G.discard.length;
    const has25 = G.discard.some(c => c.id === 25);
    if(global._lastLen !== undefined && len !== global._lastLen){
      (global._lenLog = global._lenLog || []).push(`len ${global._lastLen}->${len} (#25在场=${global._lastHas25}->${has25}) @ ${line}`);
    }
    global._lastLen = len; global._lastHas25 = has25;
  }
};
// 让 stub 里的引用可见：把 stub 放进同一作用域
code = code.replace(/global\.document/g, "global.document");

vm.runInThisContext(`var captureLogs = null; var testLogs = null;`, { filename: "prelude.js" });
// 直接在本次 global 上声明供 stub 使用
global.captureLogs = false;
global.testLogs = testLogs;
// 替换 stub 中对 captureLogs/testLogs 的引用方式：用 global 变量
code = code.replace("if(captureLogs)", "if(global.captureLogs)")
           .replace("testLogs.push", "global.testLogs.push");

vm.runInThisContext(code, { filename: "game-bundle.js" });

/* ---------- 运行多局测试 ---------- */
const GAMES = parseInt(process.argv[2] || "20", 10);

function totalCardsInWorld(g){
  let n = g.deck.length + g.discard.length;
  for(const p of g.players){
    n += p.hand.length;
    n += Object.values(p.equip).filter(Boolean).length;
    n += p.judgeCards.length;
  }
  return n;
}

(async () => {
  let pass = 0, fail = 0;
  const wins = {};
  const SEED = parseInt(process.argv[3] || "42", 10);
  global.__setSeed(SEED + 1000);
  for(let i = 0; i < GAMES; i++){
    global.__setSeed(SEED + i * 977);
    global.captureLogs = true;
    global.testLogs.length = 0;
    let err = null, g = null;
    try{
      newGame({ role: "random" });
      g = G;
      g.autotest = true; g.fast = true; g.turbo = true;
      g.me.human = false;
      g._total = totalCardsInWorld(g);
      g._allCards = [];
      for(const p of g.players){ g._allCards.push(...p.hand); }
      g._allCards.push(...g.deck, ...g.discard);
      // 重置追踪状态，避免跨局污染
      global._allCards = g._allCards;
      global._missStreak = 0; global._missLine = "";
      global._lastLoc = null; global._sightings = [];
      global._traceDebug = true;
      global._traceOn = true;
      g.turnPlayer = g.zhu;
      await gameLoop();
    }catch(e){ err = e; }
    if(err){
      fail++;
      console.log(`\n✗ 局 ${i + 1} 崩溃: ${err.message}`);
      console.log(err.stack.split("\n").slice(0, 6).join("\n"));
      console.log("最后 12 条日志:");
      console.log(global.testLogs.slice(-12).join("\n"));
      break;
    }
    const total = totalCardsInWorld(g);
    const ok = g.over && g.winSide && total === g._total;
    if(ok){
      pass++;
      wins[g.winSide] = (wins[g.winSide] || 0) + 1;
      process.stdout.write(`✓ 局 ${i + 1}: ${g.winSide} 胜，${g.round} 轮，牌数守恒 ${total}/${g._total}，日志 ${global.testLogs.length} 条\n`);
    } else {
      fail++;
      console.log(`\n✗ 局 ${i + 1}: over=${g.over} winSide=${g.winSide} 牌数 ${total}/${g._total}（期望 ${g._total}）`);
      console.log("最后 15 条日志:");
      console.log(global.testLogs.slice(-15).join("\n"));
    }
  }
  console.log(`\n======== 结果: ${pass} 过 / ${fail} 挂 ========`);
  console.log("胜方分布:", JSON.stringify(wins));
  process.exit(fail ? 1 : 0);
})();
