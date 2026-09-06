/* ============================================================
 * data.js —— 卡牌 / 武将 / 身份 / 剧情数据（原创实现）
 * ============================================================ */
"use strict";

/* ---------- 身份 ---------- */
const ROLES = {
  zhu:    { name: "主公", color: "var(--zhu)",    hex: "#c8352e" },
  zhong:  { name: "忠臣", color: "var(--zhong)",  hex: "#3f8f4f" },
  fan:    { name: "反贼", color: "var(--fan)",    hex: "#3a6ea5" },
  nei:    { name: "内奸", color: "var(--nei)",    hex: "#8a8f98" },
};

/* 身份剧情（原创文案） */
const ROLE_STORY = {
  zhu: [
    "汉室倾颓，奸雄环伺。你高坐堂上，锦袍玉带，却如芒在背。",
    "堂下四将，孰忠孰奸？忠臣愿为你挡刀，反贼欲取你性命，而内奸……正冷笑着等待最后一击。",
    "诛反贼，辨忠奸，守住这万里江山！",
  ],
  zhong: [
    "你身经百战，只为报知遇之恩。今日随主公出阵，乱贼环伺。",
    "反贼明枪易躲，内奸暗箭难防。你的使命只有一个——",
    "护主公周全，与主公共存亡！",
  ],
  fan: [
    "苍天已死，黄天当立！你潜伏于阵中，刀已出鞘。",
    "主公身旁高手如云，那所谓的忠臣，不过是汲汲于名利的看门之犬。",
    "斩主公首级者，即为天下之主！动手吧！",
  ],
  nei: [
    "你乃百戏之人，笑里藏刀，左右逢源。没有人知道你真正效忠的是谁。",
    "先借忠臣之手诛反贼，再借反贼之刀弱主公，待战场只剩你与主公——",
    "一击，定天下！",
  ],
};

const ROLE_GOAL = {
  zhu:  "胜利条件：消灭所有反贼与内奸",
  zhong:"胜利条件：与主公同存亡，消灭所有反贼与内奸",
  fan:  "胜利条件：消灭主公",
  nei:  "胜利条件：成为唯一的幸存者（最后与主公单挑并获胜）",
};

/* ---------- 武将（原创描述） ---------- */
const HEROES = [
  { id:"liubei", name:"刘备", title:"乱世枭雄", hp:4, gender:"m", color:"#3f7fbf",
    skill:"仁德", skillDesc:"出牌阶段限一次：将任意张手牌交给一名其他角色；若给出的牌首次达到两张，你回复1点体力。" },
  { id:"guanyu", name:"关羽", title:"美髯公", hp:4, gender:"m", color:"#c8352e",
    skill:"武圣", skillDesc:"你的红色手牌可以当作【杀】使用或打出。" },
  { id:"zhangfei", name:"张飞", title:"万人敌", hp:4, gender:"m", color:"#c3cad8",
    skill:"咆哮", skillDesc:"锁定技：出牌阶段，你使用【杀】无次数限制。" },
  { id:"zhugeliang", name:"诸葛亮", title:"卧龙", hp:3, gender:"m", color:"#4a7c3f",
    skill:"空城", skillDesc:"锁定技：你没有手牌时，不能成为【杀】和【决斗】的目标。" },
  { id:"zhaoyun", name:"赵云", title:"常山之龙", hp:4, gender:"m", color:"#e8e8e8",
    skill:"龙胆", skillDesc:"你可以把【杀】当【闪】、【闪】当【杀】使用或打出。" },
  { id:"caocao", name:"曹操", title:"乱世奸雄", hp:4, gender:"m", color:"#3a6ea5",
    skill:"奸雄", skillDesc:"你受到伤害后，可以获得造成此伤害的牌。" },
  { id:"sunquan", name:"孙权", title:"江东碧眼", hp:4, gender:"m", color:"#c9a227",
    skill:"制衡", skillDesc:"出牌阶段限一次：弃置任意张手牌，然后摸等量的牌。" },
  { id:"lvbu", name:"吕布", title:"飞将", hp:4, gender:"m", color:"#a4161a",
    skill:"无双", skillDesc:"锁定技：你使用【杀】时，目标需使用两张【闪】才能抵消；你决斗时，对手需打出两张【杀】。" },
  { id:"diaochan", name:"貂蝉", title:"倾国倾城", hp:3, gender:"f", color:"#d4507f",
    skill:"离间", skillDesc:"出牌阶段限一次：弃置一张手牌，令两名男性角色进行【决斗】（由你选择谁先出杀）。" },
  { id:"huatuo", name:"华佗", title:"神医", hp:3, gender:"m", color:"#4a9e7c",
    skill:"急救", skillDesc:"你的回合外，你可以将红色牌当【桃】使用（濒死自救）。" },
];

/* ---------- 卡牌定义 ---------- */
const CAT = { basic:"基本牌", trick:"锦囊牌", delay:"延时锦囊", equip:"装备牌" };

const CARD_DEFS = {
  sha:     { name:"杀", cat:"basic", target:"single", desc:"出牌阶段，对攻击范围内一名角色使用，造成1点伤害。" },
  shan:    { name:"闪", cat:"basic", target:"none",   desc:"抵消一张【杀】的效果。" },
  tao:     { name:"桃", cat:"basic", target:"none",   desc:"回复1点体力；也可在他人濒死时使用。" },
  jiu:     { name:"酒", cat:"basic", target:"none",   desc:"本回合你的下一张【杀】伤害+1；或濒死时对自己使用回复1点体力。" },

  wuzhong: { name:"无中生有", cat:"trick", target:"none",   desc:"摸两张牌。" },
  wuxie:   { name:"无懈可击", cat:"trick", target:"none",   desc:"抵消一张锦囊牌对一名角色的效果。" },
  chai:    { name:"过河拆桥", cat:"trick", target:"single", desc:"弃置一名其他角色的一张牌（手牌或装备）。" },
  shun:    { name:"顺手牵羊", cat:"trick", target:"single", desc:"获得距离1以内一名其他角色的一张牌。" },
  juedou:  { name:"决斗",     cat:"trick", target:"single", desc:"与目标角色轮流出【杀】，未出者受到1点伤害。" },
  nanman:  { name:"南蛮入侵", cat:"trick", target:"all",    desc:"其他所有角色需打出一张【杀】，否则受到1点伤害。" },
  wanjian: { name:"万箭齐发", cat:"trick", target:"all",    desc:"其他所有角色需打出一张【闪】，否则受到1点伤害。" },
  taoyuan: { name:"桃园结义", cat:"trick", target:"all",    desc:"所有角色回复1点体力。" },
  wugu:    { name:"五谷丰登", cat:"trick", target:"all",    desc:"亮出牌堆顶等同于存活人数的牌，从你开始每人选择一张获得。" },

  le:       { name:"乐不思蜀", cat:"delay", target:"single", desc:"出牌阶段置于一名其他角色的判定区。其判定阶段判定：若非红桃，跳过其出牌阶段。" },
  shandian: { name:"闪电",     cat:"delay", target:"self",   desc:"置于你的判定区。判定阶段判定：若为黑桃，你受到3点雷电伤害；否则移至下家判定区。" },

  nulver:   { name:"诸葛连弩",   cat:"equip", slot:"weapon", range:1, target:"self", desc:"武器·攻击范围1：出牌阶段你可以使用任意数量的【杀】。" },
  qinglong: { name:"青龙偃月刀", cat:"equip", slot:"weapon", range:3, target:"self", desc:"武器·攻击范围3：当你的【杀】被【闪】抵消后，你可以立刻再使用一张【杀】。" },
  guanshi:  { name:"贯石斧",     cat:"equip", slot:"weapon", range:3, target:"self", desc:"武器·攻击范围3：当你的【杀】被【闪】抵消后，你可以弃置两张牌，令此【杀】依然生效。" },
  bagua:    { name:"八卦阵",     cat:"equip", slot:"armor",  target:"self", desc:"防具：当你需要使用【闪】时，可以进行判定：若为红色，视为你打出了一张【闪】。" },
  chitu:    { name:"赤兔",       cat:"equip", slot:"horse-", target:"self", desc:"坐骑·进攻马：你计算与其他角色的距离-1。" },
  dawan:    { name:"大宛",       cat:"equip", slot:"horse-", target:"self", desc:"坐骑·进攻马：你计算与其他角色的距离-1。" },
  dilu:     { name:"的卢",       cat:"equip", slot:"horse+", target:"self", desc:"坐骑·防御马：其他角色计算与你的距离+1。" },
  jueying:  { name:"绝影",       cat:"equip", slot:"horse+", target:"self", desc:"坐骑·防御马：其他角色计算与你的距离+1。" },
  zhaohuang:{ name:"爪黄飞电",   cat:"equip", slot:"horse+", target:"self", desc:"坐骑·防御马：其他角色计算与你的距离+1。" },
};

const SLOT_NAMES = { weapon:"武器", armor:"防具", "horse-":"进攻马", "horse+":"防御马" };

/* ---------- 牌库构成：[key, 数量, 允许花色] ---------- */
const DECK_RECIPE = [
  ["sha",     18, ["♠","♣","♠","♥","♦"]],
  ["shan",    15, ["♥","♦"]],
  ["tao",      8, ["♥","♦"]],
  ["jiu",      3, ["♠","♣"]],
  ["wuzhong",  4, ["♥"]],
  ["wuxie",    4, ["♠","♣","♦"]],
  ["chai",     6, ["♠","♣","♥"]],
  ["shun",     5, ["♠","♣","♦"]],
  ["juedou",   3, ["♠","♦"]],
  ["nanman",   3, ["♠","♣"]],
  ["wanjian",  1, ["♥"]],
  ["taoyuan",  1, ["♥"]],
  ["wugu",     2, ["♥"]],
  ["le",       3, ["♠","♣","♥"]],
  ["shandian", 2, ["♠","♥"]],
  ["nulver",   2, ["♣"]],
  ["qinglong", 1, ["♠"]],
  ["guanshi",  1, ["♠"]],
  ["bagua",    2, ["♠","♣"]],
  ["chitu",    1, ["♥"]],
  ["dawan",    1, ["♠"]],
  ["dilu",     1, ["♣"]],
  ["jueying",  1, ["♠"]],
  ["zhaohuang",1, ["♥"]],
];

const SUIT_RED = s => s === "♥" || s === "♦";

/* ---------- 生成牌库 ---------- */
let __cardId = 0;
function buildDeck(){
  const deck = [];
  for(const [key, count, suits] of DECK_RECIPE){
    const def = CARD_DEFS[key];
    for(let i = 0; i < count; i++){
      deck.push({
        id: ++__cardId,
        key,
        name: def.name,
        cat: def.cat,
        slot: def.slot || null,
        suit: suits[i % suits.length],
        num: 1 + Math.floor(Math.random() * 13),
      });
    }
  }
  return shuffle(deck);
}

function shuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
