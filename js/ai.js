/* ============================================================
 * ai.js —— AI 决策（身份推理 + 敌意评估 + 出牌策略）
 * ============================================================ */
"use strict";

const AI = (() => {

  /* ---------- 关系评估 ---------- */

  // 公开阵营标签：打过主公的人被全场标记为"反贼相"
  function markAntiZhu(attacker){
    if(attacker && !attacker.dead && attacker.pid !== G.zhu.pid){
      attacker.reputation = "anti";
      log(`❖ <b>${attacker.name}</b> 露出了反贼的獠牙！`, "lg-red");
    }
  }
  function markProZhu(killer, victim){
    if(killer && victim && victim.reputation === "anti"){
      killer.reputation = "pro";
      log(`❖ <b>${killer.name}</b> 斩杀反贼，忠义可鉴！`, "lg-green");
    }
  }

  // AI 眼中：t 是否敌人
  function isEnemy(p, t){
    if(t.dead || t.pid === p.pid) return false;
    const role = p.role;
    if(role === "fan"){
      if(t.role === "zhu") return true;                 // 知道谁是主公
      if(t.reputation === "pro") return true;
      if(t.reputation === "anti") return false;         // 反贼同伴
      return (p.grudge[t.pid] || 0) >= 4;
    }
    if(role === "zhong" || role === "zhu"){
      if(t.reputation === "anti") return true;
      if(t.pid === G.zhu.pid) return false;
      return (p.grudge[t.pid] || 0) >= 3;
    }
    // 内奸：先助主公除反贼，残局再图大业
    if(role === "nei"){
      const fansAlive = G.players.filter(x => !x.dead && x.role === "fan").length;
      if(fansAlive > 0){
        if(t.reputation === "anti") return true;
        if(t.pid === G.zhu.pid) return false;
        return (p.grudge[t.pid] || 0) >= 5;
      }
      // 反贼死光：人数占优（二对一残局）或主公残血/自己状态占优时提前发难
      const aliveCnt = G.players.filter(x => !x.dead).length;
      if(t.pid === G.zhu.pid){
        return aliveCnt <= 2 || p.hp > t.hp || t.hp <= 2;
      }
      return (p.grudge[t.pid] || 0) >= 4;
    }
    return false;
  }

  function isFriend(p, t){
    if(t.dead || t.pid === p.pid) return false;
    if(p.role === "fan") return t.reputation === "anti" || (t.role !== "zhu" && t.reputation !== "pro" && !isEnemy(p, t));
    if(p.role === "nei"){
      const fansAlive = G.players.filter(x => !x.dead && x.role === "fan").length;
      if(fansAlive > 0) return t.pid === G.zhu.pid || t.reputation === "pro";
      return false;
    }
    return t.pid === G.zhu.pid || t.reputation === "pro";
  }

  // 敌意打分：越高越想打
  function threatScore(p, t){
    let s = (p.grudge[t.pid] || 0);
    if(isEnemy(p, t)) s += 10;
    if(isFriend(p, t)) s -= 20;
    if(t.pid === G.zhu.pid && p.role === "fan") s += 6;
    if(t.role === "zhu" && p.role === "nei") s -= 5; // 内奸不急
    if(t.hp <= 1) s += 3;                            // 补刀
    if(t.handCount >= 6) s += 2;
    return s;
  }

  /* ---------- 通用响应 ---------- */

  // 是否愿意出闪
  function wantShan(p){
    return p.hand.some(c => canUseAsShan(p, c));
  }

  // 濒死求桃：是否救 target
  function wantSave(p, target){
    if(!p.hand.some(c => c.key === "tao" || c.key === "jiu" || (p.hero.id === "huatuo" && !p.isMyTurn && SUIT_RED(c.suit)))) return false;
    if(target.pid === p.pid) return true;
    if(p.role === "fan") return target.reputation === "anti" || target.role === "fan";
    if(p.role === "nei"){
      const fansAlive = G.players.filter(x => !x.dead && x.role === "fan").length;
      if(target.pid === G.zhu.pid) return fansAlive > 0;  // 反贼未除尽，主公不能死
      return target.reputation === "anti" && fansAlive > 0;
    }
    return target.pid === G.zhu.pid || isFriend(p, target) || target.role === "zhu";
  }

  // 是否出无懈
  function wantWuxie(p, trickName, target, source){
    if(trickName === "无懈可击") return false;
    if(!target){
      // 无指定目标的全局锦囊：桃园/五谷对敌有利时低概率抵消
      if(trickName === "桃园结义" || trickName === "五谷丰登") return Math.random() < .12;
      return false;
    }
    const friendly = target.pid === p.pid || isFriend(p, target);
    const hostile = isEnemy(p, target);
    if(friendly && ["乐不思蜀","过河拆桥","顺手牵羊","决斗","南蛮入侵","万箭齐发","闪电"].includes(trickName)) return Math.random() < .85;
    if(hostile && ["桃园结义","五谷丰登","无中生有"].includes(trickName)) return Math.random() < .4;
    return false;
  }

  // 嵌套无懈：第 0 层按常规判断；接力层简化为有限概率反制
  function wantWuxieNest(p, trickName, target, source, depth){
    if(depth === 0) return wantWuxie(p, trickName, target, source);
    return Math.random() < .35;
  }

  // 弃牌打分：唯一的一张闪要重权重保住
  function discardScore(p, c){
    switch(c.key){
      case "tao": return 10 + (p.maxHp - p.hp) * 2;
      case "shan": {
        const shanCnt = p.hand.filter(x => canUseAsShan(p, x)).length;
        return 8 + (shanCnt <= 1 ? 8 : 0);
      }
      case "sha": return 7;
      case "jiu": return p.hp <= 2 ? 8 : 5;
      case "wuzhong": return 6;
      case "juedou": return 5;
      case "le": return 5;
      case "shandian": return p.hero.id === "caocao" ? 3 : 4;
      case "wuxie": return 5;
      case "chai": return 4; case "shun": return 4;
      case "nanman": return 4; case "wanjian": return 4; case "taoyuan": return 4; case "wugu": return 4;
      default: return 3;
    }
  }

  /* ---------- 出牌阶段主决策 ----------
   * 返回 {type:'end'} 或 {type:'card', card, asKey?, target?} 或 {type:'skill', ...}
   */
  function playAction(p){
    const others = G.players.filter(x => !x.dead && x.pid !== p.pid);
    const hand = p.hand;

    // --- 装备优先（坐骑按局势评估价值） ---
    const othersAll = G.players.filter(x => !x.dead && x.pid !== p.pid);
    const enemyFoes = othersAll.filter(x => isEnemy(p, x));
    for(const c of hand){
      if(c.cat === "equip"){
        const cur = p.equip[c.slot];
        if(c.slot === "weapon"){
          if(!cur || (CARD_DEFS[c.key].range || 1) > (CARD_DEFS[cur.key].range || 1))
            return { type:"card", card:c };
        } else if(c.slot === "armor"){
          if(!cur) return { type:"card", card:c };
        } else {
          // 坐骑：+1 马在被贴脸或残血时有价值；-1 马在最近敌人超出攻击范围时有价值
          if(cur && cur.key === c.key) continue;
          const worth = c.slot === "horse+"
            ? (p.hp <= 2 || enemyFoes.some(x => dist(p, x) <= 2))
            : enemyFoes.some(x => dist(p, x) >= 2);
          if(worth) return { type:"card", card:c };
        }
      }
    }

    // --- 自保：残血吃桃 ---
    if(p.hp <= 2 && p.hp < p.maxHp){
      const tao = hand.find(c => c.key === "tao");
      if(tao) return { type:"card", card:tao };
    }

    // --- 爆发牌 ---
    const wuzhong = hand.find(c => c.key === "wuzhong");
    if(wuzhong) return { type:"card", card:wuzhong };

    // --- 制衡：手牌质量差时 ---
    if(p.hero.id === "sunquan" && !p.skillUsed && hand.length >= 2){
      const junk = hand.filter(c => discardScore(p, c) <= 4);
      if(junk.length >= 2 || (junk.length >= 1 && hand.length <= 2))
        return { type:"skill", skill:"zhiheng", cards:junk };
    }

    // --- 乐不思蜀：贴敌人 ---
    const le = hand.find(c => c.key === "le");
    if(le){
      const t = bestTarget(p, others.filter(x => x.pid !== G.zhu.pid || p.role === "fan" || p.role === "nei"), x => !x.judgeCards.some(j => j.key === "le"));
      if(t) return { type:"card", card:le, target:t };
    }

    // --- 闪电：自己有八卦或血量健康才挂 ---
    const sd = hand.find(c => c.key === "shandian");
    if(sd && p.hp >= 3 && !p.judgeCards.some(j => j.key === "shandian"))
      return { type:"card", card:sd, target:p };

    // --- 决斗：挑手牌少或残血的敌人 ---
    const jd = hand.find(c => c.key === "juedou");
    if(jd){
      const t = bestTarget(p, others, x => threatScore(p, x) > 0 && x.hp <= 3);
      if(t) return { type:"card", card:jd, target:t };
    }

    // --- 杀 ---
    const shaCandidates = hand.filter(c => canUseAsSha(p, c));
    const canSha = p.hero.id === "zhangfei" || p.equip.weapon?.key === "nulver" || p.shaUsed < 1;
    if(canSha && shaCandidates.length){
      const inRange = others.filter(x => dist(p, x) <= attackRange(p) && canBeShaTarget(p, x));
      const t = bestTarget(p, inRange, x => threatScore(p, x) > -1);
      if(t){
        // 酒杀连招（残局收割或打主公）
        const jiu = hand.find(c => c.key === "jiu");
        if(jiu && !p.drunk && (t.hp <= 2 || (t.pid === G.zhu.pid && p.role === "fan")) && Math.random() < .8)
          return { type:"card", card:jiu };
        const realSha = shaCandidates.find(c => c.key === "sha");
        if(realSha) return { type:"card", card:realSha, target:t };
        // 武圣等虚拟杀：必须显式声明按【杀】结算
        return { type:"card", card:shaCandidates[0], target:t, use:{ key:"sha", target:t } };
      }
    }

    // --- AOE：敌多友少才放 ---
    for(const key of ["nanman","wanjian"]){
      const c = hand.find(x => x.key === key);
      if(!c) continue;
      const foes = others.filter(x => threatScore(p, x) > 2).length;
      const friends = others.filter(x => isFriend(p, x)).length;
      if(foes >= friends + 1 || (foes >= 2 && friends === 0)) return { type:"card", card:c };
    }

    // --- 桃园 / 五谷 ---
    const taoyuan = hand.find(c => c.key === "taoyuan");
    if(taoyuan && p.hp < p.maxHp) return { type:"card", card:taoyuan };
    const wugu = hand.find(c => c.key === "wugu");
    if(wugu && others.filter(x => isFriend(p, x)).length >= others.filter(x => isEnemy(p, x)).length)
      return { type:"card", card:wugu };

    // --- 拆桥 / 牵羊 ---
    for(const key of ["chai","shun"]){
      const c = hand.find(x => x.key === key);
      if(!c) continue;
      let pool = others;
      if(key === "shun") pool = pool.filter(x => dist(p, x) <= 1);
      const t = bestTarget(p, pool, x => threatScore(p, x) > 0 && totalCards(x) > 0);
      if(t) return { type:"card", card:c, target:t };
    }

    // --- 仁德：给"朋友"塞牌回血 ---
    if(p.hero.id === "liubei" && !p.skillUsed && p.hp < p.maxHp && hand.length >= 3){
      const friend = others.find(x => isFriend(p, x));
      if(friend){
        const give = hand.slice().sort((a,b) => discardScore(p,a) - discardScore(p,b)).slice(0, 2);
        return { type:"skill", skill:"rende", cards:give, target:friend };
      }
    }

    // --- 离间 ---
    if(p.hero.id === "diaochan" && !p.skillUsed && hand.length > 1){
      const males = others.filter(x => x.hero.gender === "m" && threatScore(p, x) > 2);
      if(males.length >= 2){
        const discard = hand.slice().sort((a,b) => discardScore(p,a) - discardScore(p,b))[0];
        return { type:"skill", skill:"lijian", card:discard, targets:males.slice(0, 2) };
      }
    }

    // --- 酒（没杀可打但血低时留着；否则不用）---
    return { type:"end" };
  }

  function bestTarget(p, pool, filter){
    const cands = pool.filter(filter || (() => true));
    if(!cands.length) return null;
    return cands.sort((a, b) => threatScore(p, b) - threatScore(p, a))[0];
  }

  /* ---------- 五谷选牌 ---------- */
  function wuguPick(p, cards){
    // 残血拿桃，否则拿分最高
    if(p.hp < p.maxHp){
      const tao = cards.find(c => c.key === "tao");
      if(tao) return tao;
    }
    return cards.slice().sort((a,b) => discardScore(p,b) - discardScore(p,a))[0];
  }

  /* ---------- 拆/牵 目标牌选择 ---------- */
  function pickRemoval(p, t, equipCards, handCount){
    // 优先拆武器/防具，其次随机手牌
    if(equipCards.length){
      const armor = equipCards.find(c => c.slot === "armor");
      const weapon = equipCards.find(c => c.slot === "weapon");
      return (armor || weapon || equipCards[0]).zoneId;
    }
    return "hand"; // 随机手牌
  }

  /* ---------- 贯石斧：是否强命 ---------- */
  function wantPiercing(p){
    return p.hand.length >= 3 || Math.random() < .4;
  }

  /* ---------- 青龙刀：是否追杀 ---------- */
  function wantChase(p){
    const t = p._lastShaTarget;
    return !t || !t.dead;
  }

  /* ============================================================
   * AI 提示（教练模式）：复用决策链生成"建议 + 理由"，教学向
   * ============================================================ */

  // 出牌阶段建议
  function advise(p){
    const others = G.players.filter(x => !x.dead && x.pid !== p.pid);
    const hand = p.hand;
    const foes = others.filter(x => isEnemy(p, x));

    // 装备
    for(const c of hand.filter(x => x.cat === "equip")){
      const cur = p.equip[c.slot];
      if(c.slot === "weapon" && (!cur || (CARD_DEFS[c.key].range || 1) > (CARD_DEFS[cur.key].range || 1))){
        const range = CARD_DEFS[c.key].range || 1;
        const now = others.filter(x => dist(p, x) <= attackRange(p)).length;
        const after = others.filter(x => dist(p, x) <= range).length;
        if(after > now) return { kind:"card", card:c, use:{ key:c.key, target:null },
          title:`先装备【${c.name}】`,
          reason:`攻击范围从 ${attackRange(p)} 提升到 ${range}，能威胁的目标从 ${now} 人增加到 ${after} 人。武器先就位，你的【杀】才有覆盖面。` };
      }
      if(c.slot === "armor" && !cur){
        return { kind:"card", card:c, use:{ key:c.key, target:null },
          title:"先装备【八卦阵】",
          reason:"之后每次被【杀】指定都可以判定：红牌约占牌堆一半，平均一半概率免伤，而且不消耗手牌里的【闪】。" };
      }
      if((c.slot === "horse+" || c.slot === "horse-") && (!cur || cur.key !== c.key)){
        if(c.slot === "horse+"){
          const pressed = foes.some(x => dist(p, x) <= 2);
          if(pressed || p.hp <= 2) return { kind:"card", card:c, use:{ key:c.key, target:null },
            title:`骑上【${c.name}】`,
            reason: pressed ? "有敌人与你的距离已经贴到 2 以内，防御马让他们计算与你的距离 +1，【杀】更难够到你。" : "你血量偏低，先拉开距离更安全。" };
        } else {
          const far = foes.filter(x => dist(p, x) >= 2).length;
          if(far && foes.length) return { kind:"card", card:c, use:{ key:c.key, target:null },
            title:`骑上【${c.name}】`,
            reason:`敌人都站在攻击范围之外，进攻马让距离 -1，或许刚好够到目标。` };
        }
      }
    }

    // 残血吃桃
    if(p.hp <= 2 && p.hp < p.maxHp){
      const tao = hand.find(c => c.key === "tao");
      if(tao) return { kind:"card", card:tao, use:{ key:"tao", target:null },
        title:"先回复体力",
        reason:`你只剩 ${p.hp} 点体力，血线过低会成为集火目标。先吃【桃】站稳，防守牌留着不被弃掉。` };
    }

    // 无中生有
    const wz = hand.find(c => c.key === "wuzhong");
    if(wz) return { kind:"card", card:wz, use:{ key:"wuzhong", target:null },
      title:"先摸两张牌",
      reason:"【无中生有】白赚两张牌、没有任何代价，先摸牌再决定后续打法，选择更多。" };

    // 制衡
    if(p.hero.id === "sunquan" && !p.skillUsed && hand.length >= 2){
      const junk = hand.filter(c => discardScore(p, c) <= 4);
      if(junk.length >= 2) return { kind:"skill", skill:"zhiheng", cards:junk,
        title:"发动【制衡】",
        reason:`这 ${junk.length} 张牌（${junk.map(c => c.name).join("、")}）当前价值不高，换成新牌可能摸到【杀】【闪】【桃】。孙权的核心就是每回合把手牌换成质量最高的组合。` };
    }

    // 乐不思蜀
    const le = hand.find(c => c.key === "le");
    if(le){
      const t = bestTarget(p, others.filter(x => !x.judgeCards.some(j => j.key === "le")), x => threatScore(p, x) > 0);
      if(t) return { kind:"card", card:le, use:{ key:"le", target:t },
        title:`【乐不思蜀】贴给 ${t.name}`,
        reason:`判定不为红桃（概率 3/4）他下回合就要跳过出牌阶段——等于白赚一回合。他是目前对你威胁最大的目标。` };
    }

    // 闪电
    const sd = hand.find(c => c.key === "shandian");
    if(sd && p.hp >= 3 && !p.judgeCards.some(j => j.key === "shandian")){
      return { kind:"card", card:sd, use:{ key:"shandian", target:null },
        title:"挂出【闪电】",
        reason:`你血量健康（${p.hp} 点），能扛住一次 3 点判定失败；闪电会顺时针移动，抽到黑桃时大概率劈中你的敌人。风险与收益并存。` };
    }

    // 决斗
    const jd = hand.find(c => c.key === "juedou");
    if(jd){
      const t = bestTarget(p, others, x => threatScore(p, x) > 0 && x.hp <= 3);
      if(t) return { kind:"card", card:jd, use:{ key:"juedou", target:t },
        title:`与 ${t.name} 决斗`,
        reason:`他只剩 ${t.hp} 点体力且手牌不多（${t.hand.length} 张），轮到他出【杀】时大概率出不来——白嫖一次伤害。` };
    }

    // 杀（含武圣虚拟杀与酒杀）
    const shaCandidates = hand.filter(c => canUseAsSha(p, c));
    const canSha = p.hero.id === "zhangfei" || p.equip.weapon?.key === "nulver" || p.shaUsed < 1;
    if(canSha && shaCandidates.length){
      const inRange = others.filter(x => dist(p, x) <= attackRange(p) && canBeShaTarget(p, x));
      const t = bestTarget(p, inRange, x => threatScore(p, x) > -1);
      if(t){
        const why = isEnemy(p, t) ? "他是你已确认的敌对目标"
          : (p.grudge[t.pid] || 0) >= 3 ? `他对你累计造成过 ${p.grudge[t.pid] || 0} 点威胁，是当前最该还手的人`
          : "他的手牌和血量对你压力最大";
        const killTxt = t.hp <= 1 ? `这一刀大概率带走他。` : `他剩 ${t.hp} 点体力，这一刀能显著压低他的状态。`;
        const realSha = shaCandidates.find(c => c.key === "sha");
        const card = realSha || shaCandidates[0];
        const jiu = hand.find(c => c.key === "jiu");
        const useVirtual = !realSha;
        if(jiu && !p.drunk && (t.hp <= 2 || (t.pid === G.zhu.pid && p.role === "fan"))){
          return { kind:"card", card:jiu, use:{ key:"jiu", target:null },
            title:"先喝【酒】再杀",
            reason:`${t.name} 只剩 ${t.hp} 点体力：先喝酒让下一张【杀】伤害变 2 点，可以一波带走，别浪费酒杀连招。` };
        }
        return { kind:"card", card, use:{ key:"sha", target:t },
          title: useVirtual ? `把【${card.name}】当【杀】打向 ${t.name}` : `对 ${t.name} 出【杀】`,
          reason:`原因：${why}。${killTxt}${useVirtual ? "（武圣：红色牌可当【杀】）" : ""}` };
      }
    }

    // AOE
    for(const key of ["nanman","wanjian"]){
      const c = hand.find(x => x.key === key);
      if(!c) continue;
      const foesN = others.filter(x => threatScore(p, x) > 2).length;
      const friendsN = others.filter(x => isFriend(p, x)).length;
      if(foesN >= friendsN + 1) return { kind:"card", card:c, use:{ key:key, target:null },
        title:`放【${c.name}】`,
        reason:`场上对你有威胁的目标有 ${foesN} 个，友方只有 ${friendsN} 个——无差别攻击收益大于损失。注意友方也会受伤。` };
    }

    // 拆桥
    const chai = hand.find(c => c.key === "chai");
    if(chai){
      const t = bestTarget(p, others.filter(x => totalCards(x) > 0), x => threatScore(p, x) > 0);
      if(t) return { kind:"card", card:chai, use:{ key:"chai", target:t },
        title:`拆 ${t.name} 的一张牌`,
        reason:`削弱敌人的手牌或装备就是削弱他的输出与防御。优先拆威胁最大的人。` };
    }

    // 仁德
    if(p.hero.id === "liubei" && !p.skillUsed && p.hp < p.maxHp && hand.length >= 3){
      const friend = others.find(x => isFriend(p, x));
      if(friend){
        const give = hand.slice().sort((a,b) => discardScore(p,a) - discardScore(p,b)).slice(0, 2);
        return { kind:"skill", skill:"rende", cards:give, target:friend,
          title:"发动【仁德】",
          reason:`把 2 张用不上的牌送给 ${friend.name}，既强化队友，又能回复自己 1 点体力——一石二鸟。` };
      }
    }

    // 离间
    if(p.hero.id === "diaochan" && !p.skillUsed && hand.length > 1){
      const males = others.filter(x => x.hero.gender === "m" && threatScore(p, x) > 2);
      if(males.length >= 2){
        const discard = hand.slice().sort((a,b) => discardScore(p,a) - discardScore(p,b))[0];
        return { kind:"skill", skill:"lijian", card:discard, targets:males.slice(0, 2),
          title:"发动【离间】",
          reason:`让 ${males[0].name} 和 ${males[1].name} 决斗：无论谁输谁赢，损失的都不是你的牌——坐收渔利。` };
      }
    }

    return { kind:"end", title:"结束回合",
      reason:"手牌没有明显的高收益动作了。保留【杀】【闪】【桃】等防守牌，把手牌数控制在体力值以内即可。" };
  }

  // 响应建议：被杀要闪 / 决斗南蛮要杀 / 万箭要闪 / 濒死求桃
  function adviseRespond(p, scene, srcName){
    const hand = p.hand;
    switch(scene){
      case "sha": {
        const shans = hand.filter(c => canUseAsShan(p, c)).length;
        const dmgTxt = srcName ? `${srcName} 的【杀】` : "这张【杀】";
        return `💡 建议：${shans ? `出【闪】——${dmgTxt}会造成 1 点伤害（若对方喝过酒则是 2 点），用一张【闪】完全抵消最划算。` : "你没有【闪】，若装备了八卦阵可以赌判定（约一半概率免伤）。"}`;
      }
      case "juedou": {
        const shas = hand.filter(c => canUseAsSha(p, c)).length;
        return `💡 建议：${shas ? `打出【杀】——不出就要受 1 点伤害，有杀别硬扛。` : "你没有【杀】，只能承受 1 点伤害；若濒死要提前留好【桃】。"}`;
      }
      case "nanman": {
        const shas = hand.filter(c => canUseAsSha(p, c)).length;
        return `💡 建议：${shas ? `打出【杀】——全场都要响应，省着点血。` : "你没有【杀】，将受 1 点伤害；血量健康时可以硬吃。"}`;
      }
      case "wanjian": {
        const shans = hand.filter(c => canUseAsShan(p, c)).length;
        return `💡 建议：${shans ? `打出【闪】——一张【闪】换 1 点血，稳赚。` : "你没有【闪】，将受 1 点伤害。"}`;
      }
      case "dying": {
        const canSave = hand.some(c => c.key === "tao" || (c.key === "jiu" && p.pid === p.pid));
        return `💡 建议：${canSave ? "出【桃】救人——救人者不树敌，且能阻止胜负天平倾斜；出牌前先想清楚他的身份对你是否有利。" : "你没有【桃】，只能眼看他倒下——记住凶手是谁，权衡这对你是否有利。"}`;
      }
    }
    return "";
  }

  // 弃牌建议：保留高分牌，弃低分牌
  function adviseDiscard(p, extra){
    const ranked = p.hand.slice().sort((a,b) => discardScore(p,b) - discardScore(p,a));
    const keep = ranked.slice(0, Math.max(0, p.hand.length - extra));
    const drop = ranked.slice(Math.max(0, p.hand.length - extra));
    if(!drop.length) return "";
    return `💡 建议弃：${drop.map(c => `【${c.name}】`).join("、")}——保留【闪】【桃】等防守牌（${keep.map(c => c.name).join("、")}）价值更高。`;
  }

  return { markAntiZhu, markProZhu, isEnemy, isFriend, threatScore,
           wantShan, wantSave, wantWuxie, wantWuxieNest, discardScore, playAction, advise,
           adviseRespond, adviseDiscard,
           wuguPick, pickRemoval, wantPiercing, wantChase };
})();
