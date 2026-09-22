import test from "node:test";
import assert from "node:assert/strict";
import { createCocCharacter, deriveCocStats, parseDiceExpression, resolvePercentileCheck, rollDice } from "./coc.mjs";

test("dice expressions are parsed and rolled without eval", () => {
  assert.deepEqual(parseDiceExpression("3d6 + 2"), { count: 3, sides: 6, modifier: 2, expression: "3d6+2" });
  assert.deepEqual(rollDice("2d6-1", () => 0), { count: 2, sides: 6, modifier: -1, expression: "2d6-1", rolls: [1, 1], total: 1 });
  assert.throws(() => parseDiceExpression("1d100; DROP TABLE"));
});

test("percentile checks expose a stable result tier", () => {
  assert.equal(resolvePercentileCheck({ skill: 60, difficulty: "hard", forcedRoll: 30 }).tier, "success");
  assert.equal(resolvePercentileCheck({ skill: 60, difficulty: "regular", forcedRoll: 5 }).tier, "critical");
  assert.equal(resolvePercentileCheck({ skill: 20, difficulty: "regular", forcedRoll: 99 }).tier, "fumble");
});

test("CoC character creation derives core resources", () => {
  const character = createCocCharacter({ name: "艾伦", attributes: { con: 50, siz: 60, pow: 70, dex: 60, str: 45 } });
  assert.equal(character.name, "艾伦");
  assert.equal(character.derived.hp, 11);
  assert.equal(character.derived.san, 70);
  assert.equal(character.skills.spotHidden, 25);
  assert.deepEqual(deriveCocStats({ con: 50, siz: 60, pow: 70 }).hp, 11);
});
