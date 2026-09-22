"use client";

/* The scene asset URL is room-authenticated by the self-hosted API, so a native image keeps the URL out of a remote image allowlist. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

type SpeechRecognitionResultLike = { isFinal: boolean; [index: number]: { transcript: string } };
type SpeechRecognitionEventLike = { resultIndex: number; results: { [index: number]: SpeechRecognitionResultLike; length: number } };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type IconName = "spark" | "bell" | "more" | "settings" | "pause" | "play" | "mic" | "send" | "lock" | "arrow-up-right" | "image" | "dice" | "close";

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    spark: <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" />,
    bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    settings: <><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="4" /></>,
    pause: <><rect x="6" y="5" width="3" height="14" rx="1" /><rect x="15" y="5" width="3" height="14" rx="1" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    send: <path d="m4 4 16 8-16 8 3-8-3-8Zm3 8h13" />,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    "arrow-up-right": <path d="M7 17 17 7M8 7h9v9" />,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m3 16 5-5 4 4 3-3 6 6" /></>,
    dice: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5m0 0-8-4.5M8 8h.01M16 16h.01M8 16h.01M16 8h.01" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };

  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

type Channel = "ic" | "ooc" | "kp";
type MessageKind = "narration" | "player" | "kp" | "system";

type Message = {
  id: number;
  kind: MessageKind;
  author: string;
  role: string;
  time: string;
  text: string;
  channel: Channel;
  avatar: string;
  accent?: string;
};

type RoomEvent = { seq: number; type: string; actorId?: string; payload?: Record<string, unknown> };

type LogEntry = { id: number; tone: "purple" | "amber" | "cyan"; icon: string; text: string; time: string };

type RoomSystem = "coc-percentile" | "dnd-srd-d20";

type Seat = {
  id: string;
  role: "kp" | "pl";
  index: number;
  controller: "human" | "ai" | "empty";
  memberId?: string | null;
  characterId?: string | null;
  label: string;
};

type CharacterRecord = {
  id?: string;
  ownerMemberId?: string;
  system: RoomSystem;
  name: string;
  sheet: {
    name: string;
    playerName?: string;
    occupation?: string;
    className?: string;
    age?: number;
    level?: number;
    attributes?: Record<string, number>;
    abilities?: Record<string, number>;
    derived?: { hp?: number; maxHp?: number; san?: number; maxSan?: number; luck?: number };
    hp?: number;
    maxHp?: number;
    armorClass?: number;
    proficiency?: number;
    notes?: string;
  };
};

type Asset = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  prompt: string;
  mimeType?: string;
  fileName?: string | null;
  error?: string | null;
};

type AdventurePlan = {
  title: string;
  premise: string;
  tone: string;
  scenes: { title: string; purpose: string; hook: string; choices: string[] }[];
  npcs: { name: string; role: string; secret: string }[];
  safetyNotes: string;
};

const defaultCharacterForm = { name: "艾伦·格雷", occupation: "调查记者", age: "31", str: "45", con: "50", siz: "50", dex: "60", app: "50", int: "70", pow: "65", edu: "75", luck: "42", wis: "50", cha: "50", notes: "第三声钟响之后，港口所有的灯同时熄灭。" };

function characterFormFromRecord(record: CharacterRecord) {
  const sheet = record.sheet || {};
  const stats = sheet.attributes || sheet.abilities || {};
  return {
    ...defaultCharacterForm,
    name: sheet.name || defaultCharacterForm.name,
    occupation: sheet.occupation || sheet.className || defaultCharacterForm.occupation,
    age: String(sheet.age || defaultCharacterForm.age),
    str: String(stats.str ?? defaultCharacterForm.str),
    con: String(stats.con ?? defaultCharacterForm.con),
    siz: String(stats.siz ?? defaultCharacterForm.siz),
    dex: String(stats.dex ?? defaultCharacterForm.dex),
    app: String(stats.app ?? defaultCharacterForm.app),
    int: String(stats.int ?? defaultCharacterForm.int),
    pow: String(stats.pow ?? defaultCharacterForm.pow),
    edu: String(stats.edu ?? defaultCharacterForm.edu),
    luck: String(stats.luck ?? defaultCharacterForm.luck),
    wis: String(stats.wis ?? defaultCharacterForm.wis),
    cha: String(stats.cha ?? defaultCharacterForm.cha),
    notes: sheet.notes || "",
  };
}

const initialMessages: Message[] = [
  {
    id: 1,
    kind: "system",
    author: "夜桌引擎",
    role: "SCENE BEAT 01",
    time: "20:41",
    text: "新场景已建立 · 雾港，1927 年 11 月 03 日，23:17。雨幕正在变密。",
    channel: "ic",
    avatar: "✦",
  },
  {
    id: 2,
    kind: "kp",
    author: "AI KP · 伊芙琳",
    role: "守秘人",
    time: "20:42",
    text: "第三声钟响之后，港口所有的灯同时熄灭。你们站在旧海关外，听见门内传来一声不像人类的喘息。门缝里，有一线温热的雾。",
    channel: "ic",
    avatar: "E",
    accent: "violet",
  },
  {
    id: 3,
    kind: "player",
    author: "林默",
    role: "艾伦·格雷 · 调查记者",
    time: "20:43",
    text: "我先绕到海关侧面，看有没有能避开正门的入口。手电只照脚下，不把自己暴露在窗边。",
    channel: "ic",
    avatar: "林",
    accent: "amber",
  },
  {
    id: 4,
    kind: "player",
    author: "夏蝉",
    role: "顾清 · 医生",
    time: "20:43",
    text: "我检查一下门口的积水和雾，尤其留意有没有血迹、脚印或者异常气味。",
    channel: "ic",
    avatar: "顾",
    accent: "cyan",
  },
  {
    id: 5,
    kind: "system",
    author: "夜桌引擎",
    role: "RULE CHECK",
    time: "20:44",
    text: "顾清进行【侦查】检定 · 普通难度 · 需要 45 或更低。",
    channel: "ic",
    avatar: "d100",
  },
  {
    id: 6,
    kind: "player",
    author: "顾清",
    role: "侦查检定",
    time: "20:44",
    text: "我掷骰。",
    channel: "ic",
    avatar: "顾",
    accent: "cyan",
  },
];

const channelLabels: Record<Channel, string> = {
  ic: "场内",
  ooc: "场外",
  kp: "KP 私语",
};

const playerSeats = [
  { name: "林默", subtitle: "艾伦·格雷", avatar: "林", color: "amber", status: "在线" },
  { name: "夏蝉", subtitle: "顾清", avatar: "顾", color: "cyan", status: "在线" },
  { name: "空位", subtitle: "AI PL 待命", avatar: "AI", color: "violet", status: "AI" },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8788";

function eventToMessage(event: { seq: number; type: string; payload?: Record<string, unknown> }): Message | null {
  const payload = event.payload || {};
  if (event.type === "message.posted") {
    const channel = payload.channel === "ooc" || payload.channel === "kp" ? payload.channel as Channel : "ic";
    return {
      id: 100000 + event.seq,
      kind: payload.ai ? "kp" : "player",
      author: String(payload.author || (payload.ai ? "AI KP" : "玩家")),
      role: payload.ai ? "守秘人" : payload.channel === "ooc" ? "场外发言" : "调查员",
      time: "刚刚",
      text: String(payload.text || ""),
      channel,
      avatar: payload.ai ? "E" : "玩",
      accent: payload.ai ? "violet" : "amber",
    };
  }
  if (event.type === "dice.rolled") {
    const isD20 = String(payload.expression || "").includes("d20");
    return {
      id: 100000 + event.seq,
      kind: "system",
      author: "夜桌引擎",
      role: "服务器骰点",
      time: "刚刚",
      text: `${String(payload.expression || "骰子")} = ${String(payload.total ?? "-")} · ${(payload.rolls as number[] | undefined)?.join(" + ") || ""}`,
      channel: "ic",
      avatar: isD20 ? "d20" : "d100",
    };
  }
  if (event.type === "check.resolved") {
    const isD20 = payload.difficultyClass !== undefined;
    return {
      id: 100000 + event.seq,
      kind: "system",
      author: "夜桌引擎",
      role: `检定 · ${String(payload.skillName || "技能")}`,
      time: "刚刚",
      text: `${isD20 ? "D20" : "D100"} = ${String(payload.roll ?? "-")} · ${String(payload.tier || (payload.success ? "成功" : "失败"))}`,
      channel: "ic",
      avatar: isD20 ? "d20" : "d100",
    };
  }
  if (event.type === "room.paused" || event.type === "room.resumed") {
    return {
      id: 100000 + event.seq,
      kind: "system",
      author: "夜桌引擎",
      role: event.type === "room.paused" ? "房间已暂停" : "房间已恢复",
      time: "刚刚",
      text: event.type === "room.paused" ? "所有行动暂时冻结，准备好后可以继续。" : "房间重新开放行动。",
      channel: "ic",
      avatar: "✦",
    };
  }
  return null;
}

function eventToLog(event: RoomEvent): LogEntry | null {
  const payload = event.payload || {};
  if (event.type === "scene.advanced") return { id: event.seq, tone: "purple", icon: "✦", text: "AI KP 推进了场景", time: "刚刚" };
  if (event.type === "message.posted" && payload.ai) return { id: event.seq, tone: "purple", icon: "✦", text: `${String(payload.author || "AI")} 发出了新叙述`, time: "刚刚" };
  if (event.type === "dice.rolled") return { id: event.seq, tone: "amber", icon: "◈", text: `${String(payload.expression || "骰子")} = ${String(payload.total ?? "-")}`, time: "刚刚" };
  if (event.type === "check.resolved") return { id: event.seq, tone: "amber", icon: "◈", text: `${String(payload.skillName || "技能")} 检定 · ${String(payload.tier || "未判定")}`, time: "刚刚" };
  if (event.type === "member.joined") return { id: event.seq, tone: "cyan", icon: "↗", text: `${String(payload.displayName || "玩家")} 加入房间`, time: "刚刚" };
  if (event.type === "seat.handoff") return { id: event.seq, tone: "cyan", icon: "♧", text: `座位已${payload.controller === "empty" ? "释放" : payload.controller === "ai" ? "交给 AI" : "有人入座"}`, time: "刚刚" };
  if (event.type === "asset.completed") return { id: event.seq, tone: "purple", icon: "▧", text: "场景图生成完成", time: "刚刚" };
  if (event.type === "asset.failed") return { id: event.seq, tone: "amber", icon: "!", text: "场景图生成失败", time: "刚刚" };
  return null;
}

export default function Home() {
  const [activeChannel, setActiveChannel] = useState<Channel>("ic");
  const [messages, setMessages] = useState(initialMessages);
  const [composer, setComposer] = useState("");
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [diceRolling, setDiceRolling] = useState(false);
  const [eventLog, setEventLog] = useState<LogEntry[]>([
    { id: 1, tone: "purple", icon: "✦", text: "AI KP 推进了场景", time: "刚刚" },
    { id: 2, tone: "amber", icon: "◈", text: "顾清发起侦查检定", time: "1 分钟前" },
    { id: 3, tone: "cyan", icon: "↗", text: "林默加入房间", time: "3 分钟前" },
  ]);
  const [isAiWorking, setIsAiWorking] = useState(false);
  const [roomPaused, setRoomPaused] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [characterRecord, setCharacterRecord] = useState<CharacterRecord | null>(null);
  const [characterForm, setCharacterForm] = useState(defaultCharacterForm);
  const [characterSaving, setCharacterSaving] = useState(false);
  const [characterError, setCharacterError] = useState("");
  const [toast, setToast] = useState("");
  const [apiStatus, setApiStatus] = useState<"demo" | "online" | "offline">("demo");
  const [roomCode, setRoomCode] = useState("MORROW-7Q");
  const [roomTitle, setRoomTitle] = useState("雾港的第三声钟鸣");
  const [roomId, setRoomId] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [memberId, setMemberId] = useState("");
  const [memberRole, setMemberRole] = useState("player");
  const [roomSystem, setRoomSystem] = useState<RoomSystem>("coc-percentile");
  const [roomSeats, setRoomSeats] = useState<Seat[]>([]);
  const [roomMembers, setRoomMembers] = useState<{ id: string; displayName: string; role: string }[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [showAssetDialog, setShowAssetDialog] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [assetForm, setAssetForm] = useState({ prompt: "雨夜旧海关，潮湿的石墙，远处灯塔，克苏鲁式压迫感，电影感构图" });
  const [adventurePlan, setAdventurePlan] = useState<AdventurePlan | null>(null);
  const [showAdventure, setShowAdventure] = useState(false);
  const [adventureBusy, setAdventureBusy] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState("");
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [showRoomDialog, setShowRoomDialog] = useState(false);
  const [roomDialogMode, setRoomDialogMode] = useState<"create" | "join">("join");
  const [roomDialogBusy, setRoomDialogBusy] = useState(false);
  const [roomDialogError, setRoomDialogError] = useState("");
  const [roomForm, setRoomForm] = useState<{ code: string; title: string; displayName: string; system: RoomSystem }>({ code: "", title: "雾港的第三声钟鸣", displayName: "访客", system: "coc-percentile" });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [aiForm, setAiForm] = useState({ baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", imageBaseUrl: "https://api.openai.com/v1", imageModel: "dall-e-3", apiKey: "", maxOutputTokens: "2048", thinking: false });
  const toastTimerRef = useRef<number | null>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.channel === activeChannel),
    [activeChannel, messages],
  );

  const displayPlayerSeats = useMemo(() => {
    if (!roomSeats.length) return playerSeats.map((seat) => ({ ...seat, id: undefined, controller: seat.status === "AI" ? "ai" : "human" as const }));
    return roomSeats.filter((seat) => seat.role === "pl").map((seat, index) => {
      const member = roomMembers.find((candidate) => candidate.id === seat.memberId);
      return {
        id: seat.id,
        name: seat.label || `PL ${index + 1}`,
        subtitle: seat.controller === "ai" ? "AI PL 待命" : seat.controller === "human" ? member?.displayName || "玩家" : "等待加入",
        avatar: seat.controller === "ai" ? "AI" : member?.displayName?.slice(0, 1) || "·",
        color: seat.controller === "ai" ? "violet" : index % 2 === 0 ? "amber" : "cyan",
        status: seat.controller === "ai" ? "AI" : seat.controller === "human" ? "在线" : "空位",
        controller: seat.controller,
        memberId: seat.memberId || null,
      };
    });
  }, [roomMembers, roomSeats]);

  const latestAsset = [...assets].reverse().find((asset) => asset.status === "completed");
  const generatedAssetUrl = latestAsset && roomId && sessionToken ? `${API_BASE}/api/rooms/${roomId}/assets/${latestAsset.id}/file?sessionToken=${encodeURIComponent(sessionToken)}` : "";
  const canManageRoom = memberRole === "owner" || memberRole === "kp";
  const activeSheet = characterRecord?.sheet;
  const activeHp = activeSheet?.derived?.hp ?? activeSheet?.hp ?? 11;
  const activeMaxHp = activeSheet?.derived?.maxHp ?? activeSheet?.maxHp ?? activeHp;
  const activeSan = activeSheet?.derived?.san ?? 58;
  const activeMaxSan = activeSheet?.derived?.maxSan ?? activeSan;
  const formLuck = Number(characterForm.luck);
  const activeLuck = activeSheet?.derived?.luck ?? (Number.isFinite(formLuck) ? formLuck : 42);
  const characterStatKeys = roomSystem === "dnd-srd-d20" ? ["str", "dex", "con", "int", "wis", "cha"] : ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"];
  const diceExpression = roomSystem === "dnd-srd-d20" ? "1d20" : "1d100";
  const diceSuccess = lastRoll === null ? false : roomSystem === "dnd-srd-d20" ? lastRoll >= 10 : lastRoll <= 45;

  const pushToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 2600);
  };

  useEffect(() => {
    const hasModal = showCharacter || showAssetDialog || showAdventure || showRoomDialog || showSettings;
    if (!hasModal) return undefined;

    document.body.classList.add("modal-open");
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowCharacter(false);
      setShowAssetDialog(false);
      setShowAdventure(false);
      setShowRoomDialog(false);
      setShowSettings(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showAdventure, showAssetDialog, showCharacter, showRoomDialog, showSettings]);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const copyInviteCode = async () => {
    if (!roomCode || roomCode === "MORROW-7Q") {
      openRoomDialog("join");
      return;
    }
    try {
      await navigator.clipboard.writeText(roomCode);
      pushToast(`邀请码 ${roomCode} 已复制`);
    } catch {
      pushToast(`邀请码：${roomCode}`);
    }
  };

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    const connect = async () => {
      try {
        const stored = window.sessionStorage.getItem("night-table-session");
        let session = stored ? JSON.parse(stored) : null;
        if (session?.roomId && session?.sessionToken) {
          const probe = await fetch(`${API_BASE}/api/rooms/${session.roomId}/bootstrap?afterSeq=0`, { headers: { "x-night-table-session": session.sessionToken } });
          if (!probe.ok) {
            window.sessionStorage.removeItem("night-table-session");
            session = null;
          }
        }
        if (!session?.roomId || !session?.sessionToken) {
          const response = await fetch(`${API_BASE}/api/rooms`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "雾港的第三声钟鸣", system: "coc-percentile", displayName: "访客" }),
          });
          if (!response.ok) throw new Error("API unavailable");
          session = await response.json();
          window.sessionStorage.setItem("night-table-session", JSON.stringify({ roomId: session.room.id, roomCode: session.room.code, sessionToken: session.sessionToken, member: session.member }));
        }
        if (cancelled) return;
        const activeRoomId = session.room?.id || session.roomId;
        const activeRoomCode = session.room?.code || session.roomCode;
        const activeRoomSystem = session.room?.system || "coc-percentile";
        const activeRoomTitle = session.room?.title || "雾港的第三声钟鸣";
        const activeMemberId = session.member?.id || "";
        setRoomId(activeRoomId);
        setRoomCode(activeRoomCode);
        setRoomTitle(activeRoomTitle);
        setSessionToken(session.sessionToken);
        setMemberId(activeMemberId);
        setMemberRole(session.member?.role || "player");
        setRoomSystem(activeRoomSystem === "dnd-srd-d20" ? "dnd-srd-d20" : "coc-percentile");
        const bootstrap = await fetch(`${API_BASE}/api/rooms/${activeRoomId}/bootstrap?afterSeq=0`, { headers: { "x-night-table-session": session.sessionToken } });
        if (!bootstrap.ok) throw new Error("房间会话已失效");
        setApiStatus("online");
        {
          const data = await bootstrap.json();
          setRoomTitle(data.room?.title || activeRoomTitle);
          setMemberId(data.member?.id || session.member?.id || "");
          setRoomSystem(data.room?.system === "dnd-srd-d20" ? "dnd-srd-d20" : "coc-percentile");
          setMemberRole(data.member?.role || session.member?.role || "player");
          setRoomSeats(data.seats || []);
          setRoomMembers(data.members || []);
          setAssets(data.assets || []);
          setRoomPaused(data.room?.status === "paused");
          const currentSettings = data.room?.settings || {};
          setAiForm((current) => ({ ...current, baseUrl: currentSettings.baseUrl || current.baseUrl, model: currentSettings.model || current.model, imageBaseUrl: currentSettings.imageBaseUrl || current.imageBaseUrl, imageModel: currentSettings.imageModel || current.imageModel, maxOutputTokens: String(currentSettings.maxOutputTokens || current.maxOutputTokens), thinking: Boolean(currentSettings.thinking) }));
          const ownedCharacter = (data.characters || []).find((candidate: CharacterRecord) => candidate.ownerMemberId === data.member?.id) || data.characters?.[0];
          if (ownedCharacter) {
            setCharacterRecord(ownedCharacter);
            setCharacterForm(characterFormFromRecord(ownedCharacter));
          }
          const restored = (data.events || []).map(eventToMessage).filter(Boolean) as Message[];
          setMessages(restored);
          const restoredLog = (data.events || []).map(eventToLog).filter(Boolean) as LogEntry[];
          if (restoredLog.length > 0) setEventLog(restoredLog.slice(-6));
        }
        source = new EventSource(`${API_BASE}/api/rooms/${activeRoomId}/stream?sessionToken=${encodeURIComponent(session.sessionToken)}`);
        source.onopen = () => setApiStatus("online");
        source.onerror = () => {
          if (!cancelled) {
            setApiStatus("offline");
            setDiceRolling(false);
          }
        };
        source.addEventListener("room.event", (event) => {
          const domainEvent = JSON.parse((event as MessageEvent).data) as RoomEvent;
          const nextLog = eventToLog(domainEvent);
          if (nextLog) setEventLog((current) => [...current, nextLog].slice(-6));
          if (domainEvent.type === "room.paused" || domainEvent.type === "room.resumed") {
            setRoomPaused(domainEvent.type === "room.paused");
          }
          if (domainEvent.type === "dice.rolled") {
            const rolls = domainEvent.payload?.rolls as number[] | undefined;
            const result = Number(rolls?.[0] ?? domainEvent.payload?.total);
            if (Number.isFinite(result)) setLastRoll(result);
            setDiceRolling(false);
          }
          if (domainEvent.type === "check.resolved") {
            const result = Number(domainEvent.payload?.roll);
            if (Number.isFinite(result)) setLastRoll(result);
            setDiceRolling(false);
          }
          if (domainEvent.type === "seat.handoff") {
            const payload = domainEvent.payload || {};
            setRoomSeats((current) => current.map((seat) => seat.id === payload.seatId ? { ...seat, controller: payload.controller as Seat["controller"], memberId: payload.memberId as string | null } : seat));
          }
          if (domainEvent.type === "asset.requested" || domainEvent.type === "asset.completed" || domainEvent.type === "asset.failed") {
            const candidate = domainEvent.payload?.asset as Asset | undefined;
            const assetId = String(domainEvent.payload?.assetId || candidate?.id || "");
            if (candidate) setAssets((current) => [...current.filter((asset) => asset.id !== candidate.id), candidate]);
            else if (assetId) setAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, status: domainEvent.type === "asset.failed" ? "failed" : "queued", error: String(domainEvent.payload?.error || "") } : asset));
            if (domainEvent.type === "asset.completed") pushToast("场景图已生成");
            if (domainEvent.type === "asset.failed") pushToast("场景图生成失败，请检查图片 Provider 设置");
          }
          if (domainEvent.type === "character.created" || domainEvent.type === "character.updated") {
            const sheet = domainEvent.payload?.sheet as (CharacterRecord["sheet"] & { system?: RoomSystem }) | undefined;
            const candidate = sheet ? { id: String(domainEvent.payload?.characterId || ""), system: sheet.system || "coc-percentile" as RoomSystem, name: String(sheet.name || ""), sheet } : null;
            if (candidate && domainEvent.actorId === activeMemberId) {
              setCharacterRecord(candidate);
              setCharacterForm(characterFormFromRecord(candidate));
            }
          }
          if (domainEvent.type === "adventure.generated") {
            setAdventurePlan(domainEvent.payload?.plan as AdventurePlan);
            setShowAdventure(true);
            setAdventureBusy(false);
          }
          if (domainEvent.type === "job.completed" && domainEvent.payload?.kind === "ai.kp.turn") {
            setIsAiWorking(false);
            pushToast("AI KP 已完成一轮推进");
          }
          if (domainEvent.type === "job.failed") {
            const kind = String(domainEvent.payload?.kind || "");
            const terminal = domainEvent.payload?.status === "failed";
            if (terminal && kind === "ai.kp.turn") setIsAiWorking(false);
            if (terminal && kind === "adventure.generate") setAdventureBusy(false);
            if (kind === "ai.kp.turn" || kind === "adventure.generate") pushToast(terminal ? `任务失败：${String(domainEvent.payload?.error || "请检查设置")}` : "任务暂时失败，正在自动重试");
          }
          const message = eventToMessage(domainEvent);
          if (!message) return;
          setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        });
      } catch {
        if (!cancelled) {
          setApiStatus("offline");
          setToast("API 未启动，当前使用本地演示模式");
          if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
          toastTimerRef.current = window.setTimeout(() => {
            setToast("");
            toastTimerRef.current = null;
          }, 2600);
        }
      }
    };

    void connect();
    return () => {
      cancelled = true;
      source?.close();
      speechRecognitionRef.current?.stop();
    };
  }, []);

  const openRoomDialog = (mode: "create" | "join") => {
    setRoomDialogMode(mode);
    setRoomDialogError("");
    setRoomForm((current) => ({ ...current, code: mode === "join" ? current.code : "", displayName: current.displayName || "访客" }));
    setShowRoomDialog(true);
  };

  const submitRoomDialog = async (event: FormEvent) => {
    event.preventDefault();
    setRoomDialogBusy(true);
    setRoomDialogError("");
    try {
      const isJoin = roomDialogMode === "join";
      const response = await fetch(isJoin ? `${API_BASE}/api/rooms/${encodeURIComponent(roomForm.code.trim())}/join` : `${API_BASE}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isJoin ? { displayName: roomForm.displayName } : { title: roomForm.title, system: roomForm.system, displayName: roomForm.displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "房间操作失败");
      window.sessionStorage.setItem("night-table-session", JSON.stringify({ roomId: data.room.id, roomCode: data.room.code, sessionToken: data.sessionToken, member: data.member }));
      window.location.reload();
    } catch (error) {
      setRoomDialogError(error instanceof Error ? error.message : "房间操作失败");
    } finally {
      setRoomDialogBusy(false);
    }
  };

  const saveAiSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!roomId || !sessionToken) {
      setSettingsError("真实 API 房间连接后才能保存设置");
      return;
    }
    setSettingsBusy(true);
    setSettingsError("");
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${roomId}/ai/settings`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-night-table-session": sessionToken },
        body: JSON.stringify({ ...aiForm, maxOutputTokens: Number(aiForm.maxOutputTokens) || 2048 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 设置保存失败");
      setShowSettings(false);
      pushToast("AI Provider 设置已保存");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "AI 设置保存失败");
    } finally {
      setSettingsBusy(false);
    }
  };

  const saveCharacter = async (event: FormEvent) => {
    event.preventDefault();
    if (!characterForm.name.trim()) {
      setCharacterError("角色名不能为空");
      return;
    }
    setCharacterSaving(true);
    setCharacterError("");
    const statKeys = roomSystem === "dnd-srd-d20" ? ["str", "dex", "con", "int", "wis", "cha"] : ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"];
    const coreStats = Object.fromEntries(statKeys.map((key) => [key, Number(characterForm[key as keyof typeof characterForm]) || 0]));
    const payload = roomSystem === "dnd-srd-d20"
      ? { name: characterForm.name, className: characterForm.occupation, abilities: coreStats, playerName: "", inventory: [], notes: characterForm.notes }
      : { name: characterForm.name, occupation: characterForm.occupation, age: Number(characterForm.age) || 30, attributes: coreStats, notes: characterForm.notes };
    try {
      if (apiStatus !== "online" || !roomId || !sessionToken) {
        setCharacterRecord({ id: characterRecord?.id, system: roomSystem, name: characterForm.name, sheet: { ...payload, name: characterForm.name, occupation: characterForm.occupation, attributes: roomSystem === "coc-percentile" ? coreStats : undefined, abilities: roomSystem === "dnd-srd-d20" ? coreStats : undefined, notes: characterForm.notes } });
        setShowCharacter(false);
        pushToast("角色卡已在本地演示模式更新");
        return;
      }
      const endpoint = characterRecord?.id ? `${API_BASE}/api/rooms/${roomId}/characters/${characterRecord.id}` : `${API_BASE}/api/rooms/${roomId}/characters`;
      const response = await fetch(endpoint, { method: characterRecord?.id ? "PUT" : "POST", headers: { "content-type": "application/json", "x-night-table-session": sessionToken }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "角色卡保存失败");
      const nextRecord = { id: data.id || characterRecord?.id, system: roomSystem, name: data.sheet.name, sheet: data.sheet } as CharacterRecord;
      setCharacterRecord(nextRecord);
      setCharacterForm(characterFormFromRecord(nextRecord));
      setShowCharacter(false);
      pushToast("角色卡已保存");
    } catch (error) {
      setCharacterError(error instanceof Error ? error.message : "角色卡保存失败");
    } finally {
      setCharacterSaving(false);
    }
  };

  const generateSceneImage = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageRoom) {
      setAssetError("只有房主或 KP 可以生成场景图");
      return;
    }
    if (apiStatus !== "online" || !roomId || !sessionToken) {
      setAssetError("图片任务需要连接自托管 API");
      return;
    }
    setAssetBusy(true);
    setAssetError("");
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${roomId}/assets/generate`, { method: "POST", headers: { "content-type": "application/json", "x-night-table-session": sessionToken }, body: JSON.stringify({ prompt: assetForm.prompt }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "图片任务提交失败");
      if (data.asset) setAssets((current) => [...current.filter((asset) => asset.id !== data.asset.id), data.asset]);
      setShowAssetDialog(false);
      pushToast("场景图任务已加入队列");
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : "图片任务提交失败");
    } finally {
      setAssetBusy(false);
    }
  };

  const generateAdventure = async (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (!canManageRoom) {
      pushToast("只有房主或 KP 可以生成剧情");
      return;
    }
    if (apiStatus !== "online" || !roomId || !sessionToken) {
      pushToast("生成剧情需要连接自托管 API");
      return;
    }
    setAdventureBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${roomId}/adventures/generate`, { method: "POST", headers: { "content-type": "application/json", "x-night-table-session": sessionToken }, body: JSON.stringify({ brief: "围绕当前房间的地点和线索生成一段可在 3-6 个场景完成的冒险", playerCount: Math.max(1, roomMembers.length - 1) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "剧情任务提交失败");
      pushToast(`剧情任务已加入队列 · ${String(data.jobId || "").slice(0, 8)}`);
    } catch (error) {
      setAdventureBusy(false);
      pushToast(error instanceof Error ? error.message : "剧情任务提交失败");
    }
  };

  const sendSeatCommand = (type: "claim_seat" | "release_seat", seat?: Seat) => {
    if (apiStatus !== "online" || !roomId || !sessionToken) {
      pushToast("连接 API 后才能管理座位");
      return;
    }
    void fetch(`${API_BASE}/api/rooms/${roomId}/commands`, { method: "POST", headers: { "content-type": "application/json", "x-night-table-session": sessionToken }, body: JSON.stringify({ type, payload: seat ? { seatId: seat.id } : {}, clientCommandId: crypto.randomUUID() }) }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "座位操作失败");
      }
      pushToast(type === "claim_seat" ? `${seat?.label || "PL"} 已入座` : `${seat?.label || "PL"} 已释放`);
    }).catch((error) => pushToast(error instanceof Error ? error.message : "座位操作失败"));
  };

  const changeSeatController = (seat: Seat, controller: "ai" | "empty") => {
    if (apiStatus !== "online" || !roomId || !sessionToken) {
      pushToast("连接 API 后才能切换 AI PL 座位");
      return;
    }
    void fetch(`${API_BASE}/api/rooms/${roomId}/commands`, { method: "POST", headers: { "content-type": "application/json", "x-night-table-session": sessionToken }, body: JSON.stringify({ type: "handoff_seat", payload: { seatId: seat.id, controller }, clientCommandId: crypto.randomUUID() }) }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "座位切换失败");
      }
      pushToast(controller === "ai" ? `${seat.label} 已交给 AI PL` : `${seat.label} 已释放`);
    }).catch((error) => pushToast(error instanceof Error ? error.message : "座位切换失败"));
  };

  const requestAiPl = (seat: Seat) => {
    if (apiStatus !== "online" || !roomId || !sessionToken) return;
    void fetch(`${API_BASE}/api/rooms/${roomId}/ai-pl/${seat.id}/continue`, { method: "POST", headers: { "content-type": "application/json", "x-night-table-session": sessionToken }, body: JSON.stringify({}) }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "AI PL 行动失败");
      }
      pushToast(`${seat.label} 的 AI PL 行动已排队`);
    }).catch((error) => pushToast(error instanceof Error ? error.message : "AI PL 行动失败"));
  };

  const sendMessage = (event?: FormEvent) => {
    event?.preventDefault();
    const text = composer.trim();
    if (!text || roomPaused) return;

    if (apiStatus === "online" && roomId && sessionToken) {
      void fetch(`${API_BASE}/api/rooms/${roomId}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-night-table-session": sessionToken },
        body: JSON.stringify({ type: "post_message", payload: { channel: activeChannel, text }, clientCommandId: crypto.randomUUID() }),
      }).then((response) => {
        if (!response.ok) throw new Error("message failed");
        setComposer((current) => current === text ? "" : current);
      }).catch(() => {
        setApiStatus("offline");
        setComposer((current) => current || text);
        pushToast("实时 API 暂时不可用，消息已保留在输入框");
      });
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: Date.now(),
        kind: "player",
        author: "你",
        role: activeChannel === "ooc" ? "场外发言" : "艾伦·格雷",
        time: "现在",
        text,
        channel: activeChannel,
        avatar: "你",
        accent: "amber",
      },
    ]);
    setComposer("");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  };

  const completeDemoRoll = () => {
    const isD20 = roomSystem === "dnd-srd-d20";
    const result = Math.floor(Math.random() * (isD20 ? 20 : 100)) + 1;
    const success = isD20 ? result >= 10 : result <= 45;
    setLastRoll(result);
    setDiceRolling(false);
    setMessages((current) => [
      ...current,
      {
        id: Date.now(),
        kind: "system",
        author: "夜桌引擎",
        role: success ? "成功 · 侦查" : "失败 · 侦查",
        time: "现在",
        text: `${isD20 ? "D20" : "D100"} = ${result} · ${success ? "你在雨水里找到了一串朝向海关内部的细小脚印。" : "雨水冲掉了大部分痕迹，只剩下一股咸腥的铁锈味。"}`,
        channel: "ic",
        avatar: isD20 ? "d20" : "d100",
      },
    ]);
    pushToast(`${isD20 ? "D20" : "D100"} · ${result} · ${success ? "成功" : "失败"}`);
  };

  const rollD100 = () => {
    if (roomPaused) return;
    setDiceRolling(true);
    if (apiStatus === "online" && roomId && sessionToken) {
      void fetch(`${API_BASE}/api/rooms/${roomId}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-night-table-session": sessionToken },
        body: JSON.stringify({ type: "roll_dice", payload: { expression: diceExpression, reason: roomSystem === "dnd-srd-d20" ? "能力检定" : "侦查" }, clientCommandId: crypto.randomUUID() }),
      }).then((response) => {
        if (!response.ok) throw new Error("roll failed");
      }).catch(() => {
        setApiStatus("offline");
        pushToast("服务器骰点暂时不可用，已切换演示模式");
        completeDemoRoll();
      });
      return;
    }
    window.setTimeout(completeDemoRoll, 520);
  };

  const toggleRoomPaused = () => {
    if (!canManageRoom) {
      pushToast("只有房主或 KP 可以暂停房间");
      return;
    }
    const next = !roomPaused;
    if (apiStatus === "online" && roomId && sessionToken) {
      void fetch(`${API_BASE}/api/rooms/${roomId}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-night-table-session": sessionToken },
        body: JSON.stringify({ type: next ? "pause_room" : "resume_room", payload: {}, clientCommandId: crypto.randomUUID() }),
      }).then((response) => {
        if (!response.ok) throw new Error("pause failed");
      }).catch(() => {
        setApiStatus("offline");
        setRoomPaused(!next);
        pushToast("房间状态同步失败，已恢复原状态");
      });
    }
    setRoomPaused(next);
    pushToast(next ? "房间已暂停" : "房间已恢复");
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      speechRecognitionRef.current?.stop();
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      pushToast("当前浏览器不支持语音转文字，请使用 Chrome 或 Edge");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText.trim()) {
        setComposer((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${finalText.trim()}`);
      }
      setVoiceInterim(interimText);
    };
    recognition.onerror = () => {
      setIsListening(false);
      setVoiceInterim("");
      pushToast("麦克风识别没有成功，请检查浏览器权限");
    };
    recognition.onend = () => {
      setIsListening(false);
      setVoiceInterim("");
      speechRecognitionRef.current = null;
    };
    speechRecognitionRef.current = recognition;
    setIsListening(true);
    pushToast("正在聆听，你可以直接说出行动");
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceInterim("");
      speechRecognitionRef.current = null;
      pushToast("麦克风没有启动，请稍后再试");
    }
  };

  const advanceScene = () => {
    if (!canManageRoom) {
      pushToast("只有房主或 KP 可以让 AI 推进");
      return;
    }
    if (roomPaused || isAiWorking) return;
    setIsAiWorking(true);
    if (apiStatus === "online" && roomId && sessionToken) {
      pushToast("AI KP 正在整理下一幕……");
      void fetch(`${API_BASE}/api/rooms/${roomId}/ai/continue`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-night-table-session": sessionToken },
        body: JSON.stringify({ clientCommandId: crypto.randomUUID() }),
      }).then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "AI 推进失败");
        }
        pushToast("AI 任务已加入队列");
      }).catch((error) => {
        setIsAiWorking(false);
        pushToast(error instanceof Error ? error.message : "AI Provider 尚未配置，使用演示推进");
      });
      return;
    }
    pushToast("AI KP 正在整理下一幕……");
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: Date.now(),
          kind: "kp",
          author: "AI KP · 伊芙琳",
          role: "守秘人",
          time: "现在",
          text: "脚印在门槛处突然中断。就在你们以为它被雨冲散时，门内的喘息声变成了三下轻敲——像有人从里面，用指节敲了一下自己的喉咙。",
          channel: "ic",
          avatar: "E",
          accent: "violet",
        },
      ]);
      setIsAiWorking(false);
      pushToast("场景节拍已推进");
    }, 1100);
  };

  return (
    <main className="night-table-app">
      <a className="skip-link" href="#room-main">跳到房间内容</a>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Icon name="spark" size={17} /></div>
          <div>
            <div className="brand-name">夜桌 <span>/ NIGHT TABLE</span></div>
            <div className="brand-caption">AI 文字跑团工作台</div>
          </div>
        </div>

        <div className="topbar-center" role="status" aria-live="polite">
          <span className="live-dot" />
          <span>{apiStatus === "online" ? "房间已连接" : apiStatus === "offline" ? "演示模式" : "房间运行中"}</span>
          <span className="topbar-divider" />
          <span className="room-id">{roomCode}</span>
        </div>

        <div className="topbar-actions">
          <button className="icon-button" type="button" aria-label="通知" title="通知"><Icon name="bell" size={17} /><i /></button>
          <button className="avatar-button" type="button" aria-label="你的资料">你</button>
        </div>
      </header>

      <div className="app-layout">
        <aside className="left-rail">
          <div className="rail-section">
            <div className="section-label">当前房间</div>
            <button className="room-summary room-summary-button" type="button" onClick={() => openRoomDialog("join")}>
              <div className="room-symbol"><Icon name="spark" size={15} /></div>
              <div>
                <strong>{roomTitle}</strong>
                <span>{roomSystem === "dnd-srd-d20" ? "D&D · d20 核心" : "CoC · 百分骰"} · 第 01 幕</span>
              </div>
              <span className="more-button" aria-hidden="true"><Icon name="more" size={16} /></span>
            </button>
          </div>

          <div className="rail-section seats-section">
            <div className="section-heading">
              <div className="section-label">桌边成员</div>
              <span className="member-count">{roomMembers.length || 3} / 6</span>
            </div>
            <div className="kp-seat">
              <div className="seat-avatar kp-avatar">E</div>
              <div className="seat-copy"><strong>伊芙琳</strong><span>AI KP · 主持中</span></div>
              <span className="ai-pulse">AI</span>
            </div>
            {displayPlayerSeats.map((seat) => (
              <div className="player-seat" key={seat.id || seat.name}>
                <div className={`seat-avatar ${seat.color}`}>{seat.avatar}</div>
                <div className="seat-copy"><strong>{seat.name}</strong><span>{seat.subtitle}</span></div>
                <span className={`seat-status ${seat.color === "violet" ? "is-ai" : ""}`}><i />{seat.status}</span>
                {seat.id && seat.controller === "empty" && <button className="seat-action" type="button" onClick={() => { const sourceSeat = roomSeats.find((candidate) => candidate.id === seat.id); if (sourceSeat) sendSeatCommand("claim_seat", sourceSeat); }}>入座</button>}
                {seat.id && canManageRoom && seat.controller === "empty" && <button className="seat-action ai-action" type="button" onClick={() => { const sourceSeat = roomSeats.find((candidate) => candidate.id === seat.id); if (sourceSeat) changeSeatController(sourceSeat, "ai"); }}>AI</button>}
                {seat.id && seat.controller === "human" && seat.memberId === memberId && <button className="seat-action" type="button" onClick={() => { const sourceSeat = roomSeats.find((candidate) => candidate.id === seat.id); if (sourceSeat) sendSeatCommand("release_seat", sourceSeat); }}>离座</button>}
                {seat.id && canManageRoom && seat.controller === "human" && seat.memberId !== memberId && <button className="seat-action" type="button" onClick={() => { const sourceSeat = roomSeats.find((candidate) => candidate.id === seat.id); if (sourceSeat) changeSeatController(sourceSeat, "empty"); }}>清空</button>}
                {seat.id && canManageRoom && seat.controller === "ai" && <button className="seat-action ai-action" type="button" onClick={() => { const sourceSeat = roomSeats.find((candidate) => candidate.id === seat.id); if (sourceSeat) requestAiPl(sourceSeat); }}>行动</button>}
              </div>
            ))}
            <button className="outline-button invite-button" type="button" onClick={copyInviteCode}>
              <span>＋</span> 邀请玩家
            </button>
          </div>

          <div className="rail-section scene-section">
            <div className="section-heading"><div className="section-label">场景章节</div><button className="tiny-link" type="button">查看全部</button></div>
            <div className="scene-list">
              <div className="scene-list-item active"><span className="scene-index">01</span><div><strong>旧海关</strong><span>进行中 · 23:17</span></div><em>•</em></div>
              <div className="scene-list-item"><span className="scene-index">02</span><div><strong>潮湿的档案室</strong><span>未解锁</span></div><em>—</em></div>
              <div className="scene-list-item"><span className="scene-index">03</span><div><strong>灯塔底层</strong><span>未解锁</span></div><em>—</em></div>
            </div>
          </div>

          <div className="rail-footer">
            <button className="rail-footer-button" type="button" disabled={!canManageRoom} onClick={() => { setSettingsError(""); setShowSettings(true); }}><span><Icon name="settings" size={15} /></span> 房间设置</button>
            <button className="rail-footer-button" type="button" disabled={!canManageRoom} onClick={toggleRoomPaused}><span><Icon name={roomPaused ? "play" : "pause"} size={15} /></span> {roomPaused ? "恢复房间" : "暂停房间"}</button>
          </div>
        </aside>

        <section className="chat-panel" id="room-main">
          <div className="scene-header">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> 第 01 幕 · 潮声之下</div>
              <h1>旧海关</h1>
              <p>雨 · 1927 年 11 月 03 日 · 23:17 · 雾港东堤</p>
            </div>
            <div className="scene-actions">
              <button className="soft-button" type="button" onClick={() => pushToast("摘要任务已加入队列")}><span><Icon name="image" size={14} /></span> 保存摘要</button>
              <button className="soft-button" type="button" disabled={!canManageRoom || adventureBusy || roomPaused} onClick={() => { void generateAdventure(); }}><span><Icon name="spark" size={14} /></span> {adventureBusy ? "生成中" : "生成剧情"}</button>
              <button className="primary-button" type="button" disabled={!canManageRoom || isAiWorking || roomPaused} onClick={advanceScene}>
                <span className={isAiWorking ? "spin" : "sparkle"}><Icon name="spark" size={14} /></span>{isAiWorking ? "AI 推进中" : "让 AI 推进"}
              </button>
            </div>
          </div>

          <div className="channel-tabs" role="tablist" aria-label="聊天频道">
            {(Object.keys(channelLabels) as Channel[]).map((channel) => (
              <button key={channel} type="button" role="tab" aria-selected={activeChannel === channel} className={activeChannel === channel ? "active" : ""} onClick={() => setActiveChannel(channel)}>
                {channelLabels[channel]} {channel === "kp" && <span className="lock-mini"><Icon name="lock" size={11} /></span>}
              </button>
            ))}
            <div className="channel-tools"><span className="unread-pill">{apiStatus === "online" ? "实时同步" : "本地演示"}</span><button type="button" aria-label="更多聊天设置" title="更多聊天设置"><Icon name="more" size={17} /></button></div>
          </div>

          <div className="chat-scroll">
            <div className="date-divider"><span>今晚 · 23:17</span></div>
            {visibleMessages.map((message) => (
              <article className={`message-row ${message.kind}`} key={message.id}>
                <div className={`message-avatar ${message.accent ?? "system-avatar"}`}>{message.avatar}</div>
                <div className="message-main">
                  <div className="message-meta"><strong>{message.author}</strong><span>{message.role}</span><time>{message.time}</time></div>
                  <p>{message.text}</p>
                  {message.role.includes("检定") && <div className="check-chip"><span>◈</span> 服务器已完成检定</div>}
                </div>
              </article>
            ))}
            {visibleMessages.length === 0 && <div className="empty-channel">这个频道还没有新的声音。</div>}
            {isAiWorking && <div className="ai-typing"><span className="typing-orb">✦</span><div><strong>伊芙琳正在整理线索</strong><span><i /> <i /> <i /></span></div></div>}
          </div>

          <form className="composer" onSubmit={sendMessage}>
            <div className="composer-topline"><span className="compose-mode">{activeChannel === "ic" ? "场内行动" : activeChannel === "ooc" ? "场外聊天" : "私语"}</span><span>Ctrl + Enter 发送</span></div>
            <textarea value={`${composer}${voiceInterim}`} onChange={(event) => { setComposer(event.target.value); setVoiceInterim(""); }} onKeyDown={handleComposerKeyDown} placeholder={roomPaused ? "房间已暂停，恢复后继续行动……" : activeChannel === "ic" ? "描述你的行动……" : "说点什么……"} disabled={roomPaused} rows={2} />
            <div className="composer-actions"><div className="composer-tools"><button type="button" aria-label="添加附件" title="添加附件"><Icon name="image" size={16} /></button><button type="button" aria-label="使用角色动作" title="使用角色动作"><Icon name="spark" size={16} /></button><button className={`voice-button ${isListening ? "listening" : ""}`} type="button" aria-label={isListening ? "停止语音转文字" : "开始语音转文字"} aria-pressed={isListening} onClick={toggleVoiceInput} disabled={roomPaused}><span aria-hidden="true"><Icon name="mic" size={16} /></span>{isListening && <i aria-hidden="true" />}</button><span className={`composer-hint ${isListening ? "voice-active-hint" : ""}`}>{isListening ? "正在聆听……再次点击停止" : "AI 会在你确认行动后推进场景"}</span></div><button className="send-button" type="submit" aria-label="发送消息" title="发送消息"><Icon name="send" size={16} /></button></div>
          </form>
        </section>

        <aside className="right-rail">
          <section className="visual-card">
            <div className="visual-card-top"><span className="section-label">当前场景</span><button type="button" aria-label="场景图设置" title="场景图设置" onClick={() => pushToast("场景图生成入口已准备")}><Icon name="more" size={17} /></button></div>
            <div className="scene-visual" role="img" aria-label="雨夜中的雾港旧海关场景预览">{generatedAssetUrl && <img className="generated-scene-image" src={generatedAssetUrl} alt="AI 生成的雨夜旧海关场景" />}<div className="moon" /><div className="harbor-line" /><div className="warehouse"><i /><i /><i /></div><div className="rain rain-one" /><div className="rain rain-two" /><div className="visual-caption"><span>{latestAsset?.status === "completed" ? "AI SCENE" : "GENERATE SCENE"}</span><strong>雨幕下的旧海关</strong></div></div>
            <button className="generate-button" type="button" disabled={!canManageRoom} onClick={() => { setAssetError(""); setShowAssetDialog(true); }}><span><Icon name="image" size={14} /> 生成场景图</span><Icon name="arrow-up-right" size={15} /></button>
          </section>

          <section className="status-card">
            <div className="card-heading"><div><div className="section-label">{characterForm.name}</div><strong>{characterForm.occupation} · {roomSystem === "dnd-srd-d20" ? `Lv.${activeSheet?.level || 1}` : `${characterForm.age} 岁`}</strong></div><button className="tiny-link" type="button" onClick={() => { setCharacterError(""); setShowCharacter(true); }}>角色卡 <Icon name="arrow-up-right" size={12} /></button></div>
            <div className="stat-grid"><div className="stat"><span>HP</span><strong>{activeHp} <em>/ {activeMaxHp}</em></strong><div className="stat-bar"><i className="hp" style={{ width: `${Math.min(100, Math.round((activeHp / Math.max(1, activeMaxHp)) * 100))}%` }} /></div></div><div className="stat"><span>{roomSystem === "dnd-srd-d20" ? "AC" : "SAN"}</span><strong>{roomSystem === "dnd-srd-d20" ? String(activeSheet?.armorClass || 10) : activeSan} {roomSystem === "dnd-srd-d20" ? null : <em>/ {activeMaxSan}</em>}</strong><div className="stat-bar"><i className="san" /></div></div><div className="stat"><span>{roomSystem === "dnd-srd-d20" ? "熟练" : "LUCK"}</span><strong>{roomSystem === "dnd-srd-d20" ? `+${activeSheet?.proficiency || 2}` : activeLuck}</strong><div className="stat-bar"><i className="luck" /></div></div></div>
            <div className="condition-row"><span className="condition-icon">◌</span><span>状态正常</span><span className="condition-dot" /> <span>3 件线索</span></div>
          </section>

          <section className="dice-card">
            <div className="card-heading"><div><div className="section-label">骰子台</div><strong>服务器骰点</strong></div><span className="secure-badge"><Icon name="lock" size={12} /> 已验证</span></div>
            <button className={`dice-display ${lastRoll !== null ? "has-result" : ""} ${diceRolling ? "is-rolling" : ""}`} type="button" onClick={rollD100} aria-label={`掷 ${diceExpression}`}>{diceRolling ? "···" : lastRoll ?? diceExpression.replace("1", "")}<small>{diceRolling ? "服务器正在掷骰" : lastRoll !== null ? (diceSuccess ? "成功" : "失败") : "点击掷骰"}</small></button>
            <div className="dice-actions"><button type="button" onClick={rollD100}>掷 {diceExpression.replace("1", "")}</button><button type="button" onClick={() => pushToast("骰子表达式面板已打开")}>自定义</button></div>
          </section>

          <section className="log-card">
            <div className="card-heading"><div><div className="section-label">最近事件</div><strong>场景日志</strong></div><button className="tiny-link" type="button" onClick={() => pushToast("完整日志已打开")}>全部</button></div>
            <div className="event-log">{eventLog.map((entry) => <div key={entry.id}><span className={`event-mark ${entry.tone}`}>{entry.icon}</span><p>{entry.text}<span>{entry.time}</span></p></div>)}</div>
          </section>
        </aside>
      </div>

      {toast && <div className="toast" role="status" aria-live="polite"><span><Icon name="spark" size={14} /></span>{toast}</div>}

      {showCharacter && <div className="modal-backdrop" role="presentation" onClick={() => setShowCharacter(false)}><section className="character-modal" role="dialog" aria-modal="true" aria-labelledby="character-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow"><span className="eyebrow-line" /> {roomSystem === "dnd-srd-d20" ? "冒险者档案" : "调查员档案"}</div><h2 id="character-title">{characterForm.name}</h2><p>{characterForm.occupation} · {roomSystem === "dnd-srd-d20" ? "D&D SRD d20 核心" : "CoC 百分骰"}</p></div><button className="close-button" type="button" onClick={() => setShowCharacter(false)} aria-label="关闭"><Icon name="close" size={19} /></button></div><form className="character-form" onSubmit={saveCharacter}><div className="character-form-grid"><label>角色名<input value={characterForm.name} onChange={(event) => setCharacterForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} /></label><label>{roomSystem === "dnd-srd-d20" ? "职业" : "职业 / 身份"}<input value={characterForm.occupation} onChange={(event) => setCharacterForm((current) => ({ ...current, occupation: event.target.value }))} maxLength={80} /></label>{roomSystem === "coc-percentile" && <label>年龄<input type="number" min={1} max={120} value={characterForm.age} onChange={(event) => setCharacterForm((current) => ({ ...current, age: event.target.value }))} /></label>}</div><div className="section-label character-stats-label">核心属性 · {roomSystem === "dnd-srd-d20" ? "1-30" : "1-100"}</div><div className="editable-stat-grid">{characterStatKeys.map((key) => <label key={key}>{key.toUpperCase()}<input type="number" min={roomSystem === "dnd-srd-d20" ? 1 : 0} max={roomSystem === "dnd-srd-d20" ? 30 : 100} value={characterForm[key as keyof typeof characterForm]} onChange={(event) => setCharacterForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div><label className="character-note">调查笔记<textarea value={characterForm.notes} onChange={(event) => setCharacterForm((current) => ({ ...current, notes: event.target.value }))} rows={4} maxLength={2000} /></label>{characterError && <p className="form-error" role="alert">{characterError}</p>}<div className="modal-actions"><button className="soft-button" type="button" onClick={() => setShowCharacter(false)}>取消</button><button className="primary-button" type="submit" disabled={characterSaving}>{characterSaving ? "保存中……" : "保存角色卡"} <Icon name="arrow-up-right" size={14} /></button></div></form></section></div>}

      {showAssetDialog && <div className="modal-backdrop" role="presentation" onClick={() => setShowAssetDialog(false)}><section className="utility-modal" role="dialog" aria-modal="true" aria-labelledby="asset-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow"><span className="eyebrow-line" /> 场景资源</div><h2 id="asset-title">生成一张场景图</h2><p>请求会进入本地队列，图片 Provider 由房主在设置中配置。</p></div><button className="close-button" type="button" onClick={() => setShowAssetDialog(false)} aria-label="关闭"><Icon name="close" size={19} /></button></div><form className="utility-form" onSubmit={generateSceneImage}><label>画面描述<textarea className="utility-textarea" value={assetForm.prompt} onChange={(event) => setAssetForm({ prompt: event.target.value })} rows={6} maxLength={3000} /></label>{assetError && <p className="form-error" role="alert">{assetError}</p>}<div className="modal-actions"><button className="soft-button" type="button" onClick={() => setShowAssetDialog(false)}>取消</button><button className="primary-button" type="submit" disabled={assetBusy}>{assetBusy ? "提交中……" : "加入图片队列"}</button></div></form></section></div>}

      {showAdventure && adventurePlan && <div className="modal-backdrop" role="presentation" onClick={() => setShowAdventure(false)}><section className="utility-modal adventure-modal" role="dialog" aria-modal="true" aria-labelledby="adventure-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow"><span className="eyebrow-line" /> AI 剧情草案</div><h2 id="adventure-title">{adventurePlan.title}</h2><p>{adventurePlan.tone || "可在 3-6 个场景完成"}</p></div><button className="close-button" type="button" onClick={() => setShowAdventure(false)} aria-label="关闭"><Icon name="close" size={19} /></button></div><p className="adventure-premise">{adventurePlan.premise}</p><div className="adventure-scenes">{adventurePlan.scenes.map((scene, index) => <article key={`${scene.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{scene.title}</strong><p>{scene.hook || scene.purpose}</p>{scene.choices.length > 0 && <div className="tag-row">{scene.choices.slice(0, 3).map((choice) => <em key={choice}>{choice}</em>)}</div>}</div></article>)}</div><button className="primary-button full-button" type="button" onClick={() => { setShowAdventure(false); pushToast("剧情草案已保留在 KP 私语日志"); }}>收起草案</button></section></div>}

      {showRoomDialog && <div className="modal-backdrop" role="presentation" onClick={() => setShowRoomDialog(false)}><section className="utility-modal" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow"><span className="eyebrow-line" /> 房间入口</div><h2 id="room-dialog-title">进入一张桌子</h2><p>熟人小团使用邀请码加入，房主可以随时切换 AI KP。</p></div><button className="close-button" type="button" onClick={() => setShowRoomDialog(false)} aria-label="关闭"><Icon name="close" size={19} /></button></div><div className="segmented-control"><button className={roomDialogMode === "join" ? "active" : ""} type="button" onClick={() => openRoomDialog("join")}>加入房间</button><button className={roomDialogMode === "create" ? "active" : ""} type="button" onClick={() => openRoomDialog("create")}>创建房间</button></div><form className="utility-form" onSubmit={submitRoomDialog}>{roomDialogMode === "join" ? <label>邀请码<input value={roomForm.code} onChange={(event) => setRoomForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="NIGHT-XXXXXX" autoComplete="off" required /></label> : <><label>房间名称<input value={roomForm.title} onChange={(event) => setRoomForm((current) => ({ ...current, title: event.target.value }))} placeholder="例如：雾港的第三声钟鸣" required /></label><label>规则包<select value={roomForm.system} onChange={(event) => setRoomForm((current) => ({ ...current, system: event.target.value as RoomSystem }))}><option value="coc-percentile">CoC 百分骰核心</option><option value="dnd-srd-d20">D&D SRD d20 核心</option></select></label></>}<label>你的昵称<input value={roomForm.displayName} onChange={(event) => setRoomForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="桌边显示的名字" maxLength={30} required /></label>{roomDialogError && <p className="form-error" role="alert">{roomDialogError}</p>}<button className="primary-button full-button" type="submit" disabled={roomDialogBusy}>{roomDialogBusy ? "正在连接……" : roomDialogMode === "join" ? "加入这张桌子" : "创建并开始"}</button></form></section></div>}

      {showSettings && <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}><section className="utility-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow"><span className="eyebrow-line" /> 房主设置</div><h2 id="settings-title">AI Provider</h2><p>API Key 只会发送到自托管 API，并以加密形式保存。</p></div><button className="close-button" type="button" onClick={() => setShowSettings(false)} aria-label="关闭"><Icon name="close" size={19} /></button></div><form className="utility-form" onSubmit={saveAiSettings}><label>兼容接口 Base URL<input value={aiForm.baseUrl} onChange={(event) => setAiForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.deepseek.com" /></label><label>文字模型名称<input value={aiForm.model} onChange={(event) => setAiForm((current) => ({ ...current, model: event.target.value }))} placeholder="deepseek-v4-flash" /></label><label>图片 Provider Base URL<input value={aiForm.imageBaseUrl} onChange={(event) => setAiForm((current) => ({ ...current, imageBaseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" /></label><label>图片模型名称<input value={aiForm.imageModel} onChange={(event) => setAiForm((current) => ({ ...current, imageModel: event.target.value }))} placeholder="dall-e-3" /></label><label>API Key<input type="password" value={aiForm.apiKey} onChange={(event) => setAiForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="不会回显已保存的 Key" autoComplete="new-password" /></label><label>单次最大输出 Token<input type="number" min={256} max={16000} value={aiForm.maxOutputTokens} onChange={(event) => setAiForm((current) => ({ ...current, maxOutputTokens: event.target.value }))} /></label><label className="checkbox-label"><input type="checkbox" checked={aiForm.thinking} onChange={(event) => setAiForm((current) => ({ ...current, thinking: event.target.checked }))} />允许思考模式（实时主持建议关闭）</label>{settingsError && <p className="form-error" role="alert">{settingsError}</p>}<button className="primary-button full-button" type="submit" disabled={settingsBusy}>{settingsBusy ? "保存中……" : "保存 Provider 设置"}</button></form></section></div>}
    </main>
  );
}
