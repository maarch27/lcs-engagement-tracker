import logging
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from telegram import Update
from telegram.constants import ChatType
from telegram.ext import (
    Application, ChatMemberHandler, CommandHandler, ContextTypes,
    MessageHandler, filters,
)

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
DB_PATH = os.environ.get("DATABASE_PATH", "data/lcs_tracker.sqlite3")
GEORGIA_TZ = ZoneInfo("Asia/Tbilisi")
REVIEW_START_HOUR = 20  # Georgia time; checks run every 15 minutes from 20:00 to 20:45.
TRUSTED_ADMIN_USERNAMES = {"marriaammi", "lizal", "itsimplymartha", "drlamarya"}
INSTAGRAM_RE = re.compile(r"https?://(?:www\.)?(?:instagram\.com|instagr\.am)/\S+", re.I)
GENERIC_COMMENTS = {"nice", "nice post", "love it", "i like this product", "great", "great post", "so cute", "amazing", "beautiful", "love this"}

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("lcs-tracker")


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now_utc()).astimezone(timezone.utc).isoformat(timespec="seconds")


def connect_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
      url TEXT NOT NULL, instruction TEXT NOT NULL DEFAULT 'ALL', poster_id INTEGER NOT NULL,
      poster_name TEXT NOT NULL, created_at TEXT NOT NULL, due_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, user_name TEXT NOT NULL,
      last_seen TEXT NOT NULL, PRIMARY KEY(chat_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS task_targets (
      task_id INTEGER NOT NULL, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL, PRIMARY KEY(task_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS completions (
      task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, user_name TEXT NOT NULL,
      comment_text TEXT NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY(task_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, user_name TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_at TEXT,
      UNIQUE(task_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL, level INTEGER NOT NULL, reason TEXT NOT NULL,
      issued_at TEXT NOT NULL, issued_by TEXT NOT NULL
    );
    """)
    # Migrate the original repository database if it already exists.
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    if "due_at" not in cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN due_at TEXT")
        conn.execute("UPDATE tasks SET due_at = created_at WHERE due_at IS NULL")
    conn.commit()
    return conn


def display_name(user):
    return ("@" + user.username) if user.username else (user.full_name or str(user.id))


async def is_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user, chat = update.effective_user, update.effective_chat
    if not user:
        return False
    if (user.username or "").lstrip("@").casefold() in TRUSTED_ADMIN_USERNAMES:
        return True
    if not chat:
        return False
    try:
        member = await context.bot.get_chat_member(chat.id, user.id)
        return member.status in ("administrator", "creator")
    except Exception:
        return False


def remember_member(conn, chat_id, user):
    if not user or user.is_bot:
        return
    conn.execute(
        "INSERT INTO members(chat_id,user_id,user_name,last_seen) VALUES(?,?,?,?) "
        "ON CONFLICT(chat_id,user_id) DO UPDATE SET user_name=excluded.user_name,last_seen=excluded.last_seen",
        (chat_id, user.id, display_name(user), iso()),
    )
    # Add this member to still-open tasks as soon as the bot observes them in the group.
    # Telegram bots cannot enumerate a group's full member list.
    conn.execute(
        "INSERT OR IGNORE INTO task_targets(task_id,chat_id,user_id,user_name) "
        "SELECT t.id,t.chat_id,?,? FROM tasks t "
        "WHERE t.chat_id=? AND t.poster_id<>? AND t.due_at>?",
        (user.id, display_name(user), chat_id, user.id, iso()),
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "💗 LCS Engagement Tracker is online.\n\n"
        "Instagram links shared in this Telegram group become tasks with a rolling 24-hour deadline. "
        "During the nightly Georgia-time review window, overdue unreported tasks are queued for admin review. "
        "The bot cannot independently verify Instagram likes or saves.\n\n"
        "Commands: /rules /tasks /done /report /review /warn /finalwarn /admin"
    )


async def rules(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "💗 LCS engagement rules\n"
        "1. Engage with links shared in this Telegram group within 24 hours of the link being posted.\n"
        "2. Like and save the Instagram post and leave a relevant comment.\n"
        "3. Unless the post says otherwise, comments should contain at least 3 meaningful words.\n"
        "4. Follow specific instructions, including exact emoji requests.\n"
        "5. Report with /done TASK_ID | the comment you left. This is a self-report, not proof of likes/saves.\n"
        "6. Overdue tasks are queued for admin review; warnings and serious penalties are not automatic."
    )


async def tasks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat, user = update.effective_chat, update.effective_user
    conn = connect_db()
    rows = conn.execute(
        "SELECT t.id,t.url,t.instruction,t.poster_name,t.created_at,t.due_at "
        "FROM tasks t JOIN task_targets x ON x.task_id=t.id AND x.user_id=? "
        "LEFT JOIN completions c ON c.task_id=t.id AND c.user_id=? "
        "WHERE t.chat_id=? AND c.task_id IS NULL ORDER BY t.id DESC LIMIT 30",
        (user.id, user.id, chat.id),
    ).fetchall()
    conn.close()
    if not rows:
        await update.effective_message.reply_text("You have no open tracked tasks assigned to you 💗")
        return
    lines = ["📋 Your open tasks (deadlines are shown in UTC):"]
    for r in rows:
        lines.append(f"Task #{r['id']} · {r['instruction']} · posted by {r['poster_name']}\nDue: {r['due_at']}\n{r['url']}")
    await update.effective_message.reply_text("\n\n".join(lines))


async def done(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    match = re.match(r"^/done(?:@\w+)?\s+(\d+)\s*\|\s*(.+)$", msg.text or "", re.S)
    if not match:
        await msg.reply_text("Format: /done TASK_ID | the meaningful comment you left")
        return
    task_id, comment = int(match.group(1)), match.group(2).strip()
    conn = connect_db()
    task = conn.execute("SELECT * FROM tasks WHERE id=? AND chat_id=?", (task_id, chat.id)).fetchone()
    if not task:
        conn.close()
        await msg.reply_text("I couldn't find that task in this chat. Use /tasks.")
        return
    if task["poster_id"] == user.id:
        conn.close()
        await msg.reply_text("You can't report engagement on your own post.")
        return
    words = re.sub(r"[^\w\s]", " ", comment, flags=re.UNICODE).split()
    norm = " ".join(words).casefold()
    if task["instruction"] != "EMOJI_ONLY" and (len(words) < 3 or norm in GENERIC_COMMENTS):
        conn.close()
        await msg.reply_text("⚠️ Please use at least 3 meaningful words that are specific to the post, unless the post asks for emojis or another format.")
        return
    conn.execute(
        "INSERT INTO completions(task_id,user_id,user_name,comment_text,completed_at) VALUES(?,?,?,?,?) "
        "ON CONFLICT(task_id,user_id) DO UPDATE SET user_name=excluded.user_name,comment_text=excluded.comment_text,completed_at=excluded.completed_at",
        (task_id, user.id, display_name(user), comment[:500], iso()),
    )
    conn.commit()
    conn.close()
    await msg.reply_text(f"💗 Self-report recorded for task #{task_id}. This does not independently verify the Instagram like or save.")


async def review(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_admin(update, context):
        await update.effective_message.reply_text("Admin-only command.")
        return
    chat = update.effective_chat
    conn = connect_db()
    rows = conn.execute(
        "SELECT id,task_id,user_id,user_name,reason,created_at FROM violations "
        "WHERE chat_id=? AND status='pending' ORDER BY id DESC LIMIT 30", (chat.id,)
    ).fetchall()
    conn.close()
    if not rows:
        await update.effective_message.reply_text("No overdue tasks are waiting for review 💗")
        return
    lines = ["🔎 Pending overdue-task reviews (not confirmed violations):"]
    for r in rows:
        lines.append(
            f"Review #{r['id']} · Task #{r['task_id']} · {r['user_name']} (user ID {r['user_id']})\n"
            f"{r['reason']}\nApprove: /approve {r['task_id']} {r['user_id']}\nDismiss: /dismiss {r['task_id']} {r['user_id']}"
        )
    await update.effective_message.reply_text("\n\n".join(lines))


async def review_decision(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_admin(update, context):
        await update.effective_message.reply_text("Admin-only command.")
        return
    msg, chat = update.effective_message, update.effective_chat
    parts = (msg.text or "").split()
    if len(parts) != 3 or not parts[1].isdigit() or not parts[2].isdigit():
        await msg.reply_text("Format: /approve TASK_ID USER_ID or /dismiss TASK_ID USER_ID")
        return
    task_id, user_id = int(parts[1]), int(parts[2])
    conn = connect_db()
    violation = conn.execute(
        "SELECT * FROM violations WHERE chat_id=? AND task_id=? AND user_id=? AND status='pending'",
        (chat.id, task_id, user_id),
    ).fetchone()
    if not violation:
        conn.close()
        await msg.reply_text("No matching pending review was found.")
        return
    if parts[0].split("@")[0] == "/dismiss":
        conn.execute("UPDATE violations SET status='dismissed',reviewed_at=? WHERE id=?", (iso(), violation["id"]))
        conn.commit()
        conn.close()
        await msg.reply_text(f"Review dismissed for task #{task_id}. No warning was issued.")
        return
    prior = conn.execute("SELECT COUNT(*) n FROM warnings WHERE chat_id=? AND user_id=?", (chat.id, user_id)).fetchone()["n"]
    level = min(prior + 1, 3)
    reason = f"Missed 24-hour engagement deadline for task #{task_id}"
    conn.execute("UPDATE violations SET status='confirmed',reviewed_at=? WHERE id=?", (iso(), violation["id"]))
    conn.execute(
        "INSERT INTO warnings(chat_id,user_id,user_name,level,reason,issued_at,issued_by) VALUES(?,?,?,?,?,?,?)",
        (chat.id, user_id, violation["user_name"], level, reason, iso(), display_name(update.effective_user)),
    )
    conn.commit()
    conn.close()
    if level == 1:
        notice = "⚠️ First warning"
    elif level == 2:
        notice = "⚠️ Second warning — repeated missed deadlines are being recorded."
    else:
        notice = "🚨 FINAL WARNING — further missed deadlines may lead to removal after admin review."
    await msg.reply_text(f"{notice}\nMember: {violation['user_name']}\n{reason}")


async def issue_manual_warning(update: Update, context: ContextTypes.DEFAULT_TYPE, final=False):
    if not await is_admin(update, context):
        await update.effective_message.reply_text("Admin-only command.")
        return
    msg, chat = update.effective_message, update.effective_chat
    raw = (msg.text or "").split(maxsplit=1)
    if len(raw) < 2:
        await msg.reply_text("Format: /warn @username reason (or /finalwarn @username reason)")
        return
    match = re.match(r"@?(\w+)\s+(.+)", raw[1], re.S)
    if not match:
        await msg.reply_text("Format: /warn @username reason")
        return
    username, reason = match.group(1), match.group(2).strip()
    conn = connect_db()
    member = conn.execute(
        "SELECT user_id,user_name FROM members WHERE chat_id=? AND lower(user_name)=lower(?)",
        (chat.id, "@" + username),
    ).fetchone()
    if not member:
        conn.close()
        await msg.reply_text("I don't have that member in my tracked roster yet. Ask them to send a message in the group, then try again.")
        return
    prior = conn.execute("SELECT COUNT(*) n FROM warnings WHERE chat_id=? AND user_id=?", (chat.id, member["user_id"])).fetchone()["n"]
    level = 3 if final else min(prior + 1, 2)
    conn.execute(
        "INSERT INTO warnings(chat_id,user_id,user_name,level,reason,issued_at,issued_by) VALUES(?,?,?,?,?,?,?)",
        (chat.id, member["user_id"], member["user_name"], level, reason, iso(), display_name(update.effective_user)),
    )
    conn.commit()
    conn.close()
    notice = "🚨 FINAL WARNING" if level == 3 else ("⚠️ Second warning" if level == 2 else "⚠️ First warning")
    await msg.reply_text(f"{notice}\nMember: {member['user_name']}\nReason: {reason}")


async def report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_admin(update, context):
        await update.effective_message.reply_text("Admin-only command.")
        return
    chat = update.effective_chat
    conn = connect_db()
    task_count = conn.execute("SELECT COUNT(*) n FROM tasks WHERE chat_id=?", (chat.id,)).fetchone()["n"]
    pending = conn.execute("SELECT COUNT(*) n FROM violations WHERE chat_id=? AND status='pending'", (chat.id,)).fetchone()["n"]
    warnings = conn.execute("SELECT COUNT(*) n FROM warnings WHERE chat_id=? AND date(issued_at)=date('now')", (chat.id,)).fetchone()["n"]
    open_count = conn.execute(
        "SELECT COUNT(*) n FROM task_targets x JOIN tasks t ON t.id=x.task_id "
        "LEFT JOIN completions c ON c.task_id=x.task_id AND c.user_id=x.user_id "
        "WHERE t.chat_id=? AND c.task_id IS NULL", (chat.id,)
    ).fetchone()["n"]
    conn.close()
    await update.effective_message.reply_text(
        f"📊 LCS tracker report\nTasks recorded: {task_count}\nOpen task assignments: {open_count}\n"
        f"Pending overdue reviews: {pending}\nWarnings issued today (UTC): {warnings}\n\n"
        "Instagram likes and saves are not independently verified. Overdue tasks require admin review before warnings are issued."
    )


async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_admin(update, context):
        await update.effective_message.reply_text("Admin-only command.")
        return
    await update.effective_message.reply_text(
        "🛠 Admin commands\n/review — pending overdue-task reviews\n"
        "/approve TASK_ID USER_ID — confirm miss and issue next warning\n"
        "/dismiss TASK_ID USER_ID — dismiss review\n"
        "/warn @username reason — issue a warning\n/finalwarn @username reason — issue a final warning\n"
        "/report — tracker summary\n\nNo member is automatically removed, and posts are never auto-deleted."
    )


async def track_chat_member(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    cmu = update.chat_member
    if not chat or not cmu:
        return
    user = cmu.new_chat_member.user
    if cmu.new_chat_member.status in ("member", "administrator", "creator", "restricted"):
        conn = connect_db()
        remember_member(conn, chat.id, user)
        conn.commit()
        conn.close()


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    if not msg or not chat or not user or chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return
    text = msg.text or msg.caption or ""
    conn = connect_db()
    remember_member(conn, chat.id, user)
    conn.commit()
    links = INSTAGRAM_RE.findall(text)
    if not links:
        conn.close()
        return
    lowered = text.casefold()
    instruction = "ALL"
    if "emoji only" in lowered or "emoji-only" in lowered:
        instruction = "EMOJI_ONLY"
    elif "repost to x" in lowered or "repost on x" in lowered:
        instruction = "ALL + REPOST TO X"
    elif "repost" in lowered:
        instruction = "ALL + REPOST"
    created = []
    created_at = now_utc()
    due_at = created_at + timedelta(hours=24)
    # Targets are people already observed in this chat; Telegram does not expose a full member list.
    members = conn.execute("SELECT user_id,user_name FROM members WHERE chat_id=?", (chat.id,)).fetchall()
    for link in links:
        clean = link.rstrip(".,!?)]}")
        cur = conn.execute(
            "INSERT INTO tasks(chat_id,message_id,url,instruction,poster_id,poster_name,created_at,due_at) VALUES(?,?,?,?,?,?,?,?)",
            (chat.id, msg.message_id, clean, instruction, user.id, display_name(user), iso(created_at), iso(due_at)),
        )
        task_id = cur.lastrowid
        created.append(task_id)
        for member in members:
            if member["user_id"] != user.id:
                conn.execute(
                    "INSERT OR IGNORE INTO task_targets(task_id,chat_id,user_id,user_name) VALUES(?,?,?,?)",
                    (task_id, chat.id, member["user_id"], member["user_name"]),
                )
    conn.commit()
    conn.close()
    ids = ", ".join(f"#{i}" for i in created)
    await msg.reply_text(
        f"📌 Telegram link task created: {ids}\nInstruction: {instruction}\n"
        f"24-hour deadline: {iso(due_at)} (UTC)\n"
        "Please like + save and leave the requested comment. Report with /done TASK_ID | your comment.\n"
        "Note: Instagram likes/saves are not independently verified by this bot."
    )


async def nightly_review(context: ContextTypes.DEFAULT_TYPE):
    local_now = datetime.now(GEORGIA_TZ)
    if local_now.hour != REVIEW_START_HOUR:
        return
    conn = connect_db()
    due_tasks = conn.execute("SELECT * FROM tasks WHERE due_at<=?", (iso(),)).fetchall()
    private_messages = []
    for task in due_tasks:
        targets = conn.execute(
            "SELECT x.user_id,x.user_name FROM task_targets x "
            "LEFT JOIN completions c ON c.task_id=x.task_id AND c.user_id=x.user_id "
            "LEFT JOIN violations v ON v.task_id=x.task_id AND v.user_id=x.user_id "
            "WHERE x.task_id=? AND c.task_id IS NULL AND v.id IS NULL",
            (task["id"],),
        ).fetchall()
        for target in targets:
            cur = conn.execute(
                "INSERT OR IGNORE INTO violations(task_id,chat_id,user_id,user_name,reason,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
                (task["id"], task["chat_id"], target["user_id"], target["user_name"],
                 f"No completion report for task #{task['id']} after the 24-hour deadline. This is not proof that the Instagram actions were skipped.", iso()),
            )
            if cur.rowcount:
                private_messages.append({
                    "chat_id": task["chat_id"], "user_id": target["user_id"],
                    "user_name": target["user_name"], "task_id": task["id"],
                    "url": task["url"], "due_at": task["due_at"],
                    "instruction": task["instruction"],
                })
    conn.commit()
    conn.close()

    # Reminders are private only. No names or missed-task notices are posted in the group.
    # Telegram bots can only DM users who have opened the bot / pressed Start first.
    for item in private_messages:
        try:
            is_admin_member = False
            try:
                member_status = await context.bot.get_chat_member(item["chat_id"], item["user_id"])
                is_admin_member = member_status.status in ("administrator", "creator")
            except Exception:
                is_admin_member = item["user_name"].lstrip("@").casefold() in TRUSTED_ADMIN_USERNAMES

            if is_admin_member:
                reminder_text = (
                    f"💗 Hey {item['user_name']}! Friendly admin reminder\n\n"
                    "Thank you for helping run the community! Admins are also expected to support members "
                    "by engaging with their posts, even when admins have their own posting allowance.\n\n"
                    f"Task #{item['task_id']} is past its 24-hour deadline.\n"
                    f"Link: {item['url']}\n"
                    f"Instructions: {item['instruction']}\n\n"
                    "Please check whether you completed the requested like, save, and comment. "
                    "If you did, use /done TASK_ID | your comment in the engagement group. "
                    "If you missed something, please complete it if still possible.\n\n"
                    "This is a private reminder because no completion report was found; it is not a verified accusation. "
                    "The bot cannot independently verify Instagram likes or saves."
                )
            else:
                reminder_text = (
                    f"💗 Hey {item['user_name']}! LCS Engagement Tracker reminder\n\n"
                    f"Task #{item['task_id']} is past its 24-hour deadline.\n"
                    f"Link: {item['url']}\n"
                    f"Instructions: {item['instruction']}\n\n"
                    "Please check whether you completed all requested actions (like, save, and the requested comment). "
                    "If you completed them, use /done TASK_ID | your comment in the engagement group. "
                    "If you missed something, complete it if still possible and let an admin know.\n\n"
                    "This is a private reminder because no completion report was found, not a verified accusation. "
                    "The bot cannot independently verify Instagram likes or saves."
                )
            await context.bot.send_message(chat_id=item["user_id"], text=reminder_text)
        except Exception:
            log.info(
                "Private reminder unavailable for user %s; they may need to start the bot first.",
                item["user_id"],
            )


async def post_init(application: Application):
    await application.bot.set_my_commands([
        ("start", "Start tracker"), ("rules", "Show rules"), ("tasks", "List your open tasks"),
        ("done", "Report completion"), ("report", "Admin report"), ("review", "Review overdue tasks"),
        ("admin", "Admin controls"),
    ])
    # Check every 15 minutes; only perform review during 20:00–20:59 in Georgia.
    application.job_queue.run_repeating(nightly_review, interval=900, first=15, name="georgia_nightly_review")


def main():
    if not TOKEN:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN environment variable.")
    conn = connect_db()
    conn.close()
    app = Application.builder().token(TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", start))
    app.add_handler(CommandHandler("rules", rules))
    app.add_handler(CommandHandler("tasks", tasks))
    app.add_handler(CommandHandler("done", done))
    app.add_handler(CommandHandler("review", review))
    app.add_handler(CommandHandler("approve", review_decision))
    app.add_handler(CommandHandler("dismiss", review_decision))
    app.add_handler(CommandHandler("warn", issue_manual_warning))
    app.add_handler(CommandHandler("finalwarn", lambda u, c: issue_manual_warning(u, c, final=True)))
    app.add_handler(CommandHandler("report", report))
    app.add_handler(CommandHandler("admin", admin_command))
    app.add_handler(ChatMemberHandler(track_chat_member, ChatMemberHandler.CHAT_MEMBER))
    app.add_handler(MessageHandler(filters.TEXT | filters.CAPTION, handle_message))
    log.info("LCS Engagement Tracker with rolling deadlines starting.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
