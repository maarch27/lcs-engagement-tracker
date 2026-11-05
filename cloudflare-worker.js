const GENERIC = new Set(["nice", "nice post", "love it", "i like this product", "great", "great post", "so cute", "amazing", "beautiful", "love this"]);
const TRUSTED_ADMIN_USERNAMES = new Set(["marriaammi", "lizal", "itsimplymartha", "drlamarya"]);
const IG_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/ig;

export default {
  async scheduled(controller, env, ctx) {
    const cron = controller.cron || "";
    if (cron === "0 * * * *") {
      ctx.waitUntil((async () => {
        const now = controller.scheduledTime ? new Date(controller.scheduledTime) : new Date();
        await processExpiredTasks(env, now);
        await sendEngagementReminders(env, now);
        const local = tbilisiParts(now);
        const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tbilisi", weekday: "short" }).format(now);
        if (weekday === "Sun" && local.hour === 12 && env.SAVES_CHAT_ID) {
          await reply(env, env.SAVES_CHAT_ID, "💗 SUNDAY SAVES REMINDER\n\nPlease share the Instagram links you engaged with and upload screenshots or screen recordings as evidence before the Saves window closes at Monday 00:00 Georgia time. This records evidence for admin review; it does not independently verify Instagram actions.");
        }
      })());
    } else if (cron === "0 20 * * SAT") {
      ctx.waitUntil((async () => {
        await setSavesChatOpen(env, true);
        if (env.SAVES_CHAT_ID) await reply(env, env.SAVES_CHAT_ID, "💗 STAR SAVES IS OPEN\n\nSunday 00:00–Monday 00:00 Georgia time. Please share the Instagram links you engaged with and attach screenshots or screen recordings. Admins review submissions manually; evidence is not automatic proof of likes or saves.");
      })());
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
      const meResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
      const meJson = await meResponse.json();
      if (meJson.ok && meJson.result && meJson.username) await saveGlobal(env, "botUsername", meJson.result.username);
      const menuResult = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commands: [
            { command: "start", description: "Open your Star Links welcome menu" },
            { command: "menu", description: "Show the Star Links menu again" },
            { command: "admin", description: "Open the admin controls (authorized admins only)" },
            { command: "posts", description: "Open posts assigned to you" },
            { command: "tasks", description: "View posts you still need to engage with" },
            { command: "done", description: "Report your comment: /done TASK_ID | comment" },
            { command: "confirm", description: "Confirm you liked and saved a post" },
            { command: "reviewposts", description: "Admin: review pending post submissions" },
            { command: "approve", description: "Admin: approve a pending post by task ID" },
            { command: "reject", description: "Admin: reject a pending post with a reason" },
            { command: "warnings", description: "Check your warning count" },
            { command: "rules", description: "Read the engagement rules" },
            { command: "help", description: "Open help and menu" },
            { command: "ai", description: "Ask the private admin AI assistant" }
          ],
          scope: { type: "all_private_chats" }
        })
      });
      return new Response(JSON.stringify({ webhook: await result.json(), privateMenu: await menuResult.json() }), { status: 200, headers: { "content-type": "application/json" } });
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
function displayUser(user) { return user.username ? "@" + user.username : (user.first_name || "Telegram member"); }
function cleanInstagramUrl(raw) {
  const trimmed = String(raw || "").replace(/[.,!?]+$/g, "");
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!["instagram.com", "instagr.am"].includes(host)) return trimmed;
    const match = u.pathname.match(/^\/(reel|reels|p|tv)\/([^/]+)\/?/i);
    if (match) return `https://www.instagram.com/${match[1].toLowerCase() === "reels" ? "reel" : match[1].toLowerCase()}/${match[2]}/`;
    const profile = u.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (profile) return `https://www.instagram.com/${profile[1]}/`;
    return `https://www.instagram.com${u.pathname.endsWith("/") ? u.pathname : u.pathname + "/"}`;
  } catch { return trimmed; }
}
function taskChatIdFor(chat, env) {
  return chat.type === "private" && env.LINK_CHAT_ID ? env.LINK_CHAT_ID : chat.id;
}
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
async function processExpiredTasks(env, now = new Date()) {
  if (!env.LINK_CHAT_ID || !env.LCS_DATA) {
    console.error("Expiry review skipped: configure LINK_CHAT_ID and LCS_DATA.");
    return;
  }
  const data = await load(env, env.LINK_CHAT_ID);
  const participants = data.participants || [];
  const warnings = await loadGlobal(env, "warnings", []);
  const changedTasks = [];
  const newlyIssued = [];
  let warningsChanged = false;

  for (const task of data.tasks || []) {
    if (!["approved", "active", undefined].includes(task.status) || !task.deadline) continue;
    if (new Date(task.deadline).getTime() > now.getTime()) continue;

    const knownMembers = participants.filter(p => String(p.userId) !== String(task.posterId));
    const missing = knownMembers.filter(p =>
      !((data.completions || []).some(c =>
        String(c.userId) === String(p.userId) &&
        Number(c.taskId) === Number(task.id) &&
        c.comment && c.comment.trim() &&
        c.likesConfirmed && c.saveConfirmed
      ))
    );

    for (const member of missing) {
      const alreadyWarned = warnings.some(w =>
        String(w.userId) === String(member.userId) &&
        Number(w.taskId) === Number(task.id) &&
        w.reasonCode === "missed_24h_cycle"
      );
      if (alreadyWarned) continue;
      const count = monthlyWarnings(warnings, member.userId, monthKey(now)).length + 1;
      const warning = {
        id: warnings.length ? Math.max(...warnings.map(w => w.id || 0)) + 1 : 1,
        userId: member.userId,
        name: member.name || member.username || "Member",
        adminId: 0,
        adminName: "Star Links automatic 24-hour cycle review",
        reason: "No complete comment + like/save self-report for expired Task #" + task.id + " before its 24-hour deadline.",
        reasonCode: "missed_24h_cycle",
        taskId: task.id,
        month: monthKey(now),
        at: now.toISOString(),
        count
      };
      warnings.push(warning);
      newlyIssued.push({ member, warning, task });
      warningsChanged = true;
    }

    task.status = "expired";
    task.expiredAt = now.toISOString();
    task.expiryReview = {
      checkedAt: now.toISOString(),
      knownParticipants: knownMembers.length,
      missingReports: missing.length,
      warningCount: newlyIssued.filter(x => Number(x.task.id) === Number(task.id)).length,
      note: "Instagram likes and saves are self-reported; the bot cannot independently verify those actions."
    };
    changedTasks.push({ task, missingCount: missing.length });
  }

  if (changedTasks.length) await save(env, env.LINK_CHAT_ID, data);
  if (warningsChanged) await saveGlobal(env, "warnings", warnings);

  for (const item of newlyIssued) {
    const count = monthlyWarnings(warnings, item.member.userId, monthKey(now)).length;
    await sendPrivate(env, item.member.userId,
      "⚠️ Star Links: 24-hour cycle warning " + count + "/5\n\nTask #" + item.task.id + " expired at " + formatGeorgian(item.task.deadline) +
      ". Our records show that a complete comment and like/save confirmation was not submitted before the deadline.\n\nIf this is incorrect, please contact an admin. Instagram likes/saves are not independently verified by the bot.");
    if (count >= 5) {
      const limits = await loadGlobal(env, "limits", {});
      limits[String(item.member.userId)] = { untilMonth: monthKey(now), reason: "Reached 5 warnings in one calendar month", at: now.toISOString() };
      await saveGlobal(env, "limits", limits);
    }
  }

  if (changedTasks.length) {
    const lines = changedTasks.map(({task, missingCount}) =>
      "• Task #" + task.id + " — " + task.url + "\n  Expired: " + formatGeorgian(task.deadline) +
      " · Missing complete reports: " + missingCount + " · Status: expired"
    );
    const report = "🧾 STAR LINKS — 24-HOUR CYCLE REVIEW\n\n" + lines.join("\n\n") +
      "\n\nExpired links have been removed from active Posts lists. Newer links remain active with their own deadlines. Missing reports create warnings; Instagram likes/saves are self-reported, not independently verified.";
    if (env.WARNING_CHAT_ID) await reply(env, env.WARNING_CHAT_ID, report);
    else await reply(env, env.LINK_CHAT_ID, report);
  }
}

async function sendEngagementReminders(env, now = new Date()) {
  if (!env.LINK_CHAT_ID || !env.LCS_DATA) {
    console.error("Engagement reminders skipped: configure LINK_CHAT_ID and LCS_DATA.");
    return;
  }
  const data = await load(env, env.LINK_CHAT_ID);
  const thresholds = [
    { key: "1h", ms: 60 * 60 * 1000, min: 0, label: "⏰ Final 1-hour reminder" }
  ];
  const notices = [];
  let changed = false;
  for (const task of data.tasks || []) {
    if (!["approved", "active", undefined].includes(task.status) || !task.deadline) continue;
    const complete = (data.completions || []).some(c =>
      c.taskId === task.id && c.comment && c.comment.trim() && c.likesConfirmed && c.saveConfirmed
    );
    if (complete) continue;
    const remaining = new Date(task.deadline).getTime() - now.getTime();
    const threshold = thresholds.find(t => remaining <= t.ms && remaining > t.min && !(task.reminders || []).includes(t.key));
    if (!threshold) continue;
    task.reminders = [...(task.reminders || []), threshold.key];
    changed = true;
    notices.push({ task, threshold });
  }
  if (changed) await save(env, env.LINK_CHAT_ID, data);
  if (!notices.length) return;
  const chunks = [];
  for (const {task, threshold} of notices) {
    chunks.push(threshold.label + "\nTask #" + task.id + " · Posted by " + task.posterName + "\n" + task.url + "\nPlease open the private bot via /posts and finish the comment, like, and save reports. Deadline: " + formatGeorgian(task.deadline) + ".");
  }
  // Aggregate reminders into one message per hourly run to avoid flooding a busy 24/7 group.
  const header = "💗 STAR LINKS ENGAGEMENT CHECK-IN\nPlease complete every assigned post within 24 hours. Use the Posts button to open your private task list. Your comment report and like/save confirmation are self-reported and may be reviewed by admins.\n\n";
  const maxLen = 3500;
  let message = header;
  for (const item of chunks) {
    if ((message + item + "\n\n").length > maxLen) {
      await reply(env, env.LINK_CHAT_ID, message.trim());
      message = "💗 STAR LINKS REMINDER (continued)\n\n";
    }
    message += item + "\n\n";
  }
  if (message.trim() !== header.trim()) await reply(env, env.LINK_CHAT_ID, message.trim());
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
  const observed = (roster.participants || []).filter(p => p.seenAt && georgianDateKey(new Date(p.seenAt)) === sundayKey);
  const missing = observed.filter(p => !byMember.has(String(p.userId)));
  const submissions = [...byMember.entries()].sort((a,b) => b[1].count-a[1].count).map(([id, v]) => `• ${v.name} (ID ${id}): ${v.count} submission(s) — ${[...v.types].join(", ")}`);
  const missingText = missing.length ? missing.map(p => `• ${p.name} (ID ${p.userId})`).join("\n") : "No known Saves-chat participants were missing submissions.";
  const report = `📊 WEEKLY SAVES EVIDENCE REPORT\nEvidence window: Sunday 00:00–23:59 Georgia time (${sundayKey})\nReport generated: Monday 00:00 Georgia time\n\nSubmissions: ${windowEvidence.length}\nMembers who submitted: ${byMember.size}\nKnown Saves-chat participants without a submission: ${missing.length}\n\n📸 SUBMISSIONS\n${submissions.length ? submissions.join("\n") : "No evidence submissions were recorded during the window."}\n\n⚠️ NO SUBMISSION RECORDED\n${missingText}\n\nAdmin review required: this report only includes members the bot has observed in the Saves chat. Missing evidence is not an automatic warning, and the bot cannot independently verify Instagram likes/saves.`;
  await reply(env, env.WARNING_CHAT_ID, report);
}
async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;
  const chat = msg.chat, user = msg.from;
  if (user && user.is_bot) return;
  const chatId = chat.id;
  const text = msg.text || msg.caption || "";

  // STAR LINKS AI ASSISTANT: private, admin-only, with short per-admin conversation history.
  const aiCommand = text.match(/^\/ai(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (aiCommand && user) {
    if (chat.type !== "private") {
      return reply(env, chatId, "🔒 Please use /ai in the bot's private chat so admin questions stay private.", msg.message_id);
    }
    const adminChatId = env.LINK_CHAT_ID || chatId;
    if (!(await isAdmin(env, adminChatId, user.id, user.username))) {
      return reply(env, chatId, "🔒 The AI assistant is available to authorized Star Links admins only.");
    }
    const prompt = (aiCommand[1] || "").trim();
    if (!prompt) {
      return reply(env, chatId, "🤖 Star Links AI\n\nAsk me about bot errors, code, features, or debugging.\n\nExample: /ai Explain how the post approval flow works.\n\nThis first version can answer questions, but cannot directly edit GitHub or deploy the Worker.");
    }
    if (!env.AI || typeof env.AI.run !== "function") {
      return reply(env, chatId, "⚙️ AI is not connected yet. In Cloudflare, open this Worker → Settings → Bindings → Add binding → Workers AI, set the variable name to AI, save, then deploy. No paid API key is needed for the free Workers AI allowance.");
    }
    const historyKey = "global:aiHistory:" + String(user.id);
    const history = await loadGlobal(env, historyKey.replace(/^global:/, ""), []);
    const messages = [
      {
        role: "system",
        content: "You are Star Links AI, a careful coding and operations assistant for the Star Links Telegram engagement tracker running on Cloudflare Workers. Help the authorized admin understand, debug, and improve the bot. Be practical and concise. You do not have direct access to the repository, live logs, Telegram account, secrets, or deployment unless explicitly provided in the message. Never claim to have edited, tested, or deployed code when you have not. Ask the admin to share sanitized errors or relevant code when needed. Never ask them to paste API keys, bot tokens, webhook secrets, or personal data. Explain safe, reversible steps and recommend reviewing code changes before deployment."
      },
      ...history,
      { role: "user", content: prompt.slice(0, 3000) }
    ];
    try {
      const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
        messages,
        max_tokens: 700,
        temperature: 0.3
      });
      const answer = String(result && (result.response || result.output_text || result.text) || "").trim();
      if (!answer) throw new Error("AI returned an empty response");
      const updated = [...history, { role: "user", content: prompt.slice(0, 3000) }, { role: "assistant", content: answer }].slice(-8);
      await saveGlobal(env, historyKey.replace(/^global:/, ""), updated);
      return reply(env, chatId, "🤖 Star Links AI\n\n" + answer.slice(0, 3500), msg.message_id);
    } catch (err) {
      console.error("Star Links AI request failed:", String(err && err.message || err).slice(0, 300));
      return reply(env, chatId, "⚠️ I couldn't get an AI response right now. Check that the Workers AI binding is enabled and that the free daily allowance has not been exhausted. Please try again later.");
    }
  }
  if (["group", "supergroup"].includes(chat.type) && user && !user.is_bot) {
    const roster = await load(env, chatId);
    roster.participants = roster.participants || [];
    if (!roster.participants.some(p => String(p.userId) === String(user.id))) {
      roster.participants.push({ userId: user.id, name: nameOf(user), username: user.username || "", seenAt: dateNow() });
      await save(env, chatId, roster);
    } else {
      roster.participants = roster.participants.map(p => String(p.userId) === String(user.id) ? { ...p, name: nameOf(user), username: user.username || "", seenAt: dateNow() } : p);
      await save(env, chatId, roster);
    }
  }
  const deepStart = chat.type === "private" ? text.match(/^\/start(?:@\w+)?(?:\s+(post|posts|members|admins|rules|warnings|chat|saves))?(?:\s|$)/i) : null;
  if (deepStart && deepStart[1]) {
    const section = deepStart[1].toLowerCase();
    if (section === "post") {
      await saveGlobal(env, "postDraft:" + user.id, { state: "awaiting_link", at: dateNow() });
      return reply(env, chatId, "📸 SUBMIT YOUR INSTAGRAM POST\\n\\nSend your Instagram post or Reel link here privately. Add any special comment instructions after the link (optional).\\n\\nThe bot checks your 24-hour posting eligibility and queues your post for admin review. Review usually takes around 3–5 minutes, but approval is not automatic.");
    }
    if (section === "posts") {
      if (!env.LINK_CHAT_ID) return reply(env, chatId, "⚠️ The Posts menu is not connected yet. The bot admin needs to configure LINK_CHAT_ID in Cloudflare.");
      const data = await load(env, env.LINK_CHAT_ID);
      const ownOpen = data.tasks.filter(t => (!t.status || t.status === "approved" || t.status === "active") && String(t.posterId) !== String(user.id) && !data.completions.some(c => c.taskId === t.id && String(c.userId) === String(user.id) && c.comment && c.comment.trim() && c.likesConfirmed && c.saveConfirmed)).slice(-30).reverse();
      const nowMs = Date.now();
      const timeLeft = (deadline) => {
        if (!deadline) return "time not set";
        const diff = new Date(deadline).getTime() - nowMs;
        if (diff <= 0) return "⚠️ overdue";
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        if (hours >= 24) return Math.floor(hours / 24) + "d " + (hours % 24) + "h left";
        if (hours > 0) return hours + "h " + minutes + "m left";
        return minutes + "m left";
      };
      const body = ownOpen.map((t, i) => (i + 1) + ") " + t.url + "\n   ⏳ " + timeLeft(t.deadline) + " · ID #" + t.id + "\n   Comment report: /done " + t.id + " | your comment\n   After liking + saving: /confirm " + t.id).join("\n\n");
      return reply(env, chatId, body ? "📋 YOUR OPEN POSTS\nOne compact list — complete each post within its deadline.\n\n" + body : "💗 You have no open posts to engage with right now.");
    }
    if (!env.LINK_CHAT_ID) return reply(env, chatId, "⚠️ This menu is not connected yet. The bot admin needs to configure LINK_CHAT_ID in Cloudflare.");
    const data = await load(env, env.LINK_CHAT_ID);
    if (section === "rules") return reply(env, chatId, "💗 STAR LINKS RULES\n\n1. Like and save every assigned post.\n2. Leave a meaningful, relevant comment of at least 3 words unless the post says otherwise.\n3. Complete every assigned post; do not skip tasks.\n4. Submit your comment with /done TASK_ID | your comment, then use /confirm TASK_ID after liking and saving.\n5. Post only one Instagram link every 24 hours unless an admin approves an exception.\n6. Instagram actions are self-reported; the bot cannot independently verify them.");
    if (section === "admins") return reply(env, chatId, "🛡️ STAR LINKS ADMINS\n\n@marriaammi\n@lizal\n@itsimplymartha\n@drlamarya");
    if (section === "warnings") return reply(env, chatId, "🛡️ WARNINGS & REPORTS\n\nUse #WARNING in Star Saves to flag an issue for admin review. Use #IMBACK when returning. These tags do not automatically issue a formal warning. Admins review reports and handle formal warnings.");
    if (section === "chat") return reply(env, chatId, "💬 Star Links Chat — the casual conversation group. Keep normal chatting here; use Links for engagement posts and Saves for weekly evidence.\n\nOpen Chat: " + (env.CHAT_CHAT_URL || "https://t.me/+_IwypUTODNIzNDI6"));
    if (section === "members") {
      const profiles = await loadGlobal(env, "memberProfiles", []);
      return reply(env, chatId, profiles.length
        ? "👥 STAR LINKS COMMUNITY — INSTAGRAM PROFILES\n\n" + profiles.slice(-100).reverse().map(p => (p.name || p.username || "Member") + "\n" + p.url).join("\n\n") + "\n\nAdd or update your profile with /profile followed by your Instagram profile URL."
        : "👥 COMMUNITY INSTAGRAM DIRECTORY\n\nNo Instagram profiles have been registered yet. Add yours with:\n/profile https://www.instagram.com/yourusername/\n\nMembers can then discover and follow each other.");
    }
    const members = (data.participants || []).slice(-100).reverse();
    return reply(env, chatId, members.length ? "👥 MEMBERS SEEN BY THE BOT\n\n" + members.map(p => p.username ? "@" + p.username.replace(/^@/, "") : p.name).join("\n") : "👥 No members have been recorded yet.");
  }
  if (text.startsWith("/start") || text.startsWith("/help") || text.startsWith("/menu")) {
    if (chat.type === "private") {
      const normalizedUsername = (user.username || "").replace(/^@/, "").toLowerCase();
      if (TRUSTED_ADMIN_USERNAMES.has(normalizedUsername)) {
        const botUsername = await loadGlobal(env, "botUsername", "");
        const botUrl = botUsername ? "https://t.me/" + botUsername : "";
        const adminRows = [
          [{ text: "📸 Post", url: botUrl + "?start=post" }, { text: "📋 Posts", url: botUrl + "?start=posts" }],
          [{ text: "👥 Members", url: botUrl + "?start=members" }, { text: "👩🏻‍💼 Admin", url: botUrl + "?start=admins" }],
          [{ text: "💾 Saves & ⚠️ Warnings", url: "https://t.me/+zvH-bkE_ZT45NTli" }],
          [{ text: "📜 Rules", url: botUrl + "?start=rules" }]
        ];
        return telegram(env, "sendMessage", {
          chat_id: chatId,
          text: "🛠 STAR LINKS ADMIN PANEL\n\n/admin — reopen admin controls\n/report — daily task summary\n/tracked — latest tracked posts privately\n/check TASK_ID — task reports\n/warnings — monthly warning summary\n/warn USER_ID | reason — issue a warning\n/reviewposts — pending submissions\n/approve TASK_ID — publish an approved submission\n/reject TASK_ID | reason — reject a submission\n/evidence — review Saves submissions\n/flags — review flagged comments\n\nUse the menu below to navigate the community sections.\n\nGitHub repository: https://github.com/maarch27/lcs-engagement-tracker",
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: adminRows }
        });
      }
      const botUsername = await loadGlobal(env, "botUsername", "");
      const botUrl = botUsername ? "https://t.me/" + botUsername : "";
      const privateMenu = [
        [{ text: "📸 Post", url: botUrl + "?start=post" }, { text: "📋 Posts", url: botUrl + "?start=posts" }],
        [{ text: "👥 Members", url: botUrl + "?start=members" }, { text: "👩🏻‍💼 Admin", url: botUrl + "?start=admins" }],
        [{ text: "💾 Saves & ⚠️ Warnings", url: "https://t.me/+zvH-bkE_ZT45NTli" }],
        [{ text: "📜 Rules", url: botUrl + "?start=rules" }]
      ];
      return telegram(env, "sendMessage", {
        chat_id: chatId,
        text: "💗 STAR LINKS — ENGAGEMENT COMMUNITY\n\nChoose a section below.\n\n📸 Post — privately submit your Instagram post/Reel for admin approval.\n📋 Posts — view assigned links and deadlines.\n👥 Members — discover community Instagram profiles.\n👩🏻‍💼 Admin — contact moderators.\n💾 Saves & Warnings — weekly evidence and reports.\n📜 Rules — read community guidelines.\n\nGitHub repository: https://github.com/maarch27/lcs-engagement-tracker",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: privateMenu }
      });
    }
    if (savesChat(env, chatId)) return reply(env, chatId, "📸 STAR SAVES — WEEKLY EVIDENCE CHAT\n\nPost the Instagram links you engaged with and upload screenshots or screen recordings as evidence.\n\n🗓️ Open: Sunday 00:00 Georgia time. Closes: Monday 00:00 Georgia time. The bot will remind members during the window and send a weekly report to the admin Warnings chat.\n\nUse #WARNING with a member username or reply to their message to flag an issue for admin review. Use #IMBACK when returning and then catch up on outstanding Posts in the private bot. Tags are recorded for review; they do not automatically issue warnings.");
    if (env.WARNING_CHAT_ID && String(chatId) === String(env.WARNING_CHAT_ID)) return reply(env, chatId, "🛡️ WARNINGS — ADMIN DESK\n\nWarning alerts and the weekly Saves evidence report appear here.\n/warnings — monthly summary\n/warn USER_ID | reason — issue a warning\n/evidence — review evidence submissions");
    const botUsername = await loadGlobal(env, "botUsername", "");
    const menuText = "💗 STAR LINKS — ENGAGEMENT COMMUNITY\n\nChoose a section below.\n\n📸 Post — privately submit your Instagram post/Reel for admin approval.\n📋 Posts — view assigned links and deadlines.\n👥 Members — discover community Instagram profiles.\n👩🏻‍💼 Admin — contact moderators.\n💾 Saves & Warnings — weekly evidence and reports.\n📜 Rules — read community guidelines.\n\nGitHub repository: https://github.com/maarch27/lcs-engagement-tracker";
    if (botUsername && String(chatId) === String(env.LINK_CHAT_ID)) {
      const botUrl = "https://t.me/" + botUsername;
      const rows = [
        [{ text: "📸 Post", url: botUrl + "?start=post" }, { text: "📋 Posts", url: botUrl + "?start=posts" }],
        [{ text: "👥 Members", url: botUrl + "?start=members" }, { text: "👩🏻‍💼 Admin", url: botUrl + "?start=admins" }],
        [{ text: "💾 Saves & ⚠️ Warnings", url: "https://t.me/+zvH-bkE_ZT45NTli" }],
        [{ text: "📜 Rules", url: botUrl + "?start=rules" }]
      ];
      return telegram(env, "sendMessage", {
        chat_id: chatId, text: menuText, disable_web_page_preview: true,
        reply_markup: { inline_keyboard: rows }
      });
    }
    return reply(env, chatId, menuText + "\n\n⚠️ Menu buttons are not configured yet. Admin: deploy the latest Worker and run /setup?key=SETUP_KEY.");
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
    const dataChatId = taskChatIdFor(chat, env);
    const data = await load(env, dataChatId);
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
    await save(env, dataChatId, data);
    return reply(env, chatId, `💗 Like/save confirmation recorded for task #${taskId}. This is a self-report; the bot cannot verify Instagram actions directly.`);
  }
  if (text.startsWith("/check")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can check a task.");
    const match = text.match(/^\/check(?:@\w+)?\s+(\d+)$/);
    if (!match) return reply(env, chatId, "Format: /check TASK_ID");
    const taskId = Number(match[1]);
    const data = await load(env, taskChatIdFor(chat, env));
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
    const alert = `⚠️ STAR LINKS WARNING RECORDED\nMember: ${warning.name} (ID ${target.id})\nWarnings this month: ${count}/5\nReason: ${warning.reason}\nIssued by: ${warning.adminName}${limitActive ? "\nPOSTING LIMIT ACTIVE until next month (no ban)." : ""}`;
    if (env.WARNING_CHAT_ID) await reply(env, env.WARNING_CHAT_ID, alert);
    return reply(env, chatId, `‼️ Warning ${count}/5 recorded for ${warning.name} (ID ${target.id}).${limitActive ? " Posting limit activated until next month; no ban applied." : ""}`);
  }
  if (text.startsWith("/reviewposts")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can review pending posts.");
    const data = await load(env, taskChatIdFor(chat, env));
    const pending = data.tasks.filter(t => t.status === "pending_review").slice(-20).reverse();
    return reply(env, chatId, pending.length
      ? "🕵️ POSTS WAITING FOR REVIEW\n\n" + pending.map(t => "Task #" + t.id + " · " + t.posterName + " (ID " + t.posterId + ")\n" + t.url + "\nApprove: /approve " + t.id + "\nReject: /reject " + t.id + " | reason").join("\n\n")
      : "💗 There are no posts waiting for review.");
  }
  if (text.startsWith("/approve ") || text === "/approve") {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can approve posts.");
    const match = text.match(/^\/approve(?:@\w+)?\s+(\d+)$/);
    if (!match) return reply(env, chatId, "Format: /approve TASK_ID");
    const dataChatId = taskChatIdFor(chat, env);
    const data = await load(env, dataChatId);
    const task = data.tasks.find(t => t.id === Number(match[1]));
    if (!task) return reply(env, chatId, "I couldn't find that task.");
    if (task.status !== "pending_review") return reply(env, chatId, "This post is not waiting for review. Current status: " + (task.status || "legacy/active") + ".");
    task.status = "approved";
    task.reviewedAt = dateNow();
    task.reviewedBy = user.id;
    task.deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await save(env, dataChatId, data);
    const botUsername = await loadGlobal(env, "botUsername", "");
    const botUrl = botUsername ? "https://t.me/" + botUsername : "";
    const postText = "🔥 STAR LINKS — NEW INSTAGRAM POST\n\n👤 Shared by: " + task.posterName + "\n📸 " + task.url + "\n📝 Instructions: " + (task.instructionText || (task.instruction === "EMOJI_ONLY" ? "Emoji-only comment" : task.instruction === "ALL + REPOST TO X" ? "Like, save, comment and repost to X" : task.instruction === "ALL + REPOST" ? "Like, save, comment and repost" : "Like, save and leave a meaningful, relevant comment")) + "\n\n⏳ Complete within 24 hours.\nTask ID: #" + task.id + "\n\nAfter engaging, open Posts in the bot to report your comment and confirm your like/save.";
    const rows = botUsername ? [
      [{ text: "📸 Post", url: botUrl + "?start=post" }, { text: "📋 Posts", url: botUrl + "?start=posts" }],
      [{ text: "👥 Members", url: botUrl + "?start=members" }, { text: "👩🏻‍💼 Admin", url: botUrl + "?start=admins" }],
      [{ text: "💾 Saves & ⚠️ Warnings", url: "https://t.me/+zvH-bkE_ZT45NTli" }],
      [{ text: "📜 Rules", url: botUrl + "?start=rules" }]
    ] : [];
    const keyboard = rows.length ? { reply_markup: { inline_keyboard: rows } } : {};
    await telegram(env, "sendMessage", { chat_id: task.chatId || dataChatId, text: postText, disable_web_page_preview: false, ...keyboard });
    await sendPrivate(env, task.posterId, "✅ Your Instagram post has been approved and published in Star Links!\n\n" + task.url + "\nTask ID: #" + task.id + "\nMembers can now find it in Posts. Please check the bot for updates.");
    return reply(env, chatId, "✅ Task #" + task.id + " approved and published. The poster was notified privately.");
  }
  if (text.startsWith("/reject ") || text === "/reject") {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "Only admins can reject posts.");
    const match = text.match(/^\/reject(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$/s);
    if (!match) return reply(env, chatId, "Format: /reject TASK_ID | reason");
    const dataChatId = taskChatIdFor(chat, env);
    const data = await load(env, dataChatId);
    const task = data.tasks.find(t => t.id === Number(match[1]));
    if (!task) return reply(env, chatId, "I couldn't find that task.");
    if (task.status !== "pending_review") return reply(env, chatId, "This post is not waiting for review. Current status: " + (task.status || "legacy/active") + ".");
    task.status = "rejected";
    task.reviewedAt = dateNow();
    task.reviewedBy = user.id;
    task.reviewReason = match[2].trim().slice(0,300);
    await save(env, dataChatId, data);
    await sendPrivate(env, task.posterId, "❌ Your Instagram post was not approved.\nReason: " + task.reviewReason + "\nYou may correct the issue and submit a valid post link when eligible.");
    return reply(env, chatId, "❌ Task #" + task.id + " rejected. The poster was notified privately.");
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
  if (savesChat(env, chatId) && /#(?:WARNING|IMBACK)\b/i.test(text)) {
    const tags = [...text.matchAll(/#(?:WARNING|IMBACK)\b/gi)].map(m => m[0].toUpperCase());
    const notices = await loadGlobal(env, "savesNotices", []);
    for (const tag of tags) notices.push({ id: notices.length ? Math.max(...notices.map(n => n.id || 0)) + 1 : 1, tag, userId: user.id, name: nameOf(user), chatId, messageId: msg.message_id, text: text.slice(0, 500), at: dateNow() });
    await saveGlobal(env, "savesNotices", notices);
    await reply(env, chatId, "📝 " + tags.join(", ") + " notice recorded for " + displayUser(user) + ". An admin can review it; no warning or penalty was applied automatically.", msg.message_id);
    if (env.WARNING_CHAT_ID) await reply(env, env.WARNING_CHAT_ID, "📌 STAR SAVES NOTICE\nMember: " + displayUser(user) + " (ID " + user.id + ")\nNotice: " + tags.join(", ") + "\nMessage: " + text.slice(0, 300) + "\nRecorded: " + dateNow());
    return;
  }
  // Saves-chat notices are sent to the admin warning desk for review; they do not issue automatic warnings.
  if (savesChat(env, chatId) && /#(?:WARNING|IMBACK)\b/i.test(text)) {
    const kind = /#WARNING\b/i.test(text) ? "WARNING" : "IMBACK";
    const repliedUser = msg.reply_to_message && msg.reply_to_message.from;
    const usernameMatch = text.match(/@([A-Za-z0-9_]{5,32})/);
    const target = repliedUser && !repliedUser.is_bot ? repliedUser : (kind === "IMBACK" ? user : null);
    const targetName = target ? nameOf(target) : (usernameMatch ? "@" + usernameMatch[1] : "Unidentified member");
    const reason = text.replace(/#(?:WARNING|IMBACK)\b/ig, "").trim().slice(0,500);
    const notices = await loadGlobal(env, "savesNotices", []);
    const record = {
      id: notices.length ? Math.max(...notices.map(n => n.id || 0)) + 1 : 1,
      kind, userId: target ? target.id : null, username: usernameMatch ? usernameMatch[1] : (target && target.username) || "",
      name: targetName, reporterId: user.id, reporterName: nameOf(user), reason,
      chatId, messageId: msg.message_id, month: monthKey(), at: dateNow(), status: "pending_admin_review"
    };
    notices.push(record);
    await saveGlobal(env, "savesNotices", notices);
    if (env.WARNING_CHAT_ID) {
      await reply(env, env.WARNING_CHAT_ID,
        (kind === "WARNING" ? "⚠️ SAVES CHAT WARNING FLAG" : "💗 MEMBER RETURNED — #IMBACK") +
        "\nMember: " + targetName + (target && target.id ? " (ID " + target.id + ")" : "") +
        "\nReported by: " + nameOf(user) + "\nDetails: " + (reason || "No additional details") +
        "\nMonth: " + record.month + "\nNotice ID: #" + record.id +
        "\nAction: admin review required. Use /warn USER_ID | reason to issue a formal warning; this tag alone does not issue one.");
    }
    if (kind === "WARNING") {
      return reply(env, chatId, "⚠️ The #WARNING notice has been recorded for admin review. It does not automatically issue a formal warning. Please include the member's @username or reply to their message so admins can identify them.", msg.message_id);
    }
    return reply(env, chatId, "💗 #IMBACK recorded. Welcome back! Open Posts in the private bot and complete your outstanding assigned links, including meaningful comments, likes, and saves. Admins have been notified.", msg.message_id);
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
    await reply(env, chatId, "📸 Saved " + links.length + " Instagram link(s) for admin review. This records the submission; it does not prove likes or saves.", msg.message_id);
    return;
  }
  // Save-chat evidence mode: record incoming images/videos/documents without cluttering the chat with bot replies.
  if (savesChat(env, chatId) && (msg.photo || msg.video || msg.document || msg.animation || msg.video_note)) {
    const evidence = await loadGlobal(env, "evidence", []);
    const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : (msg.video || msg.document || msg.animation || msg.video_note || {}).file_id;
    const type = msg.photo ? "screenshot/photo" : msg.video ? "screen recording/video" : msg.video_note ? "video note" : msg.animation ? "animation" : "document";
    evidence.push({ id: evidence.length ? Math.max(...evidence.map(e => e.id || 0)) + 1 : 1, userId: user.id, name: nameOf(user), chatId, type, fileId, caption: (msg.caption || "").slice(0,300), messageId: msg.message_id, at: dateNow(), status: "pending_review" });
    await saveGlobal(env, "evidence", evidence);
    await reply(env, chatId, "📸 Evidence received (" + type + ") and saved for admin review.", msg.message_id);
    return;
  }
  if (text.startsWith("/tracked") || text.startsWith("/remove")) {
    if (!(await isAdmin(env, chatId, user.id, user.username))) return reply(env, chatId, "This command is available to group admins only.");
    const data = await load(env, taskChatIdFor(chat, env));
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
    const adminDataChatId = chat.type === "private" && env.LINK_CHAT_ID ? env.LINK_CHAT_ID : chatId;
    const data = await load(env, adminDataChatId);
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
  if (text.startsWith("/tasks") || text.startsWith("/posts")) {
    const dataChatId = taskChatIdFor(chat, env);
    const data = await load(env, dataChatId);
    const ownOpen = data.tasks.filter(t => (!t.status || t.status === "approved" || t.status === "active") && String(t.posterId) !== String(user.id) && !data.completions.some(c => c.taskId === t.id && String(c.userId) === String(user.id) && c.comment && c.comment.trim() && c.likesConfirmed && c.saveConfirmed)).slice(-30).reverse();
    return reply(env, chatId, ownOpen.length ? "📋 Your unreported tasks (including overdue posts — please catch up on all of them):\n\n" + ownOpen.map(t => `#${t.id} · ${t.instruction} · posted by ${t.posterName}\n${t.deadline && Date.now() > new Date(t.deadline).getTime() ? "⚠️ OVERDUE — please complete this task" : "⏳ Deadline"}: ${t.deadline ? formatGeorgian(t.deadline) : "Check with an admin"}\n${t.url}`).join("\n\n") : "You have no open tasks recorded here 💗")
  }
  if (text.startsWith("/done")) {
    const match = text.match(/^\/done(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$/s);
    if (!match) return reply(env, chatId, "Format: /done TASK_ID | the meaningful comment you left");
    const taskId = Number(match[1]), comment = match[2].trim();
    const dataChatId = taskChatIdFor(chat, env);
    const data = await load(env, dataChatId);
    const task = data.tasks.find(t => t.id === taskId);
    if (!task) return reply(env, chatId, `I couldn't find task #${taskId} in this chat. Use /tasks.`);
    if (task.posterId === user.id) return reply(env, chatId, "You can't mark your own post as an engagement task you completed.");
    const admin = await isAdmin(env, chatId, user.id, user.username);
    const normalized = comment.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    const generic = GENERIC.has(normalized) || wordCount < 4;
    if (generic && task.instruction !== "EMOJI_ONLY" && !admin) {
      const flag = { id: data.flags.length + 1, chatId, userId: user.id, name: nameOf(user), reason: `Task #${taskId}: possibly short/generic comment: ${comment.slice(0,180)}`, at: dateNow() };
      data.flags.push(flag); await save(env, dataChatId, data);
      return reply(env, chatId, `⚠️ Your completion for task #${taskId} was flagged for admin review because the comment may be too short or generic. Please submit a specific, relevant comment. Likes and saves are still required.`);
    }
    // Record the comment report, but explicitly ask members to confirm likes and saves too.
    const previous = data.completions.find(c => c.taskId === taskId && String(c.userId) === String(user.id));
    data.completions = data.completions.filter(c => !(c.taskId === taskId && String(c.userId) === String(user.id)));
    data.completions.push({ taskId, userId: user.id, name: nameOf(user), comment: comment.slice(0,500), likesConfirmed: !!(previous && previous.likesConfirmed), saveConfirmed: !!(previous && previous.saveConfirmed), at: dateNow(), confirmedAt: previous && previous.confirmedAt });
    await save(env, chatId, data);
    return reply(env, chatId, `💗 Comment report recorded for task #${taskId}.\n\n⚠️ After liking and saving, send /confirm ${taskId} to record those actions too.\n\nThe bot cannot verify Instagram likes or saves directly, so these records are self-reports, not proof.`);
  }
  if (chat.type === "private" && text.startsWith("/profile")) {
    const match = text.match(/^\/profile(?:@\w+)?\s+(https?:\/\/\S+)/i);
    if (!match) return reply(env, chatId, "Format: /profile https://www.instagram.com/yourusername/");
    const profileUrl = cleanInstagramUrl(match[1]);
    if (!/^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/$/i.test(profileUrl)) return reply(env, chatId, "Please send your Instagram profile URL, not a post or Reel URL. Example: /profile https://www.instagram.com/yourusername/");
    const profiles = await loadGlobal(env, "memberProfiles", []);
    const next = profiles.filter(p => String(p.userId) !== String(user.id));
    next.push({ userId: user.id, name: displayUser(user), username: user.username || "", url: profileUrl, at: dateNow() });
    await saveGlobal(env, "memberProfiles", next);
    return reply(env, chatId, "✅ Your Instagram profile has been added to the Members directory. Update it anytime with /profile followed by your new profile URL.");
  }
  if (chat.type === "private") {
    const draft = await loadGlobal(env, "postDraft:" + user.id, null);
    if (draft && draft.state === "awaiting_link" && !text.startsWith("/")) {
      IG_RE.lastIndex = 0;
      const found = (text.match(IG_RE) || []).map(cleanInstagramUrl);
      const postLink = found.find(link => /^https:\/\/www\.instagram\.com\/(?:p|reel|tv)\/[^/]+\/$/i.test(link));
      if (!postLink) return reply(env, chatId, "I couldn't find a valid Instagram post/Reel URL. Please send a direct link such as https://www.instagram.com/p/ABC123/ . You can put comment instructions on the next line.");
      if (!env.LINK_CHAT_ID) return reply(env, chatId, "⚠️ Post submissions are not connected yet. Please ask an admin to configure LINK_CHAT_ID.");
      const data = await load(env, env.LINK_CHAT_ID);
      const limits = await loadGlobal(env, "limits", {});
      if (limits[String(user.id)] && limits[String(user.id)].untilMonth === monthKey()) {
        await saveGlobal(env, "postDraft:" + user.id, null);
        return reply(env, chatId, "⛔ Your posting limit is active because you reached 5 warnings this month. Contact an admin if you need help.");
      }
      const approvals = await loadGlobal(env, "postApprovals", {});
      const approval = approvals[String(user.id)];
      const lastPost = (data.tasks || []).filter(t => String(t.posterId) === String(user.id) && t.status !== "rejected").sort((x,y) => new Date(y.at)-new Date(x.at))[0];
      if (lastPost && Date.now() - new Date(lastPost.at).getTime() < 24*60*60*1000 && !(approval && !approval.used)) {
        const availableAt = new Date(new Date(lastPost.at).getTime() + 24*60*60*1000);
        await saveGlobal(env, "postDraft:" + user.id, null);
        return reply(env, chatId, "⏳ You can submit another post after " + formatGeorgian(availableAt.toISOString()) + ". Contact an admin if you need an exception.");
      }
      if (approval && !approval.used) {
        approvals[String(user.id)] = { ...approval, used: true, usedAt: dateNow() };
        await saveGlobal(env, "postApprovals", approvals);
      }
      const instructionText = text.replace(postLink, "").trim().slice(0,500);
      let instruction = "ALL";
      if (/emoji[- ]only/i.test(instructionText)) instruction = "EMOJI_ONLY";
      else if (/repost.*\bx\b/i.test(instructionText)) instruction = "ALL + REPOST TO X";
      else if (/repost/i.test(instructionText)) instruction = "ALL + REPOST";
      const id = data.nextId++;
      const createdAt = dateNow();
      const deadline = new Date(Date.now() + 24*60*60*1000).toISOString();
      data.tasks.push({ id, chatId: env.LINK_CHAT_ID, messageId: null, url: postLink, instruction, instructionText, posterId: user.id, posterName: displayUser(user), at: createdAt, cycle: georgianCycle(new Date(createdAt)), deadline, status: "pending_review" });
      await save(env, env.LINK_CHAT_ID, data);
      await saveGlobal(env, "postDraft:" + user.id, null);
      if (env.WARNING_CHAT_ID) await reply(env, env.WARNING_CHAT_ID, "🕵️ NEW POST AWAITING REVIEW\nMember: " + displayUser(user) + " (ID " + user.id + ")\nTask: #" + id + "\n" + postLink + (instructionText ? "\nInstructions: " + instructionText : "") + "\nReview with /reviewposts, then /approve " + id + " or /reject " + id + " | reason.");
      return reply(env, chatId, "✅ Your Instagram post was submitted privately for review.\n\n📸 " + postLink + "\nTask ID: #" + id + "\nInstructions: " + (instructionText || "Standard engagement: like, save and leave a meaningful relevant comment.") + "\n\n⏳ Review estimate: 3–5 minutes. This is not automatic verification; an admin must approve the post before it appears in the Links group.\n\nYou may submit another post after: " + formatGeorgian(deadline));
    }
  }
  if (!["group", "supergroup"].includes(chat.type)) return;
  IG_RE.lastIndex = 0;
  const links = text.match(IG_RE);
  if (!links || !user) return;
  const postLinks = links.map(cleanInstagramUrl).filter(link => /^https:\/\/www\.instagram\.com\/(?:p|reel|tv)\/[^/]+\/$/i.test(link));
  if (!postLinks.length) return reply(env, chatId, "🔗 Please share a direct Instagram post, Reel, or IGTV link (for example, instagram.com/p/... or instagram.com/reel/...). Profile links are not accepted. Your message has not been deleted.");
  const data = await load(env, chatId);
  const limits = await loadGlobal(env, "limits", {});
  const currentLimit = limits[String(user.id)];
  if (currentLimit && currentLimit.untilMonth === monthKey()) {
    await reply(env, chatId, `‼️ ${nameOf(user)}, your posting limit is active because you reached 5 warnings this month. You can post again next month. Your message has not been deleted.`, msg.message_id);
    return;
  }
  const approvals = await loadGlobal(env, "postApprovals", {});
  const approval = approvals[String(user.id)];
  const lastPost = data.tasks.filter(t => String(t.posterId) === String(user.id) && t.status !== "rejected").sort((a,b) => new Date(b.at)-new Date(a.at))[0];
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
  const canonicalLinks = [];
  for (const link of postLinks) {
    const clean = cleanInstagramUrl(link);
    canonicalLinks.push(clean);
    const id = data.nextId++;
    const createdAt = dateNow();
    const deadline = new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
    data.tasks.push({ id, chatId, messageId: msg.message_id, url: clean, instruction, posterId: user.id, posterName: nameOf(user), at: createdAt, cycle: georgianCycle(new Date(createdAt)), deadline, status: "pending_review" });
    ids.push("#" + id);
  }
  await save(env, chatId, data);
  const open = data.tasks.filter(t => t.posterId !== user.id && !data.completions.some(c => c.taskId === t.id && c.userId === user.id && c.comment && c.comment.trim() && c.likesConfirmed && c.saveConfirmed));
  const latestTask = data.tasks.find(t => t.id === Number(ids[0].slice(1)));
  const note = `🕵️ Your Instagram post has been received and queued for review.\n\n${canonicalLinks[0]}\nPosted by: ${displayUser(user)}\nTask ID: ${ids.join(", ")}\n\n⏳ Review estimate: 3–5 minutes. This is an estimate, not a guarantee; an admin may need to review it manually.\n\nIf approved, the bot will publish it in Star Links and notify you here. If it is rejected, the bot will send the reason privately. Until approval, it will not appear in members’ assigned Posts list.\n\nYou may submit another post after: ${formatGeorgian(latestTask.deadline)}\nThe bot validates the link format and records the submission; it cannot independently verify Instagram engagement or content availability.`;
  const botUsername = await loadGlobal(env, "botUsername", "");
  // Keep the public Link Chat clean: review details are sent privately and to the admin desk.
  if (env.WARNING_CHAT_ID) await reply(env, env.WARNING_CHAT_ID, "🕵️ NEW POST AWAITING REVIEW\nMember: " + displayUser(user) + " (ID " + user.id + ")\nTask: " + ids.join(", ") + "\n" + canonicalLinks.join("\n") + "\nReview with /reviewposts, then /approve TASK_ID or /reject TASK_ID | reason.");
  const dm = await telegram(env, "sendMessage", { chat_id: user.id, text: note, disable_web_page_preview: true });
  if (!dm.ok) {
    console.error("Could not DM post sharer; they may need to start the bot first.", await dm.text());
  }
  // One compact group acknowledgement with navigation buttons; keep public chatter low.
  const compactRows = botUsername ? [
    [{ text: "📋 Active posts & deadlines", url: "https://t.me/" + botUsername + "?start=posts" }],
    [{ text: "📜 Rules", url: "https://t.me/" + botUsername + "?start=rules" }, { text: "💗 Menu", url: "https://t.me/" + botUsername }]
  ] : [];
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "💗 Link received for admin review. Once approved, it will appear in the active 24-hour list. Use the buttons for posts and rules.",
    reply_to_message_id: msg.message_id,
    disable_web_page_preview: true,
    ...(compactRows.length ? { reply_markup: { inline_keyboard: compactRows } } : {})
  });
}
