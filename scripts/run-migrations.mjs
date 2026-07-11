#!/usr/bin/env node
// Prisma-`migrate deploy`-style runner: applies every not-yet-applied file
// in supabase/migrations/*.sql (in filename order) against DATABASE_URL,
// tracking what's been applied in public._migrations so re-running is safe.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function loadEnvLocal() {
  let content;
  try {
    content = readFileSync(path.join(projectRoot, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (checked .env.local and the environment).");
  process.exit(1);
}

const migrationsDir = path.join(projectRoot, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  await client.query(`
    create table if not exists public._migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await client.query("select name from public._migrations");
  const applied = new Set(rows.map((r) => r.name));

  // Bootstrap: if 0001_init.sql was already applied by hand (e.g. pasted
  // into the Supabase SQL editor before this script existed), detect that
  // via the table it creates and record it instead of re-running it (its
  // `create policy` statements aren't guarded with IF NOT EXISTS and would
  // error on a second run).
  if (!applied.has("0001_init.sql") && files.includes("0001_init.sql")) {
    const { rows: existing } = await client.query("select to_regclass('public.books') as reg");
    if (existing[0]?.reg) {
      console.log("- 0001_init.sql: detected existing schema, marking as already applied");
      await client.query("insert into public._migrations (name) values ($1)", ["0001_init.sql"]);
      applied.add("0001_init.sql");
    }
  }

  let ranAny = false;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`- ${file} already applied, skipping`);
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`> Applying ${file} ...`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public._migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`  done.`);
      ranAny = true;
    } catch (err) {
      await client.query("rollback");
      console.error(`  failed: ${err.message}`);
      throw err;
    }
  }

  if (!ranAny) console.log("Nothing new to apply — database is up to date.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
