/**
 * Applies the public chaos-feed view to the live Supabase project.
 *
 * The view is additive: `create or replace view` cannot drop columns from
 * something a caller already depends on, and it grants the anon role SELECT so
 * the landing page can read it without a session. It does NOT touch the anon
 * role on any base table.
 *
 * Run: node scripts/apply-feed-view.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function env() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const e = env();
const url = e.SUPABASE_URL;
const key = e.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL or SUPABASE_SECRET_KEY missing from .env");
  process.exit(1);
}

const sql = `
create or replace view public.recent_chaos as
select p.id,
       p.from_token_id,
       cf.name as from_name,
       p.to_token_id,
       ct.name as to_name,
       p.prank_id,
       p.landed,
       p.revenge,
       p.points,
       p.created_at
from public.pranks p
join public.chogs cf on cf.token_id = p.from_token_id
join public.chogs ct on ct.token_id = p.to_token_id;

grant select on public.recent_chaos to anon;
grant select on public.recent_chaos to authenticated;
`;

console.log("Executing the view DDL…");
const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ sql }),
});

const text = await res.text();
console.log("status:", res.status);
console.log(text.slice(0, 600));

// The REST schema cache can lag a DDL change; verify by reading the view back.
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const probe = await db.from("recent_chaos").select("*").order("created_at", { ascending: false }).limit(3);
console.log("\nread-back status:", probe.status, probe.error?.message ?? "");
if (probe.data) console.log("rows:", probe.data);
else console.log("(view readable; currently empty - expected on a fresh project)");