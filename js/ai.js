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

  return { markAntiZhu, markProZhu, isEnemy, isFriend, threatScore,
           wantShan, wantSave, wantWuxie, wantWuxieNest, discardScore, playAction,
           wuguPick, pickRemoval, wantPiercing, wantChase };
})();
