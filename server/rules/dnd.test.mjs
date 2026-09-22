import test from "node:test";
import assert from "node:assert/strict";
import { abilityModifier, createDndCharacter, resolveD20Check } from "./dnd.mjs";

test("d20 ability modifiers and critical boundaries are deterministic", () => {
  assert.equal(abilityModifier(8), -1);
  assert.equal(abilityModifier(18), 4);
  assert.equal(resolveD20Check({ abilityScore: 18, forcedRoll: 20, difficultyClass: 30 }).natural, "critical-success");
  assert.equal(resolveD20Check({ abilityScore: 18, forcedRoll: 1, difficultyClass: 1 }).natural, "critical-failure");
});

test("D&D character creation derives proficiency and armor class", () => {
  const character = createDndCharacter({ name: "灰烬", level: 5, abilities: { dex: 16, con: 14 } });
  assert.equal(character.proficiency, 3);
  assert.equal(character.armorClass, 13);
  assert.equal(character.maxHp, 10);
});
