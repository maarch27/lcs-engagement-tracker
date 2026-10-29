const GENERIC = new Set(["nice", "nice post", "love it", "i like this product", "great", "great post", "so cute", "amazing", "beautiful", "love this"]);
const IG_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/ig;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("LCS Engagement Tracker webhook is ready.");
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
async function isAdmin(env, chatId, userId) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${chatId}&user_id=${userId}`);
    const j = await r.json();
    return j.ok && ["administrator", "creator"].includes(j.result.status);
  } catch { return false; }
}
async function load(env, chatId) {
  return await env.LCS_DATA.get(`chat:${chatId}`, "json") || { tasks: [], completions: [], flags: [], nextId: 1 };
}
async function save(env, chatId, data) {
  await env.LCS_DATA.put(`chat:${chatId}`, JSON.stringify(data));
}
function nameOf(user) { return user.username ? "@" + user.username : (user.first_name || "member"); }
function dateNow() { return new Date().toISOString(); }

async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;
  const chat = msg.chat, user = msg.from;
  const chatId = chat.id;
  const text = msg.text || msg.caption || "";
  if (text.startsWith("/start") || text.startsWith("/help")) {
    return reply(env, chatId,
      "💗 LCS Engagement Tracker\n\n/rules — community rules\n/tasks — your unreported tasks\n/done TASK_ID | meaningful comment — self-report completion\n/report — admin daily report\n/flags — admin review queue\n/admin — admin controls\n\nLikes and saves are required, but Telegram cannot independently verify them. Admins can post normally; the bot does not delete posts or automatically ban anyone.");
  }
  if (text.startsWith("/rules")) {
    return reply(env, chatId,
      "💗 LCS engagement rules\n1. Like and save each assigned post.\n2. Leave a genuine, relevant comment following the post instructions.\n3. If no special instruction is given, leave a meaningful comment.\n4. Emoji-only comments are acceptable only when explicitly requested.\n5. Avoid generic comments.\n6. Report with /done TASK_ID | your comment.\n\nCompletion is self-reported; likes/saves cannot be independently verified. Admins review flags manually.");
  }
  if (text.startsWith("/admin") || text.startsWith("/report") || text.startsWith("/flags")) {
    if (!(await isAdmin(env, chatId, user.id))) return reply(env, chatId, "This command is available to group admins only.");
    const data = await load(env, chatId);
    if (text.startsWith("/admin")) return reply(env, chatId,
      "🛠 Admin controls\n/report — daily task and completion summary\n/flags — latest 20 flags for manual review\n\nAdmins can post freely. The bot never auto-deletes admin messages or auto-bans members. Flags are review prompts, not proof. Instagram likes/saves are not independently verified.");
    if (text.startsWith("/flags")) {
      const rows = data.flags.slice(-20).reverse();
      return reply(env, chatId, rows.length ? "🔎 Recent flags (manual review):\n\n" + rows.map(f => `Flag #${f.id} · ${f.name}\n${f.reason}\n${f.at}`).join("\n\n") + "\n\nNo automatic bans are applied." : "No flagged comments to review 💗");
    }
    const today = new Date().toISOString().slice(0, 10);
    const taskCount = data.tasks.filter(t => t.at.slice(0,10) === today).length;
    const doneCount = data.completions.filter(c => c.at.slice(0,10) === today).length;
    const openCount = data.tasks.filter(t => !data.completions.some(c => c.taskId === t.id)).length;
    const flags = data.flags.filter(f => f.at.slice(0,10) === today);
    return reply(env, chatId, `📊 LCS daily report (UTC)\nTasks posted today: ${taskCount}\nCompletion self-reports today: ${doneCount}\nUnreported task entries: ${openCount}\nFlags today: ${flags.length}\n\nCompletion is self-reported; likes/saves are not independently verified.`);
  }
  if (text.startsWith("/tasks")) {
    const data = await load(env, chatId);
    const ownOpen = data.tasks.filter(t => t.posterId !== user.id && !data.completions.some(c => c.taskId === t.id && c.userId === user.id)).slice(-20).reverse();
    return reply(env, chatId, ownOpen.length ? "📋 Your unreported tasks:\n\n" + ownOpen.map(t => `#${t.id} · ${t.instruction} · posted by ${t.posterName}\n${t.url}`).join("\n\n") : "You have no open tasks recorded here 💗");
  }
  if (text.startsWith("/done")) {
    const match = text.match(/^\/done(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$/s);
    if (!match) return reply(env, chatId, "Format: /done TASK_ID | the meaningful comment you left");
    const taskId = Number(match[1]), comment = match[2].trim();
    const data = await load(env, chatId);
    const task = data.tasks.find(t => t.id === taskId);
    if (!task) return reply(env, chatId, `I couldn't find task #${taskId} in this chat. Use /tasks.`);
    if (task.posterId === user.id) return reply(env, chatId, "You can't mark your own post as an engagement task you completed.");
    const admin = await isAdmin(env, chatId, user.id);
    const normalized = comment.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    const generic = GENERIC.has(normalized) || wordCount < 4;
    if (generic && task.instruction !== "EMOJI_ONLY" && !admin) {
      const flag = { id: data.flags.length + 1, chatId, userId: user.id, name: nameOf(user), reason: `Task #${taskId}: possibly short/generic comment: ${comment.slice(0,180)}`, at: dateNow() };
      data.flags.push(flag); await save(env, chatId, data);
      return reply(env, chatId, `⚠️ Your completion for task #${taskId} was flagged for admin review because the comment may be too short or generic. Please submit a specific, relevant comment. Likes and saves are still required.`);
    }
    data.completions = data.completions.filter(c => !(c.taskId === taskId && c.userId === user.id));
    data.completions.push({ taskId, userId: user.id, name: nameOf(user), comment: comment.slice(0,500), at: dateNow() });
    await save(env, chatId, data);
    return reply(env, chatId, `💗 Self-report recorded for task #${taskId}. Likes and saves cannot be independently verified.`);
  }
  if (!["group", "supergroup"].includes(chat.type)) return;
  const links = text.match(IG_RE);
  if (!links || !user) return;
  const data = await load(env, chatId);
  let instruction = "ALL";
  const lower = text.toLowerCase();
  if (lower.includes("emoji only") || lower.includes("emoji-only")) instruction = "EMOJI_ONLY";
  else if (lower.includes("repost to x") || lower.includes("repost on x")) instruction = "ALL + REPOST TO X";
  else if (lower.includes("repost")) instruction = "ALL + REPOST";
  const ids = [];
  for (const link of links) {
    const clean = link.replace(/[.,!?\)\]\}]+$/g, "");
    const id = data.nextId++;
    data.tasks.push({ id, chatId, messageId: msg.message_id, url: clean, instruction, posterId: user.id, posterName: nameOf(user), at: dateNow() });
    ids.push("#" + id);
  }
  await save(env, chatId, data);
  const open = data.tasks.filter(t => t.posterId !== user.id && !data.completions.some(c => c.taskId === t.id && c.userId === user.id));
  let note = `📌 Instagram task created: ${ids.join(", ")}\nInstruction: ${instruction}\nPlease like + save and leave a genuine, relevant comment.\nWhen done, report: /done TASK_ID | your comment`;
  if (open.length) note += `\n⚠️ Reminder: you have ${open.length} earlier task(s) still unreported. This is a reminder, not proof that engagement was skipped.`;
  await reply(env, chatId, note, msg.message_id);
}
