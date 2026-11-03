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
    """Send the complete Star Links rules and supplied Instagram roster privately."""
    full_rules = "❗️CHAT RULES — PLEASE READ CAREFULLY (RULES HAVE BEEN UPDATED!)\n\n☑ All members must follow every member of the chat.\n☑ Admins can choose whether or not to complete links.\n☑ Admins are allowed to post up to 2 links/posts.\n☑ Only 1 post/link per 24 hours is allowed.\n☑ You can post any content, whether it is old or new.\n☑ Comments must contain at least 3 words.\n☑ If a post requires ALL, comments must contain at least 3 words. Emoji-only comments are not allowed. When sharing a link, mention what the product is about! Bot-like or generic comments are also prohibited.\n☑ Engagement on all posts must be completed within 24 hours. Activity will be checked daily!\n☑ It does not matter whether you have been inactive and haven’t posted a link for one week or two — you must still complete all outstanding links.\n☑ After joining the chat, you must follow all members within 24 hours. Members’ Instagram links are pinned in the links chat. Other members will follow you back within 24 hours. If someone hasn’t followed you back, tag them in the discussion chat.\n☑ Saves are posted only on Sundays.\n☑ Sunday is our rest day — only saves are allowed to be posted.\n\n‼️ If you do not have your required saves completed within 48 hours, you will be banned from posting links. However, you must continue completing other members’ links.\n‼️ After receiving 3 warnings, you must leave the chat. Admins will notify you in advance.\n‼️ If you are unable to participate in engagement, you must post a numbered warning using #WARNING.\nExample: #WARNING2 I won’t be able to participate in engagement.\nWarnings must be numbered consecutively. A maximum of 2 warnings per month is allowed.\n\n📌 SATURDAY RULE\nOn Saturdays, you may post someone else’s link, but you must clearly label it (Someone else’s link).\nYou are allowed to post only ONE link in total — either your own link or someone else’s.\n\n📌 RETURNING AFTER INACTIVITY\nWhen you become active again, you must write #IMBACK.\nFor any links you missed while you were away, you only need to complete the likes and saves.\n\n📌 TELEGRAM & CHAT ETIQUETTE\n⭕️ Use the same name on Telegram as the one you use on Instagram.\n⭕️ Use the same profile picture on Telegram as the one you use on Instagram.\n⭕️ Do not leave generic or bot-like comments such as:\n• “Wow”\n• “Great”\n• “Cool content”\n• “I love this content”\n• “Great product”\n⭕️ Do not write anything in the Saves Chat except warnings and save links. For general conversations, please use the Discussion Chat or the Star Chat space.\n⭕️ Sharing paid collaboration opportunities is mandatory. If you do not share paid opportunities with the group, you may be required to leave the chat.\n⭕️ You can contact the admins privately at any time if you have questions or concerns.\nThank you for respecting the rules and helping us keep the group fair, active, and supportive for everyone! 💗\n\nADMINS\n1) https://www.instagram.com/maarch_27\n2) https://www.instagram.com/lizalens__\n3) https://www.instagram.com/itsimplymartha\n4) https://www.instagram.com/dr.lamarya\n\nMEMBERS — Instagram links\n5) https://www.instagram.com/meksssun/\n6) https://www.instagram.com/ugc.tako\n7) https://www.instagram.com/mariamkha.ugc\n8) https://www.instagram.com/niiinuciii\n9) https://www.instagram.com/sergeevaaianaaa\n10) https://www.instagram.com/marishkkan\n11) https://www.instagram.com/tamu__bb\n12) https://www.instagram.com/by.marsho\n13) https://www.instagram.com/sallom_ee\n15) https://www.instagram.com/aniardazishvili\n16) https://www.instagram.com/tata.papiashvili\n17) https://www.instagram.com/kokhre.salluka\n18) https://www.instagram.com/ugcwithgvantsi\n19) https://www.instagram.com/ddzuguu\n20) https://www.instagram.com/sesilia_tr\n21) https://www.instagram.com/ugcketi_\n22) https://www.instagram.com/marisa_ugccreator\n23) https://www.instagram.com/ildas.way\n24) https://www.instagram.com/khatia.chargazia\n25) https://www.instagram.com/teo.createss_\n26) https://www.instagram.com/lana_span\n27) https://www.instagram.com/manoni_ugc\n28) https://www.instagram.com/ninuca.ugc\n29) https://www.instagram.com/tati.mtskerashvili\n30) https://www.instagram.com/taks_ugc\n31) https://www.instagram.com/nina_zarnadze\n32) https://www.instagram.com/marlen__music\n34) https://www.instagram.com/teona.kurtanidze\n35) https://www.instagram.com/__lilluuu\n36) https://www.instagram.com/tamaras_style\n37) https://www.instagram.com/teokekos_\n38) https://www.instagram.com/merriem3.14\n39) https://www.instagram.com/bbetheaa\n40) https://www.instagram.com/itsjeni1212\n41) https://www.instagram.com/sallyna___\n42) https://www.instagram.com/ugc_eka\n43) https://www.instagram.com/tamarcreates\n44) https://www.instagram.com/mariam_giorgashvili\n\nBlank entries 14, 33 and 45 were omitted. The bot cannot automatically verify Instagram follows."
    chat = update.effective_chat
    if chat and chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        try:
            await context.bot.send_message(chat_id=update.effective_user.id, text=full_rules)
            await update.effective_message.reply_text("💗 I’ve sent the full rules and member Instagram list privately. If you don’t receive a DM, open @LCS_Engagement_Tracker_bot and press Start, then try /rules again.")
        except Exception:
            await update.effective_message.reply_text("I couldn’t DM you yet. Please open @LCS_Engagement_Tracker_bot, press Start, then use /rules again.")
    else:
        await update.effective_message.reply_text(full_rules)


async def members_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text("💗 The full member Instagram list is included at the end of /rules. Use /rules to receive the rules and list privately. Follow status is not automatically verified.")


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


async def review_done(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_admin(update, context):
        await update.effective_message.reply_text("Admin-only command.")
        return
    chat = update.effective_chat
    conn = connect_db()
    rows = conn.execute(
        "SELECT c.task_id,c.user_id,c.user_name,c.comment_text,c.completed_at,t.url "
        "FROM completions c JOIN tasks t ON t.id=c.task_id "
        "WHERE t.chat_id=? ORDER BY c.completed_at DESC LIMIT 30",
        (chat.id,),
    ).fetchall()
    conn.close()
    if not rows:
        await update.effective_message.reply_text("No completion comments have been submitted yet.")
        return
    lines = ["📝 Recent completion comments (latest 30):"]
    for r in rows:
        lines.append(
            f"Task #{r['task_id']} · {r['user_name']} (ID {r['user_id']})\n"
            f"Comment: {r['comment_text']}\n"
            f"Edit: /edit_done {r['task_id']} {r['user_id']} | corrected comment\n"
            f"Link: {r['url']}"
        )
    await update.effective_message.reply_text("\n\n".join(lines))


async def edit_done(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_admin(update, context):
        await update.effective_message.reply_text("Admin-only command.")
        return
    msg, chat = update.effective_message, update.effective_chat
    match = re.match(r"^/edit_done(?:@\w+)?\s+(\d+)\s+(\d+)\s*\|\s*(.+)$", msg.text or "", re.S)
    if not match:
        await msg.reply_text("Format: /edit_done TASK_ID USER_ID | corrected comment")
        return
    task_id, user_id, comment = int(match.group(1)), int(match.group(2)), match.group(3).strip()
    if len(comment) > 500:
        await msg.reply_text("Comments must be 500 characters or fewer.")
        return
    conn = connect_db()
    row = conn.execute(
        "SELECT c.comment_text FROM completions c JOIN tasks t ON t.id=c.task_id "
        "WHERE c.task_id=? AND c.user_id=? AND t.chat_id=?",
        (task_id, user_id, chat.id),
    ).fetchone()
    if not row:
        conn.close()
        await msg.reply_text("No submitted completion comment found for that task and member.")
        return
    old_comment = row["comment_text"]
    conn.execute("""
        CREATE TABLE IF NOT EXISTS completion_edits (
          id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
          old_comment TEXT NOT NULL, new_comment TEXT NOT NULL, edited_by TEXT NOT NULL, edited_at TEXT NOT NULL
        )
    """)
    conn.execute(
        "INSERT INTO completion_edits(task_id,user_id,old_comment,new_comment,edited_by,edited_at) VALUES(?,?,?,?,?,?)",
        (task_id, user_id, old_comment, comment[:500], display_name(update.effective_user), iso()),
    )
    conn.execute(
        "UPDATE completions SET comment_text=?,completed_at=? WHERE task_id=? AND user_id=?",
        (comment[:500], iso(), task_id, user_id),
    )
    conn.commit()
    conn.close()
    await msg.reply_text(f"Updated the comment for task #{task_id}, member ID {user_id}. The previous comment was retained in edit history.")


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
    # Final-warning destination: private (default), group, or configured admin log chat.
    # Telegram bots cannot send directly to the admin's Saved Messages.
    destination = "private"
    raw_args = raw[1]
    dest_match = re.search(r"\s+--to=(private|group|log)\s*$", raw_args, re.I)
    if dest_match:
        destination = dest_match.group(1).lower()
        raw_args = raw_args[:dest_match.start()].strip()
    match = re.match(r"@?(\w+)\s+(.+)", raw_args, re.S)
    if not match:
        await msg.reply_text("Format: /warn @username reason OR /finalwarn @username reason [--to=private|group|log]")
        return
    username, reason = match.group(1), match.group(2).strip()
    if not final:
        destination = "private"
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
    warning_text = f"{notice}\nMember: {member['user_name']}\nReason: {reason}\nIssued by: {display_name(update.effective_user)}"
    if final and destination == "group":
        await context.bot.send_message(chat_id=chat.id, text=warning_text)
        await msg.reply_text("Final warning posted in this group.")
    elif final and destination == "log":
        log_chat_id = os.environ.get("FINAL_WARNING_CHAT_ID", "").strip()
        if not log_chat_id:
            await msg.reply_text("FINAL_WARNING_CHAT_ID is not configured. Warning is recorded in the database; no message was sent.")
            return
        try:
            await context.bot.send_message(chat_id=int(log_chat_id), text=warning_text)
            await msg.reply_text("Final warning sent to the configured admin log chat.")
        except Exception:
            await msg.reply_text("Could not send to the configured admin log chat. Check FINAL_WARNING_CHAT_ID and ensure the bot is in that chat.")
    else:
        try:
            await context.bot.send_message(chat_id=member["user_id"], text=warning_text)
            await msg.reply_text("Final warning sent privately to the member." if final else "Warning recorded and sent to the member privately.")
        except Exception:
            await msg.reply_text("Warning recorded in the database, but Telegram could not deliver the private message. The member may need to start the bot first.")


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
        "/warn @username reason — issue a private warning\n/finalwarn @username reason [--to=private|group|log] — final warning destination\n"
        "/review_done — review recent completion comments\n/edit_done TASK_ID USER_ID | comment — correct a completion comment\n"
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
        ("start", "Start the tracker"),
        ("help", "Show bot help"),
        ("rules", "Get full rules and member Instagram list"),
        ("members", "View member Instagram list"),
        ("tasks", "List your open tasks"),
        ("done", "Report a completed task"),
        ("report", "Show the tracker report (admin)"),
        ("review", "Review overdue tasks (admin)"),
        ("approve", "Approve an overdue-task review (admin)"),
        ("dismiss", "Dismiss an overdue-task review (admin)"),
        ("warn", "Issue a private warning (admin)"),
        ("finalwarn", "Issue a final warning (admin)"),
        ("review_done", "Review recent completion comments (admin)"),
        ("edit_done", "Edit a completion comment (admin)"),
        ("admin", "Show admin commands"),
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
    app.add_handler(CommandHandler("members", members_list))
    app.add_handler(CommandHandler("tasks", tasks))
    app.add_handler(CommandHandler("done", done))
    app.add_handler(CommandHandler("review_done", review_done))
    app.add_handler(CommandHandler("edit_done", edit_done))
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
