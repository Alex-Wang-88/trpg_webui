import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GameStore } from "./store.mjs";

test("rooms create, join, persist ordered events, and deduplicate commands", () => {
  const store = new GameStore({ dbPath: ":memory:" });
  const owner = store.createRoom({ title: "雾港", displayName: "房主" });
  assert.match(owner.room.code, /^NIGHT-[A-Z2-9]{6}$/);
  const guest = store.joinRoom({ code: owner.room.code, displayName: "玩家一" });
  const first = store.command({ roomId: owner.room.id, member: guest.member, type: "post_message", payload: { channel: "ic", text: "我观察门缝" }, clientCommandId: "client-1" });
  const duplicate = store.command({ roomId: owner.room.id, member: guest.member, type: "post_message", payload: { channel: "ic", text: "这条不应重复" }, clientCommandId: "client-1" });
  assert.equal(first.seq, duplicate.seq);
  const bootstrap = store.getBootstrap(owner.room.id, 0, guest.member);
  assert.equal(bootstrap.events.at(-1).payload.text, "我观察门缝");
  assert.equal(bootstrap.members.length, 2);
});

test("KP channel is private to the owner", () => {
  const store = new GameStore({ dbPath: ":memory:" });
  const owner = store.createRoom({ title: "私语", displayName: "KP" });
  const guest = store.joinRoom({ code: owner.room.code, displayName: "PL" });
  const event = store.command({ roomId: owner.room.id, member: owner.member, type: "post_message", payload: { channel: "kp", text: "隐藏线索" }, clientCommandId: "kp-1" });
  assert.equal(store.getEvents(owner.room.id, 0, owner.member).some((item) => item.seq === event.seq), true);
  assert.equal(store.getEvents(owner.room.id, 0, guest.member).some((item) => item.seq === event.seq), false);
});

test("players cannot access KP controls or private resources", () => {
  const assetDir = mkdtempSync(join(tmpdir(), "night-table-permissions-"));
  const store = new GameStore({ dbPath: ":memory:", assetDir });
  const owner = store.createRoom({ title: "权限", displayName: "KP" });
  const guest = store.joinRoom({ code: owner.room.code, displayName: "PL" });
  assert.throws(() => store.updateAiSettings({ roomId: owner.room.id, member: guest.member, settings: { model: "blocked" } }), /只有房主/);
  assert.throws(() => store.requestAsset({ roomId: owner.room.id, member: guest.member, input: { prompt: "blocked" } }), /只有房主或 KP/);
  assert.throws(() => store.command({ roomId: owner.room.id, member: guest.member, type: "handoff_seat", payload: { seatId: store.getSeats(owner.room.id).find((seat) => seat.role === "pl").id, controller: "ai" }, clientCommandId: "blocked-seat" }), /只有房主或 KP/);
  rmSync(assetDir, { recursive: true, force: true });
});

test("players can claim one seat and character cards bind to that seat", () => {
  const store = new GameStore({ dbPath: ":memory:" });
  const owner = store.createRoom({ title: "入座", displayName: "KP" });
  const player = store.joinRoom({ code: owner.room.code, displayName: "调查员" });
  const claimed = store.command({ roomId: owner.room.id, member: player.member, type: "claim_seat", payload: {}, clientCommandId: "claim-1" });
  const seat = store.getSeats(owner.room.id).find((candidate) => candidate.id === claimed.payload.seatId);
  assert.equal(seat.controller, "human");
  assert.equal(seat.memberId, player.member.id);
  assert.throws(() => store.command({ roomId: owner.room.id, member: player.member, type: "claim_seat", payload: {}, clientCommandId: "claim-2" }), /已经占用/);
  const character = store.createCharacter({ roomId: owner.room.id, member: player.member, input: { name: "绑定角色" } });
  assert.equal(store.getSeats(owner.room.id).find((candidate) => candidate.id === seat.id).characterId, character.id);
  store.command({ roomId: owner.room.id, member: player.member, type: "release_seat", payload: { seatId: seat.id }, clientCommandId: "release-1" });
  assert.equal(store.getSeats(owner.room.id).find((candidate) => candidate.id === seat.id).controller, "empty");
});

test("D&D rooms resolve checks with the d20 core", () => {
  const store = new GameStore({ dbPath: ":memory:" });
  const owner = store.createRoom({ title: "d20 检定", system: "dnd-srd-d20", displayName: "KP" });
  const event = store.command({ roomId: owner.room.id, member: owner.member, type: "resolve_check", payload: { abilityScore: 16, proficiency: 3, proficient: true, difficultyClass: 18, forcedRoll: 10, skillName: "力量检定" }, clientCommandId: "d20-check-1" });
  assert.equal(event.payload.total, 16);
  assert.equal(event.payload.success, false);
  assert.equal(event.payload.natural, null);
});

test("AI jobs are durable and claimable for async rooms", () => {
  const store = new GameStore({ dbPath: ":memory:" });
  const owner = store.createRoom({ title: "异步调查", displayName: "KP" });
  const queued = store.enqueueJob({ roomId: owner.room.id, kind: "ai.kp.turn", payload: { memberId: owner.member.id } });
  assert.equal(queued.status, "queued");
  const running = store.claimNextJob();
  assert.equal(running.id, queued.id);
  assert.equal(running.status, "running");
  store.completeJob(queued.id, { usage: { total_tokens: 42 } });
  assert.equal(store.getJob(queued.id).status, "completed");
});

test("room settings redact the encrypted API key and character updates persist", () => {
  const assetDir = mkdtempSync(join(tmpdir(), "night-table-assets-"));
  const store = new GameStore({ dbPath: ":memory:", assetDir });
  const owner = store.createRoom({ title: "安全边界", displayName: "KP" });
  store.updateAiSettings({ roomId: owner.room.id, member: owner.member, settings: { baseUrl: "https://example.test", model: "demo", apiKey: "secret-key" } });
  const publicRoom = store.getRoom(owner.room.id);
  assert.equal(publicRoom.settings.apiKeyEncrypted, undefined);
  assert.equal(publicRoom.settings.apiKeyConfigured, true);
  assert.equal(JSON.stringify(publicRoom).includes("secret-key"), false);

  const created = store.createCharacter({ roomId: owner.room.id, member: owner.member, input: { name: "新调查员", occupation: "记者", attributes: { int: 80 } } });
  const updated = store.updateCharacter({ roomId: owner.room.id, member: owner.member, characterId: created.id, input: { name: "新调查员·改", attributes: { pow: 70 } } });
  assert.equal(updated.sheet.name, "新调查员·改");
  assert.equal(store.getCharacters(owner.room.id).at(-1).sheet.attributes.pow, 70);
  rmSync(assetDir, { recursive: true, force: true });
});

test("scene assets queue, complete, and remain room-scoped", () => {
  const assetDir = mkdtempSync(join(tmpdir(), "night-table-assets-"));
  const store = new GameStore({ dbPath: ":memory:", assetDir });
  const owner = store.createRoom({ title: "资源", displayName: "KP" });
  const asset = store.requestAsset({ roomId: owner.room.id, member: owner.member, input: { prompt: "测试场景", model: "image-demo" } });
  assert.equal(asset.status, "queued");
  store.markAssetRunning(asset.id);
  const completed = store.completeAsset(asset.id, { buffer: Buffer.from("not-a-real-png"), mimeType: "image/png" });
  assert.equal(completed.status, "completed");
  assert.equal(store.readAssetFile(owner.room.id, asset.id).buffer.length > 0, true);
  assert.equal(store.getAsset("other-room", asset.id), null);
  rmSync(assetDir, { recursive: true, force: true });
});
