import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from telegram import Update
from telegram.constants import ChatType
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
DB_PATH = os.environ.get("DATABASE_PATH", "data/lcs_tracker.sqlite3")
INSTAGRAM_RE = re.compile(r"https?://(?:www\.)?(?:instagram\.com|instagr\.am)/\S+", re.I)
GENERIC_COMMENTS = {
    "nice", "nice post", "love it", "i like this product", "great", "great post",
    "so cute", "amazing", "beautiful", "love this", "😍", "❤️", "🔥", "👏"
}
logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    level=logging.INFO,
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("lcs-tracker")


def connect_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            message_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            instruction TEXT NOT NULL DEFAULT 'ALL',
            posted_by INTEGER NOT NULL,
            posted_name TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS completions (
            task_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            comment_text TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            PRIMARY KEY (task_id, user_id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def display_name(user):
    return (user.username and f"@{user.username}") or user.full_name or str(user.id)


async def is_group_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return False
    try:
        member = await context.bot.get_chat_member(chat.id, user.id)
        return member.status in ("administrator", "creator")
    except Exception:
        return False


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "💗 LCS Engagement Tracker is online.\n\n"
        "When an Instagram post link is shared in this group, I create a task ID. "
        "Members can use /done TASK_ID | a meaningful comment they left after liking and saving. "
        "This is a self-report, not independent Instagram verification.\n\n"
        "Commands: /help /rules /tasks /done /report /flags /admin"
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "LCS Engagement Tracker commands\n"
        "/rules — community engagement rules\n"
        "/tasks — open Instagram tasks in this group\n"
        "/done TASK_ID | your meaningful comment — self-report like + save + comment\n"
        "/report — admin-only daily report\n"
        "/flags — admin-only review of flagged comments\n"
        "/admin — admin controls and guidance\n\n"
        "ALL or no special instruction means leave a meaningful, relevant comment. "
        "Follow any specific instruction in the original post. Likes and saves are expected for every task. "
        "The bot cannot independently confirm Instagram likes or saves."
    )


async def rules(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "💗 LCS engagement rules\n"
        "1. Like and save every assigned post.\n"
        "2. Leave a relevant, genuine comment that follows the post's instruction.\n"
        "3. If the post says ALL or has no special instruction, use a meaningful comment.\n"
        "4. Emoji-only comments are acceptable only when the post explicitly asks for them.\n"
        "5. Do not copy generic comments such as “nice post” or “I like this product.”\n"
        "6. Report completion with /done TASK_ID | the comment you left. This is an honor-system report.\n"
        "7. Repost to Instagram or X only when the post's instructions request it.\n"
        "Admins review flags before taking moderation action."
    )


async def record_instagram_links(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    chat = update.effective_chat
    user = update.effective_user
    if not msg or not chat or not user or chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return
    text = msg.text or msg.caption or ""
    links = INSTAGRAM_RE.findall(text)
    if not links:
        return

    instruction = "ALL"
    lowered = text.lower()
    if "emoji only" in lowered or "emoji-only" in lowered:
        instruction = "EMOJI_ONLY"
    elif "repost to x" in lowered or "repost on x" in lowered:
        instruction = "ALL + REPOST TO X"
    elif "repost" in lowered:
        instruction = "ALL + REPOST"

    conn = connect_db()
    created = []
    for link in links:
        clean_link = link.rstrip(".,!?)]}")
        cur = conn.execute(
            "INSERT INTO tasks(chat_id, message_id, url, instruction, posted_by, posted_name, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (chat.id, msg.message_id, clean_link, instruction, user.id, display_name(user), now_iso()),
        )
        created.append(cur.lastrowid)

    open_rows = conn.execute(
        "SELECT t.id FROM tasks t LEFT JOIN completions c ON c.task_id=t.id AND c.user_id=? "
        "WHERE t.chat_id=? AND t.posted_by != ? AND c.task_id IS NULL",
        (user.id, chat.id, user.id),
    ).fetchall()
    conn.commit()
    conn.close()

    task_ids = ", ".join(f"#{task_id}" for task_id in created)
    note = (
        f"📌 Instagram task created: {task_ids}\n"
        f"Instruction: {instruction}\n"
        "Please like + save and leave a genuine, relevant comment. "
        "When done, report: /done TASK_ID | your comment"
    )
    if open_rows:
        note += (
            f"\n⚠️ Reminder: you have {len(open_rows)} earlier task(s) still unreported. "
            "This is a reminder, not proof that engagement was skipped."
        )
    await msg.reply_text(note)


async def tasks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    user = update.effective_user
    if not chat or not user:
        return
    conn = connect_db()
    rows = conn.execute(
        "SELECT t.id, t.url, t.instruction, t.posted_name, t.created_at "
        "FROM tasks t LEFT JOIN completions c ON c.task_id=t.id AND c.user_id=? "
        "WHERE t.chat_id=? AND c.task_id IS NULL ORDER BY t.id DESC LIMIT 20",
        (user.id, chat.id),
    ).fetchall()
    conn.close()
    if not rows:
        await update.effective_message.reply_text("You have no open tasks recorded here 💗")
        return
    lines = ["📋 Your unreported tasks:"]
    for row in rows:
        lines.append(f"#{row['id']} · {row['instruction']} · posted by {row['posted_name']}\n{row['url']}")
    await update.effective_message.reply_text("\n\n".join(lines))


async def done(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    chat = update.effective_chat
    user = update.effective_user
    raw = msg.text or ""
    match = re.match(r"^/done(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$", raw, re.S)
    if not match:
        await msg.reply_text("Format: /done TASK_ID | the meaningful comment you left")
        return
    task_id = int(match.group(1))
    comment = match.group(2).strip()
    normalized = re.sub(r"[^a-z0-9 ]", "", comment.lower()).strip()
    words = normalized.split()
    generic = normalized in GENERIC_COMMENTS or len(words) < 4
    admin_user = await is_group_admin(update, context)
    conn = connect_db()
    task = conn.execute(
        "SELECT * FROM tasks WHERE id=? AND chat_id=?", (task_id, chat.id)
    ).fetchone()
    if not task:
        conn.close()
        await msg.reply_text(f"I couldn't find task #{task_id} in this chat. Use /tasks to see open tasks.")
        return
    if task["posted_by"] == user.id:
        conn.close()
        await msg.reply_text("You can't mark your own post as an engagement task you completed.")
        return
    if generic and task["instruction"] != "EMOJI_ONLY" and not admin_user:
        conn.execute(
            "INSERT INTO flags(chat_id,user_id,user_name,reason,created_at) VALUES(?,?,?,?,?)",
            (chat.id, user.id, display_name(user), f"Task #{task_id}: comment may be too generic or short: {comment[:180]}", now_iso()),
        )
        conn.commit()
        conn.close()
        await msg.reply_text(
            f"⚠️ Your completion for task #{task_id} was flagged for admin review because the comment looks very short or generic. "
            "Please use a specific, relevant comment and resubmit. Likes and saves are still required."
        )
        return
    conn.execute(
        "INSERT OR REPLACE INTO completions(task_id,user_id,user_name,comment_text,completed_at) VALUES(?,?,?,?,?)",
        (task_id, user.id, display_name(user), comment[:500], now_iso()),
    )
    conn.commit()
    conn.close()
    await msg.reply_text(
        f"💗 Self-report recorded for task #{task_id}. Remember: this bot cannot independently verify Instagram likes or saves."
    )


async def flags_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_group_admin(update, context):
        await update.effective_message.reply_text("This command is available to group admins only.")
        return
    chat = update.effective_chat
    conn = connect_db()
    rows = conn.execute(
        "SELECT id, user_name, reason, created_at FROM flags "
        "WHERE chat_id=? ORDER BY id DESC LIMIT 20",
        (chat.id,),
    ).fetchall()
    conn.close()
    if not rows:
        await update.effective_message.reply_text("No flagged comments to review 💗")
        return
    lines = ["🔎 Recent flags for admin review (newest first):"]
    lines.extend(
        f"Flag #{row['id']} · {row['user_name']}\\n{row['reason']}\\n{row['created_at']}"
        for row in rows
    )
    lines.append("\\nFlags are review prompts, not automatic proof of a rule violation. No one is auto-banned.")
    await update.effective_message.reply_text("\\n\\n".join(lines))


async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_group_admin(update, context):
        await update.effective_message.reply_text("Admin controls are available to group admins only.")
        return
    await update.effective_message.reply_text(
        "🛠 LCS admin controls\\n"
        "/report — daily activity report\\n"
        "/flags — recent flagged comments for manual review\\n\\n"
        "Admins can post messages and links normally. The bot does not delete admin posts, "
        "automatically ban members, or independently verify Instagram likes/saves. "
        "Instagram links posted in the group are recorded as tasks so members can engage with them."
    )


async def report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_group_admin(update, context):
        await update.effective_message.reply_text("This report is available to group admins only.")
        return
    chat = update.effective_chat
    conn = connect_db()
    task_count = conn.execute(
        "SELECT COUNT(*) n FROM tasks WHERE chat_id=? AND date(created_at)=date('now')", (chat.id,)
    ).fetchone()["n"]
    completion_count = conn.execute(
        "SELECT COUNT(*) n FROM completions c JOIN tasks t ON t.id=c.task_id "
        "WHERE t.chat_id=? AND date(c.completed_at)=date('now')", (chat.id,)
    ).fetchone()["n"]
    open_count = conn.execute(
        "SELECT COUNT(*) n FROM tasks t LEFT JOIN completions c ON c.task_id=t.id "
        "WHERE t.chat_id=? AND c.task_id IS NULL", (chat.id,)
    ).fetchone()["n"]
    flags = conn.execute(
        "SELECT user_name, reason, created_at FROM flags WHERE chat_id=? "
        "AND date(created_at)=date('now') ORDER BY id DESC LIMIT 15", (chat.id,)
    ).fetchall()
    conn.close()
    lines = [
        "📊 LCS daily report (UTC date)",
        f"Instagram tasks posted today: {task_count}",
        f"Completion self-reports today: {completion_count}",
        f"Currently unreported task entries: {open_count}",
        f"Flags today: {len(flags)}",
    ]
    if flags:
        lines.append("\n⚠️ Flags for admin review:")
        lines.extend(f"• {f['user_name']}: {f['reason']}" for f in flags)
    lines.append("\nNote: task completion is self-reported; likes/saves are not independently verified.")
    await update.effective_message.reply_text("\n".join(lines))


async def post_init(application: Application):
    await application.bot.set_my_commands([
        ("start", "Start the LCS tracker"),
        ("help", "Show commands"),
        ("rules", "Show engagement rules"),
        ("tasks", "List your open tasks"),
        ("done", "Report task completion"),
        ("report", "Admin daily report"),
        ("flags", "Admin review of flagged comments"),
        ("admin", "Admin controls and guidance"),
    ])


def main():
    if not TOKEN:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN environment variable.")
    # Initialize schema before starting polling.
    conn = connect_db()
    conn.close()
    app = Application.builder().token(TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("rules", rules))
    app.add_handler(CommandHandler("tasks", tasks))
    app.add_handler(CommandHandler("done", done))
    app.add_handler(CommandHandler("report", report))
    app.add_handler(CommandHandler("flags", flags_command))
    app.add_handler(CommandHandler("admin", admin_command))
    app.add_handler(MessageHandler(filters.TEXT | filters.CAPTION, record_instagram_links))
    log.info("LCS Engagement Tracker starting with long polling.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
