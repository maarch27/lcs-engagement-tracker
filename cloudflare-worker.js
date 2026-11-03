const GENERIC = new Set(["nice", "nice post", "love it", "i like this product", "great", "great post", "so cute", "amazing", "beautiful", "love this"]);
const TRUSTED_ADMIN_USERNAMES = new Set(["marriaammi", "lizal", "itsimplymartha", "drlamarya"]);
const IG_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/ig;

export default {
  async scheduled(controller, env, ctx) {
    const cron = controller.cron || "";
    if (cron === "0 20 * * SAT") {
      ctx.waitUntil(setSavesChatOpen(env, true));
    } else if (cron === "0 20 * * SUN") {
      ctx.waitUntil((async () => {
        await setSavesChatOpen(env, false);
        await sendWeeklyEvidenceReport(env, controller.scheduledTime ? new Date(controller.scheduledTime) : new Date());
      })());
    } else {
      console.error("Unknown scheduled cron trigger:", cron);
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/setup") {
      if (!env.SETUP_KEY || url.searchParams.get("key") !== env.SETUP_KEY) return new Response("Not found", { status: 404 });
      if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET || !env.LCS_DATA) return new Response("Missing required Worker secrets or KV binding.", { status: 500 });
      const webhookUrl = url.origin + "/";
      const result = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "edited_message"] })
      });
      return new Response(await result.text(), { status: result.status, headers: { "content-type": "application/json" } });
    }
    if (request.method !== "POST") return new Response("Star Links Engagement Tracker webhook is ready.");
    const secret = env.WEBHOOK_SECRET;
    if (!secret || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }
    let update;
    try { update = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    try { await handleUpdate(update, env); } catch (err) { console.error("Update failed", err); }
    return new Response("OK");
  }
};

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  if (!response.ok) console.error("Telegram API error", method, await response.text());
  return response;
}
async function reply(env, chatId, text, replyTo) {
  const payload = { chat_id: chatId, text, disable_web_page_preview: true };
  if (replyTo) payload.reply_to_message_id = replyTo;
  return telegram(env, "sendMessage", payload);
}
async function isAdmin(env, chatId, userId, username) {
  // Explicit trusted usernames are accepted even if Telegram's membership lookup fails.
  const normalized = (username || "").replace(/^@/, "").toLowerCase();
  if (TRUSTED_ADMIN_USERNAMES.has(normalized)) return true;
  // Native Telegram group admins and the creator are also trusted.
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${chatId}&user_id=${userId}`);
    const j = await r.json();
    return j.ok && ["administrator", "creator"].includes(j.result.status);
  } catch { return false; }
}
async function load(env, chatId) {
  return await env.LCS_DATA.get(`chat:${chatId}`, "json") || { tasks: [], completions: [], flags: [], participants: [], nextId: 1 };
}
async function save(env, chatId, data) {
  await env.LCS_DATA.put(`chat:${chatId}`, JSON.stringify(data));
}

async function loadGlobal(env, key, fallback) {
  return await env.LCS_DATA.get(`global:${key}`, "json") || fallback;
}
async function saveGlobal(env, key, value) {
  await env.LCS_DATA.put(`global:${key}`, JSON.stringify(value));
}
function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}
function monthlyWarnings(warnings, userId, month = monthKey()) {
  return warnings.filter(w => String(w.userId) === String(userId) && w.month === month);
}
function savesChat(env, chatId) {
  return !!env.SAVES_CHAT_ID && String(chatId) === String(env.SAVES_CHAT_ID);
}
async function sendPrivate(env, userId, text) {
  return telegram(env, "sendMessage", { chat_id: userId, text, disable_web_page_preview: true });
}
function nameOf(user) { return user.username ? "@" + user.username : (user.first_name || "member"); }
function dateNow() { return new Date().toISOString(); }
function tbilisiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
function georgianCycle(date = new Date()) {
  const p = tbilisiParts(date);
  const start = new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0));
  // Cycle labels use the Georgian calendar date on which the 21:00 cycle began.
  if (p.hour < 21) start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString().slice(0, 10);
}
function nextGeorgianDeadline(date = new Date()) {
  const p = tbilisiParts(date);
  // Georgia is UTC+4. Deadline is the next 21:00 Asia/Tbilisi cutoff.
  const localMidnightUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const todayCutoff = localMidnightUtc + (21 - 4) * 60 * 60 * 1000;
  const candidate = new Date(todayCutoff);
  if (date.getTime() >= todayCutoff) candidate.setTime(todayCutoff + 24 * 60 * 60 * 1000);
  return candidate.toISOString();
}
function formatGeorgian(dateString) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(dateString)) + " Georgia time";
}

async function setSavesChatOpen(env, open) {
  if (!env.SAVES_CHAT_ID || !env.TELEGRAM_BOT_TOKEN) {
    console.error("Saves chat permissions unchanged: configure SAVES_CHAT_ID and TELEGRAM_BOT_TOKEN.");
    return;
  }
  const permissions = open ? {
    can_send_messages: true, can_send_audios: true, can_send_documents: true,
    can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
    can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
    can_add_web_page_previews: true, can_change_info: false, can_invite_users: false,
    can_pin_messages: false, use_independent_chat_permissions: true
  } : {
    can_send_messages: false, can_send_audios: false, can_send_documents: false,
    can_send_photos: false, can_send_videos: false, can_send_video_notes: false,
    can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false,
    can_add_web_page_previews: false, can_change_info: false, can_invite_users: false,
    can_pin_messages: false, use_independent_chat_permissions: true
  };
  const response = await telegram(env, "setChatPermissions", { chat_id: env.SAVES_CHAT_ID, permissions });
  if (response.ok) console.log("Saves chat", open ? "opened" : "closed");
}
function georgianDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
async function sendWeeklyEvidenceReport(env, scheduledTime = new Date()) {
  if (!env.WARNING_CHAT_ID || !env.SAVES_CHAT_ID || !env.LCS_DATA) {
    console.error("Weekly evidence report skipped: configure WARNING_CHAT_ID, SAVES_CHAT_ID and LCS_DATA.");
    return;
  }
  // Cloudflare cron 0 20 * * SUN runs at Monday 00:00 in Georgia (UTC+4).
  const localParts = tbilisiParts(scheduledTime);
  const previousDay = new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day) - 24 * 60 * 60 * 1000);
  const sundayKey = georgianDateKey(previousDay);
  const evidence = await loadGlobal(env, "evidence", []);
  const windowEvidence = evidence.filter(e => String(e.chatId) === String(env.SAVES_CHAT_ID) && georgianDateKey(new Date(e.at)) === sundayKey);
  const roster = await load(env, env.SAVES_CHAT_ID);
  const byMember = new Map();
  for (const item of windowEvidence) {
    const key = String(item.userId);
    const current = byMember.get(key) || { name: item.name || key, count: 0, types: new Set() };
    current.count++;
    current.types.add(item.type || "evidence");
    byMember.set(key, current);
  }
  const observed = roster.participants || [];
  const missing = observed.filter(p => !byMember.has(String(p.userId)));
  const submissions = [...byMember.entries()].sort((a,b) => b[1].count-a[1].count).map(([id, v]) => `• ${v.name} (ID ${id}): ${v.count} submission(s) — ${[...v.types].join(", ")}`);
  const missingText = missing.length ? missing.map(p => `• ${p.name} (ID ${p.userId})`).join("\\n") : "No known Saves-chat participants were missing submissions.";
  const report = `📊 WEEKLY SAVES EVIDENCE REPORT\\nEvidence window: Sunday 00:00–23:59 Georgia time (${sundayKey})\\nReport generated: Monday 00:00 Georgia time\\n\\nSubmissions: ${windowEvidence.length}\\nMembers who submitted: ${byMember.size}\\nKnown Saves-chat participants without a submission: ${missing.length}\\n\\n📸 SUBMISSIONS\\n${submissions.length ? submissions.join("\\n") : "No evidence submissions were recorded during the window."}\\n\\n⚠️ NO SUBMISSION RECORDED\\n${missingText}\\n\\nAdmin review required: this report only includes members the bot has observed in the Saves chat. Missing evidence is not an automatic warning, and the bot cannot independently verify Instagram likes/saves.`;
  await reply(env, env.WARNING_CHAT_ID, report);
}
async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;
  const chat = msg.chat, user = msg.from;
  const chatId = chat.id;
  const text = msg.text || msg.caption || "";
  if (["group", "supergroup"].includes(chat.type) && user && !user.is_bot) {
    const roster = await load(env, chatId);
    roster.participants = roster.participants || [];
    if (!roster.participants.some(p => String(p.userId) === String(user.id))) {
      roster.participants.push({ userId: user.id, name: nameOf(user), username: user.username || "", seenAt: dateNow() });
      await save(env, chatId, roster);
    } else if (!roster.participants.some(p => String(p.userId) === String(user.id) && p.name === nameOf(user))) {
      roster.participants = roster.participants.map(p => String(p.userId) === String(user.id) ? { ...p, name: nameOf(user), username: user.username || "", seenAt: dateNow() } : p);
      await save(env, chatId, roster);
    }
  }
  if (text.startsWith("/start") || text.startsWith("/help")) {
    if (savesChat(env, chatId)) return reply(env, chatId, "📸 SAVES — Weekly Evidence Chat\\n\\nPost Instagram links you engaged with and upload screenshots or screen recordings as evidence. Keep submissions in this chat so admins can review them.\\n\\nThe evidence window opens Sunday at 00:00 and closes Monday at 00:00 Georgia time.\\n/evidence — admins: review recent submissions\\n/review — admins: review recent submissions\\n/warnings — admins: view warning summary");
    if (env.WARNING_CHAT_ID && String(chatId) === String(env.WARNING_CHAT_ID)) return reply(env, chatId, "🛡️ WARNINGS — Admin Desk\\n\\nThis chat receives warning alerts and the weekly Saves evidence report.\\n/warnings — monthly warning summary\\n/warn USER_ID | reason — issue a warning\\n/evidence — review evidence submissions\\n/review — review evidence submissions\\n\\nWeekly report is sent after the Sunday evidence window closes at 00:00 Monday Georgia time.");
    return reply(env, chatId,
      "💗 Welcome to Star Links — Daily Engagement!\\n\\nLet’s support each other and grow together ✨\\n\\n👥 MEMBERS\\n/tasks — view engagement tasks\\n/rules — community rules\\n/done TASK_ID | your comment — report your comment\\n/confirm TASK_ID — confirm you liked and saved the post\\n/warnings — view your current-month warning count\\n\\n🛠 ADMINS\\n/admin — admin controls\\n/report — daily activity report\\n/flags — review flagged reports\\n/tracked — privately view tracked posts (admins)\\n/warnings — view warning summary (admins)\\n/warn USER_ID | reason — issue a warning (admins)\\n/approvepost USER_ID — approve one early post (admins)\\n/evidence — list recent submitted evidence (admins)\\n/check TASK_ID — list known members missing reports (admins)\\n\\n📸 SAVES CHAT\\nSend screenshots or screen recordings as evidence. Admins can use /warnings, /warn, /evidence and /review.\\n\\n💌 NEED HELP?\\nContact @marriaammi, @Lizal, @itsimplymartha, or @drlamarya.\\n\\nThe bot never deletes messages or auto-bans members. Instagram likes/saves cannot be verified directly by the bot. 💗");
  }
  if (text.startsWith("/rules")) {
    return reply(env, chatId,
      "💗 Star Links engagement rules\n1. Like and save each assigned post.\n2. Leave a genuine, relevant comment following the post instructions.\n3. If no special instruction is given, leave a meaningful comment.\n4. Emoji-only comments are acceptable only when explicitly requested.\n5. Avoid generic comments.\n6. Report with /done TASK_ID | your comment, then /confirm TASK_ID after liking and saving.\n7. Each member may submit a new Instagram post once every 24 hours. An admin can approve an earlier post with /approvepost USER_ID.\n8. Evidence goes in the designated saves chat: screenshots or screen recordings.\n\nWarnings are counted by calendar month. At 5 warnings, the bot applies a posting limit until the next month and alerts admins. It does not ban members or delete messages. Completion and evidence require human review; likes/saves cannot be independently verified by the bot.");
  }
  // Warning/evidence commands are backed by shared KV records so the saves chat and main group can share moderation history.
  if (text.startsWith("/confirm")) {
    const match = text.match(/^\/confirm(?:@\w+)?\s+(\d+)$/);
    if (!match) return reply(env, chatId, "Format: /confirm TASK_ID — use this after you have liked and saved the post.");
    const taskId = Number(match[1]);
    const data = await load(env, chatId);
    const task = data.tasks.find(t => t.id === taskId);
    if (!task) return reply(env, chatId, `I couldn't find task #${taskId} in this chat.`);
    if (String(task.posterId) === String(user.id)) return reply(env, chatId, "You don't need to engage with your own post.");
    const existing = data.completions.find(c => c.taskId === taskId && String(c.userId) === String(user.id));
    if (existing) {
      existing.likesConfirmed = true;
      existing.saveConfirmed = true;
      existing.confirmedAt = dateNow();
      existing.name = nameOf(user);
    } else {
      data.completions.push({ taskId, userId: user.id, name: nameOf(user), comment: "", likesConfirmed: true, saveConfirmed: true, at: dateNow(), confirmedAt: dateNow() });
    }
    await save(env, chatId, data);
    return reply(env, chatId, `💗 Like/save confirmation recorded for task #${taskId}. This is a self-report; the bot cannot verify Instagram actions directly.`);
  }
  if (text.startsWith("/check")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can check a task.");
    const match = text.match(/^\/check(?:@\w+)?\s+(\d+)$/);
    if (!match) return reply(env, chatId, "Format: /check TASK_ID");
    const taskId = Number(match[1]);
    const data = await load(env, chatId);
    const task = data.tasks.find(t => t.id === taskId);
    if (!task) return reply(env, chatId, `I couldn't find task #${taskId} in this chat.`);
    const people = (data.participants || []).filter(p => String(p.userId) !== String(task.posterId));
    const status = people.map(p => {
      const record = data.completions.find(x => x.taskId === taskId && String(x.userId) === String(p.userId));
      const missing = [];
      if (!record || !record.comment || !record.comment.trim()) missing.push("comment");
      if (!record || !record.likesConfirmed) missing.push("like report");
      if (!record || !record.saveConfirmed) missing.push("save report");
      return { name: p.name, userId: p.userId, missing };
    });
    const incomplete = status.filter(x => x.missing.length);
    const complete = status.length - incomplete.length;
    const body = incomplete.length ? incomplete.map(x => `• ${x.name} (ID ${x.userId}): missing ${x.missing.join(", ")}`).join("\n") : "No known active participants are missing reports.";
    return reply(env, chatId, `🔎 Task #${taskId} report status\nPost: ${task.url}\nKnown participants checked: ${status.length}\nAll three reports present: ${complete}\nStill missing reports: ${incomplete.length}\n\n${body}\n\nImportant: this only covers members the bot has seen message in this chat. Like/save statuses are self-reported, not independently verified by Instagram.`);
  }
  if (text.startsWith("/warnings")) {
    const warnings = await loadGlobal(env, "warnings", []);
    const memberRows = monthlyWarnings(warnings, user.id);
    const admin = await isAdmin(env, chatId, user.id, user.username);
    if (!admin) return reply(env, chatId, `⚠️ Your warnings this month: ${memberRows.length}/5.${memberRows.length >= 5 ? "\n‼️ Your posting limit is active until next month." : ""}`);
    const grouped = new Map();
    for (const w of warnings.filter(x => x.month === monthKey())) {
      const key = String(w.userId);
      const current = grouped.get(key) || { name: w.name, count: 0 };
      current.count++;
      grouped.set(key, current);
    }
    const rows = [...grouped.entries()].sort((a,b) => b[1].count-a[1].count).slice(0,50);
    return reply(env, chatId, rows.length ? "‼️ Monthly warnings (" + monthKey() + ")\n\n" + rows.map(([id, v]) => `${v.name} (ID ${id}): ${v.count}/5${v.count >= 5 ? " — POSTING LIMIT ACTIVE" : ""}`).join("\n") : "No warnings this month 💗");
  }
  if (text.startsWith("/warn")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can issue warnings.");
    let target = msg.reply_to_message && msg.reply_to_message.from;
    let reason = "";
    const match = text.match(/^\/warn(?:@\\w+)?\\s+(\\d+)\\s*\\|\\s*(.+)$/s);
    if (match) {
      target = { id: Number(match[1]), first_name: "Member" };
      reason = match[2].trim();
    } else if (msg.reply_to_message && text.match(/^\/warn(?:@\\w+)?(?:\\s+(.+))?$/s)) {
      reason = (text.match(/^\/warn(?:@\\w+)?(?:\\s+(.+))?$/s) || [,"No reason provided"])[1] || "No reason provided";
    } else {
      return reply(env, chatId, "Reply to a member's message with /warn reason, or use /warn USER_ID | reason.");
    }
    if (!target || !target.id) return reply(env, chatId, "I couldn't identify that member. Reply to one of their messages or use their numeric Telegram user ID.");
    const warnings = await loadGlobal(env, "warnings", []);
    const count = monthlyWarnings(warnings, target.id).length + 1;
    const warning = { id: warnings.length ? Math.max(...warnings.map(w => w.id || 0)) + 1 : 1, userId: target.id, name: nameOf(target), adminId: user.id, adminName: nameOf(user), reason: reason.slice(0,500), month: monthKey(), at: dateNow(), count };
    warnings.push(warning);
    await saveGlobal(env, "warnings", warnings);
    const limitActive = count >= 5;
    await sendPrivate(env, target.id, `‼️ Star Links warning ${count}/5 for ${monthKey()}\nReason: ${warning.reason}${limitActive ? "\n\n⛔ Your posting limit is now active until the next calendar month. This is not a ban." : ""}`);
    if (limitActive) {
      const limits = await loadGlobal(env, "limits", {});
      limits[String(target.id)] = { untilMonth: monthKey(), reason: "Reached 5 warnings in one calendar month", at: dateNow() };
      await saveGlobal(env, "limits", limits);
    }
    const alert = `⚠️ STAR LINKS WARNING RECORDED\\nMember: ${warning.name} (ID ${target.id})\\nWarnings this month: ${count}/5\\nReason: ${warning.reason}\\nIssued by: ${warning.adminName}${limitActive ? "\\nPOSTING LIMIT ACTIVE until next month (no ban)." : ""}`;
    if (env.WARNING_CHAT_ID) await reply(env, env.WARNING_CHAT_ID, alert);
    return reply(env, chatId, `‼️ Warning ${count}/5 recorded for ${warning.name} (ID ${target.id}).${limitActive ? " Posting limit activated until next month; no ban applied." : ""}`);
  }
  if (text.startsWith("/approvepost")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can approve early posts.");
    const match = text.match(/^\/approvepost(?:@\\w+)?\\s+(\\d+)$/);
    if (!match) return reply(env, chatId, "Format: /approvepost USER_ID");
    const approvals = await loadGlobal(env, "postApprovals", {});
    approvals[String(match[1])] = { approvedBy: user.id, at: dateNow(), used: false };
    await saveGlobal(env, "postApprovals", approvals);
    return reply(env, chatId, `✅ One early-post approval is ready for Telegram user ID ${match[1]}. It will be used on their next Instagram link.`);
  }
  if (text.startsWith("/evidence") || text.startsWith("/review")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can review evidence.");
    const evidence = await loadGlobal(env, "evidence", []);
    const rows = evidence.slice(-15).reverse();
    return reply(env, chatId, rows.length ? "📸 Recent evidence submissions (manual review)\n\n" + rows.map(e => `Evidence #${e.id} · ${e.name} (ID ${e.userId})\nType: ${e.type} · ${e.at}\n${e.caption || "No caption"}${e.fileId ? "\nTelegram file ID saved" : ""}`).join("\n\n") : "No evidence submissions recorded yet.");
  }
  // Saves chat is an evidence-only room: record Instagram links as evidence, never as engagement tasks.
  if (savesChat(env, chatId) && IG_RE.test(text)) {
    IG_RE.lastIndex = 0;
    const links = text.match(IG_RE) || [];
    const evidence = await loadGlobal(env, "evidence", []);
    for (const rawLink of links) {
      const link = rawLink.replace(/[.,!?]+$/g, "");
      evidence.push({ id: evidence.length ? Math.max(...evidence.map(e => e.id || 0)) + 1 : 1, userId: user.id, name: nameOf(user), chatId, type: "Instagram link", url: link, caption: text.slice(0,300), messageId: msg.message_id, at: dateNow(), status: "pending_review" });
    }
    await saveGlobal(env, "evidence", evidence);
    return;
  }
  // Save-chat evidence mode: record incoming images/videos/documents without cluttering the chat with bot replies.
  if (savesChat(env, chatId) && (msg.photo || msg.video || msg.document || msg.animation || msg.video_note)) {
    const evidence = await loadGlobal(env, "evidence", []);
    const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : (msg.video || msg.document || msg.animation || msg.video_note || {}).file_id;
    const type = msg.photo ? "screenshot/photo" : msg.video ? "screen recording/video" : msg.video_note ? "video note" : msg.animation ? "animation" : "document";
    evidence.push({ id: evidence.length ? Math.max(...evidence.map(e => e.id || 0)) + 1 : 1, userId: user.id, name: nameOf(user), chatId, type, fileId, caption: (msg.caption || "").slice(0,300), messageId: msg.message_id, at: dateNow(), status: "pending_review" });
    await saveGlobal(env, "evidence", evidence);
    return;
  }
  if (text.startsWith("/tracked") || text.startsWith("/remove")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "This command is available to group admins only.");
    const data = await load(env, chatId);
    if (text.startsWith("/remove")) {
      const match = text.match(/^\/remove(?:@\w+)?\s+(\d+)$/);
      if (!match) return reply(env, chatId, "Format: /remove TASK_ID");
      const taskId = Number(match[1]);
      const index = data.tasks.findIndex(t => t.id === taskId);
      if (index < 0) return reply(env, chatId, `I couldn't find task #${taskId}.`);
      const removed = data.tasks.splice(index, 1)[0];
      data.completions = data.completions.filter(c => c.taskId !== taskId);
      await save(env, chatId, data);
      const dm = await telegram(env, "sendMessage", { chat_id: user.id, text: `🗑 Task #${taskId} has been removed from tracking.\nPost: ${removed.url}`, disable_web_page_preview: true });
      if (!dm.ok) return reply(env, chatId, "Task removed, but I couldn't DM you. Please start the bot privately with /start.");
      return reply(env, chatId, `✅ Task #${taskId} removed. Details sent to your bot chat.`);
    }
    const rows = data.tasks.slice(-30).reverse();
    const report = rows.length
      ? "📌 Tracked posts · latest 30\n\n" + rows.map(t => {
          const done = data.completions.filter(x => x.taskId === t.id && x.comment && x.comment.trim() && x.likesConfirmed && x.saveConfirmed);
          const overdue = t.deadline && Date.now() > new Date(t.deadline).getTime();
          return `Task #${t.id} · ${t.posterName} · ${t.instruction}\nStatus: ${done.length ? "Completion reported (self-reported)" : overdue ? "⚠️ OVERDUE — no report" : "⏳ Awaiting engagement"}\nDue: ${t.deadline ? formatGeorgian(t.deadline) : "Not set"}\nReports: ${done.length}\n${t.url}`;
        }).join("\n\n") + "\n\nAdmin control: use /remove TASK_ID in the group to stop tracking a post."
      : "📌 No tracked posts yet."
    const dm = await telegram(env, "sendMessage", { chat_id: user.id, text: report, disable_web_page_preview: true });
    if (!dm.ok) return reply(env, chatId, "I couldn't send the tracked-post list privately. Open the bot and send /start first, then run /tracked again in the group.");
    return reply(env, chatId, "📩 I sent the tracked-post list to your private bot chat.");
  }
  if (text.startsWith("/admin") || text.startsWith("/report") || text.startsWith("/flags")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "This command is available to group admins only.");
    const data = await load(env, chatId);
    if (text.startsWith("/admin")) return reply(env, chatId,
      "🛠 Admin controls\n/report — daily task and completion summary\n/flags — latest 20 flags for manual review\n/tracked — privately view tracked posts\n/warnings — monthly warning summary\n/warn USER_ID | reason — issue a warning (or reply to a member's message with /warn reason)\n/approvepost USER_ID — approve one early post\n/evidence — list recent screenshot/screen-recording submissions\n/check TASK_ID — check who has not reported each action\n\nAt 5 warnings in a calendar month, a posting limit is applied until next month and the member/admins are notified. No auto-ban or auto-delete. Instagram likes/saves are not independently verified.");
    if (text.startsWith("/flags")) {
      const rows = data.flags.slice(-20).reverse();
      return reply(env, chatId, rows.length ? "🔎 Recent flags (manual review):\n\n" + rows.map(f => `Flag #${f.id} · ${f.name}\n${f.reason}\n${f.at}`).join("\n\n") + "\n\nNo automatic bans are applied." : "No flagged comments to review 💗");
    }
    const today = new Date().toISOString().slice(0, 10);
    const taskCount = data.tasks.filter(t => t.at.slice(0,10) === today).length;
    const doneCount = data.completions.filter(c => c.at.slice(0,10) === today).length;
    const openCount = data.tasks.filter(t => !data.completions.some(c => c.taskId === t.id && c.comment && c.comment.trim() && c.likesConfirmed && c.saveConfirmed)).length;
    const flags = data.flags.filter(f => f.at.slice(0,10) === today);
    return reply(env, chatId, `📊 Star Links daily report (UTC)\nTasks posted today: ${taskCount}\nCompletion self-reports today: ${doneCount}\nUnreported task entries: ${openCount}\nFlags today: ${flags.length}\n\nCompletion is self-reported; likes/saves are not independently verified.`);
  }
  if (text.startsWith("/tasks")) {
    const data = await load(env, chatId);
    const ownOpen = data.tasks.filter(t => t.posterId !== user.id && !data.completions.some(c => c.taskId === t.id && c.userId === user.id && c.comment && c.comment.trim() && c.likesConfirmed && c.saveConfirmed)).slice(-20).reverse();
    return reply(env, chatId, ownOpen.length ? "📋 Your unreported tasks (including overdue posts — please catch up on all of them):\n\n" + ownOpen.map(t => `#${t.id} · ${t.instruction} · posted by ${t.posterName}\n${t.deadline && Date.now() > new Date(t.deadline).getTime() ? "⚠️ OVERDUE — please complete this task" : "⏳ Deadline"}: ${t.deadline ? formatGeorgian(t.deadline) : "Check with an admin"}\n${t.url}`).join("\n\n") : "You have no open tasks recorded here 💗")
  }
  if (text.startsWith("/done")) {
    const match = text.match(/^\/done(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$/s);
    if (!match) return reply(env, chatId, "Format: /done TASK_ID | the meaningful comment you left");
    const taskId = Number(match[1]), comment = match[2].trim();
    const data = await load(env, chatId);
    const task = data.tasks.find(t => t.id === taskId);
    if (!task) return reply(env, chatId, `I couldn't find task #${taskId} in this chat. Use /tasks.`);
    if (task.posterId === user.id) return reply(env, chatId, "You can't mark your own post as an engagement task you completed.");
    const admin = await isAdmin(env, chatId, user.id, user.username);
    const normalized = comment.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    const generic = GENERIC.has(normalized) || wordCount < 4;
    if (generic && task.instruction !== "EMOJI_ONLY" && !admin) {
      const flag = { id: data.flags.length + 1, chatId, userId: user.id, name: nameOf(user), reason: `Task #${taskId}: possibly short/generic comment: ${comment.slice(0,180)}`, at: dateNow() };
      data.flags.push(flag); await save(env, chatId, data);
      return reply(env, chatId, `⚠️ Your completion for task #${taskId} was flagged for admin review because the comment may be too short or generic. Please submit a specific, relevant comment. Likes and saves are still required.`);
    }
    // Record the comment report, but explicitly ask members to confirm likes and saves too.
    const previous = data.completions.find(c => c.taskId === taskId && String(c.userId) === String(user.id));
    data.completions = data.completions.filter(c => !(c.taskId === taskId && String(c.userId) === String(user.id)));
    data.completions.push({ taskId, userId: user.id, name: nameOf(user), comment: comment.slice(0,500), likesConfirmed: !!(previous && previous.likesConfirmed), saveConfirmed: !!(previous && previous.saveConfirmed), at: dateNow(), confirmedAt: previous && previous.confirmedAt });
    await save(env, chatId, data);
    return reply(env, chatId, `💗 Comment report recorded for task #${taskId}.\n\n⚠️ After liking and saving, send /confirm ${taskId} to record those actions too.\n\nThe bot cannot verify Instagram likes or saves directly, so these records are self-reports, not proof.`);
  }
  if (!["group", "supergroup"].includes(chat.type)) return;
  const links = text.match(IG_RE);
  if (!links || !user) return;
  const data = await load(env, chatId);
  const limits = await loadGlobal(env, "limits", {});
  const currentLimit = limits[String(user.id)];
  if (currentLimit && currentLimit.untilMonth === monthKey()) {
    await reply(env, chatId, `‼️ ${nameOf(user)}, your posting limit is active because you reached 5 warnings this month. You can post again next month. Your message has not been deleted.`, msg.message_id);
    return;
  }
  const approvals = await loadGlobal(env, "postApprovals", {});
  const approval = approvals[String(user.id)];
  const lastPost = data.tasks.filter(t => String(t.posterId) === String(user.id)).sort((a,b) => new Date(b.at)-new Date(a.at))[0];
  const elapsed = lastPost ? Date.now() - new Date(lastPost.at).getTime() : Infinity;
  if (lastPost && elapsed < 24 * 60 * 60 * 1000 && !(approval && !approval.used)) {
    const availableAt = new Date(new Date(lastPost.at).getTime() + 24 * 60 * 60 * 1000);
    await reply(env, chatId, `⏳ ${nameOf(user)}, you can submit another post after ${formatGeorgian(availableAt.toISOString())}. An admin can approve an exception with /approvepost ${user.id}. Your message has not been deleted and was not added as a task.`, msg.message_id);
    return;
  }
  if (approval && !approval.used) {
    approvals[String(user.id)] = { ...approval, used: true, usedAt: dateNow() };
    await saveGlobal(env, "postApprovals", approvals);
  }
  let instruction = "ALL";
  const lower = text.toLowerCase();
  if (lower.includes("emoji only") || lower.includes("emoji-only")) instruction = "EMOJI_ONLY";
  else if (lower.includes("repost to x") || lower.includes("repost on x")) instruction = "ALL + REPOST TO X";
  else if (lower.includes("repost")) instruction = "ALL + REPOST";
  const ids = [];
  for (const link of links) {
    const clean = link.replace(/[.,!?\)\]\}]+$/g, "");
    const id = data.nextId++;
    const createdAt = dateNow();
    const deadline = new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
    data.tasks.push({ id, chatId, messageId: msg.message_id, url: clean, instruction, posterId: user.id, posterName: nameOf(user), at: createdAt, cycle: georgianCycle(new Date(createdAt)), deadline });
    ids.push("#" + id);
  }
  await save(env, chatId, data);
  const open = data.tasks.filter(t => t.posterId !== user.id && !data.completions.some(c => c.taskId === t.id && c.userId === user.id && c.comment && c.comment.trim() && c.likesConfirmed && c.saveConfirmed));
  const latestTask = data.tasks.find(t => t.id === Number(ids[0].slice(1)));
  const note = `💗 Thank you ${nameOf(user)} for sharing your Instagram post!\n\n✅ Your post has been added to the Star Links Engagement Tracker.\n📌 Task ID: ${ids.join(", ")}\n⏳ Daily engagement deadline: ${formatGeorgian(latestTask.deadline)}\n\n💗 Please make sure to engage with the other posts in this cycle: like + save and leave the requested, meaningful comment (3+ words unless the post says otherwise).\n\nUse /tasks to review outstanding tasks. Report completion in the group with /done TASK_ID | your comment.\n\nℹ️ The bot records self-reports; it cannot independently verify Instagram likes or saves.`;
  // Send this confirmation privately to the person who shared the link. Never post the notification in the group.
  const dm = await telegram(env, "sendMessage", { chat_id: user.id, text: note, disable_web_page_preview: true });
  if (!dm.ok) console.error("Could not DM post sharer; they may need to start the bot first.", await dm.text());
}
