import * as config from "./config.js";
import { createBackend } from "./data.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const KINDS = {
  fix: {
    title: "To Fix",
    prompt: "Add something to fix…",
    emptyTitle: "Nothing to fix",
    emptyText: "Dump anything that needs fixing in the box above: a dripping tap, a squeaky door, a dead bulb.",
  },
  routine: {
    title: "Routines",
    prompt: "Add a recurring chore…",
    emptyTitle: "No routines yet",
    emptyText: "Add things that come back, like watering plants or changing a filter. Ticking one off schedules the next.",
  },
  shopping: {
    title: "Shopping",
    prompt: "Add to the shopping list…",
    emptyTitle: "Shopping list is empty",
    emptyText: "Add what you need. Tick things off as they go in the basket.",
  },
};

const REPEATS = {
  none: ["Never", ""],
  daily: ["Every day", "Daily"],
  weekly: ["Every week", "Weekly"],
  biweekly: ["Every 2 weeks", "2 wks"],
  monthly: ["Every month", "Monthly"],
  quarterly: ["Every 3 months", "3 mo"],
  semiannual: ["Every 6 months", "6 mo"],
  yearly: ["Every year", "Yearly"],
};

const QUICK_PINGS = [
  "Heading to the shop – anything to add to the list?",
  "Can you check the list when you get a sec?",
  "On my way home 🏠",
  "Dinner's ready! 🍽️",
  "Can you give me a call?",
];

const ICON_PATHS = {
  fix: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  routine: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M19 3v4h-4M5 21v-4h4"/>',
  shopping: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 11v10h14V11M10 21v-5h4v5"/>',
};

const DEFAULT_CATEGORIES = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Garden", "Garage", "Car"];

const icon = (name, cls = "icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  backend: null,
  user: null,
  household: null,
  members: [],
  items: [],
  tab: ["fix", "routine", "shopping", "home"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "fix",
  mineOnly: false,
  showDone: {},
  category: {},      // chosen category filter per list (fix, routine)
  storeFilter: null, // chosen store on the Shopping tab
  live: "connecting",
  push: "unknown",
};

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* private mode etc. */ }
  },
};

const settings = {
  get notifyOnAdd() { return store.get("hearth-notify-on-add", true); },
  set notifyOnAdd(v) { store.set("hearth-notify-on-add", v); },
};

const me = () => state.user?.id;
const app = document.getElementById("app");
const sheet = document.getElementById("sheet");

// ─── Tiny DOM helper (text is always set via textContent, never parsed as HTML) ──

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  const later = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v; // only ever used with the constant icons above
    else if (["value", "checked", "disabled", "selected"].includes(k)) later[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  Object.assign(el, later);
  return el;
}

function toast(message, ms = 3000) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), ms);
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const longFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function friendlyDue(iso) {
  const d = new Date(iso);
  const diff = dayDiff(d);
  if (diff === 0) return `Today ${timeFmt.format(d)}`;
  if (diff === 1) return `Tomorrow ${timeFmt.format(d)}`;
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return `${weekdayFmt.format(d)} ${timeFmt.format(d)}`;
  return shortDateFmt.format(d);
}

function tomorrowAt(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function addRepeat(date, repeat) {
  const d = new Date(date);
  switch (repeat) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "semiannual": d.setMonth(d.getMonth() + 6); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    default: return null;
  }
  return d;
}

/** Next due date counted from today, keeping the original time of day. */
function nextDue(item) {
  const base = item.due_at ? new Date(item.due_at) : tomorrowAt(9);
  const today = new Date();
  today.setHours(base.getHours(), base.getMinutes(), 0, 0);
  return addRepeat(today, item.repeat);
}

const toLocalInput = (iso) => {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ─── Item helpers ───────────────────────────────────────────────────────────

const isOverdue = (item) => !item.done && item.due_at && new Date(item.due_at) < new Date();
const memberName = (id) => {
  if (!id) return null;
  if (id === me()) return "Me";
  return state.members.find((m) => m.user_id === id)?.name ?? "Someone";
};
const partner = () => state.members.find((m) => m.user_id !== me());
const partnerName = () => partner()?.name ?? "your partner";

const norm = (s) => (s ?? "").trim().toLocaleLowerCase();
const clean = (s) => (s ?? "").trim().replace(/\s+/g, " ");

/** Distinct values of a text field (e.g. category, store), keeping the first spelling seen. */
function distinct(field, items = state.items) {
  const seen = new Map();
  for (const i of items) {
    const v = clean(i[field]);
    if (v && !seen.has(norm(v))) seen.set(norm(v), v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Everything that needs buying: shopping items, plus tasks with a "Buy at" store
 *  (routines only once they're due within the next 3 days). */
function onShoppingList(i) {
  if (i.kind === "shopping") return true;
  if (!clean(i.store) || i.done) return false;
  if (i.kind === "routine") return !!i.due_at && new Date(i.due_at) <= Date.now() + 3 * 86400000;
  return true;
}

function openCount(tab) {
  if (tab === "shopping") return state.items.filter((i) => !i.done && onShoppingList(i)).length;
  return state.items.filter((i) => i.kind === tab && !i.done && (tab !== "routine" || isOverdue(i))).length;
}

function visibleItems(tab) {
  const mine = (i) => !state.mineOnly || !i.assignee || i.assignee === me();
  return state.items.filter((i) => (tab === "shopping" ? onShoppingList(i) : i.kind === tab) && mine(i));
}

/** The active filter for this tab, if it still matches something. */
function activeFilter(tab, items) {
  if (tab === "shopping") {
    const options = distinct("store", items);
    if (state.storeFilter && !options.some((o) => norm(o) === norm(state.storeFilter))) state.storeFilter = null;
    return { field: "store", options, value: state.storeFilter };
  }
  const options = distinct("category", items);
  if (state.category[tab] && !options.some((o) => norm(o) === norm(state.category[tab]))) state.category[tab] = null;
  return { field: "category", options, value: state.category[tab] ?? null };
}

function setFilter(tab, value) {
  if (tab === "shopping") state.storeFilter = value;
  else state.category[tab] = value;
  render();
}

function byDueThenNewest(a, b) {
  if (a.due_at && b.due_at) return new Date(a.due_at) - new Date(b.due_at);
  if (a.due_at) return -1;
  if (b.due_at) return 1;
  return new Date(b.created_at) - new Date(a.created_at);
}

function groupItems(kind, open) {
  const groups = [];
  const add = (title, items) => items.length && groups.push({ title, items: items.sort(byDueThenNewest) });
  if (kind === "fix") {
    add("Urgent", open.filter((i) => i.urgent));
    add("To do", open.filter((i) => !i.urgent));
  } else if (kind === "routine") {
    const weekAhead = Date.now() + 7 * 86400000;
    add("Overdue", open.filter(isOverdue));
    add("This week", open.filter((i) => i.due_at && !isOverdue(i) && new Date(i.due_at) <= weekAhead));
    add("Later", open.filter((i) => !i.due_at || new Date(i.due_at) > weekAhead));
  } else if (state.storeFilter) {
    add("To buy", open);
  } else {
    add("Anywhere", open.filter((i) => !clean(i.store)));
    for (const storeName of distinct("store", open)) {
      groups.push({ title: storeName, store: true, items: open.filter((i) => norm(i.store) === norm(storeName)).sort(byDueThenNewest) });
    }
  }
  return groups;
}

// ─── Changing things ────────────────────────────────────────────────────────

function upsertLocal(row) {
  const i = state.items.findIndex((x) => x.id === row.id);
  if (i >= 0) state.items[i] = { ...state.items[i], ...row };
  else state.items.push(row);
}

async function saveItem(item) {
  upsertLocal(item);
  render();
  try {
    await state.backend.saveItem(item);
  } catch (e) {
    toast(`Couldn't save: ${e.message}`);
    refreshAll();
  }
}

async function deleteItems(ids) {
  state.items = state.items.filter((i) => !ids.includes(i.id));
  render();
  try {
    await state.backend.deleteItems(ids);
  } catch (e) {
    toast(`Couldn't delete: ${e.message}`);
    refreshAll();
  }
}

function addItem(title, kind) {
  const item = {
    id: crypto.randomUUID(),
    household_id: state.household.id,
    kind,
    title,
    notes: "",
    done: false,
    urgent: false,
    due_at: null,
    repeat: "none",
    assignee: null,
    created_by: me(),
    created_at: new Date().toISOString(),
    completed_at: null,
    last_done_by: null,
    category: kind === "shopping" ? null : state.category[kind] ?? null,
    store: kind === "shopping" ? state.storeFilter : null,
  };
  if (kind === "routine") {
    item.repeat = "weekly";
    item.due_at = tomorrowAt(9).toISOString();
  }
  saveItem(item);
  queueAddedPing(title);
}

function toggle(item) {
  const now = new Date().toISOString();
  if (item.repeat !== "none" && !item.done) {
    saveItem({ ...item, completed_at: now, last_done_by: me(), due_at: nextDue(item).toISOString() });
    toast(`Done! Next: ${friendlyDue(nextDue(item).toISOString())}`);
  } else {
    const done = !item.done;
    saveItem({ ...item, done, completed_at: done ? now : null, last_done_by: done ? me() : null });
    if (done && state.tab === "shopping" && item.kind !== "shopping") toast(`Bought, and marked done on ${KINDS[item.kind].title}`);
  }
}

// ─── Pings ──────────────────────────────────────────────────────────────────

async function sendPing(message, itemId = null) {
  const text = message.trim();
  if (!text) return;
  const result = await state.backend.sendPing(state.household.id, text, itemId);
  if (result?.demo) toast("Demo mode: pings go out once Supabase is connected");
  else if (!partner()) toast("Sent, but nobody else has joined yet");
  else if (result?.phones === 0) toast(`Sent, but ${partnerName()} hasn't turned on notifications yet`);
  else toast("Ping sent");
}

/** Batches quick-fire additions into one ping, sent once you stop adding for a bit. */
const addedBuffer = [];
let addedTimer;
function queueAddedPing(title) {
  if (!settings.notifyOnAdd || !partner()) return;
  addedBuffer.push(title);
  clearTimeout(addedTimer);
  addedTimer = setTimeout(() => {
    const titles = addedBuffer.splice(0);
    if (!titles.length) return;
    const message = titles.length === 1
      ? `Added “${titles[0]}”`
      : `Added ${titles.length} things: ${titles.slice(0, 4).join(", ")}${titles.length > 4 ? "…" : ""}`;
    state.backend.sendPing(state.household.id, message).catch(() => {});
  }, 20000);
}

// ─── Push notifications ─────────────────────────────────────────────────────

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function pushSupport() {
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

function base64UrlToBytes(b64) {
  const padded = (b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function refreshPushState() {
  const support = pushSupport();
  if (support !== "ok") return setPush(support);
  if (Notification.permission === "denied") return setPush("denied");
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub && Notification.permission === "granted") {
      setPush("on");
      await state.backend.savePushSubscription(state.household.id, sub); // keep it pointed at this household
    } else {
      setPush("off");
    }
  } catch {
    setPush("off");
  }
}

function setPush(value) {
  if (state.push !== value) {
    state.push = value;
    render();
  }
}

async function enablePush() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setPush(permission === "denied" ? "denied" : "off");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(config.VAPID_PUBLIC_KEY),
    });
    await state.backend.savePushSubscription(state.household.id, sub);
    setPush("on");
    toast("Notifications are on");
  } catch (e) {
    toast(`Couldn't turn on notifications: ${e.message}`, 5000);
  }
}

async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await state.backend.removePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  setPush("off");
}

function updateAppBadge() {
  const count = state.items.filter((i) => !i.done && (isOverdue(i) || i.urgent) && (!i.assignee || i.assignee === me())).length;
  try {
    if (count) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch { /* not supported */ }
}

// ─── Loading & live updates ─────────────────────────────────────────────────

const cacheKey = () => `hearth-cache-${me()}`;

function saveCache() {
  if (!state.household) return;
  store.set(cacheKey(), { household: state.household, members: state.members, items: state.items });
}

function loadCache() {
  const cached = store.get(cacheKey(), null);
  if (!cached) return false;
  Object.assign(state, cached);
  return true;
}

async function afterAuth() {
  stopLive();
  if (!state.user) {
    state.household = null;
    state.members = [];
    state.items = [];
    renderAuth();
    return;
  }
  const hadCache = loadCache();
  if (hadCache) render();
  else renderLoading();

  try {
    const loaded = await state.backend.loadHousehold(me());
    if (!loaded) {
      state.household = null;
      renderOnboarding();
      return;
    }
    state.household = loaded.household;
    state.members = loaded.members;
    state.items = await state.backend.listItems(state.household.id);
    render();
    startLive();
    refreshPushState();
  } catch (e) {
    if (state.household) {
      toast("Offline: showing your last saved lists", 4000);
      render();
    } else {
      renderMessage("Couldn't connect", e.message, "Try again", () => afterAuth());
    }
  }
}

async function refreshAll() {
  if (!state.household) return;
  try {
    const loaded = await state.backend.loadHousehold(me());
    if (!loaded) return afterAuth();
    state.household = loaded.household;
    state.members = loaded.members;
    state.items = await state.backend.listItems(state.household.id);
    render();
    if (state.live !== "SUBSCRIBED" && state.live !== "DEMO") startLive();
  } catch {
    /* offline; try again on next focus */
  }
}

function startLive() {
  const householdId = state.household.id;
  state.backend.subscribe(householdId, {
    onItem: (row) => {
      if (row.household_id !== householdId) return;
      upsertLocal(row);
      renderSoon();
    },
    onItemDeleted: (id) => {
      state.items = state.items.filter((i) => i.id !== id);
      renderSoon();
    },
    onMembers: async () => {
      const loaded = await state.backend.loadHousehold(me()).catch(() => null);
      if (loaded) {
        state.members = loaded.members;
        state.household = loaded.household;
        renderSoon();
      }
    },
    onPing: (ping) => {
      if (ping.sender !== me()) toast(`${memberName(ping.sender)}: ${ping.message}`, 6000);
    },
    onStatus: (status) => {
      state.live = status;
      renderSoon();
    },
  });
}

function stopLive() {
  state.backend?.unsubscribe();
  state.live = "connecting";
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAll();
});
window.addEventListener("online", () => refreshAll());

// ─── Rendering: shell ───────────────────────────────────────────────────────

let shell = null;
let renderQueued = false;

function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function buildShell() {
  const quickInput = h("input", {
    id: "quick-input",
    type: "text",
    autocomplete: "off",
    enterkeyhint: "enter",
    "aria-label": "Add an item",
  });
  const quickForm = h("form", {
    class: "quick-add",
    onsubmit: (e) => {
      e.preventDefault();
      const title = quickInput.value.trim();
      if (!title) return;
      addItem(title, state.tab);
      quickInput.value = "";
      quickInput.focus(); // keep the keyboard up so you can keep dumping things in
    },
  }, h("span", { class: "quick-plus", html: icon("plus") }), quickInput);

  const tabs = ["fix", "routine", "shopping", "home"].map((tab) =>
    h("button", {
      class: "tab",
      "data-tab": tab,
      onclick: () => switchTab(tab),
    },
    h("span", { class: "tab-icon", html: icon(tab) }),
    h("span", { class: "tab-label" }, tab === "home" ? "Home" : KINDS[tab].title),
    h("span", { class: "tab-badge" })),
  );

  const filterBtn = h("button", {
    class: "pill",
    onclick: () => {
      state.mineOnly = !state.mineOnly;
      render();
    },
  });

  const pingBtn = h("button", { class: "icon-btn", "aria-label": "Send a ping", onclick: () => openPingSheet(), html: icon("bell") });
  const title = h("h1");
  const demo = h("span", { class: "demo-pill" }, "Demo");
  const content = h("main", { class: "content" });

  const root = h("div", { class: "shell" },
    h("header", { class: "top" },
      h("div", { class: "top-row" }, filterBtn, h("div", { class: "spacer" }), demo, pingBtn),
      title,
      quickForm),
    content,
    h("nav", { class: "tabbar" }, tabs));

  return { root, quickInput, quickForm, tabs, filterBtn, title, demo, content };
}

function switchTab(tab) {
  if (tab === state.tab) {
    shell.content.scrollTo?.({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  state.tab = tab;
  history.replaceState(null, "", `#${tab}`);
  shell.quickInput.value = "";
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  if (!state.user || !state.household) return;
  if (!shell || !app.contains(shell.root)) {
    shell = buildShell();
    app.replaceChildren(shell.root);
  }
  const isHome = state.tab === "home";
  shell.title.textContent = isHome ? state.household.name : KINDS[state.tab].title;
  shell.quickForm.hidden = isHome;
  shell.filterBtn.hidden = isHome;
  shell.filterBtn.textContent = state.mineOnly ? "Mine" : "Everyone's";
  shell.demo.hidden = !state.backend.demo;

  for (const btn of shell.tabs) {
    const tab = btn.dataset.tab;
    btn.classList.toggle("active", tab === state.tab);
    const badge = btn.querySelector(".tab-badge");
    const count = tab === "home" ? 0 : openCount(tab);
    badge.textContent = count ? String(count) : "";
    badge.hidden = !count;
  }

  // Don't rebuild the Home tab while you're typing in it.
  const typingInContent = shell.content.contains(document.activeElement) && document.activeElement.matches("input, textarea, select");
  if (!(isHome && typingInContent)) {
    shell.content.replaceChildren(isHome ? renderHome() : renderList(state.tab));
  }
  if (!isHome) shell.quickInput.placeholder = placeholderFor(state.tab);

  saveCache();
  updateAppBadge();
}

// ─── Rendering: lists ───────────────────────────────────────────────────────

function placeholderFor(tab) {
  const value = tab === "shopping" ? state.storeFilter : state.category[tab];
  if (!value) return KINDS[tab].prompt;
  return tab === "shopping" ? `Add to the ${value} list…` : `Add to ${value}…`;
}

function filterBar(tab, filter) {
  if (!filter.options.length) return null;
  const chip = (label, value) => h("button", {
    class: `fchip${norm(value) === norm(filter.value) ? " on" : ""}`,
    "aria-pressed": norm(value) === norm(filter.value) ? "true" : "false",
    onclick: () => setFilter(tab, value),
  }, value && tab === "shopping" ? h("span", { html: icon("store", "icon tiny") }) : null, label);
  return h("div", { class: "filter-bar", role: "group", "aria-label": tab === "shopping" ? "Stores" : "Categories" },
    chip(tab === "shopping" ? "All stores" : "All", null),
    filter.options.map((o) => chip(o, o)));
}

function renderList(kind) {
  const items = visibleItems(kind);
  const filter = activeFilter(kind, items);
  const matches = (i) => !filter.value || norm(i[filter.field]) === norm(filter.value);
  const open = items.filter((i) => !i.done && matches(i));
  const done = items.filter((i) => i.done && matches(i))
    .sort((a, b) => new Date(b.completed_at ?? 0) - new Date(a.completed_at ?? 0));
  const groups = groupItems(kind, open);

  const frag = h("div", { class: "list" }, filterBar(kind, filter));

  if (!groups.length && !done.length) {
    const title = filter.value
      ? `Nothing left for ${filter.value}`
      : state.mineOnly && items.length === 0 && state.items.some((i) => i.kind === kind) ? "Nothing for you here" : KINDS[kind].emptyTitle;
    frag.append(h("div", { class: "empty" },
      h("div", { class: "empty-icon", html: icon(kind, "icon big") }),
      h("h2", {}, title),
      filter.value ? null : h("p", {}, KINDS[kind].emptyText)));
    return frag;
  }

  for (const group of groups) {
    frag.append(h("section", { class: "group" },
      h("h3", { class: group.title === "Urgent" || group.title === "Overdue" ? "danger" : "" },
        group.store ? h("span", { class: "h3-icon", html: icon("store", "icon tiny") }) : null,
        group.title),
      h("ul", { class: "card" }, group.items.map((i) => itemRow(i)))));
  }

  if (done.length) {
    const details = h("details", {
      class: "group done-group",
      open: state.showDone[kind] ? true : null,
      ontoggle: (e) => { state.showDone[kind] = e.currentTarget.open; },
    },
    h("summary", {}, `${kind === "shopping" ? "In the basket" : "Done"} (${done.length})`),
    h("ul", { class: "card" }, done.map((i) => itemRow(i))),
    h("button", {
      class: "text-btn danger",
      onclick: () => deleteItems(done.map((i) => i.id)),
    }, `Clear ${done.length} done`));
    frag.append(details);
  }
  return frag;
}

function itemRow(item) {
  const recurring = item.repeat !== "none";
  const checkClass = item.done ? "check done" : recurring ? "check recurring" : "check";
  const checkIcon = item.done ? icon("check") : recurring ? icon("routine") : "";

  return h("li", { class: `row${item.done ? " is-done" : ""}` },
    h("button", {
      class: checkClass,
      "aria-label": recurring && !item.done ? "Mark done for now" : item.done ? "Mark not done" : "Mark done",
      onclick: () => toggle(item),
      html: checkIcon,
    }),
    h("button", { class: "row-body", onclick: () => openEditor(item) },
      h("span", { class: "row-title" }, item.title),
      metaLine(item)),
  );
}

function metaLine(item) {
  const chips = [];
  const chip = (iconName, text, cls = "") => h("span", { class: `chip ${cls}` }, h("span", { html: icon(iconName, "icon tiny") }), text);
  if (item.urgent && !item.done) chips.push(chip("alert", "Urgent", "danger"));
  if (item.due_at && !item.done) chips.push(chip("calendar", friendlyDue(item.due_at), isOverdue(item) ? "danger" : ""));
  if (item.repeat !== "none") chips.push(chip("repeat", REPEATS[item.repeat][1]));
  if (item.assignee) chips.push(chip("person", memberName(item.assignee), item.assignee === me() ? "accent" : ""));
  if (state.tab === "shopping") {
    if (item.kind !== "shopping") chips.push(chip(item.kind, KINDS[item.kind].title));
  } else {
    if (item.category && !state.category[state.tab]) chips.push(chip("tag", item.category));
    if (item.store) chips.push(chip("store", item.store));
  }
  if (item.notes) chips.push(chip("note", "Note"));
  return chips.length ? h("span", { class: "meta" }, chips) : null;
}

// ─── Rendering: home tab ────────────────────────────────────────────────────

function renderHome() {
  const meMember = state.members.find((m) => m.user_id === me());
  const alone = !partner();
  const inviteText = `Join our home on Hearth! Open ${location.origin}${location.pathname} on your iPhone, tap Share → Add to Home Screen, open it from there, create an account and enter the code ${state.household.join_code}`;

  const nameInput = h("input", {
    type: "text",
    value: meMember?.name ?? "",
    maxlength: "40",
    autocomplete: "given-name",
    onchange: async (e) => {
      const name = e.target.value.trim();
      if (!name || name === meMember?.name) return;
      try {
        await state.backend.renameMe(me(), name);
        state.members = state.members.map((m) => (m.user_id === me() ? { ...m, name } : m));
        toast("Name updated");
      } catch (err) {
        toast(err.message);
      }
    },
  });

  return h("div", { class: "list" },
    h("section", { class: "group" },
      h("h3", {}, "Household"),
      h("ul", { class: "card" },
        state.members.map((m) => h("li", { class: "row static" },
          h("span", { class: "avatar" }, (m.name || "?").slice(0, 1).toUpperCase()),
          h("span", { class: "row-title" }, m.user_id === me() ? `${m.name} (me)` : m.name))),
        alone && h("li", { class: "row static muted" }, "Waiting for your partner to join…")),
      h("div", { class: "invite card padded" },
        h("div", { class: "invite-label" }, "Invite code"),
        h("div", { class: "invite-code" }, state.household.join_code),
        h("p", { class: "footnote" }, "Your partner opens this website, adds it to their Home Screen, creates an account and enters this code."),
        h("button", {
          class: "btn",
          onclick: async () => {
            try {
              if (navigator.share) await navigator.share({ title: "Join our home on Hearth", text: inviteText });
              else {
                await navigator.clipboard.writeText(inviteText);
                toast("Invite copied, paste it in Messages");
              }
            } catch { /* share sheet dismissed */ }
          },
        }, h("span", { html: icon("share") }), "Send invite"))),

    h("section", { class: "group" },
      h("h3", {}, "Pings & notifications"),
      h("ul", { class: "card" },
        h("li", { class: "row static" },
          h("button", { class: "row-body", onclick: () => openPingSheet() },
            h("span", { class: "row-title accent-text" }, `Ping ${partnerName()}`),
            h("span", { class: "meta" }, "Send a quick notification")),
          h("span", { class: "chev", html: icon("chevron") })),
        pushRow(),
        h("li", { class: "row static" },
          h("label", { class: "toggle-row" },
            h("span", {}, `Ping ${partnerName()} when I add things`),
            h("input", {
              type: "checkbox",
              class: "switch",
              checked: settings.notifyOnAdd,
              onchange: (e) => { settings.notifyOnAdd = e.target.checked; },
            })))),
      h("p", { class: "footnote" }, "Assigning something to your partner pings them. Items with a due date send a reminder when they're due.")),

    h("section", { class: "group" },
      h("h3", {}, "You"),
      h("ul", { class: "card" },
        h("li", { class: "row static" }, h("label", { class: "field" }, h("span", {}, "Name"), nameInput)),
        h("li", { class: "row static muted" }, state.user.email ?? ""),
        h("li", { class: "row static" },
          h("button", { class: "text-btn danger", onclick: () => state.backend.signOut() }, "Sign out")))),

    h("p", { class: "footnote center" }, statusText()));
}

function pushRow() {
  const row = (text, action) => h("li", { class: "row static" },
    h("span", { class: "row-title" }, text), action ?? null);
  if (state.backend.demo) return row("Notifications start working once Supabase is connected");
  switch (state.push) {
    case "on":
      return row("Notifications are on ✓", h("button", { class: "text-btn", onclick: disablePush }, "Turn off"));
    case "denied":
      return row("Notifications are blocked. Turn them on in Settings → Notifications → Hearth.");
    case "needs-install":
      return row("To get notifications, add Hearth to your Home Screen: tap Share, then Add to Home Screen, and open it from there.");
    case "unsupported":
      return row("This browser can't receive notifications.");
    default:
      return row("Get pings and reminders on this phone", h("button", { class: "btn small", onclick: enablePush }, "Turn on"));
  }
}

function statusText() {
  if (state.backend.demo) return "Demo mode: everything is saved on this device only.";
  switch (state.live) {
    case "SUBSCRIBED": return "Live: changes appear instantly on both phones.";
    case "CHANNEL_ERROR":
    case "TIMED_OUT":
    case "CLOSED": return "Offline: changes will appear when you reconnect.";
    default: return "Connecting…";
  }
}

// ─── Sheets ─────────────────────────────────────────────────────────────────

function openSheet(title, body, { onSave, saveLabel = "Save" } = {}) {
  sheet.replaceChildren(
    h("div", { class: "sheet-head" },
      h("button", { class: "text-btn", onclick: closeSheet }, "Cancel"),
      h("h2", {}, title),
      onSave ? h("button", { class: "text-btn bold", onclick: onSave }, saveLabel) : h("span", { class: "head-spacer" })),
    h("div", { class: "sheet-body" }, body));
  if (!sheet.open) sheet.showModal();
}

function closeSheet() {
  sheet.close();
}

sheet.addEventListener("click", (e) => {
  if (e.target === sheet) closeSheet();
});

/** A text field with tappable suggestions underneath (things you've used before). */
function suggestField(label, value, suggestions, placeholder, maxlength) {
  const input = h("input", {
    type: "text",
    value: value ?? "",
    placeholder,
    maxlength: String(maxlength),
    autocomplete: "off",
    autocapitalize: "words",
    enterkeyhint: "done",
  });
  const chips = h("div", { class: "suggest" });
  const draw = () => {
    const typed = norm(input.value);
    const picked = suggestions.some((s) => norm(s) === typed); // already a known value: offer the others to switch
    const matches = suggestions.filter((s) => norm(s) !== typed && (!typed || picked || norm(s).includes(typed))).slice(0, 8);
    chips.replaceChildren(...matches.map((s) => h("button", {
      type: "button",
      class: "fchip small",
      onclick: () => { input.value = s; draw(); },
    }, s)));
    if (input.value) {
      chips.append(h("button", { type: "button", class: "fchip small clear", onclick: () => { input.value = ""; draw(); } }, "Clear"));
    }
    chips.hidden = !chips.childElementCount;
  };
  input.addEventListener("input", draw);
  draw();
  const row = h("li", { class: "row static stacked" }, h("label", { class: "field" }, h("span", {}, label), input), chips);
  return { input, row };
}

function openEditor(original) {
  const titleEl = h("textarea", { rows: "2", maxlength: "300", value: original.title, class: "title-input" });
  const notesEl = h("textarea", { rows: "3", maxlength: "4000", value: original.notes ?? "", placeholder: "Notes (size, brand, where it is…)" });
  const kindEl = h("select", { value: original.kind },
    Object.entries(KINDS).map(([k, v]) => h("option", { value: k }, v.title)));
  const whoEl = h("select", { value: original.assignee ?? "" },
    h("option", { value: "" }, "Anyone"),
    state.members.map((m) => h("option", { value: m.user_id }, m.user_id === me() ? `${m.name} (me)` : m.name)));
  const urgentEl = h("input", { type: "checkbox", class: "switch", checked: !!original.urgent });
  const hasDueEl = h("input", { type: "checkbox", class: "switch", checked: !!original.due_at });
  const dueEl = h("input", { type: "datetime-local", value: toLocalInput(original.due_at ?? tomorrowAt(9).toISOString()) });
  const repeatEl = h("select", { value: original.repeat },
    Object.entries(REPEATS).map(([k, [label]]) => h("option", { value: k }, label)));
  const categoryField = suggestField("Category", original.category, distinct("category", [
    ...state.items, ...DEFAULT_CATEGORIES.map((category) => ({ category })),
  ]), "None", 40);
  const storeField = suggestField("Buy at", original.store, distinct("store"), "Store (optional)", 60);

  const urgentRow = h("li", { class: "row static" }, h("label", { class: "toggle-row" }, h("span", {}, "Urgent"), urgentEl));
  const dueRow = h("li", { class: "row static" }, h("label", { class: "field" }, h("span", {}, "When"), dueEl));
  const sync = () => {
    urgentRow.hidden = kindEl.value !== "fix";
    dueRow.hidden = !hasDueEl.checked;
  };
  kindEl.addEventListener("change", sync);
  hasDueEl.addEventListener("change", sync);
  sync();

  const save = () => {
    const title = titleEl.value.trim();
    if (!title) return toast("Give it a title");
    const updated = {
      ...original,
      title,
      notes: notesEl.value.trim(),
      kind: kindEl.value,
      assignee: whoEl.value || null,
      urgent: kindEl.value === "fix" && urgentEl.checked,
      due_at: hasDueEl.checked && dueEl.value ? new Date(dueEl.value).toISOString() : null,
      repeat: repeatEl.value,
      category: clean(categoryField.input.value) || null,
      store: clean(storeField.input.value) || null,
    };
    closeSheet();
    saveItem(updated);
    if (updated.assignee && updated.assignee !== original.assignee && updated.assignee !== me()) {
      state.backend.sendPing(state.household.id, `Over to you: ${updated.title}`, updated.id).catch(() => {});
    }
  };

  const extra = [];
  if (original.completed_at && original.last_done_by) {
    extra.push(h("p", { class: "footnote" }, `Last done ${longFmt.format(new Date(original.completed_at))} by ${memberName(original.last_done_by)}`));
  }
  if (original.created_by) {
    extra.push(h("p", { class: "footnote" }, `Added ${shortDateFmt.format(new Date(original.created_at))} by ${memberName(original.created_by)}`));
  }

  openSheet("Details", h("div", { class: "form" },
    h("ul", { class: "card" },
      h("li", { class: "row static" }, titleEl),
      h("li", { class: "row static" }, notesEl)),
    h("ul", { class: "card" }, categoryField.row, storeField.row),
    h("ul", { class: "card" },
      h("li", { class: "row static" }, h("label", { class: "field" }, h("span", {}, "List"), kindEl)),
      h("li", { class: "row static" }, h("label", { class: "field" }, h("span", {}, "Who"), whoEl)),
      urgentRow),
    h("ul", { class: "card" },
      h("li", { class: "row static" }, h("label", { class: "toggle-row" }, h("span", {}, "Due date"), hasDueEl)),
      dueRow,
      h("li", { class: "row static" }, h("label", { class: "field" }, h("span", {}, "Repeats"), repeatEl))),
    h("ul", { class: "card" },
      h("li", { class: "row static" },
        h("button", { class: "text-btn", onclick: () => openPingSheet(original) }, `Ping ${partnerName()} about this`)),
      h("li", { class: "row static" },
        h("button", {
          class: "text-btn danger",
          onclick: () => {
            if (confirm(`Delete “${original.title}”?`)) {
              closeSheet();
              deleteItems([original.id]);
            }
          },
        }, "Delete"))),
    extra), { onSave: save });
}

function openPingSheet(item = null) {
  const messageEl = h("textarea", { rows: "3", maxlength: "500", placeholder: "Write a message…" });
  const quick = item
    ? [`Can you take care of “${item.title}”?`, `Done: ${item.title} ✅`, `Don't forget: ${item.title}`]
    : QUICK_PINGS;

  let sending = false;
  const send = async (text) => {
    if (sending || !text.trim()) return;
    sending = true;
    try {
      await sendPing(text, item?.id ?? null);
      closeSheet();
    } catch (e) {
      toast(e.message, 5000);
    }
    sending = false;
  };

  openSheet(`Ping ${partnerName()}`, h("div", { class: "form" },
    h("ul", { class: "card" },
      h("li", { class: "row static" }, messageEl),
      h("li", { class: "row static" },
        h("button", { class: "btn wide", onclick: () => send(messageEl.value) }, h("span", { html: icon("bell") }), `Send to ${partnerName()}`))),
    h("h3", { class: "sheet-sub" }, "Quick pings"),
    h("ul", { class: "card" },
      quick.map((text) => h("li", { class: "row static" },
        h("button", { class: "text-btn left", onclick: () => send(text) }, text))))));
  if (!item) setTimeout(() => messageEl.focus(), 50);
}

// ─── Rendering: sign in & setup ─────────────────────────────────────────────

function screen(...children) {
  shell = null;
  app.replaceChildren(h("div", { class: "center-screen" },
    h("img", { src: "icons/icon-192.png", alt: "", class: "logo" }),
    children));
}

function renderLoading() {
  screen(h("p", { class: "muted" }, "Loading…"));
}

function renderMessage(title, text, buttonLabel, onClick) {
  screen(h("h1", {}, title), h("p", { class: "muted" }, text), h("button", { class: "btn", onclick: onClick }, buttonLabel));
}

function renderAuth(mode = "signin") {
  const signingUp = mode === "signup";
  const email = h("input", { type: "email", placeholder: "Email", autocomplete: "email", required: true });
  const password = h("input", {
    type: "password",
    placeholder: signingUp ? "Choose a password (8+ characters)" : "Password",
    autocomplete: signingUp ? "new-password" : "current-password",
    minlength: "8",
    required: true,
  });
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { class: "btn wide", type: "submit" }, signingUp ? "Create account" : "Sign in");

  const form = h("form", {
    class: "auth-form",
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      try {
        if (signingUp) {
          const { needsConfirmation } = await state.backend.signUp(email.value.trim(), password.value);
          if (needsConfirmation) {
            renderMessage("Check your email", "Tap the confirmation link we sent you, then come back here and sign in.", "Sign in", () => renderAuth("signin"));
            return;
          }
        }
        await state.backend.signIn(email.value.trim(), password.value);
        const user = await state.backend.currentUser();
        if (user?.id !== state.user?.id) {
          state.user = user;
          await afterAuth();
        }
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    },
  }, email, password, submit, error);

  screen(
    h("h1", {}, "Hearth"),
    h("p", { class: "muted" }, "Shared to-fix, routines and shopping lists for your home."),
    form,
    h("button", { class: "text-btn", onclick: () => renderAuth(signingUp ? "signin" : "signup") },
      signingUp ? "Already have an account? Sign in" : "New here? Create an account"),
    isIOS() && !isStandalone()
      ? h("p", { class: "footnote tip" }, "Tip: first add Hearth to your Home Screen (tap Share, then Add to Home Screen) and sign in from there. The Home Screen app keeps its own login and is the only place notifications work.")
      : null);
}

function renderOnboarding() {
  const name = h("input", { type: "text", placeholder: "Your first name", autocomplete: "given-name", maxlength: "40" });
  const code = h("input", { type: "text", placeholder: "Invite code", autocapitalize: "characters", maxlength: "6", class: "code-input" });
  const error = h("p", { class: "error", role: "alert" });

  const run = async (action) => {
    error.textContent = "";
    if (!name.value.trim()) {
      error.textContent = "Enter your name first";
      name.focus();
      return;
    }
    try {
      await action();
      await afterAuth();
    } catch (e) {
      error.textContent = e.message;
    }
  };

  screen(
    h("h1", {}, "Welcome!"),
    h("p", { class: "muted" }, "What should your partner see you as?"),
    h("div", { class: "auth-form" }, name),
    h("div", { class: "choice card padded" },
      h("h2", {}, "Starting fresh?"),
      h("p", { class: "muted" }, "Create your household, then invite your partner with a code."),
      h("button", { class: "btn wide", onclick: () => run(() => state.backend.createHousehold(name.value.trim())) }, "Create our household")),
    h("div", { class: "choice card padded" },
      h("h2", {}, "Got an invite code?"),
      code,
      h("button", { class: "btn wide secondary", onclick: () => run(() => state.backend.joinHousehold(code.value.trim(), name.value.trim())) }, "Join household")),
    error,
    h("button", { class: "text-btn", onclick: () => state.backend.signOut() }, "Sign out"));
}

// ─── Start ──────────────────────────────────────────────────────────────────

async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker failed", e));
  }
  try {
    state.backend = await createBackend(config);
  } catch {
    renderMessage("Can't reach Hearth", "Check your internet connection and try again.", "Try again", () => location.reload());
    return;
  }
  state.user = await state.backend.currentUser();
  state.backend.onAuthChange((user) => {
    if (user?.id === state.user?.id) return;
    state.user = user;
    afterAuth();
  });
  await afterAuth();
}

boot();
