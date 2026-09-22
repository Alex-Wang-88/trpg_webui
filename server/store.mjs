import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createCocCharacter, resolvePercentileCheck, rollDice } from "./rules/coc.mjs";
import { createDndCharacter, resolveD20Check } from "./rules/dnd.mjs";

const now = () => new Date().toISOString();
const json = (value) => JSON.stringify(value ?? {});
const parseJson = (value, fallback = {}) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");
export const createSessionToken = () => randomBytes(32).toString("base64url");

function masterKey() {
  return createHash("sha256").update(process.env.APP_MASTER_KEY || "night-table-local-development-key").digest();
}

function encryptSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value) {
  if (!value) return "";
  const [ivText, tagText, dataText] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

function toMember(row) {
  if (!row) return null;
  return { id: row.id, roomId: row.room_id, displayName: row.display_name, role: row.role, createdAt: row.created_at };
}

function toEvent(row) {
  return {
    roomId: row.room_id,
    seq: row.seq,
    type: row.type,
    actorId: row.actor_id,
    visibility: row.visibility,
    targetMemberId: row.target_member_id,
    correlationId: row.correlation_id,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at,
  };
}

function assetExtension(mimeType = "image/png") {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function toAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    mimeType: row.mime_type,
    fileName: row.file_name,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GameStore extends EventEmitter {
  constructor({ dbPath = process.env.SQLITE_PATH || "data/night-table.sqlite", assetDir = process.env.ASSET_DIR || "data/assets" } = {}) {
    super();
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(assetDir, { recursive: true });
    this.assetDir = assetDir;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.initSchema();
    this.db.exec("PRAGMA optimize;");
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        system TEXT NOT NULL DEFAULT 'coc-percentile',
        status TEXT NOT NULL DEFAULT 'live',
        current_seq INTEGER NOT NULL DEFAULT 0,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player',
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seats (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        seat_role TEXT NOT NULL,
        seat_index INTEGER NOT NULL,
        controller TEXT NOT NULL DEFAULT 'empty',
        member_id TEXT,
        character_id TEXT,
        label TEXT NOT NULL DEFAULT '',
        UNIQUE(room_id, seat_role, seat_index)
      );
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        owner_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
        system TEXT NOT NULL,
        name TEXT NOT NULL,
        sheet_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'public',
        target_member_id TEXT,
        correlation_id TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(room_id, seq)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload_json TEXT NOT NULL,
        result_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        run_after TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        owner_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
        kind TEXT NOT NULL DEFAULT 'scene',
        status TEXT NOT NULL DEFAULT 'queued',
        prompt TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'openai-compatible',
        model TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT 'image/png',
        file_name TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_room_seq_idx ON events(room_id, seq);
      CREATE INDEX IF NOT EXISTS members_room_idx ON members(room_id);
      CREATE INDEX IF NOT EXISTS seats_room_role_controller_idx ON seats(room_id, seat_role, controller, member_id);
      CREATE INDEX IF NOT EXISTS characters_room_owner_created_idx ON characters(room_id, owner_member_id, created_at);
      CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, run_after);
      CREATE INDEX IF NOT EXISTS assets_room_idx ON assets(room_id, created_at);
    `);
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createRoom({ title = "未命名调查团", system = "coc-percentile", displayName = "房主" } = {}) {
    const roomId = randomUUID();
    const memberId = randomUUID();
    const sessionToken = createSessionToken();
    const createdAt = now();
    const code = this.newRoomCode();
    const room = { id: roomId, code, title: String(title).slice(0, 100), system, status: "live", currentSeq: 0, createdAt, updatedAt: createdAt };

    return this.transaction(() => {
      this.db.prepare("INSERT INTO rooms (id, code, title, system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(roomId, code, room.title, system, createdAt, createdAt);
      this.db.prepare("INSERT INTO members (id, room_id, display_name, role, token_hash, created_at) VALUES (?, ?, ?, 'owner', ?, ?)").run(memberId, roomId, String(displayName).slice(0, 50), hashToken(sessionToken), createdAt);
      this.db.prepare("INSERT INTO seats (id, room_id, seat_role, seat_index, controller, label) VALUES (?, ?, 'kp', 0, 'ai', 'AI KP')").run(randomUUID(), roomId);
      for (let index = 0; index < 6; index += 1) {
        this.db.prepare("INSERT INTO seats (id, room_id, seat_role, seat_index, controller, label) VALUES (?, ?, 'pl', ?, 'empty', ?)").run(randomUUID(), roomId, index, `PL ${index + 1}`);
      }
      this.appendEventInternal(roomId, "room.created", memberId, { system, title: room.title }, "system");
      this.appendEventInternal(roomId, "member.joined", memberId, { displayName: String(displayName).slice(0, 50), role: "owner" }, "public");
      return { room, member: { id: memberId, roomId, displayName, role: "owner" }, sessionToken };
    });
  }

  newRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do {
      const bytes = randomBytes(6);
      code = `NIGHT-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
    } while (this.db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code));
    return code;
  }

  joinRoom({ code, displayName = "玩家" } = {}) {
    const room = this.db.prepare("SELECT * FROM rooms WHERE code = ?").get(String(code || "").trim().toUpperCase());
    if (!room) throw new Error("房间不存在或邀请码已失效");
    if (room.status === "archived") throw new Error("房间已经归档");
    const memberId = randomUUID();
    const sessionToken = createSessionToken();
    const name = String(displayName || "玩家").slice(0, 50);
    return this.transaction(() => {
      this.db.prepare("INSERT INTO members (id, room_id, display_name, role, token_hash, created_at) VALUES (?, ?, ?, 'player', ?, ?)").run(memberId, room.id, name, hashToken(sessionToken), now());
      this.appendEventInternal(room.id, "member.joined", memberId, { displayName: name, role: "player" }, "public");
      return { room: this.toRoom(room), member: { id: memberId, roomId: room.id, displayName: name, role: "player" }, sessionToken };
    });
  }

  authenticate(token) {
    const row = this.db.prepare("SELECT * FROM members WHERE token_hash = ?").get(hashToken(token || ""));
    return toMember(row);
  }

  getRoom(roomId) {
    return this.toRoom(this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId));
  }

  getRoomByCode(code) {
    return this.toRoom(this.db.prepare("SELECT * FROM rooms WHERE code = ?").get(String(code || "").toUpperCase()));
  }

  toRoom(row) {
    if (!row) return null;
    const settings = parseJson(row.settings_json);
    const { apiKeyEncrypted, ...publicSettings } = settings;
    return { id: row.id, code: row.code, title: row.title, system: row.system, status: row.status, currentSeq: row.current_seq, settings: { ...publicSettings, apiKeyConfigured: Boolean(apiKeyEncrypted) }, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  getMembers(roomId) {
    return this.db.prepare("SELECT * FROM members WHERE room_id = ? ORDER BY created_at ASC").all(roomId).map(toMember);
  }

  getSeats(roomId) {
    return this.db.prepare("SELECT * FROM seats WHERE room_id = ? ORDER BY seat_role, seat_index").all(roomId).map((row) => ({ id: row.id, roomId, role: row.seat_role, index: row.seat_index, controller: row.controller, memberId: row.member_id, characterId: row.character_id, label: row.label }));
  }

  canSeeEvent(event, member) {
    if (!event || !member) return false;
    if (event.visibility === "public" || event.visibility === "system") return true;
    if (event.visibility === "member_private") return event.targetMemberId === member.id || event.actorId === member.id;
    return member.role === "owner" || member.role === "kp";
  }

  getEvents(roomId, afterSeq = 0, member) {
    return this.db.prepare("SELECT * FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC").all(roomId, Number(afterSeq) || 0).map(toEvent).filter((event) => this.canSeeEvent(event, member));
  }

  getBootstrap(roomId, afterSeq, member) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("房间不存在");
    return { room, member, members: this.getMembers(roomId), seats: this.getSeats(roomId), characters: this.getCharacters(roomId), assets: this.getAssets(roomId), events: this.getEvents(roomId, afterSeq, member) };
  }

  appendEventInternal(roomId, type, actorId, payload, visibility = "public", targetMemberId = null, correlationId = randomUUID()) {
    const room = this.db.prepare("SELECT current_seq FROM rooms WHERE id = ?").get(roomId);
    if (!room) throw new Error("房间不存在");
    const seq = room.current_seq + 1;
    const createdAt = now();
    this.db.prepare("INSERT INTO events (id, room_id, seq, type, actor_id, visibility, target_member_id, correlation_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), roomId, seq, type, actorId, visibility, targetMemberId, correlationId, json(payload), createdAt);
    this.db.prepare("UPDATE rooms SET current_seq = ?, updated_at = ? WHERE id = ?").run(seq, createdAt, roomId);
    const event = { roomId, seq, type, actorId, visibility, targetMemberId, correlationId, payload, createdAt };
    this.emit("event", event);
    return event;
  }

  appendEvent(roomId, type, actorId, payload, visibility = "public", targetMemberId = null, correlationId) {
    return this.transaction(() => this.appendEventInternal(roomId, type, actorId, payload, visibility, targetMemberId, correlationId));
  }

  command({ roomId, member, type, payload = {}, expectedSeq, clientCommandId = randomUUID() }) {
    if (!member || member.roomId !== roomId) throw new Error("没有权限访问这个房间");
    const duplicate = this.db.prepare("SELECT * FROM events WHERE correlation_id = ?").get(clientCommandId);
    if (duplicate) return toEvent(duplicate);
    const room = this.getRoom(roomId);
    if (!room) throw new Error("房间不存在");
    if (expectedSeq !== undefined && Number(expectedSeq) !== room.currentSeq) throw new Error("房间状态已更新，请刷新后重试");
    if (room.status === "paused" && !["resume_room", "post_message"].includes(type)) throw new Error("房间已暂停");

    return this.transaction(() => {
      switch (type) {
        case "post_message": {
          const channel = ["ic", "ooc", "kp"].includes(payload.channel) ? payload.channel : "ic";
          if (channel === "kp" && member.role !== "owner" && member.role !== "kp") throw new Error("只有 KP 可以使用私语频道");
          const visibility = channel === "kp" ? "kp_private" : "public";
          return this.appendEventInternal(roomId, "message.posted", member.id, { channel, text: String(payload.text || "").trim().slice(0, 4000), author: member.displayName }, visibility, null, clientCommandId);
        }
        case "roll_dice": {
          const result = rollDice(payload.expression || "1d100");
          return this.appendEventInternal(roomId, "dice.rolled", member.id, { ...result, reason: String(payload.reason || "").slice(0, 200) }, "public", null, clientCommandId);
        }
        case "resolve_check": {
          const result = room.system === "dnd-srd-d20"
            ? resolveD20Check({ abilityScore: payload.abilityScore, proficiency: payload.proficiency, proficient: payload.proficient, difficultyClass: payload.difficultyClass, forcedRoll: payload.forcedRoll })
            : resolvePercentileCheck({ skill: payload.skill, difficulty: payload.difficulty, forcedRoll: payload.forcedRoll });
          return this.appendEventInternal(roomId, "check.resolved", member.id, { ...result, skillName: String(payload.skillName || "技能").slice(0, 80) }, "public", null, clientCommandId);
        }
        case "pause_room":
          if (member.role !== "owner" && member.role !== "kp") throw new Error("只有房主或 KP 可以暂停房间");
          this.db.prepare("UPDATE rooms SET status = 'paused', updated_at = ? WHERE id = ?").run(now(), roomId);
          return this.appendEventInternal(roomId, "room.paused", member.id, {}, "public", null, clientCommandId);
        case "resume_room":
          if (member.role !== "owner" && member.role !== "kp") throw new Error("只有房主或 KP 可以恢复房间");
          this.db.prepare("UPDATE rooms SET status = 'live', updated_at = ? WHERE id = ?").run(now(), roomId);
          return this.appendEventInternal(roomId, "room.resumed", member.id, {}, "public", null, clientCommandId);
        case "claim_seat": {
          const existing = this.db.prepare("SELECT id FROM seats WHERE room_id = ? AND seat_role = 'pl' AND controller = 'human' AND member_id = ? LIMIT 1").get(roomId, member.id);
          if (existing) throw new Error("你已经占用一个 PL 座位");
          const seat = payload.seatId
            ? this.db.prepare("SELECT * FROM seats WHERE id = ? AND room_id = ? AND seat_role = 'pl'").get(payload.seatId, roomId)
            : this.db.prepare("SELECT * FROM seats WHERE room_id = ? AND seat_role = 'pl' AND controller = 'empty' ORDER BY seat_index ASC LIMIT 1").get(roomId);
          if (!seat) throw new Error("没有可用的 PL 座位");
          if (seat.controller !== "empty") throw new Error("这个座位已经被占用");
          const character = this.db.prepare("SELECT id FROM characters WHERE room_id = ? AND owner_member_id = ? ORDER BY created_at DESC LIMIT 1").get(roomId, member.id);
          this.db.prepare("UPDATE seats SET controller = 'human', member_id = ?, character_id = ? WHERE id = ?").run(member.id, character?.id || null, seat.id);
          return this.appendEventInternal(roomId, "seat.handoff", member.id, { seatId: seat.id, controller: "human", memberId: member.id }, "public", null, clientCommandId);
        }
        case "release_seat": {
          const seat = this.db.prepare("SELECT * FROM seats WHERE id = ? AND room_id = ? AND seat_role = 'pl'").get(payload.seatId, roomId);
          if (!seat) throw new Error("座位不存在");
          if (seat.controller !== "human" || (seat.member_id !== member.id && member.role !== "owner" && member.role !== "kp")) throw new Error("你不能释放这个座位");
          this.db.prepare("UPDATE seats SET controller = 'empty', member_id = NULL, character_id = NULL WHERE id = ?").run(seat.id);
          return this.appendEventInternal(roomId, "seat.handoff", member.id, { seatId: seat.id, controller: "empty", memberId: null }, "public", null, clientCommandId);
        }
        case "handoff_seat": {
          if (member.role !== "owner" && member.role !== "kp") throw new Error("只有房主或 KP 可以切换座位控制者");
          const controller = ["human", "ai", "empty"].includes(payload.controller) ? payload.controller : "empty";
          const seat = this.db.prepare("SELECT * FROM seats WHERE id = ? AND room_id = ?").get(payload.seatId, roomId);
          if (!seat) throw new Error("座位不存在");
          const targetMemberId = controller === "human" ? payload.memberId || member.id : null;
          if (targetMemberId) {
            const targetMember = this.db.prepare("SELECT id FROM members WHERE id = ? AND room_id = ?").get(targetMemberId, roomId);
            if (!targetMember) throw new Error("目标玩家不属于这个房间");
            const existingTargetSeat = this.db.prepare("SELECT id FROM seats WHERE room_id = ? AND seat_role = 'pl' AND controller = 'human' AND member_id = ? AND id != ? LIMIT 1").get(roomId, targetMemberId, seat.id);
            if (existingTargetSeat) throw new Error("目标玩家已经占用一个 PL 座位");
          }
          const targetCharacter = targetMemberId ? this.db.prepare("SELECT id FROM characters WHERE room_id = ? AND owner_member_id = ? ORDER BY created_at DESC LIMIT 1").get(roomId, targetMemberId) : null;
          this.db.prepare("UPDATE seats SET controller = ?, member_id = ?, character_id = ? WHERE id = ?").run(controller, targetMemberId, controller === "human" ? targetCharacter?.id || null : null, seat.id);
          return this.appendEventInternal(roomId, "seat.handoff", member.id, { seatId: seat.id, controller, memberId: targetMemberId }, "public", null, clientCommandId);
        }
        default:
          throw new Error(`不支持的房间命令：${type}`);
      }
    });
  }

  createCharacter({ roomId, member, input, system = "coc-percentile" }) {
    if (!member || member.roomId !== roomId) throw new Error("没有权限访问这个房间");
    const sheet = system === "dnd-srd-d20" ? createDndCharacter(input) : createCocCharacter(input);
    const id = randomUUID();
    const createdAt = now();
    return this.transaction(() => {
      this.db.prepare("INSERT INTO characters (id, room_id, owner_member_id, system, name, sheet_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, roomId, member.id, sheet.system, sheet.name, json(sheet), createdAt, createdAt);
      const seat = this.db.prepare("SELECT id FROM seats WHERE room_id = ? AND seat_role = 'pl' AND controller = 'human' AND member_id = ? ORDER BY seat_index ASC LIMIT 1").get(roomId, member.id);
      if (seat) this.db.prepare("UPDATE seats SET character_id = ? WHERE id = ?").run(id, seat.id);
      const event = this.appendEventInternal(roomId, "character.created", member.id, { characterId: id, sheet }, "public");
      return { id, sheet, event };
    });
  }

  getCharacters(roomId) {
    return this.db.prepare("SELECT * FROM characters WHERE room_id = ? ORDER BY created_at ASC").all(roomId).map((row) => ({
      id: row.id,
      roomId: row.room_id,
      ownerMemberId: row.owner_member_id,
      system: row.system,
      name: row.name,
      sheet: parseJson(row.sheet_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getCharacter(roomId, characterId) {
    const row = this.db.prepare("SELECT * FROM characters WHERE room_id = ? AND id = ?").get(roomId, characterId);
    if (!row) return null;
    return { id: row.id, roomId: row.room_id, ownerMemberId: row.owner_member_id, system: row.system, name: row.name, sheet: parseJson(row.sheet_json), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  updateCharacter({ roomId, member, characterId, input }) {
    if (!member || member.roomId !== roomId) throw new Error("没有权限访问这个房间");
    const current = this.getCharacter(roomId, characterId);
    if (!current) throw new Error("角色卡不存在");
    if (current.ownerMemberId !== member.id && member.role !== "owner" && member.role !== "kp") throw new Error("只有角色所有者或 KP 可以编辑角色卡");
    const merged = current.system === "dnd-srd-d20"
      ? { ...current.sheet, ...input, abilities: { ...(current.sheet.abilities || {}), ...(input.abilities || {}) } }
      : { ...current.sheet, ...input, attributes: { ...(current.sheet.attributes || {}), ...(input.attributes || {}) }, skills: { ...(current.sheet.skills || {}), ...(input.skills || {}) } };
    const sheet = current.system === "dnd-srd-d20" ? createDndCharacter(merged) : createCocCharacter(merged);
    const updatedAt = now();
    return this.transaction(() => {
      this.db.prepare("UPDATE characters SET name = ?, sheet_json = ?, updated_at = ? WHERE id = ? AND room_id = ?").run(sheet.name, json(sheet), updatedAt, characterId, roomId);
      const event = this.appendEventInternal(roomId, "character.updated", member.id, { characterId, sheet }, "public");
      return { ...current, name: sheet.name, sheet, updatedAt, event };
    });
  }

  updateAiSettings({ roomId, member, settings }) {
    if (!member || member.roomId !== roomId || member.role !== "owner") throw new Error("只有房主可以配置 AI");
    const current = this.getAiSettings(roomId);
    const next = { ...current, baseUrl: String(settings.baseUrl || "").replace(/\/$/, ""), model: String(settings.model || "").slice(0, 120), imageBaseUrl: String(settings.imageBaseUrl || current.imageBaseUrl || "").replace(/\/$/, ""), imageModel: String(settings.imageModel || current.imageModel || "").slice(0, 120), apiKeyEncrypted: settings.apiKey ? encryptSecret(settings.apiKey) : current.apiKeyEncrypted || "", thinking: Boolean(settings.thinking), maxOutputTokens: Math.min(16000, Math.max(256, Number(settings.maxOutputTokens) || 2048)) };
    return this.transaction(() => {
      this.db.prepare("UPDATE rooms SET settings_json = ?, updated_at = ? WHERE id = ?").run(json(next), now(), roomId);
      return { baseUrl: next.baseUrl, model: next.model, imageBaseUrl: next.imageBaseUrl, imageModel: next.imageModel, thinking: next.thinking, maxOutputTokens: next.maxOutputTokens, apiKeyConfigured: Boolean(next.apiKeyEncrypted) };
    });
  }

  getAiSettings(roomId) {
    const row = this.db.prepare("SELECT settings_json FROM rooms WHERE id = ?").get(roomId);
    return parseJson(row?.settings_json);
  }

  getAssets(roomId) {
    return this.db.prepare("SELECT * FROM assets WHERE room_id = ? ORDER BY created_at ASC").all(roomId).map(toAsset);
  }

  getAsset(roomId, assetId) {
    return toAsset(this.db.prepare("SELECT * FROM assets WHERE room_id = ? AND id = ?").get(roomId, assetId));
  }

  requestAsset({ roomId, member, input = {} }) {
    if (!member || member.roomId !== roomId) throw new Error("没有权限访问这个房间");
    if (member.role !== "owner" && member.role !== "kp") throw new Error("只有房主或 KP 可以生成场景图");
    const id = randomUUID();
    const createdAt = now();
    const prompt = String(input.prompt || "雨夜旧海关，潮湿的石墙，远处灯塔，克苏鲁式压迫感，电影感构图").trim().slice(0, 3000);
    const model = String(input.model || this.getAiSettings(roomId).imageModel || "").slice(0, 120);
    this.db.prepare("INSERT INTO assets (id, room_id, owner_member_id, kind, status, prompt, provider, model, created_at, updated_at) VALUES (?, ?, ?, 'scene', 'queued', ?, 'openai-compatible', ?, ?, ?)").run(id, roomId, member.id, prompt, model, createdAt, createdAt);
    this.appendEvent(roomId, "asset.requested", member.id, { assetId: id, kind: "scene", prompt, model, ai: Boolean(input.ai) }, "public");
    this.enqueueJob({ roomId, kind: "image.generate", payload: { memberId: member.id, assetId: id } });
    return this.getAsset(roomId, id);
  }

  markAssetRunning(assetId) {
    this.db.prepare("UPDATE assets SET status = 'running', error = NULL, updated_at = ? WHERE id = ?").run(now(), assetId);
  }

  completeAsset(assetId, { buffer, mimeType = "image/png" }) {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId);
    if (!row) throw new Error("图片任务不存在");
    const safeMimeType = ["image/png", "image/jpeg", "image/webp"].includes(mimeType) ? mimeType : "image/png";
    const fileName = `${assetId}${assetExtension(safeMimeType)}`;
    writeFileSync(join(this.assetDir, fileName), buffer);
    this.db.prepare("UPDATE assets SET status = 'completed', mime_type = ?, file_name = ?, error = NULL, updated_at = ? WHERE id = ?").run(safeMimeType, fileName, now(), assetId);
    return this.getAsset(row.room_id, assetId);
  }

  failAsset(assetId, { status = "failed", error = "图片生成失败" } = {}) {
    this.db.prepare("UPDATE assets SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(status, String(error).slice(0, 500), now(), assetId);
  }

  readAssetFile(roomId, assetId) {
    const asset = this.getAsset(roomId, assetId);
    if (!asset || asset.status !== "completed" || !asset.fileName) return null;
    return { asset, buffer: readFileSync(join(this.assetDir, asset.fileName)) };
  }

  getMemberById(memberId) {
    return toMember(this.db.prepare("SELECT * FROM members WHERE id = ?").get(memberId));
  }

  enqueueJob({ roomId, kind, payload = {}, runAfter = now() }) {
    const id = randomUUID();
    const createdAt = now();
    this.db.prepare("INSERT INTO jobs (id, room_id, kind, status, payload_json, run_after, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)").run(id, roomId, kind, json(payload), runAfter, createdAt, createdAt);
    this.appendEvent(roomId, "job.queued", String(payload.memberId || "system"), { jobId: id, kind }, "system");
    return { id, roomId, kind, status: "queued", payload, createdAt };
  }

  claimNextJob() {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at ASC LIMIT 1").get(now());
      if (!row) return null;
      const updatedAt = now();
      this.db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(updatedAt, row.id);
      return { id: row.id, roomId: row.room_id, kind: row.kind, status: "running", payload: parseJson(row.payload_json), attempts: row.attempts + 1, createdAt: row.created_at };
    });
  }

  completeJob(jobId, result = {}) {
    this.db.prepare("UPDATE jobs SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?").run(json(result), now(), jobId);
  }

  failJob(jobId, error) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!row) return { status: "missing" };
    const nextStatus = row.attempts >= 3 ? "failed" : "queued";
    const delay = Math.min(60, 2 ** Math.max(0, row.attempts - 1));
    const runAfter = new Date(Date.now() + delay * 1000).toISOString();
    this.db.prepare("UPDATE jobs SET status = ?, result_json = ?, run_after = ?, updated_at = ? WHERE id = ?").run(nextStatus, json({ error: String(error).slice(0, 500) }), runAfter, now(), jobId);
    return { status: nextStatus, runAfter };
  }

  getJob(jobId) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!row) return null;
    return { id: row.id, roomId: row.room_id, kind: row.kind, status: row.status, payload: parseJson(row.payload_json), result: parseJson(row.result_json, null), attempts: row.attempts, runAfter: row.run_after, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
