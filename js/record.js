/* ============================================================
 * record.js —— 对局录像（事件流 + 状态快照，原创实现）
 * 录制：Rec.start / Rec.event（engine 在关键动作点调用）
 * 回放：见 replay.js 的 RP
 * ============================================================ */
"use strict";

const Rec = {
  active: false,
  events: [],
  meta: null,
  lastLog: "",        // 最近的战报文本（由 log() 通知）
  lastLogHtml: "",

  start(players){
    this.active = true;
    this.events = [];
    this.lastLog = "";
    this.lastLogHtml = "";
    this.meta = {
      startedAt: new Date().toISOString(),
      mePid: G.me.pid,
      seats: players.map(p => ({
        pid: p.pid, name: p.name, heroId: p.hero.id, heroName: p.hero.name,
        role: p.role, maxHp: p.maxHp,
      })),
    };
    this.event("init", {});
  },

  note(html){
    if(!this.active) return;
    this.lastLogHtml = html;
    this.lastLog = html.replace(/<[^>]+>/g, "");
  },

  /* 记录一个事件：自动附带渲染所需的全局快照 */
  event(type, data = {}){
    if(!this.active) return;
    this.events.push({ t: type, d: data, text: this.lastLog, html: this.lastLogHtml, snap: this.snap() });
    if(this.events.length > 5000){ // 保险丝：超长对局截断
      this.active = false;
      log("⚠ 录像长度达到上限，后续内容不再记录。");
    }
  },

  snap(){
    return structuredClone({
      round: G.round,
      phase: G.phase || "",
      turnPid: G.turnPlayer ? G.turnPlayer.pid : null,
      players: G.players.map(p => ({
        pid: p.pid, name: p.name, role: p.role,
        hp: p.hp, maxHp: p.maxHp, dead: p.dead, drunk: p.drunk,
        hand: p.hand.map(c => ({ ...c })),
        equip: {
          weapon: p.equip.weapon ? { ...p.equip.weapon } : null,
          armor: p.equip.armor ? { ...p.equip.armor } : null,
          "horse-": p.equip["horse-"] ? { ...p.equip["horse-"] } : null,
          "horse+": p.equip["horse+"] ? { ...p.equip["horse+"] } : null,
        },
        judge: p.judgeCards.map(c => ({ ...c })),
      })),
      deckN: G.deck.length,
      discardN: G.discard.length,
      discardTop: G.discard.slice(-3).map(c => ({ ...c })),
    });
  },

  /* 对局结束：停录并返回完整录像对象 */
  finish(winSide){
    if(!this.active) return null;
    this.active = false;
    const replay = {
      v: 1,
      meta: { ...this.meta, finishedAt: new Date().toISOString(), winSide },
      events: this.events,
    };
    this.events = [];
    return replay;
  },
};
