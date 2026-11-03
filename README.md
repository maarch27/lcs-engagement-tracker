# lcs-engagement-tracker
LCS Engagement Tracker helps manage our creator engagement community by tracking daily participation, reminding members to engage, flagging skipped tasks and low-quality comments, monitoring link submissions, and generating daily reports. Built to encourage genuine, meaningful engagement, accountability, and fair community rules.


## Commands on the deadline prototype branch

- `/start`, `/help` — start the bot and show help.
- `/rules` — show engagement rules.
- `/tasks` — list your open tracked tasks.
- `/done TASK_ID | comment` — self-report a completed task with the comment left.
- `/review` — admin queue of overdue tasks awaiting manual review.
- `/approve TASK_ID USER_ID` — confirm an overdue miss and record the next warning.
- `/dismiss TASK_ID USER_ID` — dismiss an overdue review without a warning.
- `/review_done` — admins review recent completion comments.
- `/edit_done TASK_ID USER_ID | corrected comment` — admins correct a completion comment; the previous comment is retained in edit history.
- `/warn @username reason` — issue a private warning.
- `/finalwarn @username reason --to=private|group|log` — issue a final warning privately, in the current group, or in a configured admin log chat.
- `/report` — admin tracker summary.
- `/admin` — admin command help.

The `log` destination requires `FINAL_WARNING_CHAT_ID` in the host's environment and the bot must be able to send messages to that chat. Telegram bots cannot send directly to an administrator's personal Saved Messages. Public group warnings may expose sensitive moderation information, so use them only when appropriate. Commands and behaviors should be tested in a separate test group before production.

## Admin behavior

- Admins can post normal messages and Instagram links without the bot blocking or deleting their posts.
- Instagram links posted in the group are recorded as tasks for members.
- Admins can use `/admin`, `/report`, and `/flags`.
- `/flags` shows potentially weak/generic completion comments for manual review. Flags are not proof of a violation.
- The bot does not automatically ban members or delete posts.
- `/done TASK_ID | comment` records a self-report. The bot cannot independently verify Instagram likes or saves.

## Free Cloudflare Workers webhook version

The `cloudflare-worker.js` file is a webhook version configured for Cloudflare Workers on the `nightly-deadline-review` branch. It creates a task when a group member posts an Instagram link, sets a rolling 24-hour deadline, sends private overdue reminders during the nightly Georgia-time review window, and queues overdue reports for an admin to review. Members must open the bot privately and press Start before Telegram allows private reminders. The Worker cannot verify Instagram activity.

The Worker currently supports the core commands `/start`, `/rules`, `/tasks`, `/done`, `/report`, `/review`, `/approve`, `/dismiss`, `/warn`, `/finalwarn`, and `/admin`. The Python prototype has additional completion-review and warning-destination commands that are not yet mirrored in the Worker.

Cloudflare is configured to build this branch from GitHub. The repository includes `wrangler.jsonc` with a KV binding and nightly schedule. Keep `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`, and `SETUP_KEY` in Cloudflare's encrypted Worker secrets; never commit them or paste them into chat. The setup route first checks Telegram's current webhook and refuses to replace a different webhook. If the webhook is empty, confirm no polling bot is running before registering it.

### Important limitations

- Cloudflare KV stores task data, but updates are not transactional and simultaneous changes can race. This is intended for a small community prototype.
- A Worker deployment does not connect the bot until secrets are configured and the webhook is safely registered.
- Do not run the Python polling prototype and Worker webhook with the same bot token at the same time.
- The free plan has usage limits and may change. The Worker avoids an always-on paid background process by using scheduled runs.

## Deadline-based prototype branch

The `nightly-deadline-review` branch also contains the Python polling prototype in `deadline_bot.py`, with the expanded command set above. GitHub code is not live by itself. Before switching either version onto the bot token, identify the current bot setup and safely stop any existing polling process or webhook.
