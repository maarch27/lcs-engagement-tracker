# lcs-engagement-tracker
LCS Engagement Tracker helps manage our creator engagement community by tracking daily participation, reminding members to engage, flagging skipped tasks and low-quality comments, monitoring link submissions, and generating daily reports. Built to encourage genuine, meaningful engagement, accountability, and fair community rules.


## Admin behavior

- Admins can post normal messages and Instagram links without the bot blocking or deleting their posts.
- Instagram links posted in the group are recorded as tasks for members.
- Admins can use `/admin`, `/report`, and `/flags`.
- `/flags` shows potentially weak/generic completion comments for manual review. Flags are not proof of a violation.
- The bot does not automatically ban members or delete posts.
- `/done TASK_ID | comment` records a self-report. The bot cannot independently verify Instagram likes or saves.

## Free Cloudflare Workers webhook version

The `cloudflare-worker.js` file is the webhook-based version intended for Cloudflare Workers. The existing `bot.py` is the Python long-polling version; do not run both against the same Telegram bot token at the same time.

### Setup

1. In Cloudflare, create a Worker and paste the full contents of `cloudflare-worker.js` into its editor, then deploy it.
2. In **Storage & databases → KV**, create a KV namespace and add it to the Worker as a binding named exactly `LCS_DATA`.
3. In the Worker settings, add these encrypted secrets:
   - `TELEGRAM_BOT_TOKEN`: your bot token from BotFather. Never commit it to this repository.
   - `WEBHOOK_SECRET`: a random 32-character string using letters, numbers, underscores, or hyphens.
   - `SETUP_KEY`: a different long random secret used only once to register the webhook.
4. Copy the deployed Worker URL. Open `<WORKER_URL>/setup?key=<SETUP_KEY>` once, replacing the placeholders locally. The response should show Telegram's `"ok": true`. Do not share the setup URL. Then remove the `SETUP_KEY` secret from Worker settings so the setup route can no longer be used.
5. Add the bot to your Telegram group. To read ordinary group messages and Instagram links, open @BotFather, use `/setprivacy`, select the bot, choose **Disable**, and remove/re-add the bot to the group if needed. Grant the bot the group access it needs.
6. Test `/start`, `/admin`, `/tasks`, and `/report` in the group.

### Important limitations

- This Worker uses Cloudflare KV to store task data. KV is suitable for a small community prototype, but writes are not transactional and simultaneous updates can race.
- Completion is self-reported; the bot cannot confirm Instagram likes/saves through Telegram.
- The Worker code is prepared but has not yet been deployed or tested against your live Telegram bot.
- Cloudflare free-plan limits and account requirements can change; check your dashboard before deployment.
