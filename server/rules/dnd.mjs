/**
 * Small SRD-compatible d20 rules surface. Keep distributable text original
 * and let a future licensed pack add the complete content set.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

export function abilityModifier(score) {
  return Math.floor((clamp(score, 1, 30) - 10) / 2);
}

export function resolveD20Check({ abilityScore = 10, proficiency = 0, proficient = false, difficultyClass = 10, forcedRoll, random = Math.random }) {
  const roll = forcedRoll ?? Math.floor(random() * 20) + 1;
  const natural = roll === 1 ? "critical-failure" : roll === 20 ? "critical-success" : null;
  const total = roll + abilityModifier(abilityScore) + (proficient ? proficiency : 0);
  return { roll, total, difficultyClass, success: natural === "critical-success" || (natural !== "critical-failure" && total >= difficultyClass), natural };
}

export function createDndCharacter(input = {}) {
  const abilities = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((key) => [key, clamp(input.abilities?.[key] ?? 10, 1, 30)]));
  const level = clamp(input.level ?? 1, 1, 20);
  const proficiency = 2 + Math.floor((level - 1) / 4);
  const maxHp = Math.max(1, Number(input.maxHp) || 8 + abilityModifier(abilities.con));
  return {
    system: "dnd-srd-d20",
    version: 1,
    name: String(input.name || "未命名冒险者").slice(0, 80),
    playerName: String(input.playerName || "").slice(0, 80),
    ancestry: String(input.ancestry || "人类").slice(0, 80),
    className: String(input.className || "冒险者").slice(0, 80),
    level,
    abilities,
    proficiency,
    armorClass: clamp(input.armorClass ?? 10 + abilityModifier(abilities.dex), 1, 40),
    hp: maxHp,
    maxHp,
    inventory: Array.isArray(input.inventory) ? input.inventory.slice(0, 30).map(String) : [],
    background: String(input.background || "").slice(0, 1200),
    notes: String(input.notes || "").slice(0, 2000),
  };
}

export function buildDndRuleContext(character) {
  return {
    id: "dnd-srd-d20",
    version: 1,
    label: "D&D SRD d20 核心",
    character: { name: character.name, level: character.level, abilities: character.abilities, proficiency: character.proficiency, armorClass: character.armorClass, hp: character.hp, maxHp: character.maxHp },
  };
}
