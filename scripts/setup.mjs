#!/usr/bin/env node
/**
 * One-command local setup.
 *
 * Generates every secret, finds ports that are actually free, starts Postgres
 * and Redis, and runs the migrations. The goal is that somebody who has never
 * opened a terminal can get from a downloaded folder to a running app without
 * editing a config file.
 *
 * Safe to re-run: existing .env values are never overwritten, so it doubles as
 * a repair tool when something is missing.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const amber = (s) => `\x1b[33m${s}\x1b[0m`;

const step = (n, msg) => console.log(`\n${bold(`[${n}/6]`)} ${msg}`);
const ok = (msg) => console.log(`  ${green("✓")} ${msg}`);
const note = (msg) => console.log(`  ${dim(msg)}`);

function die(msg, fix) {
  console.error(`\n  ${amber("✗")} ${msg}`);
  if (fix) console.error(`  ${dim(fix)}`);
  process.exit(1);
}

/**
 * Ports already published by a container, on any project. Docker binds these on
 * all interfaces including IPv6, and a container in another project is invisible
 * to a plain socket probe on some setups — so ask Docker directly as well.
 */
function dockerPublishedPorts() {
  try {
    const out = execFileSync("docker", ["ps", "--format", "{{.Ports}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(
      [...out.matchAll(/:(\d+)->/g)].map((m) => Number(m[1])),
    );
  } catch {
    return new Set();
  }
}

/**
 * Bind with no host, so Node listens dual-stack the way Docker publishes.
 * Probing 127.0.0.1 alone misses a container bound to IPv6 *:port and hands
 * back a port that compose then fails to allocate.
 */
function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => srv.close(() => resolve(true)))
      .listen(port);
  });
}

const taken = dockerPublishedPorts();

async function pickPort(preferred) {
  for (let p = preferred; p < preferred + 40; p++) {
    if (taken.has(p)) continue;
    if (await portFree(p)) {
      taken.add(p); // never hand the same port to two services in one run
      return p;
    }
  }
  die(`No free port near ${preferred}.`);
}

// ── 1. Docker ───────────────────────────────────────────────────────────────
step(1, "Checking Docker");
try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
  ok("Docker is running");
} catch {
  die(
    "Docker is not running.",
    "Open Docker Desktop, wait for the whale icon to stop animating, then run this again.\n  Not installed? https://www.docker.com/products/docker-desktop/",
  );
}

// ── 2. Ports ────────────────────────────────────────────────────────────────
step(2, "Finding free ports");

const envPath = join(ROOT, ".env");
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
// Two questions, not one: `has` is "already set to something", `present` is
// "the line exists at all". Placeholders are deliberately empty, so testing them
// with `has` re-appends them on every run until .env has the same key ten times.
const has = (key) => new RegExp(`^${key}=.+`, "m").test(existing);
const present = (key) => new RegExp(`^${key}=`, "m").test(existing);
const envValue = (key) =>
  (new RegExp(`^${key}=(.+)$`, "m").exec(existing)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");

/**
 * A port already recorded in .env must be reused, not re-picked. On a second run
 * our own containers hold those ports, so a fresh probe would call them taken,
 * move compose to a new port, and leave .env pointing at the old one — a stack
 * that starts cleanly and then cannot be reached.
 */
function portFor(key, preferred) {
  const found = /:(\d+)(?=\/|$)/.exec(envValue(key));
  if (found) {
    const p = Number(found[1]);
    taken.add(p);
    return p;
  }
  return pickPort(preferred);
}

const pgPort = await portFor("DATABASE_URL", 5432);
const redisPort = await portFor("REDIS_URL", 6379);
const webPort = await portFor("NEXTAUTH_URL", 3000);
const smtpPort = await portFor("EMAIL_SERVER", 1025);
const mailPort = await portFor("MAILDEV_URL", 1080);
ok(`Postgres ${pgPort} · Redis ${redisPort} · web ${webPort}`);
if (pgPort !== 5432 || redisPort !== 6379 || webPort !== 3000) {
  note("Defaults were taken by something else on this machine — these are used instead.");
}

// compose appends port lists instead of replacing them, so !override is required
writeFileSync(
  join(ROOT, "docker-compose.override.yml"),
  `# Written by \`npm run setup\`. Ports chosen because the defaults were in use.
# !override replaces the base port list; without it compose appends and re-binds
# the taken port.
services:
  postgres:
    ports: !override
      - "${pgPort}:5432"

  redis:
    ports: !override
      - "${redisPort}:6379"

  # Catches login emails locally, so no mail account is needed to sign in.
  maildev:
    image: maildev/maildev:2.1.0
    ports:
      - "${smtpPort}:1025"
      - "${mailPort}:1080"
`,
);
ok("docker-compose.override.yml written");

// ── 3. Secrets and .env ─────────────────────────────────────────────────────
step(3, "Generating secrets");

const generated = {
  NEXTAUTH_SECRET: () => randomBytes(32).toString("hex"),
  CRON_SECRET: () => randomBytes(24).toString("hex"),
  WEBHOOK_VERIFY_TOKEN: () => randomBytes(16).toString("hex"),
  ENCRYPTION_KEY: () => randomBytes(32).toString("hex"), // must be 64 hex chars
};

const defaults = {
  NEXTAUTH_URL: `http://localhost:${webPort}`,
  DATABASE_URL: `postgresql://postgres:postgres@localhost:${pgPort}/openreply`,
  REDIS_URL: `redis://localhost:${redisPort}`,
  EMAIL_SERVER: `smtp://localhost:${smtpPort}`,
  EMAIL_FROM: "BeyondChat <login@localhost>",
  MAILDEV_URL: `http://localhost:${mailPort}`,
  META_GRAPH_API_VERSION: "v25.0",
};

const added = [];
let out = existing.trimEnd();
if (out) out += "\n";
else out = "# Written by `npm run setup`. Never commit this file.\n";

for (const [key, make] of Object.entries(generated)) {
  if (has(key)) continue;
  out += `${key}=${make()}\n`;
  added.push(key);
}
for (const [key, value] of Object.entries(defaults)) {
  if (has(key)) continue;
  out += `${key}=${value}\n`;
  added.push(key);
}
// Placeholders, so the file shows what is still needed instead of failing blind.
for (const key of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "FACEBOOK_APP_SECRET"]) {
  if (present(key)) continue;
  out += `${key}=\n`;
}

writeFileSync(envPath, out, { mode: 0o600 });

// Read the URL back out rather than reusing the one we may not have written —
// a re-run keeps whatever was already in .env, and the migration must use that.
const dbUrl = /^DATABASE_URL=(.+)$/m.exec(out)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!dbUrl) die("No DATABASE_URL in .env.", "Delete .env and run this again.");
ok(added.length ? `${added.length} values written to .env (mode 600)` : ".env already complete — nothing overwritten");

// ── 4. Start the datastores ─────────────────────────────────────────────────
step(4, "Starting Postgres, Redis and the mail catcher");
if (spawnSync("docker", ["compose", "up", "-d"], { cwd: ROOT, stdio: "inherit" }).status !== 0) {
  die("docker compose failed.", "Scroll up for the reason — it is usually a port still in use.");
}
ok("Containers up");

// ── 5. Wait for Postgres, then migrate ──────────────────────────────────────
step(5, "Waiting for the database");
let ready = false;
for (let i = 0; i < 30; i++) {
  const r = spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "postgres"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  if (r.status === 0) { ready = true; break; }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) die("Postgres did not come up within 30 seconds.", "Try: docker compose logs postgres");
ok("Database accepting connections");

step(6, "Creating the tables");
if (
  spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: dbUrl },
  }).status !== 0
) {
  die("Migration failed.", "Scroll up for the reason.");
}
ok("Tables created");

// ── Done ────────────────────────────────────────────────────────────────────
console.log(`
${green(bold("Setup complete."))}

${bold("Start it with two terminals:")}
  ${bold(`npm run dev -- -p ${webPort}`)}   ${dim("the app and the webhook receiver")}
  ${bold("npm run worker")}${" ".repeat(Math.max(1, 16 - String(webPort).length))}${dim("this is what actually sends the DMs")}

${dim(`Both are required. Without the worker, comments arrive and no DM ever sends —
and the app looks completely fine.`)}

${bold("Then open")} http://localhost:${webPort}
  Sign in with any email. ${bold("The magic link is printed in the terminal")} —
  no mail account needed. It is also in the inbox at http://localhost:${mailPort}

${amber("Still to do:")} INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET and FACEBOOK_APP_SECRET
are empty in .env. You get those when you create your Meta app — ${bold("setup.html")}
walks you through it, and your ${bold("WEBHOOK_VERIFY_TOKEN")} is already in .env ready to paste.
`);
