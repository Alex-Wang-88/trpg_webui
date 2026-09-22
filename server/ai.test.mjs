import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateAdventurePlan, generateAiTurn } from "./ai.mjs";
import { startJobRunner } from "./jobs.mjs";
import { GameStore } from "./store.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function waitFor(predicate, timeoutMs = 1200) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待异步任务超时");
}

test("OpenAI-compatible AI turns, adventure plans, and image jobs complete end to end", async () => {
  const originalFetch = globalThis.fetch;
  const assetDir = mkdtempSync(join(tmpdir(), "night-table-ai-"));
  const store = new GameStore({ dbPath: ":memory:", assetDir });
  const owner = store.createRoom({ title: "Provider 集成", displayName: "KP" });
  store.updateAiSettings({ roomId: owner.room.id, member: owner.member, settings: { baseUrl: "https://provider.test/v1", model: "text-demo", imageBaseUrl: "https://provider.test/v1", imageModel: "image-demo", apiKey: "provider-secret" } });
  const settings = store.getAiSettings(owner.room.id);
  let imageCalls = 0;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/images/generations")) {
      imageCalls += 1;
      assert.equal(options.headers.authorization, "Bearer provider-secret");
      return jsonResponse({ data: [{ b64_json: Buffer.from("demo-image").toString("base64") }] });
    }
    assert.equal(requestUrl, "https://provider.test/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "text-demo");
    assert.equal(options.headers.authorization, "Bearer provider-secret");
    const isAdventure = String(body.messages?.[0]?.content || "").includes("剧本策划");
    const isAiPl = String(body.messages?.[0]?.content || "").includes("AI PL");
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(isAdventure ? { title: "潮汐档案", premise: "一份会自行改写的档案", tone: "克制悬疑", scenes: [{ title: "旧海关", purpose: "找到入口", hook: "门内传来三下敲击", choices: ["观察", "敲门"] }], npcs: [], safetyNotes: "" } : isAiPl ? { publicText: "我贴着墙根观察门缝。", toolCalls: [{ name: "advance_scene", arguments: { title: "不应推进" } }, { name: "generate_image", arguments: { prompt: "不应生成" } }], suggestedNextAction: "等待其他调查员回应" } : { publicText: "门内的喘息停了一拍。", toolCalls: [], suggestedNextAction: "询问玩家行动" }) } }], usage: { total_tokens: 42 } });
  };

  try {
    const turn = await generateAiTurn({ settings, room: store.getRoom(owner.room.id), events: [], agentRole: "AI KP" });
    assert.equal(turn.publicText, "门内的喘息停了一拍。");
    const adventure = await generateAdventurePlan({ settings, room: store.getRoom(owner.room.id), brief: "旧海关", playerCount: 2 });
    assert.equal(adventure.plan.title, "潮汐档案");

    const asset = store.requestAsset({ roomId: owner.room.id, member: owner.member, input: { prompt: "测试场景", model: "image-demo" } });
    const stopRunner = startJobRunner(store, { intervalMs: 5 });
    await waitFor(() => store.getAsset(owner.room.id, asset.id)?.status === "completed");
    assert.equal(imageCalls, 1);
    assert.equal(store.readAssetFile(owner.room.id, asset.id).buffer.toString(), "demo-image");

    const aiSeat = store.getSeats(owner.room.id).find((seat) => seat.role === "pl");
    assert.ok(aiSeat);
    store.command({ roomId: owner.room.id, member: owner.member, type: "handoff_seat", payload: { seatId: aiSeat.id, controller: "ai" }, clientCommandId: "ai-pl-seat" });
    const aiPlJob = store.enqueueJob({ roomId: owner.room.id, kind: "ai-pl.turn", payload: { memberId: owner.member.id, seatId: aiSeat.id, seatLabel: aiSeat.label } });
    const eventsBeforeAiPl = store.getEvents(owner.room.id, 0, owner.member);
    await waitFor(() => store.getJob(aiPlJob.id)?.status === "completed");
    const eventsAfterAiPl = store.getEvents(owner.room.id, 0, owner.member);
    stopRunner();
    assert.ok(eventsAfterAiPl.some((event) => event.type === "message.posted" && event.payload?.seatId === aiSeat.id));
    assert.equal(eventsAfterAiPl.filter((event) => event.type === "scene.advanced").length, eventsBeforeAiPl.filter((event) => event.type === "scene.advanced").length);
    assert.equal(eventsAfterAiPl.filter((event) => event.type === "asset.requested").length, eventsBeforeAiPl.filter((event) => event.type === "asset.requested").length);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(assetDir, { recursive: true, force: true });
  }
});
