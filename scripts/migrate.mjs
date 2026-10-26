// Aplica las migraciones SQL de supabase/migrations en orden, una sola vez cada una.
// Uso: DATABASE_URL=postgres://... npm run db:migrate
// Solo ejecuta migraciones nuevas; nunca borra datos existentes.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

for (const f of [".env.local", ".env"]) {
  try { process.loadEnvFile(f); } catch { /* opcional */ }
}

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (o MIGRATE_DATABASE_URL).");
  process.exit(1);
}

const dir = path.resolve("supabase/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });

try {
  await sql`create table if not exists public.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from public.schema_migrations`).map((r) => r.name));
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    console.log(`→ aplicando ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
      await tx`insert into public.schema_migrations (name) values (${file})`;
    });
    applied++;
  }
  console.log(applied ? `✔ ${applied} migración(es) aplicada(s)` : "✔ base de datos al día");
} catch (err) {
  console.error("✖ error de migración:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
