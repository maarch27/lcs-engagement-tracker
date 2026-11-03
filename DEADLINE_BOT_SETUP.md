# Deadline bot prototype — setup and safety notes

This branch adds deadline_bot.py, a Python implementation with per-Telegram-link 24-hour deadlines and a nightly overdue-task review queue. It does not replace bot.py or cloudflare-worker.js on the default branch.

## Before running

- Do not run this alongside another implementation using the same Telegram bot token. Telegram supports one active update delivery mode per bot token (polling or webhook).
- This code is not deployed by committing it to GitHub. A Python host or always-on computer/server is still required.
- Never commit TELEGRAM_BOT_TOKEN, database files, or other secrets to GitHub.
- The bot cannot independently verify likes or saves on Instagram. A /done entry is a self-report. Overdue assignments go to admin review; the bot does not automatically remove members or delete posts.

## Configuration

Set the environment variable TELEGRAM_BOT_TOKEN in the hosting provider's secret/environment settings. Optionally set DATABASE_PATH; default is data/lcs_tracker.sqlite3. Use persistent storage for this database so task and warning history survive restarts.

Install dependencies with:

    python -m pip install -r requirements.txt

Start with:

    python deadline_bot.py

## Nightly review behavior

- Each Instagram URL shared in a group message becomes a task with a deadline exactly 24 hours after that Telegram message.
- The review job checks every 15 minutes during 20:00–20:59 Asia/Tbilisi time.
- Only tasks whose 24-hour deadline has passed are considered.
- Missing completion reports are placed in the pending queue. This is not proof of a missed Instagram like/save.
- Admins use /review, then /approve TASK_ID USER_ID to confirm a miss and issue the next warning, or /dismiss TASK_ID USER_ID to dismiss it.
- Admins can issue a manual warning with /warn @username reason or /finalwarn @username reason.
- Warnings are recorded in the local SQLite database. No automatic ban or post deletion is performed.

## Important roster limitation

Telegram does not give ordinary bots a complete list of all group members. This prototype assigns tasks to members it has already observed in the chat or through join/member updates. Make sure the bot is allowed to receive group messages and member updates, and have existing members interact with the bot/group before relying on the roster. Admins should review the queue before taking action.

## Time zone note

The configured review window is 20:00–21:00 in Georgia. Georgia is ahead of France, not behind it. In winter, 20:00–21:00 in Georgia corresponds to 17:00–18:00 in France; the offset can differ when France changes to summer time. Confirm which local clock time you want before production deployment.

## Suggested safe rollout

1. Deploy this branch as a separate test bot/token first, not the live bot token.
2. Add it to a private test group and confirm that link tasks receive deadlines and /review behaves correctly.
3. Test a task with an artificially shortened deadline in a test copy before waiting 24 hours.
4. Confirm the group roster and persistent database behavior.
5. Only after successful testing, decide whether to merge this branch and migrate the live bot.
