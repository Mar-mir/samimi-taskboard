import { INDEX_HTML } from "./_site.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-backup-token",
};
const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });

const te = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", te.encode(s)));
}
function rid(n = 24) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return hex(b);
}
async function kvGet(env, k, fb = null) {
  const v = await env.TASK_KV.get(k);
  return v === null ? fb : JSON.parse(v);
}
async function kvPut(env, k, v) {
  await env.TASK_KV.put(k, JSON.stringify(v));
}

async function getSession(env, req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const s = await kvGet(env, "sess:" + m[1]);
  if (!s) return null;
  if (s.exp < Date.now()) {
    await env.TASK_KV.delete("sess:" + m[1]);
    return null;
  }
  return s;
}

/* ---------- tasks ---------- */
async function loadTasks(env) {
  return await kvGet(env, "tasks:all", {});
}
async function saveTasks(env, t) {
  await kvPut(env, "tasks:all", t);
}
function sortedTasks(map) {
  const arr = Object.values(map);
  const open = arr
    .filter((t) => !t.done)
    .sort((a, b) => ((a.due || "~") < (b.due || "~") ? -1 : 1));
  const done = arr
    .filter((t) => t.done)
    .sort((a, b) => ((b.updatedAt || "") < (a.updatedAt || "") ? -1 : 1));
  return [...open, ...done];
}

/* ---------- tehran time helpers (UTC+3:30) ---------- */
const TEH = 3.5 * 3600e3;
function fmtDue(iso) {
  if (!iso) return "بدون تاریخ";
  const d = new Date(new Date(iso).getTime() + TEH);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function parseDue(s) {
  s = (s || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const hh = m[4] !== undefined ? +m[4] : 9;
    const mm = m[5] !== undefined ? +m[5] : 0;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], hh, mm) - TEH).toISOString();
  }
  const t = new Date(Date.now() + TEH);
  m = s.match(/^فردا\s+(\d{1,2}):(\d{2})$/);
  if (m)
    return new Date(
      Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1, +m[1], +m[2]) - TEH
    ).toISOString();
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    let d = new Date(
      Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), +m[1], +m[2]) - TEH
    );
    if (d.getTime() < Date.now()) d = new Date(d.getTime() + 864e5);
    return d.toISOString();
  }
  return null;
}

/* ---------- telegram ---------- */
async function tgCall(env, method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch {
    return { ok: false };
  }
}
function taskKb(id) {
  return [
    [
      { text: "✅ انجام شد", callback_data: "done:" + id },
      { text: "🗑 حذف", callback_data: "del:" + id },
    ],
  ];
}
function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleUpdate(env, upd) {
  // callback buttons
  if (upd.callback_query) {
    const cq = upd.callback_query;
    const uid = String(cq.from && cq.from.id);
    if (uid !== env.TG_OWNER_ID) {
      await tgCall(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "⛔" });
      return;
    }
    const [act, id] = String(cq.data || "").split(":");
    const tasks = await loadTasks(env);
    const t = tasks[id];
    if (act === "done" && t) {
      t.done = true;
      t.updatedAt = new Date().toISOString();
      await saveTasks(env, tasks);
      await tgCall(env, "editMessageText", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `✅ <b>${escHtml(t.title)}</b>\nانجام شد.`,
        parse_mode: "HTML",
      });
    } else if (act === "del" && t) {
      delete tasks[id];
      await saveTasks(env, tasks);
      await tgCall(env, "editMessageText", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `🗑 <b>${escHtml(t.title)}</b>\nحذف شد.`,
        parse_mode: "HTML",
      });
    }
    await tgCall(env, "answerCallbackQuery", { callback_query_id: cq.id });
    return;
  }
  const msg = upd.message;
  if (!msg || !msg.text) return;
  const uid = String(msg.from && msg.from.id);
  if (uid !== env.TG_OWNER_ID) {
    await tgCall(env, "sendMessage", { chat_id: msg.chat.id, text: "⛔ این بات خصوصی است." });
    return;
  }
  const chat = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    if (parts[1]) {
      const link = await kvGet(env, "link:" + parts[1].trim());
      if (link && Date.now() - link.created < 10 * 60e3) {
        await kvPut(env, "cfg:tg_chat", { chat_id: chat, linkedAt: new Date().toISOString() });
        await env.TASK_KV.delete("link:" + parts[1].trim());
        await tgCall(env, "sendMessage", {
          chat_id: chat,
          text: "🔗 وصل شد! از این به بعد آلارم تسک‌ها اینجاست.\n/new عنوان | تاریخ — ساخت تسک\n/list — لیست بازها\n/done شماره — انجام شد\n/del شماره — حذف",
        });
        return;
      }
    }
    await kvPut(env, "cfg:tg_chat", { chat_id: chat, linkedAt: new Date().toISOString() });
    await tgCall(env, "sendMessage", {
      chat_id: chat,
      text: "سلام رشاد 👋\n/new عنوان | تاریخ — ساخت تسک (تاریخ اختیاری: 20:30 یا فردا 8:00 یا 2026-10-25 20:00)\n/list — لیست بازها\n/done شماره — انجام شد\n/del شماره — حذف\n/today — کارهای امروز",
    });
    return;
  }
  if (text.startsWith("/setpass")) {
    const np = text.slice(8).trim();
    if (np.length < 8) {
      await tgCall(env, "sendMessage", { chat_id: chat, text: "رمز باید حداقل ۸ کاراکتر باشد." });
      return;
    }
    const salt = rid(8);
    await kvPut(env, "cfg:auth", {
      salt,
      passhash: await sha256hex(salt + ":" + np),
      createdAt: new Date().toISOString(),
    });
    // drop all sessions
    try {
      const list = await env.TASK_KV.list({ prefix: "sess:" });
      for (const k of list.keys) await env.TASK_KV.delete(k.name);
    } catch {}
    await tgCall(env, "sendMessage", { chat_id: chat, text: "🔑 رمز سایت عوض شد. دوباره وارد شو." });
    return;
  }
  if (text.startsWith("/new")) {
    const rest = text.slice(4).trim();
    if (!rest) {
      await tgCall(env, "sendMessage", { chat_id: chat, text: "مثال:\n/new خرید نان | 20:30" });
      return;
    }
    const [title, dueStr] = rest.split("|").map((x) => (x || "").trim());
    const due = parseDue(dueStr || "");
    if ((dueStr || "") && !due) {
      await tgCall(env, "sendMessage", {
        chat_id: chat,
        text: "قالب تاریخ نامعتبر است. (20:30 | فردا 8:00 | 2026-10-25 20:00)",
      });
      return;
    }
    const tasks = await loadTasks(env);
    const id = rid(8);
    const now = new Date().toISOString();
    tasks[id] = { id, title, desc: "", due, priority: 1, done: false, createdAt: now, updatedAt: now };
    await saveTasks(env, tasks);
    await tgCall(env, "sendMessage", {
      chat_id: chat,
      text: `📝 <b>${escHtml(title)}</b>\n⏰ ${fmtDue(due)}`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: taskKb(id) },
    });
    return;
  }
  if (text.startsWith("/list") || text.startsWith("/today")) {
    const tasks = await loadTasks(env);
    let arr = sortedTasks(tasks).filter((t) => !t.done);
    if (text.startsWith("/today")) {
      const t = new Date(Date.now() + TEH);
      const p = (n) => String(n).padStart(2, "0");
      const day = `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
      arr = arr.filter((x) => x.due && fmtDue(x.due).startsWith(day));
    }
    if (!arr.length) {
      await tgCall(env, "sendMessage", { chat_id: chat, text: "کاری نیست 🎉" });
      return;
    }
    const lines = arr.slice(0, 30).map((t, i) => `${i + 1}. ${t.title} — ${fmtDue(t.due)}`);
    await tgCall(env, "sendMessage", { chat_id: chat, text: lines.join("\n") });
    return;
  }
  if (text.startsWith("/done") || text.startsWith("/del")) {
    const isDel = text.startsWith("/del");
    const n = parseInt(text.split(/\s+/)[1] || "", 10);
    const tasks = await loadTasks(env);
    const arr = sortedTasks(tasks).filter((t) => !t.done);
    const t = arr[n - 1];
    if (!t) {
      await tgCall(env, "sendMessage", { chat_id: chat, text: "شماره نامعتبر است. /list" });
      return;
    }
    if (isDel) {
      delete tasks[t.id];
      await tgCall(env, "sendMessage", { chat_id: chat, text: `🗑 ${t.title} حذف شد.` });
    } else {
      t.done = true;
      t.updatedAt = new Date().toISOString();
      await tgCall(env, "sendMessage", { chat_id: chat, text: `✅ ${t.title} انجام شد.` });
    }
    await saveTasks(env, tasks);
    return;
  }
  await tgCall(env, "sendMessage", { chat_id: chat, text: "/new /list /today /done /del — راهنما: /start" });
}

/* ---------- reminders (cron) ---------- */
async function checkReminders(env) {
  const cfg = await kvGet(env, "cfg:tg_chat", null);
  if (!cfg) return;
  const tasks = await loadTasks(env);
  const now = Date.now();
  let changed = false;
  for (const t of Object.values(tasks)) {
    if (t.done || !t.due) continue;
    const due = new Date(t.due).getTime();
    if (!t.r10 && now >= due - 10 * 60e3 && now < due) {
      await tgCall(env, "sendMessage", {
        chat_id: cfg.chat_id,
        text: `⏳ ۱۰ دقیقه تا <b>${escHtml(t.title)}</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: taskKb(t.id) },
      });
      t.r10 = true;
      changed = true;
    } else if (!t.rDue && now >= due) {
      await tgCall(env, "sendMessage", {
        chat_id: cfg.chat_id,
        text: `🔔 وقت <b>${escHtml(t.title)}</b> رسید!`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: taskKb(t.id) },
      });
      t.rDue = true;
      changed = true;
    }
  }
  if (changed) await saveTasks(env, tasks);
}

/* ---------- http ---------- */
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkReminders(env));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

    // telegram webhook (no auth — telegram calls it)
    if (path === "/api/tg/webhook" && method === "POST") {
      try {
        await handleUpdate(env, await req.json());
      } catch {}
      return J({ ok: true });
    }

    // login (also bootstraps password on first run via INIT_PASSWORD)
    if (path === "/api/login" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const password = body.password || "";
      const cfg = await kvGet(env, "cfg:auth", null);
      if (!cfg) {
        if (password && env.INIT_PASSWORD && password === env.INIT_PASSWORD) {
          const salt = rid(8);
          await kvPut(env, "cfg:auth", {
            salt,
            passhash: await sha256hex(salt + ":" + password),
            createdAt: new Date().toISOString(),
          });
          const token = rid(24);
          await kvPut(env, "sess:" + token, { created: Date.now(), exp: Date.now() + 30 * 864e5 });
          return J({ ok: true, token, first: true });
        }
        return J({ ok: false, error: "not-initialized" }, 403);
      }
      if ((await sha256hex(cfg.salt + ":" + password)) !== cfg.passhash)
        return J({ ok: false, error: "bad-password" }, 401);
      const token = rid(24);
      await kvPut(env, "sess:" + token, { created: Date.now(), exp: Date.now() + 30 * 864e5 });
      return J({ ok: true, token });
    }

    // backup export (token header, for github action)
    if (path === "/api/export" && method === "GET") {
      if (!env.BACKUP_TOKEN || req.headers.get("x-backup-token") !== env.BACKUP_TOKEN)
        return J({ ok: false }, 401);
      return J({ ok: true, exportedAt: new Date().toISOString(), tasks: await loadTasks(env) });
    }

    // frontend (public — login happens via api + token)
    if (method === "GET" && (path === "/" || path === "/index.html" || !path.startsWith("/api/")))
      return new Response(INDEX_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });

    // authed api
    const sess = await getSession(env, req);
    if (!sess) return J({ ok: false, error: "unauthorized" }, 401);

    if (path === "/api/me") return J({ ok: true });

    if (path === "/api/change-password" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const cfg = await kvGet(env, "cfg:auth", null);
      if (!cfg) return J({ ok: false }, 409);
      if ((await sha256hex(cfg.salt + ":" + (body.old || ""))) !== cfg.passhash)
        return J({ ok: false, error: "bad-old" }, 401);
      if (!body.new || body.new.length < 8) return J({ ok: false, error: "too-short" }, 400);
      const salt = rid(8);
      await kvPut(env, "cfg:auth", {
        salt,
        passhash: await sha256hex(salt + ":" + body.new),
        createdAt: new Date().toISOString(),
      });
      try {
        const list = await env.TASK_KV.list({ prefix: "sess:" });
        const me = (req.headers.get("authorization") || "").replace(/^Bearer\s+/, "");
        for (const k of list.keys) if (k.name !== "sess:" + me) await env.TASK_KV.delete(k.name);
      } catch {}
      return J({ ok: true });
    }

    if (path === "/api/tasks" && method === "GET")
      return J({ ok: true, tasks: sortedTasks(await loadTasks(env)) });

    if (path === "/api/tasks" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!body.title || !body.title.trim()) return J({ ok: false, error: "no-title" }, 400);
      const tasks = await loadTasks(env);
      const id = rid(8);
      const now = new Date().toISOString();
      tasks[id] = {
        id,
        title: body.title.trim(),
        desc: (body.desc || "").trim(),
        due: body.due || null,
        priority: [1, 2, 3, 4].includes(body.priority) ? body.priority : 1,
        done: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveTasks(env, tasks);
      return J({ ok: true, task: tasks[id] });
    }

    const mTask = path.match(/^\/api\/tasks\/([0-9a-f]+)$/);
    if (mTask) {
      const id = mTask[1];
      const tasks = await loadTasks(env);
      const t = tasks[id];
      if (!t) return J({ ok: false, error: "not-found" }, 404);
      if (method === "PATCH") {
        const body = await req.json().catch(() => ({}));
        if (body.title !== undefined) t.title = String(body.title).trim();
        if (body.desc !== undefined) t.desc = String(body.desc);
        if (body.due !== undefined) {
          t.due = body.due || null;
          t.r10 = false;
          t.rDue = false;
        }
        if (body.priority !== undefined && [1, 2, 3, 4].includes(body.priority))
          t.priority = body.priority;
        if (body.done !== undefined) t.done = !!body.done;
        t.updatedAt = new Date().toISOString();
        await saveTasks(env, tasks);
        return J({ ok: true, task: t });
      }
      if (method === "DELETE") {
        delete tasks[id];
        await saveTasks(env, tasks);
        return J({ ok: true });
      }
      return J({ ok: false }, 405);
    }

    if (path === "/api/tg/status" && method === "GET") {
      const c = await kvGet(env, "cfg:tg_chat", null);
      return J({ ok: true, linked: !!c, chat_id: c ? c.chat_id : null, bot: env.BOT_USERNAME });
    }
    if (path === "/api/tg/link-code" && method === "POST") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await kvPut(env, "link:" + code, { created: Date.now() });
      return J({ ok: true, code, bot: env.BOT_USERNAME });
    }

    return J({ ok: false, error: "not-found" }, 404);
  },
};
