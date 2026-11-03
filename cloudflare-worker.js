const TRUSTED_ADMIN_USERNAMES = new Set(["marriaammi", "lizal", "itsimplymartha", "drlamarya"]);
const GENERIC_COMMENTS = new Set(["nice", "nice post", "love it", "i like this product", "great", "great post", "so cute", "amazing", "beautiful", "love this"]);
const IG_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/ig;
const DB_PREFIX = "chat:";
const SAVES_CHAT_ID = "-1003760298679";
const LINKS_CHAT_ID = "-1003167895818";

const IG_ADMINS = [
  ["maarch_27", "https://www.instagram.com/maarch_27/", "marriaammi"],
  ["lizalens__", "https://www.instagram.com/lizalens__/", "lizal"],
  ["itsimplymartha", "https://www.instagram.com/itsimplymartha/", "itsimplymartha"],
  ["dr.lamarya", "https://www.instagram.com/dr.lamarya/", "drlamarya"],
];
const IG_MEMBERS = [
  ["meksssun", "https://www.instagram.com/meksssun/"],
  ["ugc.tako", "https://www.instagram.com/ugc.tako/"],
  ["mariamkha.ugc", "https://www.instagram.com/mariamkha.ugc/"],
  ["niiinuciii", "https://www.instagram.com/niiinuciii/"],
  ["sergeevaaianaaa", "https://www.instagram.com/sergeevaaianaaa/"],
  ["marishkkan", "https://www.instagram.com/marishkkan/"],
  ["tamu__bb", "https://www.instagram.com/tamu__bb/"],
  ["by.marsho", "https://www.instagram.com/by.marsho/"],
  ["sallom_ee", "https://www.instagram.com/sallom_ee/"],
  ["aniardazishvili", "https://www.instagram.com/aniardazishvili/"],
  ["tata.papiashvili", "https://www.instagram.com/tata.papiashvili/"],
  ["kokhre.salluka", "https://www.instagram.com/kokhre.salluka/"],
  ["ugcwithgvantsi", "https://www.instagram.com/ugcwithgvantsi/"],
  ["ddzuguu", "https://www.instagram.com/ddzuguu/"],
  ["sesilia_tr", "https://www.instagram.com/sesilia_tr/"],
  ["ugcketi_", "https://www.instagram.com/ugcketi_/"],
  ["marisa_ugccreator", "https://www.instagram.com/marisa_ugccreator/"],
  ["ildas.way", "https://www.instagram.com/ildas.way/"],
  ["khatia.chargazia", "https://www.instagram.com/khatia.chargazia/"],
  ["teo.createss_", "https://www.instagram.com/teo.createss_/"],
  ["lana_span", "https://www.instagram.com/lana_span/"],
  ["manoni_ugc", "https://www.instagram.com/manoni_ugc/"],
  ["ninuca.ugc", "https://www.instagram.com/ninuca.ugc/"],
  ["tati.mtskerashvili", "https://www.instagram.com/tati.mtskerashvili/"],
  ["taks_ugc", "https://www.instagram.com/taks_ugc/"],
  ["nina_zarnadze", "https://www.instagram.com/nina_zarnadze/"],
  ["marlen__music", "https://www.instagram.com/marlen__music/"],
  ["teona.kurtanidze", "https://www.instagram.com/teona.kurtanidze/"],
  ["__lilluuu", "https://www.instagram.com/__lilluuu/"],
  ["tamaras_style", "https://www.instagram.com/tamaras_style/"],
  ["teokekos_", "https://www.instagram.com/teokekos_/"],
  ["merriem3.14 (please verify)", "https://www.instagram.com/merriem3.14/"],
  ["bbetheaa", "https://www.instagram.com/bbetheaa/"],
  ["itsjeni1212", "https://www.instagram.com/itsjeni1212/"],
  ["sallyna___", "https://www.instagram.com/sallyna___/"],
  ["ugc_eka", "https://www.instagram.com/ugc_eka/"],
  ["tamarcreates", "https://www.instagram.com/tamarcreates/"],
  ["mariam_giorgashvili", "https://www.instagram.com/mariam_giorgashvili/"],
  ["kesanekes", "https://www.instagram.com/kesanekes/"],
];
const CHAT_RULES = `❗️CHAT RULES — PLEASE READ CAREFULLY (RULES HAVE BEEN UPDATED!)
☑ All members must follow every member of the chat.
☑ Admins can choose whether or not to complete links.
☑ Admins are allowed to post up to 2 links/posts.
☑ Only 1 post/link per 24 hours is allowed.
☑ You can post any content, whether it is old or new.
☑ Comments must contain at least 3 words.
☑ If a post requires ALL, comments must contain at least 3 words. Emoji-only comments are not allowed. When sharing a link, mention what the product is about! Bot-like or generic comments are also prohibited.
☑ Engagement on all posts must be completed within 24 hours. Activity will be checked daily!
☑ It does not matter whether you have been inactive and haven’t posted a link for one week or two — you must still complete all outstanding links.
☑ After joining the chat, you must follow all members within 24 hours. Members’ Instagram links are pinned in the links chat. Other members will follow you back within 24 hours. If someone hasn’t followed you back, tag them in the discussion chat.
☑ Saves are posted only on Sundays.
☑ Sunday is our rest day — only saves are allowed to be posted.
‼️ If you do not have your required saves completed within 48 hours, you will be banned from posting links. However, you must continue completing other members’ links.
‼️ After receiving 3 warnings, you must leave the chat. Admins will notify you in advance.
‼️ If you are unable to participate in engagement, you must post a numbered warning using #WARNING.
Example: #WARNING2 I won’t be able to participate in engagement.
Warnings must be numbered consecutively. A maximum of 2 warnings per month is allowed.
📌 SATURDAY RULE
On Saturdays, you may post someone else’s link, but you must clearly label it (Someone else’s link).
You are allowed to post only ONE link in total — either your own link or someone else’s.
📌 RETURNING AFTER INACTIVITY
When you become active again, you must write #IMBACK.
For any links you missed while you were away, you only need to complete the likes and saves.
📌 TELEGRAM & CHAT ETIQUETTE
⭕️ Use the same name on Telegram as the one you use on Instagram.
⭕️ Use the same profile picture on Telegram as the one you use on Instagram.
⭕️ Do not leave generic or bot-like comments such as:
• “Wow”
• “Great”
• “Cool content”
• “I love this content”
• “Great product”
⭕️ Do not write anything in the Saves Chat except warnings and save links. For general conversations, please use the Discussion Chat or the Star Chat space.
⭕️ Sharing paid collaboration opportunities is mandatory. If you do not share paid opportunities with the group, you may be required to leave the chat.
⭕️ You can contact the admins privately at any time if you have questions or concerns.
Thank you for respecting the rules and helping us keep the group fair, active, and supportive for everyone! 💗`;


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
  const setResponse = await telegramApi(env, "setWebhook", {
    url: workerUrl,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ["message", "chat_member", "callback_query"],
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
  const changed = data.members[userId] !== userName;
  data.members[userId] = userName;
  // New members only enter tasks created after the bot first sees them.
  // Do not add them retroactively to links posted before they joined.
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
  if (update.callback_query) return handleMenuCallback(update.callback_query, env);
  if (update.chat_member) return trackMemberUpdate(update.chat_member, env);
  const original = update.message;
  if (!original?.chat) return;
  const isGroup = original.chat.type === "group" || original.chat.type === "supergroup";
  const command = commandOf(original.text || original.caption || "");
  let msg = original;
  if (isGroup && original.from) msg = { ...original, replyChatId: original.chat.id };
  if (!isGroup && original.chat.type === "private" && command && !["/start", "/help"].includes(command)) {
    const groupId = await findMemberGroup(env, original.from?.id);
    if (!groupId) return reply(env, original.chat.id, "Open the engagement group and send any message first so I can connect your private menu.");
    msg = { ...original, chat: { ...original.chat, id: groupId }, replyChatId: original.chat.id };
  }
  const chat = msg.chat;
  const user = original.from;
  const text = original.text || original.caption || "";
  if (isGroup && original.from) {
    const knownGroupData = await loadChat(env, original.chat.id);
    if (rememberMember(knownGroupData, original.chat.id, original.from)) await saveChat(env, original.chat.id, knownGroupData);
  }
  const persistentMenuAction = isGroup ? PERSISTENT_MENU_ACTIONS[text] : null;
  if (persistentMenuAction) return handlePersistentMenu(env, original.chat, persistentMenuAction);
  if (command === "/start" || command === "/help") {
    return sendMenu(env, original.chat.id, isGroup);
  }
  if (command === "/rules") {
    return reply(env, original.chat.id, CHAT_RULES);
  }

  const isGroupContext = isGroup || original.chat.type === "private";
  let groupData;
  let memberChanged = false;
  if (isGroupContext) {
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

  if (!isGroup || !user) return;
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
  await reply(env, msg.replyChatId || chat.id,
    "🔥 Thank you " + nameOf(user) + " for sharing your Instagram post!\n" +
    "✅ Tracked task: " + ids.join(", ") + "\n" +
    "⏳ Complete engagement within 24 hours: " + dueDisplay + "\n" +
    "💗 Everyone: like + save and leave the requested comment (3+ meaningful words unless the post says otherwise).\n" +
    "Use /done TASK_ID | your comment to record completion.", msg.message_id);
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
  if (!rows.length) return reply(env, msg.replyChatId || msg.chat.id, "You have no open tracked tasks assigned to you 💗");
  const lines = ["📋 Your open tasks (deadlines in UTC):"];
  for (const task of rows) lines.push("Task #" + task.id + " · " + task.instruction + " · posted by " + task.posterName + "\nDue: " + task.dueAt + "\n" + task.url);
  return reply(env, msg.replyChatId || msg.chat.id, lines.join("\n\n"));
}

async function done(env, msg) {
  const match = (msg.text || "").match(/^\/done(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$/s);
  if (!match) return reply(env, msg.replyChatId || msg.chat.id, "Format: /done TASK_ID | the meaningful comment you left");
  const taskId = Number(match[1]);
  const comment = match[2].trim();
  const data = await loadChat(env, msg.chat.id);
  const task = data.tasks.find(item => item.id === taskId);
  if (!task) return reply(env, msg.replyChatId || msg.chat.id, "I couldn't find that task in this chat. Use /tasks.");
  if (task.posterId === String(msg.from.id)) return reply(env, msg.replyChatId || msg.chat.id, "You can't report engagement on your own post.");
  if (task.instruction !== "EMOJI_ONLY" && genericOrShort(comment) && !(await isAdmin(env, msg.chat.id, msg.from.id, msg.from.username))) {
    return reply(env, msg.replyChatId || msg.chat.id, "⚠️ Please use at least 3 meaningful words specific to the post, unless the post asks for emojis or another format.");
  }
  const completion = { taskId, userId: String(msg.from.id), userName: nameOf(msg.from), comment: comment.slice(0, 500), at: new Date().toISOString() };
  const existing = data.completions.findIndex(item => item.taskId === taskId && item.userId === completion.userId);
  if (existing >= 0) data.completions[existing] = completion;
  else data.completions.push(completion);
  await saveChat(env, msg.chat.id, data);
  return reply(env, msg.replyChatId || msg.chat.id, "💗 Your completion report for task #" + taskId + " has been recorded.");
}

async function requireAdmin(env, msg) {
  if (await isAdmin(env, msg.chat.id, msg.from.id, msg.from.username)) return true;
  await reply(env, msg.replyChatId || msg.chat.id, "This command is available to group admins only.");
  return false;
}

async function adminPrivateReply(env, msg, text) {
  const userId = msg.from?.id;
  if (userId) {
    const sent = await telegram(env, "sendMessage", { chat_id: userId, text, disable_web_page_preview: true });
    if (sent.data?.ok) return sent;
  }
  return reply(env, msg.replyChatId || msg.chat.id,
    "Please open the tracker bot in a private chat and press Start to receive admin details privately.");
}

async function adminCommand(env, msg) {
  if (!(await requireAdmin(env, msg))) return;
  return reply(env, msg.replyChatId || msg.chat.id,
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
  return reply(env, msg.replyChatId || msg.chat.id,
    "📊 LCS tracker report\nTasks recorded: " + data.tasks.length + "\nOpen task assignments: " + open +
    "\nPending overdue reviews: " + pending + "\nWarnings issued today (UTC): " + warningsToday +
    "\n\nInstagram likes and saves are not independently verified. Overdue tasks require admin review before warnings are issued.");
}

async function review(env, msg) {
  if (!(await requireAdmin(env, msg))) return;
  const data = await loadChat(env, msg.chat.id);
  const rows = data.reviews.filter(item => item.status === "pending").slice(-30).reverse();
  if (!rows.length) return adminPrivateReply(env, msg, "No overdue tasks are waiting for review 💗");
  const lines = ["🔎 Pending overdue-task reviews (not confirmed violations):"];
  for (const item of rows) lines.push("Task #" + item.taskId + " · " + item.userName + " (user ID " + item.userId + ")\n" + item.reason + "\nApprove: /approve " + item.taskId + " " + item.userId + "\nDismiss: /dismiss " + item.taskId + " " + item.userId);
  return reply(env, msg.replyChatId || msg.chat.id, lines.join("\n\n"));
}

async function reviewDecision(env, msg, command) {
  if (!(await requireAdmin(env, msg))) return;
  const parts = (msg.text || "").trim().split(/\s+/);
  if (parts.length !== 3 || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) return reply(env, msg.replyChatId || msg.chat.id, "Format: /approve TASK_ID USER_ID or /dismiss TASK_ID USER_ID");
  const taskId = Number(parts[1]);
  const userId = String(parts[2]);
  const data = await loadChat(env, msg.chat.id);
  const item = data.reviews.find(row => row.taskId === taskId && row.userId === userId && row.status === "pending");
  if (!item) return reply(env, msg.replyChatId || msg.chat.id, "No matching pending review was found.");
  if (command === "/dismiss") {
    item.status = "dismissed";
    item.reviewedAt = new Date().toISOString();
    await saveChat(env, msg.chat.id, data);
    return reply(env, msg.replyChatId || msg.chat.id, "Review dismissed for task #" + taskId + ". No warning was issued.");
  }
  const prior = data.warnings.filter(warning => warning.userId === userId).length;
  const level = Math.min(prior + 1, 3);
  const reason = "Missed 24-hour engagement deadline for task #" + taskId;
  item.status = "confirmed";
  item.reviewedAt = new Date().toISOString();
  data.warnings.push({ userId, userName: item.userName, level, reason, issuedAt: item.reviewedAt, issuedBy: nameOf(msg.from) });
  await saveChat(env, msg.chat.id, data);
  const notice = level === 1 ? "⚠️ First warning" : (level === 2 ? "⚠️ Second warning — repeated missed deadlines are being recorded." : "🚨 FINAL WARNING — further missed deadlines may lead to removal after admin review.");
  const warningText = notice + "\nMember: " + item.userName + "\n" + reason;
  const posted = await telegram(env, "sendMessage", { chat_id: SAVES_CHAT_ID, text: warningText, disable_web_page_preview: true });
  if (!posted.data?.ok) return reply(env, msg.replyChatId || msg.chat.id, "Warning was recorded, but I could not post it in the Saves chat. Check that I’m still in that chat.");
  return reply(env, msg.replyChatId || msg.chat.id, "Warning recorded and posted in the Saves chat.");
}

async function issueManualWarning(env, msg, isFinal) {
  if (!(await requireAdmin(env, msg))) return;
  const match = (msg.text || "").match(/^\/(?:finalwarn|warn)(?:@\w+)?\s+@?(\w+)\s+(.+)$/s);
  if (!match) return reply(env, msg.replyChatId || msg.chat.id, "Format: /warn @username reason");
  const username = "@" + match[1].toLowerCase();
  const reason = match[2].trim();
  const data = await loadChat(env, msg.chat.id);
  const member = Object.entries(data.members).find(([, name]) => name.toLowerCase() === username);
  if (!member) return reply(env, msg.replyChatId || msg.chat.id, "I don't have that member in my tracked roster yet. Ask them to send a message in the group, then try again.");
  const userId = member[0];
  const userName = member[1];
  const prior = data.warnings.filter(warning => warning.userId === userId).length;
  const level = isFinal ? 3 : Math.min(prior + 1, 2);
  data.warnings.push({ userId, userName, level, reason, issuedAt: new Date().toISOString(), issuedBy: nameOf(msg.from) });
  await saveChat(env, msg.chat.id, data);
  const notice = level === 3 ? "🚨 FINAL WARNING" : (level === 2 ? "⚠️ Second warning" : "⚠️ First warning");
  const warningText = notice + "\nMember: " + userName + "\nReason: " + reason;
  const posted = await telegram(env, "sendMessage", { chat_id: SAVES_CHAT_ID, text: warningText, disable_web_page_preview: true });
  if (!posted.data?.ok) return reply(env, msg.replyChatId || msg.chat.id, "Warning was recorded, but I could not post it in the Saves chat. Check that I’m still in that chat.");
  return reply(env, msg.replyChatId || msg.chat.id, "Warning recorded and posted in the Saves chat.");
}

async function trackMemberUpdate(update, env) {
  const chat = update.chat;
  const member = update.new_chat_member;
  if (!chat?.id || !member?.user || !["member", "administrator", "creator", "restricted"].includes(member.status)) return;
  const data = await loadChat(env, chat.id);
  rememberMember(data, chat.id, member.user);
  await saveChat(env, chat.id, data);
  const oldStatus = update.old_chat_member?.status;
  if (!["member", "administrator", "creator", "restricted"].includes(oldStatus)) {
    const name = htmlEscape(nameOf(member.user));
    await telegram(env, "sendMessage", {
      chat_id: chat.id,
      text: welcomeMemberText(chat.id, name),
      parse_mode: "HTML",
      reply_markup: persistentMenuKeyboard(),
    });
  }
}


async function findMemberGroup(env, userId) {
  if (!userId) return null;
  let cursor;
  do {
    const page = await env.LCS_DATA.list({ prefix: DB_PREFIX, cursor, limit: 100 });
    for (const key of page.keys) {
      const data = await loadChat(env, key.name.slice(DB_PREFIX.length));
      if (data.members?.[String(userId)]) return key.name.slice(DB_PREFIX.length);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return null;
}

function menuKeyboard() {
  return { inline_keyboard: [
    [{ text: "📌 Posts", callback_data: "menu:posts:0" }, { text: "👥 Members", callback_data: "menu:list:0" }],
    [{ text: "👑 Admins", callback_data: "menu:admins" }, { text: "💬 Chats", callback_data: "menu:chats" }],
    [{ text: "💾 Saves", callback_data: "menu:saves" }, { text: "📖 Rules", callback_data: "menu:rules" }],
  ] };
}

const PERSISTENT_MENU_ACTIONS = {
  "📌 Posts": "posts",
  "👥 Members": "members",
  "👑 Admins": "admins",
  "💬 Chats": "chats",
  "💾 Saves": "saves",
  "📖 Rules": "rules",
};

function persistentMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "📌 Posts" }, { text: "👥 Members" }],
      [{ text: "👑 Admins" }, { text: "💬 Chats" }],
      [{ text: "💾 Saves" }, { text: "📖 Rules" }],
    ],
    is_persistent: true,
    resize_keyboard: true,
    input_field_placeholder: "Choose a section",
  };
}

function welcomeMemberText(chatId, name) {
  if (String(chatId) === LINKS_CHAT_ID) {
    return "💗 Welcome " + name + " to Star Links — our daily engagement chat!\nLike + save each assigned Instagram post and leave a meaningful comment of at least 3 words. Complete every assigned task; engagement is required and cannot be skipped. Existing members, tap any menu button once to register for task assignments.";
  }
  if (String(chatId) === SAVES_CHAT_ID) {
    return "💗 Welcome " + name + " to Star Saves!\nThis chat is for Sunday save links and #WARNING notices. Daily engagement happens in Star Links.";
  }
  return "💗 Welcome " + name + " to our engagement chat! Use the menu below to get started.";
}

function menuWelcomeText(chatId) {
  if (String(chatId) === LINKS_CHAT_ID) {
    return "💗 Welcome to Star Links — our daily engagement chat!\nLike + save each assigned Instagram post and leave a meaningful comment of at least 3 words. Complete every assigned task; engagement is required and cannot be skipped. Existing members, tap any menu button once to register for task assignments. Use the menu below to view posts, members, admins, and rules.";
  }
  if (String(chatId) === SAVES_CHAT_ID) {
    return "💗 Welcome to Star Saves!\nPost Sunday save links and #WARNING notices here. Daily engagement happens in Star Links. Use the menu below for help.";
  }
  return "💗 Welcome to the LCS Engagement Tracker!\nChoose a section below. Posts show Telegram-tracked links; Instagram likes and saves cannot be checked directly by the bot.";
}

async function sendMenu(env, chatId, isGroup = false) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text: isGroup ? menuWelcomeText(chatId) : "💗 Welcome to the LCS Engagement Tracker!\nChoose a section below. Posts here show Telegram-tracked links; Instagram likes and saves cannot be checked directly by the bot.",
    reply_markup: isGroup ? persistentMenuKeyboard() : menuKeyboard(),
    disable_web_page_preview: true,
  });
}

function menuPageButtons(action, page, pageCount) {
  const nav = [];
  if (page > 0) nav.push({ text: "← Previous", callback_data: "menu:" + action + ":" + (page - 1) });
  if (page + 1 < pageCount) nav.push({ text: "Next →", callback_data: "menu:" + action + ":" + (page + 1) });
  return { inline_keyboard: [nav, [{ text: "🏠 Menu", callback_data: "menu:home" }]].filter(row => row.length) };
}

async function handlePersistentMenu(env, chat, action) {
  let text;
  let replyMarkup = menuKeyboard();

  if (action === "rules") {
    text = CHAT_RULES;
  } else if (action === "admins") {
    text = "👑 <b>Admins — follow or message</b>\n" + IG_ADMINS.map(([name, url, telegramUsername]) =>
      "• <a href=\"" + url + "\">@" + htmlEscape(name) + "</a> · <a href=\"https://t.me/" + telegramUsername + "\">Message on Telegram</a>"
    ).join("\n") + "\n\nUse the Instagram link to follow an admin, or the Telegram link to contact them.";
  } else if (action === "members") {
    const page = 0;
    const pageSize = 10;
    const rows = IG_MEMBERS.slice(0, pageSize);
    const pageCount = Math.max(1, Math.ceil(IG_MEMBERS.length / pageSize));
    text = rows.length
      ? "👥 <b>Members to follow</b> · page 1/" + pageCount + "\n\n" + rows.map(([name, url]) => "• <a href=\"" + url + "\">@"+ htmlEscape(name) + "</a>").join("\n")
      : "👥 No member links are listed yet.";
    replyMarkup = menuPageButtons("list", page, pageCount);
  } else if (action === "posts") {
    const data = await loadChat(env, chat.id);
    const tasks = [...(data.tasks || [])].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const pageSize = 8;
    const pageCount = Math.max(1, Math.ceil(tasks.length / pageSize));
    const rows = tasks.slice(0, pageSize);
    text = rows.length
      ? "📌 <b>Tracked posts</b> · page 1/" + pageCount + "\n\n" + rows.map(task =>
          "Task #" + task.id + " · " + htmlEscape(task.posterName || "member") + " · " + htmlEscape(task.instruction) +
          "\nDue: " + htmlEscape(task.dueAt) + "\n<a href=\"" + htmlEscape(task.url) + "\">Open Instagram post</a>"
        ).join("\n\n") + "\n\nUse /tasks to see your assignments or /done TASK_ID | your comment to report completion."
      : "📌 No tasks yet. The bot starts tracking new Instagram links posted here; older messages from before setup are not imported.";
    replyMarkup = menuPageButtons("posts", 0, pageCount);
  } else if (action === "chats") {
    text = "💬 <b>Tracker menu</b>\nThis group is connected. Use Posts to see tracked links, Members to open Instagram profiles, and Admins to contact an admin.";
  } else if (action === "saves") {
    text = "💾 <b>Saves Chat</b>\nPost Sunday save links and #WARNING notices in the Saves chat. Likes and saves cannot be checked directly by the bot.";
    replyMarkup = {
      inline_keyboard: [
        ...(env.SAVES_CHAT_INVITE_URL ? [[{ text: "💾 Open Saves Chat", url: env.SAVES_CHAT_INVITE_URL }]] : []),
        [{ text: "🏠 Menu", callback_data: "menu:home" }],
      ],
    };
  }

  return telegram(env, "sendMessage", {
    chat_id: chat.id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

function htmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function handleMenuCallback(query, env) {
  const userId = query.from?.id;
  const data = query.data || "";
  await telegram(env, "answerCallbackQuery", { callback_query_id: query.id });
  if (!query.message || !userId) return;
  const chatId = query.message.chat.id;
  let body = "💗 LCS Engagement Tracker";
  let keyboard = menuKeyboard();
  if (data === "menu:rules") body = CHAT_RULES;
  else if (data === "menu:admins") {
    body = "👑 <b>Admins — follow or message</b>\n" + IG_ADMINS.map(([name, url, telegramUsername]) =>
      "• <a href=\"" + url + "\">@" + htmlEscape(name) + "</a> · <a href=\"https://t.me/" + telegramUsername + "\">Message on Telegram</a>"
    ).join("\n") + "\n\nUse the Instagram link to follow an admin, or the Telegram link to contact them.";
  } else if (data.startsWith("menu:list:")) {
    const page = Math.max(0, Number(data.split(":")[2]) || 0);
    const pageSize = 10;
    const start = page * pageSize;
    const rows = IG_MEMBERS.slice(start, start + pageSize);
    body = "👥 <b>Members to follow</b> · page " + (page + 1) + "/" + Math.ceil(IG_MEMBERS.length / pageSize) +
      "\n\n" + rows.map(([name, url]) => "• <a href=\"" + url + "\">@" + htmlEscape(name) + "</a>").join("\n");
    const nav = [];
    if (page > 0) nav.push({ text: "← Previous", callback_data: "menu:list:" + (page - 1) });
    if (start + pageSize < IG_MEMBERS.length) nav.push({ text: "Next →", callback_data: "menu:list:" + (page + 1) });
    keyboard = { inline_keyboard: [nav, [{ text: "🏠 Menu", callback_data: "menu:home" }]].filter(row => row.length) };
  } else if (data.startsWith("menu:posts")) {
    const requestedPage = Math.max(0, Number(data.split(":")[2]) || 0);
    const tasks = [];
    if (query.message.chat.type === "private") {
      let cursor;
      do {
        const page = await env.LCS_DATA.list({ prefix: DB_PREFIX, cursor, limit: 100 });
        for (const key of page.keys) {
          const chatData = await loadChat(env, key.name.slice(DB_PREFIX.length));
          for (const task of chatData.tasks || []) tasks.push(task);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    } else {
      const chatData = await loadChat(env, chatId);
      tasks.push(...(chatData.tasks || []));
    }
    tasks.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const pageSize = 8;
    const pageCount = Math.max(1, Math.ceil(tasks.length / pageSize));
    const pageNumber = Math.min(requestedPage, pageCount - 1);
    const rows = tasks.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize);
    if (rows.length) {
      body = "📌 <b>Tracked posts</b> · page " + (pageNumber + 1) + "/" + pageCount + "\n\n" +
        rows.map(task =>
          "Task #" + task.id + " · " + htmlEscape(task.posterName || "member") + " · " + htmlEscape(task.instruction) +
          "\nDue: " + htmlEscape(task.dueAt) + "\n<a href=\"" + htmlEscape(task.url) + "\">Open Instagram post</a>").join("\n\n") +
          "\n\nUse <code>/tasks</code> for your assignments or <code>/done TASK_ID | your comment</code> to report completion.";
      const nav = [];
      if (pageNumber > 0) nav.push({ text: "← Previous", callback_data: "menu:posts:" + (pageNumber - 1) });
      if (pageNumber + 1 < pageCount) nav.push({ text: "Next →", callback_data: "menu:posts:" + (pageNumber + 1) });
      keyboard = { inline_keyboard: [nav, [{ text: "🏠 Menu", callback_data: "menu:home" }]].filter(row => row.length) };
    } else {
      body = "📌 No Telegram post tasks have been recorded yet. Share an Instagram link in this group to create a task.";
    }
  } else if (data === "menu:chats") {
    let cursor;
    const chats = [];
    do {
      const page = await env.LCS_DATA.list({ prefix: DB_PREFIX, cursor, limit: 100 });
      for (const key of page.keys) chats.push(key.name.slice(DB_PREFIX.length));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    body = chats.length
      ? "💬 <b>Connected Telegram chats</b>\n" + chats.length + " chat(s) have tracker data. Use /tasks or /done in the chat where you posted the link.\n\nPrivate invite links are not stored by the bot."
      : "💬 No Telegram engagement chat has connected to the tracker yet.";
  } else if (data === "menu:saves") {
    body = "💾 <b>Saves Chat</b>\nPost your Sunday save links and #WARNING notices here. The bot cannot access your private Instagram Saved folder or verify screenshots automatically.";
    keyboard = {
      inline_keyboard: [
        ...(env.SAVES_CHAT_INVITE_URL ? [[{ text: "💾 Open Saves Chat", url: env.SAVES_CHAT_INVITE_URL }]] : []),
        [{ text: "🏠 Menu", callback_data: "menu:home" }],
      ],
    };
  } else if (data === "menu:home") {
    body = "💗 Welcome to the LCS Engagement Tracker!\nChoose a section below. Posts here show Telegram-tracked links; Instagram likes and saves cannot be checked directly by the bot.";
  }
  const call = await telegram(env, "editMessageText", {
    chat_id: chatId, message_id: query.message.message_id, text: body,
    parse_mode: "HTML", disable_web_page_preview: true, reply_markup: keyboard,
  });
  if (!call.data?.ok) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: body.replace(/<[^>]+>/g, ""), reply_markup: keyboard, disable_web_page_preview: true });
  }
}

function parisLocalTime(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value;
  return { weekday: value("weekday"), hour: Number(value("hour")), minute: Number(value("minute")) };
}

async function nightlyReview(env) {
  const now = new Date();
  const paris = parisLocalTime(now);
  if (paris.hour !== 20 || paris.minute !== 0) return;
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
