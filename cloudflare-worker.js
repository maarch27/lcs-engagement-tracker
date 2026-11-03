const TRUSTED_ADMIN_USERNAMES = new Set(["marriaammi", "lizal", "itsimplymartha", "drlamarya"]);
const GENERIC_COMMENTS = new Set(["nice", "nice post", "love it", "i like this product", "great", "great post", "so cute", "amazing", "beautiful", "love this"]);
const IG_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/ig;
const DB_PREFIX = "chat:";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/setup" && request.method === "GET") {
      return handleSetup(url, env);
    }
    if (request.method !== "POST") return new Response("LCS Engagement Tracker webhook is ready.");
    if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    let update;
    try { update = await request.json(); }
    catch { return new Response("Bad JSON", { status: 400 }); }
    try { await handleUpdate(update, env); }
    catch (error) { console.error("Update failed", error?.message || "unknown error"); }
    return new Response("OK");
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(nightlyReview(env));
  },
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function handleSetup(url, env) {
  if (!env.SETUP_KEY || url.searchParams.get("key") !== env.SETUP_KEY) return new Response("Not found", { status: 404 });
  if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET || !env.LCS_DATA) return new Response("Missing required Worker secrets or LCS_DATA binding.", { status: 500 });
  const action = url.searchParams.get("action") || "status";
  const infoResponse = await telegramApi(env, "getWebhookInfo");
  const info = infoResponse.data;
  if (!infoResponse.ok || !info?.ok) return json({ ok: false, error: "Telegram could not return webhook status." }, 502);
  const existingUrl = info.result?.url || "";
  const workerUrl = url.origin + "/";
  if (action !== "register") {
    return json({ ok: true, configured: Boolean(existingUrl), matchesThisWorker: existingUrl === workerUrl, urlHost: safeHost(existingUrl), pendingUpdates: info.result?.pending_update_count || 0 });
  }
  if (existingUrl && existingUrl !== workerUrl) {
    return json({ ok: false, reason: "A different webhook is already configured. No changes were made.", urlHost: safeHost(existingUrl) }, 409);
  }
  if (existingUrl === workerUrl) return json({ ok: true, alreadyConfigured: true, urlHost: safeHost(existingUrl) });
  const setResponse = await telegramApi(env, "setWebhook", {
    url: workerUrl,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ["message", "chat_member"],
  });
  return json(setResponse.data, setResponse.status);
}

function safeHost(value) {
  try { return value ? new URL(value).host : ""; }
  catch { return ""; }
}

async function telegramApi(env, method, payload) {
  const options = payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {};
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, options);
  let data = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !data.ok) console.error("Telegram API error", method, data.description || response.status);
  return { ok: response.ok, status: response.status, data };
}

async function telegram(env, method, payload) {
  return telegramApi(env, method, payload);
}

async function reply(env, chatId, text, replyTo) {
  const payload = { chat_id: chatId, text, disable_web_page_preview: true };
  if (replyTo) payload.reply_to_message_id = replyTo;
  await telegram(env, "sendMessage", payload);
}

function emptyChat() {
  return { nextTaskId: 1, nextReviewId: 1, members: {}, tasks: [], completions: [], reviews: [], warnings: [] };
}

async function loadChat(env, chatId) {
  return await env.LCS_DATA.get(DB_PREFIX + chatId, "json") || emptyChat();
}

async function saveChat(env, chatId, data) {
  await env.LCS_DATA.put(DB_PREFIX + chatId, JSON.stringify(data));
}

function nameOf(user) {
  return user?.username ? "@" + user.username : (user?.first_name || user?.full_name || String(user?.id || "member"));
}

function normalizeComment(text) {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim().replace(/\s+/g, " ");
}

function genericOrShort(comment) {
  const normalized = normalizeComment(comment);
  return GENERIC_COMMENTS.has(normalized) || normalized.split(" ").filter(Boolean).length < 3;
}

function hasCompletion(data, taskId, userId) {
  return data.completions.some(item => item.taskId === taskId && String(item.userId) === String(userId));
}

function hasReview(data, taskId, userId) {
  return data.reviews.some(item => item.taskId === taskId && String(item.userId) === String(userId));
}

function rememberMember(data, chatId, user) {
  if (!user || user.is_bot) return false;
  const userId = String(user.id);
  const userName = nameOf(user);
  let changed = data.members[userId] !== userName;
  data.members[userId] = userName;
  const now = Date.now();
  for (const task of data.tasks) {
    if (task.chatId !== String(chatId) || task.posterId === userId || Date.parse(task.dueAt) <= now || hasCompletion(data, task.id, userId)) continue;
    if (!task.targets.some(target => target.userId === userId)) {
      task.targets.push({ userId, userName });
      changed = true;
    }
  }
  return changed;
}

async function isAdmin(env, chatId, userId, username) {
  const normalized = (username || "").replace(/^@/, "").toLowerCase();
  if (TRUSTED_ADMIN_USERNAMES.has(normalized)) return true;
  try {
    const result = await telegram(env, "getChatMember", { chat_id: chatId, user_id: userId });
    return result.data?.ok && ["administrator", "creator"].includes(result.data.result?.status);
  } catch { return false; }
}

function commandOf(text) {
  const first = (text || "").trim().split(/\s+/, 1)[0];
  return first.split("@")[0].toLowerCase();
}

async function handleUpdate(update, env) {
  if (update.chat_member) return trackMemberUpdate(update.chat_member, env);
  const msg = update.message;
  if (!msg?.chat) return;
  const chat = msg.chat;
  const user = msg.from;
  const text = msg.text || msg.caption || "";
  const command = commandOf(text);
  if (command === "/start" || command === "/help") {
    return reply(env, chat.id,
      "💗 LCS Engagement Tracker is online.\n\n" +
      "Instagram links shared in this group become tasks with a rolling 24-hour deadline. " +
      "After the deadline, missing completion reports are sent privately and placed in an admin review queue.\n\n" +
      "Commands: /rules /tasks /done /report /review /approve /dismiss /warn /finalwarn /admin\n\n" +
      "Open this private chat and press Start to receive private reminders. The bot cannot verify Instagram likes or saves.");
  }
  if (command === "/rules") return rules(env, chat.id);

  const isGroup = chat.type === "group" || chat.type === "supergroup";
  let groupData;
  let memberChanged = false;
  if (isGroup) {
    groupData = await loadChat(env, chat.id);
    memberChanged = rememberMember(groupData, chat.id, user);
  }

  if (command === "/tasks") {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return listTasks(env, msg);
  }
  if (command === "/done") {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return done(env, msg);
  }
  if (command === "/admin") {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return adminCommand(env, msg);
  }
  if (command === "/report") {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return report(env, msg);
  }
  if (command === "/review") {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return review(env, msg);
  }
  if (command === "/approve" || command === "/dismiss") {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return reviewDecision(env, msg, command);
  }
  if (command === "/warn" || command === "/finalwarn") {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return issueManualWarning(env, msg, command === "/finalwarn");
  }

  if (!["group", "supergroup"].includes(chat.type) || !user) return;
  const matches = text.match(IG_RE);
  if (!matches?.length) {
    if (memberChanged) await saveChat(env, chat.id, groupData);
    return;
  }
  const data = groupData;
  let instruction = "ALL";
  const lowered = text.toLowerCase();
  if (lowered.includes("emoji only") || lowered.includes("emoji-only")) instruction = "EMOJI_ONLY";
  else if (lowered.includes("repost to x") || lowered.includes("repost on x")) instruction = "ALL + REPOST TO X";
  else if (lowered.includes("repost")) instruction = "ALL + REPOST";
  const createdAt = new Date(Number(msg.date || Math.floor(Date.now() / 1000)) * 1000);
  const dueAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const ids = [];
  for (const match of matches) {
    const cleanUrl = match.replace(/[.,!?\)\]\}]+$/g, "");
    const task = {
      id: data.nextTaskId++, chatId: String(chat.id), messageId: msg.message_id,
      url: cleanUrl, instruction, posterId: String(user.id), posterName: nameOf(user),
      createdAt: createdAt.toISOString(), dueAt, targets: [],
    };
    for (const [memberId, memberName] of Object.entries(data.members)) {
      if (memberId !== task.posterId) task.targets.push({ userId: memberId, userName: memberName });
    }
    data.tasks.push(task);
    ids.push("#" + task.id);
  }
  await saveChat(env, chat.id, data);
  const dueDisplay = dueAt.replace("T", " ").replace(".000Z", " UTC");
  await reply(env, chat.id,
    "📌 Telegram link task created: " + ids.join(", ") + "\nInstruction: " + instruction +
    "\n24-hour deadline: " + dueDisplay + "\nPlease like + save and leave the requested comment.\n" +
    "Report with /done TASK_ID | your comment. Instagram likes and saves are not independently verified.", msg.message_id);
}

async function rules(env, chatId) {
  return reply(env, chatId,
    "💗 LCS engagement rules\n" +
    "1. Engage with links shared in this Telegram group within 24 hours of the link being posted.\n" +
    "2. Like and save the Instagram post and leave a relevant comment.\n" +
    "3. Unless the post says otherwise, comments should contain at least 3 meaningful words.\n" +
    "4. Follow specific instructions, including exact emoji requests.\n" +
    "5. Report with /done TASK_ID | the comment you left. This is a self-report, not proof of likes/saves.\n" +
    "6. Overdue tasks are queued for admin review; warnings are not automatic.");
}

async function listTasks(env, msg) {
  const data = await loadChat(env, msg.chat.id);
  const userId = String(msg.from.id);
  const rows = data.tasks.filter(task => task.targets.some(target => target.userId === userId) && !hasCompletion(data, task.id, userId)).slice(-30).reverse();
  if (!rows.length) return reply(env, msg.chat.id, "You have no open tracked tasks assigned to you 💗");
  const lines = ["📋 Your open tasks (deadlines in UTC):"];
  for (const task of rows) lines.push("Task #" + task.id + " · " + task.instruction + " · posted by " + task.posterName + "\nDue: " + task.dueAt + "\n" + task.url);
  return reply(env, msg.chat.id, lines.join("\n\n"));
}

async function done(env, msg) {
  const match = (msg.text || "").match(/^\/done(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$/s);
  if (!match) return reply(env, msg.chat.id, "Format: /done TASK_ID | the meaningful comment you left");
  const taskId = Number(match[1]);
  const comment = match[2].trim();
  const data = await loadChat(env, msg.chat.id);
  const task = data.tasks.find(item => item.id === taskId);
  if (!task) return reply(env, msg.chat.id, "I couldn't find that task in this chat. Use /tasks.");
  if (task.posterId === String(msg.from.id)) return reply(env, msg.chat.id, "You can't report engagement on your own post.");
  if (task.instruction !== "EMOJI_ONLY" && genericOrShort(comment) && !(await isAdmin(env, msg.chat.id, msg.from.id, msg.from.username))) {
    return reply(env, msg.chat.id, "⚠️ Please use at least 3 meaningful words specific to the post, unless the post asks for emojis or another format.");
  }
  const completion = { taskId, userId: String(msg.from.id), userName: nameOf(msg.from), comment: comment.slice(0, 500), at: new Date().toISOString() };
  const existing = data.completions.findIndex(item => item.taskId === taskId && item.userId === completion.userId);
  if (existing >= 0) data.completions[existing] = completion;
  else data.completions.push(completion);
  await saveChat(env, msg.chat.id, data);
  return reply(env, msg.chat.id, "💗 Self-report recorded for task #" + taskId + ". This does not independently verify the Instagram like or save.");
}

async function requireAdmin(env, msg) {
  if (await isAdmin(env, msg.chat.id, msg.from.id, msg.from.username)) return true;
  await reply(env, msg.chat.id, "This command is available to group admins only.");
  return false;
}

async function adminCommand(env, msg) {
  if (!(await requireAdmin(env, msg))) return;
  return reply(env, msg.chat.id,
    "🛠 Admin commands\n/review — pending overdue-task reviews\n" +
    "/approve TASK_ID USER_ID — confirm miss and issue next warning\n" +
    "/dismiss TASK_ID USER_ID — dismiss review\n/warn @username reason\n/finalwarn @username reason\n" +
    "/report — tracker summary\n\nNo member is automatically removed, and posts are never auto-deleted.");
}

async function report(env, msg) {
  if (!(await requireAdmin(env, msg))) return;
  const data = await loadChat(env, msg.chat.id);
  const pending = data.reviews.filter(item => item.status === "pending").length;
  const open = data.tasks.reduce((count, task) => count + task.targets.filter(target => !hasCompletion(data, task.id, target.userId)).length, 0);
  const today = new Date().toISOString().slice(0, 10);
  const warningsToday = data.warnings.filter(item => item.issuedAt.startsWith(today)).length;
  return reply(env, msg.chat.id,
    "📊 LCS tracker report\nTasks recorded: " + data.tasks.length + "\nOpen task assignments: " + open +
    "\nPending overdue reviews: " + pending + "\nWarnings issued today (UTC): " + warningsToday +
    "\n\nInstagram likes and saves are not independently verified. Overdue tasks require admin review before warnings are issued.");
}

async function review(env, msg) {
  if (!(await requireAdmin(env, msg))) return;
  const data = await loadChat(env, msg.chat.id);
  const rows = data.reviews.filter(item => item.status === "pending").slice(-30).reverse();
  if (!rows.length) return reply(env, msg.chat.id, "No overdue tasks are waiting for review 💗");
  const lines = ["🔎 Pending overdue-task reviews (not confirmed violations):"];
  for (const item of rows) lines.push("Task #" + item.taskId + " · " + item.userName + " (user ID " + item.userId + ")\n" + item.reason + "\nApprove: /approve " + item.taskId + " " + item.userId + "\nDismiss: /dismiss " + item.taskId + " " + item.userId);
  return reply(env, msg.chat.id, lines.join("\n\n"));
}

async function reviewDecision(env, msg, command) {
  if (!(await requireAdmin(env, msg))) return;
  const parts = (msg.text || "").trim().split(/\s+/);
  if (parts.length !== 3 || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) return reply(env, msg.chat.id, "Format: /approve TASK_ID USER_ID or /dismiss TASK_ID USER_ID");
  const taskId = Number(parts[1]);
  const userId = String(parts[2]);
  const data = await loadChat(env, msg.chat.id);
  const item = data.reviews.find(row => row.taskId === taskId && row.userId === userId && row.status === "pending");
  if (!item) return reply(env, msg.chat.id, "No matching pending review was found.");
  if (command === "/dismiss") {
    item.status = "dismissed";
    item.reviewedAt = new Date().toISOString();
    await saveChat(env, msg.chat.id, data);
    return reply(env, msg.chat.id, "Review dismissed for task #" + taskId + ". No warning was issued.");
  }
  const prior = data.warnings.filter(warning => warning.userId === userId).length;
  const level = Math.min(prior + 1, 3);
  const reason = "Missed 24-hour engagement deadline for task #" + taskId;
  item.status = "confirmed";
  item.reviewedAt = new Date().toISOString();
  data.warnings.push({ userId, userName: item.userName, level, reason, issuedAt: item.reviewedAt, issuedBy: nameOf(msg.from) });
  await saveChat(env, msg.chat.id, data);
  const notice = level === 1 ? "⚠️ First warning" : (level === 2 ? "⚠️ Second warning — repeated missed deadlines are being recorded." : "🚨 FINAL WARNING — further missed deadlines may lead to removal after admin review.");
  return reply(env, msg.chat.id, notice + "\nMember: " + item.userName + "\n" + reason);
}

async function issueManualWarning(env, msg, isFinal) {
  if (!(await requireAdmin(env, msg))) return;
  const match = (msg.text || "").match(/^\/(?:finalwarn|warn)(?:@\w+)?\s+@?(\w+)\s+(.+)$/s);
  if (!match) return reply(env, msg.chat.id, "Format: /warn @username reason");
  const username = "@" + match[1].toLowerCase();
  const reason = match[2].trim();
  const data = await loadChat(env, msg.chat.id);
  const member = Object.entries(data.members).find(([, name]) => name.toLowerCase() === username);
  if (!member) return reply(env, msg.chat.id, "I don't have that member in my tracked roster yet. Ask them to send a message in the group, then try again.");
  const userId = member[0];
  const userName = member[1];
  const prior = data.warnings.filter(warning => warning.userId === userId).length;
  const level = isFinal ? 3 : Math.min(prior + 1, 2);
  data.warnings.push({ userId, userName, level, reason, issuedAt: new Date().toISOString(), issuedBy: nameOf(msg.from) });
  await saveChat(env, msg.chat.id, data);
  const notice = level === 3 ? "🚨 FINAL WARNING" : (level === 2 ? "⚠️ Second warning" : "⚠️ First warning");
  return reply(env, msg.chat.id, notice + "\nMember: " + userName + "\nReason: " + reason);
}

async function trackMemberUpdate(update, env) {
  const chat = update.chat;
  const member = update.new_chat_member;
  if (!chat?.id || !member?.user || !["member", "administrator", "creator", "restricted"].includes(member.status)) return;
  const data = await loadChat(env, chat.id);
  rememberMember(data, chat.id, member.user);
  await saveChat(env, chat.id, data);
}

function georgiaHour(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tbilisi", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Number(parts.find(part => part.type === "hour")?.value);
}

async function nightlyReview(env) {
  const now = new Date();
  if (georgiaHour(now) !== 20) return;
  let cursor;
  do {
    const page = await env.LCS_DATA.list({ prefix: DB_PREFIX, cursor, limit: 100 });
    for (const key of page.keys) {
      const chatId = key.name.slice(DB_PREFIX.length);
      const data = await loadChat(env, chatId);
      let changed = false;
      const reminders = [];
      for (const task of data.tasks) {
        if (Date.parse(task.dueAt) > now.getTime()) continue;
        for (const target of task.targets) {
          if (hasCompletion(data, task.id, target.userId) || hasReview(data, task.id, target.userId)) continue;
          const item = {
            id: data.nextReviewId++, taskId: task.id, userId: target.userId, userName: target.userName,
            reason: "No completion report for task #" + task.id + " after the 24-hour deadline. This is not proof that the Instagram actions were skipped.",
            status: "pending", createdAt: now.toISOString(), reminderAttempted: true,
          };
          data.reviews.push(item);
          reminders.push({ chatId, item, task });
          changed = true;
        }
      }
      if (changed) await saveChat(env, chatId, data);
      for (const { item, task } of reminders) await sendPrivateReminder(env, chatId, item, task);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function sendPrivateReminder(env, chatId, item, task) {
  const memberCheck = await telegram(env, "getChatMember", { chat_id: chatId, user_id: item.userId });
  const isNativeAdmin = memberCheck.data?.ok && ["administrator", "creator"].includes(memberCheck.data.result?.status);
  const isTrustedAdmin = item.userName.replace(/^@/, "").toLowerCase() && TRUSTED_ADMIN_USERNAMES.has(item.userName.replace(/^@/, "").toLowerCase());
  let text;
  if (isNativeAdmin || isTrustedAdmin) {
    text = "💗 Hey " + item.userName + "! Friendly admin reminder\n\n" +
      "Thank you for helping run the community! Admins are also expected to support members by engaging with their posts, even when admins have their own posting allowance.\n\n" +
      "Task #" + task.id + " is past its 24-hour deadline.\nLink: " + task.url + "\nInstructions: " + task.instruction + "\n\n" +
      "Please check whether you completed the requested like, save, and comment. If you did, use /done TASK_ID | your comment in the engagement group.\n\n" +
      "This is a private reminder because no completion report was found; it is not a verified accusation. The bot cannot independently verify Instagram likes or saves.";
  } else {
    text = "💗 Hey " + item.userName + "! LCS Engagement Tracker reminder\n\n" +
      "Task #" + task.id + " is past its 24-hour deadline.\nLink: " + task.url + "\nInstructions: " + task.instruction + "\n\n" +
      "Please check whether you completed all requested actions (like, save, and the requested comment). If you completed them, use /done TASK_ID | your comment in the engagement group. If you missed something, complete it if still possible and let an admin know.\n\n" +
      "This is a private reminder because no completion report was found, not a verified accusation. The bot cannot independently verify Instagram likes or saves.";
  }
  const result = await telegram(env, "sendMessage", { chat_id: item.userId, text, disable_web_page_preview: true });
  if (!result.data?.ok) console.info("Private reminder could not be delivered; member may need to start the bot first.");
}
