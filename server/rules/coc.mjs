/**
 * A small, original wording CoC-compatible percentile rules module.
 * The browser never owns these calculations; the server does.
 */

const SKILL_DEFAULTS = {
  accounting: 5,
  anthropology: 1,
  appraise: 5,
  archaeology: 1,
  artCraft: 5,
  charm: 15,
  climb: 20,
  creditRating: 0,
  cthulhuMythos: 0,
  disguise: 5,
  dodge: 0,
  driveAuto: 20,
  electricalRepair: 10,
  fastTalk: 5,
  firstAid: 30,
  history: 5,
  intimidate: 15,
  jump: 20,
  languageOwn: 0,
  law: 5,
  libraryUse: 20,
  listen: 20,
  locksmith: 1,
  mechanicalRepair: 10,
  medicine: 1,
  naturalWorld: 10,
  navigate: 10,
  occult: 5,
  persuade: 10,
  psychoanalysis: 1,
  psychology: 10,
  ride: 5,
  sleightOfHand: 10,
  spotHidden: 25,
  stealth: 20,
  survival: 10,
  swim: 20,
  throw: 20,
  track: 10,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

export function parseDiceExpression(expression) {
  const normalized = String(expression || "").replace(/\s+/g, "").toLowerCase();
  const match = normalized.match(/^(\d{1,2})d(\d{1,4})([+-]\d{1,4})?$/);
  if (!match) throw new Error("骰子表达式格式不支持，例如 1d100 或 3d6+2");

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = Number(match[3] || 0);
  if (count < 1 || count > 20 || sides < 2 || sides > 1000 || Math.abs(modifier) > 10000) {
    throw new Error("骰子数量、面数或修正值超出限制");
  }
  return { count, sides, modifier, expression: normalized };
}

export function rollDice(expression, random = Math.random) {
  const parsed = typeof expression === "string" ? parseDiceExpression(expression) : expression;
  const rolls = Array.from({ length: parsed.count }, () => Math.floor(random() * parsed.sides) + 1);
  const total = rolls.reduce((sum, value) => sum + value, parsed.modifier);
  return { ...parsed, rolls, total };
}

export function resolvePercentileCheck({ skill, difficulty = "regular", forcedRoll, random = Math.random }) {
  const target = clamp(skill, 0, 100);
  const thresholds = { regular: target, hard: Math.floor(target / 2), extreme: Math.floor(target / 5), critical: 5 };
  const threshold = thresholds[difficulty] ?? thresholds.regular;
  const roll = forcedRoll ?? rollDice("1d100", random).total;
  const fumble = roll >= 96 || (roll > target && target < 50 && roll === 100);
  const critical = roll <= thresholds.critical;
  const success = roll <= threshold;
  const tier = fumble ? "fumble" : critical ? "critical" : success ? "success" : "failure";
  return { roll, target, threshold, difficulty, tier, success: tier === "success" || tier === "critical" };
}

export function deriveCocStats(attributes = {}) {
  const str = clamp(attributes.str, 0, 100);
  const con = clamp(attributes.con, 0, 100);
  const siz = clamp(attributes.siz, 0, 100);
  const dex = clamp(attributes.dex, 0, 100);
  const pow = clamp(attributes.pow, 0, 100);
  const hp = Math.max(1, Math.floor((con + siz) / 10));
  const san = pow;
  const luck = clamp(attributes.luck ?? pow, 0, 100);
  const mp = Math.max(0, Math.floor(pow / 5));
  const mov = dex < siz && str < siz ? 7 : dex > siz && str > siz ? 9 : 8;
  return { hp, maxHp: hp, san, maxSan: san, luck, mp, maxMp: mp, mov, build: Math.floor((str + siz) / 20) - 2, db: "-2" };
}

export function createCocCharacter(input = {}) {
  const attributes = {
    str: clamp(input.attributes?.str ?? 50, 0, 100),
    con: clamp(input.attributes?.con ?? 50, 0, 100),
    siz: clamp(input.attributes?.siz ?? 50, 0, 100),
    dex: clamp(input.attributes?.dex ?? 50, 0, 100),
    app: clamp(input.attributes?.app ?? 50, 0, 100),
    int: clamp(input.attributes?.int ?? 50, 0, 100),
    pow: clamp(input.attributes?.pow ?? 50, 0, 100),
    edu: clamp(input.attributes?.edu ?? 50, 0, 100),
    luck: clamp(input.attributes?.luck ?? 50, 0, 100),
  };
  const skills = { ...SKILL_DEFAULTS, ...(input.skills || {}) };
  for (const [key, value] of Object.entries(skills)) skills[key] = clamp(value, 0, 100);
  return {
    system: "coc-percentile",
    version: 1,
    name: String(input.name || "未命名调查员").slice(0, 80),
    playerName: String(input.playerName || "").slice(0, 80),
    occupation: String(input.occupation || "调查员").slice(0, 80),
    age: clamp(input.age ?? 30, 1, 120),
    residence: String(input.residence || "").slice(0, 120),
    birthplace: String(input.birthplace || "").slice(0, 120),
    attributes,
    derived: deriveCocStats(attributes),
    skills,
    inventory: Array.isArray(input.inventory) ? input.inventory.slice(0, 30).map(String) : [],
    background: String(input.background || "").slice(0, 2000),
    notes: String(input.notes || "").slice(0, 2000),
    status: { conditions: [], wounds: [], temporarySanLoss: 0 },
  };
}

export function buildCocRuleContext(character) {
  return {
    id: "coc-percentile",
    version: 1,
    label: "百分骰恐怖调查",
    checkDifficulties: ["regular", "hard", "extreme", "critical"],
    character: {
      name: character.name,
      attributes: character.attributes,
      derived: character.derived,
      skills: character.skills,
      conditions: character.status?.conditions || [],
    },
  };
}

export { SKILL_DEFAULTS };
