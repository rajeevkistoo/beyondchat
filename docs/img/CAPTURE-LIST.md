# Screenshots for setup.html

Twelve shots. `setup.html` picks them up automatically from this folder — each
`<img>` deletes itself when the file is missing, so the page stays clean while
you work through the list.

**Don't do this by hand. Run:**

```bash
npm run shots
```

It walks the list one at a time, tells you what to put on screen, and saves each
capture under the right filename. Press Enter to capture, `s` to skip, `q` to
stop — already-captured shots are skipped, so you can do it over several sittings.
`npm run shots -- --redo` recaptures everything.

macOS only (it uses `screencapture -i`), and macOS will ask for Screen Recording
permission the first time. Grant it and run again — without it every capture
saves blank.

The table below is what the script walks through, kept here for reference and
for anyone on Windows doing it by hand.

**Save each one at exactly the filename below.** Crop to the panel that matters,
not the whole 27-inch screen; these are read on a laptop at half width.

| # | filename | what to capture |
| --- | --- | --- |
| 1 | `vscode-claude.png` | VS Code with the Claude Code extension open on a project — file tree left, Claude right |
| 2 | `docker-running.png` | Docker Desktop showing containers running, with the menu-bar whale visible if you can get both |
| 3 | `cf-nameservers.png` | The Cloudflare screen listing the two nameservers to set at your registrar |
| 4 | `cf-tunnel-hostname.png` | Zero Trust → Tunnels → the public hostname form, filled in: subdomain `dm`, service `http://localhost:3000` |
| 5 | `meta-create-app.png` | Meta's use-case picker with **Instagram** selected |
| 6 | `meta-oauth-redirect.png` | The OAuth redirect URI field with a callback URL in it |
| 7 | `meta-webhook-config.png` | Instagram use case → Customize → Configure webhooks, showing `comments` subscribed |
| 8 | `meta-tester-invite.png` | App roles → Roles → Instagram testers, with an invite sent |
| 9 | `ig-tester-invite.png` | **Phone.** Instagram → Edit profile → Apps and websites → Tester invites, showing Accept |
| 10 | `meta-publish.png` | The left-hand menu with **Publish** visible — this is the one nobody can find |
| 11 | `app-connect-instagram.png` | Instagram's permission/approval screen during Connect Instagram |
| 12 | `dm-received.png` | The payoff: the comment and the DM that followed. Best shot on the page — make it a good one |

## Before you save any of these

**Redact:** app IDs, app secrets, tokens, your email, phone numbers, and any
other client's name in a browser tab or sidebar. Black box over them, not a blur —
blur can be reversed.

**Never capture the app-secrets screen at all.** There's deliberately no entry
for it in the list above. That page holds credentials to your Meta app, and a
screenshot of it is the single most damaging file you could put in a public repo.

## They go stale

Meta and Instagram move these screens every few months. When one no longer
matches, delete the file rather than leaving it — a confidently wrong screenshot
sends someone hunting for a button that isn't there any more, which is worse
than no picture at all.
