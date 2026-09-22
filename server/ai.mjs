import { decryptSecret } from "./store.mjs";

const SYSTEM_PROMPT = `你是夜桌里的 AI 叙事代理。你负责参与一个多人文字调查团，保持克制、具体、可回应。
只根据给你的公开事件和主持状态行动；不要替玩家决定角色的内心或关键行动。
返回 JSON，不要使用 Markdown 代码围栏：{"publicText":"...","toolCalls":[],"suggestedNextAction":"..."}。
工具只能使用 request_check、roll、advance_scene、generate_image。数值变化必须通过工具，不能在文字中伪造结果。`;

function extractJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI 返回的内容不是有效 JSON");
  }
}

function compactEvent(event) {
  const payload = event.payload || {};
  return {
    seq: event.seq,
    type: event.type,
    actorId: event.actorId,
    channel: payload.channel,
    text: payload.text,
    result: payload.total ?? payload.roll,
    name: payload.author || payload.skillName,
  };
}

export function buildAiMessages({ room, events, agentRole = "AI KP" }) {
  const recent = events.slice(-50).map(compactEvent);
  const rolePrompt = agentRole === "AI PL"
    ? "你是一个 AI PL，只能替自己的角色做有限、可回应的行动；不要主持剧情，不要猜测隐藏线索，也不要替其他玩家决定行动。"
    : SYSTEM_PROMPT;
  return [
    { role: "system", content: rolePrompt },
    {
      role: "user",
      content: JSON.stringify({
        room: { title: room.title, system: room.system, status: room.status },
        recentEvents: recent,
        instruction: agentRole === "AI PL" ? "为自己的角色提出一个具体行动或一句符合角色视角的回应，不要推进场景结论。" : "推进一个场景节拍，优先给玩家一个具体可回应的观察或选择；如果需要规则判定，发起 request_check。",
      }),
    },
  ];
}

function providerUrl(baseUrl) {
  return `${String(baseUrl || "").replace(/\/$/, "")}/chat/completions`;
}

async function requestJson({ settings, messages, temperature = 0.8, maxTokens }) {
  if (!settings?.baseUrl || !settings?.model || !settings?.apiKeyEncrypted) throw new Error("房间还没有配置 AI Provider");
  const apiKey = decryptSecret(settings.apiKeyEncrypted);
  const response = await fetch(providerUrl(settings.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature,
      max_tokens: maxTokens || settings.maxOutputTokens || 2048,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI Provider 返回 ${response.status}${detail ? `：${detail.slice(0, 240)}` : ""}`);
  }
  const data = await response.json();
  return { parsed: extractJson(data?.choices?.[0]?.message?.content), usage: data.usage || null };
}

export async function generateAdventurePlan({ settings, room, brief = "", playerCount = 4 }) {
  const messages = [
    { role: "system", content: "你是文字跑团的剧本策划。请返回 JSON，不要 Markdown 代码围栏：{\"title\":\"\",\"premise\":\"\",\"tone\":\"\",\"scenes\":[{\"title\":\"\",\"purpose\":\"\",\"hook\":\"\",\"choices\":[\"\"]}],\"npcs\":[{\"name\":\"\",\"role\":\"\",\"secret\":\"\"}],\"safetyNotes\":\"\"}。只生成原创设定，不复述受版权保护的规则书原文；规则数值留给规则引擎。" },
    { role: "user", content: JSON.stringify({ system: room.system, roomTitle: room.title, playerCount: Math.min(8, Math.max(1, Number(playerCount) || 4)), brief: String(brief || "").slice(0, 1500), instruction: "生成一个可以在 3-6 个场景内完成的文字跑团冒险，给每个场景一个玩家可回应的入口。" }) },
  ];
  const result = await requestJson({ settings, messages, temperature: 0.75, maxTokens: Math.min(12000, settings.maxOutputTokens || 6000) });
  const plan = result.parsed || {};
  return {
    plan: {
      title: String(plan.title || "未命名冒险").slice(0, 160),
      premise: String(plan.premise || "").slice(0, 3000),
      tone: String(plan.tone || "").slice(0, 500),
      scenes: Array.isArray(plan.scenes) ? plan.scenes.slice(0, 8).map((scene) => ({ title: String(scene?.title || "场景").slice(0, 160), purpose: String(scene?.purpose || "").slice(0, 500), hook: String(scene?.hook || "").slice(0, 1000), choices: Array.isArray(scene?.choices) ? scene.choices.slice(0, 6).map((choice) => String(choice).slice(0, 300)) : [] })) : [],
      npcs: Array.isArray(plan.npcs) ? plan.npcs.slice(0, 12).map((npc) => ({ name: String(npc?.name || "未知人物").slice(0, 100), role: String(npc?.role || "").slice(0, 300), secret: String(npc?.secret || "").slice(0, 500) })) : [],
      safetyNotes: String(plan.safetyNotes || "").slice(0, 1000),
    },
    usage: result.usage,
  };
}

export async function generateAiTurn({ settings, room, events, agentRole = "AI KP" }) {
  const result = await requestJson({ settings, messages: buildAiMessages({ room, events, agentRole }), temperature: 0.8 });
  const parsed = result.parsed;
  return {
    publicText: String(parsed.publicText || "").slice(0, 6000),
    suggestedNextAction: String(parsed.suggestedNextAction || "").slice(0, 500),
    toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls.slice(0, 5) : [],
    usage: result.usage,
  };
}
