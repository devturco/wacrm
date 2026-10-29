import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

/**
 * A ultima migration que escreve no bucket `chat-media`.
 *
 * O bucket e recriado a cada migration que muda a politica (023, 039,
 * 066...). A que vale e a ultima -- as anteriores sao sobrescritas pelo
 * `ON CONFLICT (id) DO UPDATE`.
 */
function latestChatMediaBucketSql(): string {
  const relevant = migrations.filter(
    ({ sql }) =>
      /insert\s+into\s+storage\.buckets/i.test(sql) &&
      /'chat-media'/i.test(sql),
  );
  const latest = relevant.at(-1);
  if (!latest) throw new Error("No migration defines the chat-media bucket");
  return latest.sql;
}

describe("chat-media bucket policy", () => {
  const sql = latestChatMediaBucketSql();

  it("stops the bucket at 100 MB", () => {
    expect(sql).toMatch(/file_size_limit[\s\S]*?104857600/i);
  });

  it("accepts any format through the octet-stream catch-all", () => {
    expect(sql).toContain("'application/octet-stream'");
  });

  it("never serves active content inline", () => {
    expect(sql).not.toMatch(/'text\/html'/);
    expect(sql).not.toMatch(/'image\/svg\+xml'/);
    expect(sql).not.toMatch(/'application\/xhtml\+xml'/);
  });

  it("keeps the safe inline types", () => {
    expect(sql).toContain("'application/pdf'");
    expect(sql).toContain("'image/png'");
    expect(sql).toContain("'video/mp4'");
    expect(sql).toContain("'audio/ogg'");
    expect(sql).toContain("'application/vnd.oasis.opendocument.text'");
  });

  it("keeps the bucket public so the provider can fetch the media", () => {
    expect(sql).toMatch(/public[\s\S]*?TRUE/i);
  });
});

describe("media_settings migration", () => {
  const sql = migrations
    .map((m) => m.sql)
    .join("\n");

  it("creates the table with the account as the primary key", () => {
    expect(sql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+media_settings/i,
    );
    expect(sql).toMatch(
      /media_settings[\s\S]*?account_id\s+uuid\s+primary\s+key\s+references\s+accounts\s*\(\s*id\s*\)/i,
    );
  });

  it("only allows the two known backends", () => {
    expect(sql).toMatch(/backend\s+text[\s\S]*?check\s*\(\s*backend\s+in\s*\(\s*'supabase'\s*,\s*'r2'\s*\)/i);
  });

  it("is guarded by the account membership", () => {
    expect(sql).toMatch(
      /create\s+policy\s+"Members can read media settings"[\s\S]*?using\s*\(\s*is_account_member\s*\(\s*account_id\s*\)/i,
    );
  });
});
