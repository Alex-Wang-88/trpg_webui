import { createServer } from "node:http";
import { GameStore } from "./store.mjs";
import { buildCocRuleContext } from "./rules/coc.mjs";
import { buildDndRuleContext } from "./rules/dnd.mjs";
import { startJobRunner } from "./jobs.mjs";

const PORT = Number(process.env.API_PORT || 8788);
const HOST = process.env.API_HOST || "127.0.0.1";
const store = new GameStore();
const streams = new Map();

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { ...jsonHeaders, ...extraHeaders });
  response.end(JSON.stringify(body));
}

function corsHeaders() {
  return { "access-control-allow-origin": process.env.CORS_ORIGIN || "http://localhost:5188", "access-control-allow-headers": "content-type, x-night-table-session, authorization", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" };
}

function writeSse(response, eventName, payload) {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event) {
  const subscribers = streams.get(event.roomId);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    if (!store.canSeeEvent(event, subscriber.member)) continue;
    writeSse(subscriber.response, "room.event", event);
  }
}

store.on("event", broadcast);
startJobRunner(store);

async function readBody(request) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error("请求内容过大");
  }
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw new Error("请求不是有效 JSON"); }
}

function getSession(request, url) {
  const auth = request.headers.authorization;
  return request.headers["x-night-table-session"] || (auth?.startsWith("Bearer ") ? auth.slice(7) : "") || url.searchParams.get("sessionToken") || "";
}

function authenticate(request, url, roomId) {
  const member = store.authenticate(getSession(request, url));
  if (!member || (roomId && member.roomId !== roomId)) throw new Error("会话无效或不属于这个房间");
  return member;
}

function pathParts(url) {
  return url.pathname.split("/").filter(Boolean);
}

function errorStatus(message) {
  if (/房间不存在/.test(message)) return 404;
  if (/角色卡不存在|图片资源不存在|任务不存在/.test(message)) return 404;
  if (/不存在|无效|不属于|权限|只有|没有配置|已归档/.test(message)) return 403;
  if (/状态已更新/.test(message)) return 409;
  return 400;
}

async function handle(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const parts = pathParts(url);
  if (request.method === "OPTIONS") { response.writeHead(204, corsHeaders()); response.end(); return; }
  if (request.method === "GET" && url.pathname === "/api/health") { sendJson(response, 200, { ok: true, service: "night-table-api", time: new Date().toISOString() }, corsHeaders()); return; }
  if (request.method === "GET" && url.pathname === "/api/rules/packs") { sendJson(response, 200, { packs: [{ id: "coc-percentile", version: 1, label: "百分骰恐怖调查", description: "CoC-compatible 原创百分骰规则核心" }, { id: "dnd-srd-d20", version: 1, label: "D&D SRD d20 核心", description: "可公开分发边界内的 d20、属性、AC、HP 和检定核心" }] }, corsHeaders()); return; }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(request);
    const result = store.createRoom({ title: body.title, system: body.system, displayName: body.displayName });
    sendJson(response, 201, result, corsHeaders());
    return;
  }

  if (request.method === "POST" && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "join") {
    const body = await readBody(request);
    const result = store.joinRoom({ code: parts[2], displayName: body.displayName });
    sendJson(response, 200, result, corsHeaders());
    return;
  }

  if (parts[0] !== "api" || parts[1] !== "rooms" || !parts[2]) {
    sendJson(response, 404, { error: "Not found" }, corsHeaders());
    return;
  }

  const roomId = parts[2];
  const member = authenticate(request, url, roomId);

  if (request.method === "GET" && parts[3] === "bootstrap") {
    sendJson(response, 200, store.getBootstrap(roomId, Number(url.searchParams.get("afterSeq") || 0), member), corsHeaders());
    return;
  }

  if (request.method === "GET" && parts[3] === "stream") {
    response.writeHead(200, { ...corsHeaders(), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    writeSse(response, "ready", { roomId, currentSeq: store.getRoom(roomId)?.currentSeq || 0 });
    const subscriber = { response, member };
    if (!streams.has(roomId)) streams.set(roomId, new Set());
    streams.get(roomId).add(subscriber);
    const heartbeat = setInterval(() => writeSse(response, "heartbeat", { time: new Date().toISOString() }), 20_000);
    request.on("close", () => { clearInterval(heartbeat); streams.get(roomId)?.delete(subscriber); if (streams.get(roomId)?.size === 0) streams.delete(roomId); });
    return;
  }

  if (request.method === "POST" && parts[3] === "commands") {
    const body = await readBody(request);
    const event = store.command({ roomId, member, type: body.type, payload: body.payload, expectedSeq: body.expectedSeq, clientCommandId: body.clientCommandId });
    sendJson(response, 200, { event }, corsHeaders());
    return;
  }

  if (request.method === "POST" && parts[3] === "characters") {
    const body = await readBody(request);
    const system = store.getRoom(roomId)?.system || "coc-percentile";
    const result = store.createCharacter({ roomId, member, input: body, system });
    sendJson(response, 201, { ...result, ruleContext: system === "dnd-srd-d20" ? buildDndRuleContext(result.sheet) : buildCocRuleContext(result.sheet) }, corsHeaders());
    return;
  }

  if (request.method === "GET" && parts[3] === "characters" && !parts[4]) {
    sendJson(response, 200, { characters: store.getCharacters(roomId) }, corsHeaders());
    return;
  }

  if (request.method === "PUT" && parts[3] === "characters" && parts[4]) {
    const body = await readBody(request);
    const current = store.getCharacter(roomId, parts[4]);
    if (!current) throw new Error("角色卡不存在");
    const result = store.updateCharacter({ roomId, member, characterId: parts[4], input: body });
    sendJson(response, 200, { ...result, ruleContext: current.system === "dnd-srd-d20" ? buildDndRuleContext(result.sheet) : buildCocRuleContext(result.sheet) }, corsHeaders());
    return;
  }

  if (request.method === "POST" && parts[3] === "assets" && parts[4] === "generate") {
    const body = await readBody(request);
    const asset = store.requestAsset({ roomId, member, input: body });
    sendJson(response, 202, { asset, status: asset.status }, corsHeaders());
    return;
  }

  if (request.method === "GET" && parts[3] === "assets" && !parts[4]) {
    sendJson(response, 200, { assets: store.getAssets(roomId) }, corsHeaders());
    return;
  }

  if (request.method === "GET" && parts[3] === "assets" && parts[4] && parts[5] === "file") {
    const file = store.readAssetFile(roomId, parts[4]);
    if (!file) throw new Error("图片资源不存在");
    response.writeHead(200, { ...corsHeaders(), "content-type": file.asset.mimeType, "cache-control": "private, max-age=3600", "content-length": file.buffer.length });
    response.end(file.buffer);
    return;
  }

  if (request.method === "GET" && parts[3] === "assets" && parts[4]) {
    const asset = store.getAsset(roomId, parts[4]);
    if (!asset) throw new Error("图片资源不存在");
    sendJson(response, 200, { asset }, corsHeaders());
    return;
  }

  if ((request.method === "POST" || request.method === "PUT") && parts[3] === "ai" && parts[4] === "settings") {
    const body = await readBody(request);
    const settings = store.updateAiSettings({ roomId, member, settings: body });
    sendJson(response, 200, { settings }, corsHeaders());
    return;
  }

  if (request.method === "POST" && parts[3] === "ai" && parts[4] === "continue") {
    if (member.role !== "owner" && member.role !== "kp") throw new Error("只有房主或 KP 可以让 AI 推进");
    const job = store.enqueueJob({ roomId, kind: "ai.kp.turn", payload: { memberId: member.id } });
    sendJson(response, 202, { jobId: job.id, status: job.status }, corsHeaders());
    return;
  }

  if (request.method === "POST" && parts[3] === "adventures" && parts[4] === "generate") {
    if (member.role !== "owner" && member.role !== "kp") throw new Error("只有房主或 KP 可以生成剧情");
    const body = await readBody(request);
    const job = store.enqueueJob({ roomId, kind: "adventure.generate", payload: { memberId: member.id, brief: String(body.brief || "").slice(0, 1500), playerCount: Math.min(8, Math.max(1, Number(body.playerCount) || 4)) } });
    sendJson(response, 202, { jobId: job.id, status: job.status }, corsHeaders());
    return;
  }

  if (request.method === "POST" && parts[3] === "ai-pl" && parts[5] === "continue") {
    if (member.role !== "owner" && member.role !== "kp") throw new Error("只有房主或 KP 可以请求 AI PL 行动");
    const seat = store.getSeats(roomId).find((candidate) => candidate.id === parts[4]);
    if (!seat || seat.role !== "pl" || seat.controller !== "ai") throw new Error("这个座位没有启用 AI PL");
    const job = store.enqueueJob({ roomId, kind: "ai-pl.turn", payload: { memberId: member.id, seatId: seat.id, seatLabel: seat.label } });
    sendJson(response, 202, { jobId: job.id, status: job.status }, corsHeaders());
    return;
  }

  if (request.method === "GET" && parts[3] === "jobs" && parts[4]) {
    const job = store.getJob(parts[4]);
    if (!job || job.roomId !== roomId) throw new Error("任务不存在");
    sendJson(response, 200, { job }, corsHeaders());
    return;
  }

  if (request.method === "GET" && parts[3] === "export") {
    const room = store.getRoom(roomId);
    const data = { version: 1, exportedAt: new Date().toISOString(), room, members: store.getMembers(roomId), seats: store.getSeats(roomId), events: store.getEvents(roomId, 0, member) };
    sendJson(response, 200, data, { ...corsHeaders(), "content-disposition": `attachment; filename="night-table-${room.code}.json"` });
    return;
  }

  sendJson(response, 404, { error: "Not found" }, corsHeaders());
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    const message = error instanceof Error ? error.message : "服务器错误";
    if (!response.headersSent) sendJson(response, errorStatus(message), { error: message }, corsHeaders());
    else response.end();
  });
});

server.listen(PORT, HOST, () => console.log(`Night Table API listening on http://${HOST}:${PORT}`));
