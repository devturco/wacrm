import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The migration that creates the lead-origin tables.
 *
 * The rules this file protects:
 *
 *   - the tables are NEW — no existing table changes shape;
 *   - the columns the app reads exist with the shape the app expects;
 *   - a member can read, and nobody but the service role writes;
 *   - `redeem_invitation` refuses to move an account that already has
 *     lead data (the rows would be dropped with the account).
 *
 * It reads the SQL off the disk — the same file the operator runs on
 * Supabase. A green test here does NOT mean the database has the
 * tables: only running the migration does.
 */

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

const leadMigration = migrations.find((m) => m.name.startsWith("067_"));
if (!leadMigration) throw new Error("Migration 067_lead_origin.sql not found");
const sql = leadMigration.sql;

describe("lead_settings", () => {
  it("is a new table keyed by the account", () => {
    expect(sql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+lead_settings/i,
    );
    expect(sql).toMatch(
      /lead_settings[\s\S]*?account_id\s+uuid\s+primary\s+key\s+references\s+accounts\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    );
  });

  it("has a unique capture key, the enable flag, the host allowlist and the links", () => {
    expect(sql).toMatch(/capture_key\s+text\s+not\s+null\s+unique/i);
    expect(sql).toMatch(/enabled\s+boolean\s+not\s+null\s+default\s+true/i);
    expect(sql).toMatch(/allowed_hosts\s+text\[\]\s+not\s+null\s+default\s+'\{\}'/i);
    expect(sql).toMatch(/links\s+jsonb\s+not\s+null\s+default\s+'\[\]'/i);
  });

  it("is readable by the account members", () => {
    expect(sql).toMatch(
      /create\s+policy\s+"Members can read lead settings"[\s\S]*?using\s*\(\s*is_account_member\s*\(\s*account_id\s*\)/i,
    );
  });
});

describe("lead_origins", () => {
  it("is a new table with a nullable contact (pending) and a primary flag", () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+lead_origins/i);
    expect(sql).toMatch(
      /contact_id\s+uuid\s+references\s+contacts\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    );
    expect(sql).toMatch(/is_primary\s+boolean\s+not\s+null\s+default\s+false/i);
  });

  it("allows only the seven known channels", () => {
    expect(sql).toMatch(
      /channel\s+text\s+not\s+null\s+check\s*\(\s*channel\s+in\s*\(\s*'whatsapp'\s*,\s*'instagram_dm'\s*,\s*'instagram_comment'\s*,\s*'tiktok_dm'\s*,\s*'tiktok_lead'\s*,\s*'web'\s*,\s*'direct'\s*\)\s*\)/i,
    );
  });

  it("allows only the four known providers", () => {
    expect(sql).toMatch(
      /provider\s+text\s+check\s*\(\s*provider\s+in\s*\(\s*'meta'\s*,\s*'whatsmiau'\s*,\s*'tiktok'\s*,\s*'web'\s*\)\s*\)/i,
    );
  });

  it("keeps the utm, click-id and social axes in their own columns", () => {
    for (const column of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "landing_path",
      "referrer",
      "click_ids",
      "ad_id",
      "adset_id",
      "campaign_id",
      "creative_id",
      "post_id",
      "external_id",
      "lead_token",
      "link_code",
      "phone",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, "i"));
    }
    expect(sql).toMatch(/click_ids\s+jsonb\s+not\s+null\s+default\s+'\{\}'/i);
    expect(sql).toMatch(/meta\s+jsonb\s+not\s+null\s+default\s+'\{\}'/i);
  });

  it("creates every index the spec lists", () => {
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*contact_id\s*\)/i);
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*phone\s*\)/i);
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*lead_token\s*\)/i);
    expect(sql).toMatch(
      /create\s+unique\s+index[\s\S]*?on\s+lead_origins\s*\(\s*contact_id\s*\)\s+where\s+is_primary\s+and\s+contact_id\s+is\s+not\s+null/i,
    );
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*campaign_id\s*\)/i);
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*post_id\s*\)/i);
    expect(sql).toMatch(
      /create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*touched_at\s*\)\s+where\s+contact_id\s+is\s+null/i,
    );
    expect(sql).toMatch(/create\s+index[\s\S]*?using\s+gin\s*\(\s*meta\s*\)/i);
  });

  it("is readable by the account members and writable by nobody else", () => {
    expect(sql).toMatch(
      /create\s+policy\s+"Members can read lead origins"[\s\S]*?using\s*\(\s*is_account_member\s*\(\s*account_id\s*\)/i,
    );
    expect(sql).not.toMatch(
      /create\s+policy[^;]*on\s+lead_origins[^;]*for\s+(insert|update|delete)/i,
    );
  });
});

describe("a migration that only creates tables", () => {
  it("never alters an existing table", () => {
    // `lead_settings` and `lead_origins` are the tables THIS migration
    // creates, so the ALTER that enables RLS on them is expected.
    const altered = [...sql.matchAll(/alter\s+table\s+(?!lead_)([a-z_]+)/gi)]
      .map((m) => m[1].toLowerCase());
    expect(altered).toEqual([]);
  });

  it("never adds a column to an existing table", () => {
    expect(sql).not.toMatch(/add\s+column/i);
  });
});

describe("redeem_invitation", () => {
  it("refuses to move an account that already has lead data", () => {
    const fn = sql.slice(
      sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.redeem_invitation"),
    );
    expect(fn).toMatch(/union\s+all\s+select\s+1\s+from\s+lead_settings/i);
    expect(fn).toMatch(/union\s+all\s+select\s+1\s+from\s+lead_origins/i);
  });
});
