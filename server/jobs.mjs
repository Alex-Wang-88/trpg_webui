import { generateAdventurePlan, generateAiTurn } from "./ai.mjs";
import { decryptSecret } from "./store.mjs";

function applyToolCalls(store, job, result, owner, agentRole) {
    for (const toolCall of result.toolCalls || []) {
    if (toolCall?.name === "request_check") store.appendEvent(job.roomId, "check.requested", job.payload.memberId, { ...toolCall.arguments, ai: true }, "public");
    if (toolCall?.name === "advance_scene" && agentRole === "AI KP") store.appendEvent(job.roomId, "scene.advanced", job.payload.memberId, { ...toolCall.arguments, ai: true }, "public");
    if (toolCall?.name === "roll") store.command({ roomId: job.roomId, member: owner, type: "roll_dice", payload: { expression: toolCall.arguments?.expression || "1d100", reason: "AI 请求骰点" }, clientCommandId: `ai:${job.id}:${toolCall.arguments?.expression || "1d100"}` });
    if (toolCall?.name === "generate_image" && agentRole === "AI KP") store.requestAsset({ roomId: job.roomId, member: owner, input: { prompt: toolCall.arguments?.prompt, ai: true } });
  }
}

async function processAiJob(store, job) {
  const owner = store.getMemberById(job.payload.memberId);
  if (!owner) throw new Error("AI 任务所属成员不存在");
  const agentRole = job.kind === "ai-pl.turn" ? "AI PL" : "AI KP";
  const viewer = agentRole === "AI PL" ? { ...owner, id: `ai-pl:${job.payload.seatId}`, role: "player" } : owner;
  const result = await generateAiTurn({
    settings: store.getAiSettings(job.roomId),
    room: store.getRoom(job.roomId),
    events: store.getEvents(job.roomId, 0, viewer),
    agentRole,
  });
  if (result.publicText) {
    store.appendEvent(job.roomId, "message.posted", viewer.id, { channel: "ic", author: agentRole === "AI PL" ? `AI PL · ${job.payload.seatLabel || "空位"}` : "AI KP", text: result.publicText, ai: true, seatId: job.payload.seatId || null }, "public");
  }
  applyToolCalls(store, job, result, owner, agentRole);
  store.completeJob(job.id, { usage: result.usage, suggestedNextAction: result.suggestedNextAction });
  store.appendEvent(job.roomId, "job.completed", job.payload.memberId, { jobId: job.id, kind: job.kind, usage: result.usage }, "system");
}

async function processImageJob(store, job) {
  const asset = store.getAsset(job.roomId, job.payload.assetId);
  if (!asset) throw new Error("图片任务不存在");
  const settings = store.getAiSettings(job.roomId);
  const baseUrl = String(settings.imageBaseUrl || settings.baseUrl || "").replace(/\/$/, "");
  const model = asset.model || settings.imageModel || "";
  if (!baseUrl || !model || !settings.apiKeyEncrypted) throw new Error("请先在房间设置中配置图片 Provider、模型和 API Key");
  store.markAssetRunning(asset.id);
  const apiKey = decryptSecret(settings.apiKeyEncrypted);
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt: asset.prompt, size: "1024x1024", response_format: "b64_json" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`图片 Provider 返回 ${response.status}${detail ? `：${detail.slice(0, 240)}` : ""}`);
  }
  const data = await response.json();
  const item = data?.data?.[0];
  let buffer;
  let mimeType = "image/png";
  if (item?.b64_json) buffer = Buffer.from(item.b64_json, "base64");
  else if (item?.url) {
    const imageResponse = await fetch(item.url);
    if (!imageResponse.ok) throw new Error(`图片下载失败：${imageResponse.status}`);
    mimeType = imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";
    buffer = Buffer.from(await imageResponse.arrayBuffer());
  }
  if (!buffer?.length) throw new Error("图片 Provider 没有返回图片数据");
  const completed = store.completeAsset(asset.id, { buffer, mimeType });
  store.completeJob(job.id, { assetId: asset.id, mimeType, bytes: buffer.length });
  store.appendEvent(job.roomId, "asset.completed", job.payload.memberId, { assetId: asset.id, asset: completed }, "public");
  store.appendEvent(job.roomId, "job.completed", job.payload.memberId, { jobId: job.id, kind: job.kind }, "system");
}

async function processAdventureJob(store, job) {
  const owner = store.getMemberById(job.payload.memberId);
  if (!owner) throw new Error("剧情任务所属成员不存在");
  const result = await generateAdventurePlan({ settings: store.getAiSettings(job.roomId), room: store.getRoom(job.roomId), brief: job.payload.brief, playerCount: job.payload.playerCount });
  store.completeJob(job.id, { plan: result.plan, usage: result.usage });
  store.appendEvent(job.roomId, "adventure.generated", owner.id, { jobId: job.id, plan: result.plan, usage: result.usage }, "kp_private");
  store.appendEvent(job.roomId, "job.completed", owner.id, { jobId: job.id, kind: job.kind, usage: result.usage }, "system");
}

export function startJobRunner(store, { intervalMs = 400 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    const job = store.claimNextJob();
    if (!job) return;
    running = true;
    try {
      if (job.kind === "ai.kp.turn" || job.kind === "ai-pl.turn") await processAiJob(store, job);
      else if (job.kind === "image.generate") await processImageJob(store, job);
      else if (job.kind === "adventure.generate") await processAdventureJob(store, job);
      else throw new Error(`未知任务类型：${job.kind}`);
    } catch (error) {
      const state = store.failJob(job.id, error instanceof Error ? error.message : error);
      if (job.kind === "image.generate") store.failAsset(job.payload.assetId, { status: state.status === "failed" ? "failed" : "queued", error });
      store.appendEvent(job.roomId, "job.failed", job.payload.memberId || "system", { jobId: job.id, kind: job.kind, status: state.status, error: String(error).slice(0, 240) }, "system");
      if (job.kind === "image.generate" && state.status === "failed") store.appendEvent(job.roomId, "asset.failed", job.payload.memberId || "system", { assetId: job.payload.assetId, error: String(error).slice(0, 240) }, "public");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
