# BeyondChat

Instagram comment-to-DM automation, plus an AI agent that answers the replies.

Someone comments `PLAYBOOK` on your reel and gets a DM with your link about a second later. When they write back — because most tools stop dead at that point — a Claude agent picks up the conversation, answers from a brief you wrote, tags them, and hands them to you when it should.

**This is a fork.** The comment-to-DM engine is [diwenne/openreply](https://github.com/diwenne/openreply) (MIT), which is itself a fork of [im-anishraj/instagram-comment-to-dm](https://github.com/im-anishraj/instagram-comment-to-dm). I did not build that part. What I added is the agent loop and the ops layer described below.

## Why this exists

I run a small business. I was paying for a tool to do one thing, and the thing it did stopped exactly where the actual conversation started — the DM goes out, the person replies, and nobody is there.

I am not a developer. I have never written a line of production code. I found an open-source project that already did the hard part, understood it, and made it do the part I needed. That took a weekend, not a quarter, which is the only reason it exists at all.

So this repo is less a product than a worked example: what "use AI as a co-founder rather than a tool" looks like when you actually ship the result.

## What I added on top of OpenReply

**The DM agent** (`lib/agent/`). A reply to a campaign DM gets answered by a Claude tool-calling loop instead of falling into a void.

- The loop can do exactly four things: `send_link`, `tag_contact`, `book_call`, `handoff_to_me`. That list is the entire blast radius — the model never touches Instagram or the database directly.
- House rules in `systemPrompt()` override the brief you write, not the other way round. The first one is that the agent **qualifies, it never assesses**: it does not tell a stranger whether they qualify, quote a price, or give a verdict. It gathers and hands off.
- Two independent stop conditions: a per-conversation turn ceiling and a per-turn tool-iteration ceiling. Hitting either hands off to a human rather than going quiet.
- A handed-off thread is never auto-answered again.
- Off by default, per campaign. Without an `ANTHROPIC_API_KEY` it declines silently and the plain keyword autoreply handles the message.

**The ops layer** (`ops/`). This runs on a laptop, not a datacenter, so it has to survive reboots and sleep.

- `ensure-up.sh` — idempotent boot script and watchdog. Starts only what is missing, restarts the worker on a stale heartbeat, restarts the tunnel when the *public* URL stops answering. Run it from launchd or cron every few minutes.
- `refresh-tokens.sh` — the daily jobs a serverless cron config would have run. This is what stops the Instagram token expiring silently at 60 days.

The failure both of these exist to prevent is silence. A dead worker still lets webhooks arrive and return 200, so Instagram sees success and the DM never sends. Nothing surfaces unless something is actively checking.

## Four things that went wrong, which is the interesting part

The build was a few hours of work and about the same again of being confidently misled. Every one of these looked like success:

1. **Meta returned `data: []` for the comments on every post**, with valid paging cursors, while `comments_count` said 3. Not a bug and not an empty post — an unpublished app has its comment data redacted, and redaction is indistinguishable from "no comments."
2. **I diagnosed a missing webhook subscription** from `GET /{app-id}/subscriptions` returning empty. It was wrong. Instagram-Login apps register against the *Instagram* app ID, so that endpoint is a guaranteed false negative.
3. **The watchdog launched a duplicate of every service, every five minutes.** `screen -ls | grep -q` under `set -o pipefail`: `screen -ls` exits 1 even on success, pipefail lets that status win, so the "is it running?" check always answered no.
4. **Auto-start installed cleanly and did nothing.** macOS refuses launchd-spawned scripts any access to `~/Desktop`, and the error went only to the job's own stderr log. That is why the project cannot live in Desktop, Documents or Downloads.

None of these threw an error where anyone would see one. That is the actual lesson of building this way: the tooling is good enough that the constraint is no longer *can you build it* — it is **will you know when it is wrong**.

## Support

**There is none.** This is my own instance, published because the story is worth telling, not because I am maintaining it for anyone. Issues are not monitored and pull requests are not reviewed.

If you want the well-supported version of the comment-to-DM engine, go to [diwenne/openreply](https://github.com/diwenne/openreply) — it is actively maintained and the setup guide there is genuinely good.

## Running it

The engine's setup is unchanged from upstream, and the Meta app configuration is the part that takes real time. Read [docs/setup.md](docs/setup.md) first.

```bash
npm install
cp .env.example .env      # fill it in, see docs/setup.md
docker compose up -d      # Postgres and Redis
npm run db:migrate
npm run dev               # web app + webhook receiver
npm run worker            # second terminal — this is what sends the DMs
```

Two processes, always. If comments arrive and no DM does, check the worker first.

For the agent, add `ANTHROPIC_API_KEY` to `.env` (`AGENT_MODEL` defaults to `claude-sonnet-5`), then turn it on per campaign under **"And if they reply"**.

If you expose the dev server through a tunnel, set `DEV_TUNNEL_HOST` and `BEYONDCHAT_PUBLIC_URL` in `.env` — without the first, the page renders as a permanent loading skeleton.

## Stack

Next.js 16, React 19, Prisma 7 on Postgres, BullMQ on Redis, Auth.js magic links, Tailwind, the official Instagram API with Instagram Login, and the Anthropic Messages API for the agent. Full breakdown in [docs/stack.md](docs/stack.md).

## Credits

Comment-to-DM engine by [Diwen Huang](https://github.com/diwenne), originally by [Anish Raj](https://github.com/im-anishraj). Both MIT.

Agent loop and ops layer by [Rajeev Kistoo](https://rajeevkistoo.com).

## License

MIT. See [LICENSE](LICENSE).
