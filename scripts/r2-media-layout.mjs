// O PLANO da reorganização do bucket do R2 — a parte que só lê.
//
//   <empresa>-<id8>/avatar/...
//   <empresa>-<id8>/midias/...
//   <empresa>-<id8>/documentos/...
//
// O caminho antigo era `account-<uuid>/<pasta>/<arquivo>`. O caminho novo
// sai da pasta da EMPRESA — é o que deixa o bucket navegável — e o
// último segmento continua sendo o nome do arquivo.
//
// As REGRAS de nome não são reescritas aqui: o script importa
// `src/lib/media/layout.ts`, o mesmo módulo que o app usa — assim o
// plano não pode divergir do que o app vai gravar amanhã.
//
// As credenciais saem do .env.local e não são impressas.

import { readFileSync } from "node:fs";
import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { companyFolder, encodeObjectPath, folderForFile, inboundSegment, mediaPath } =
  await jiti.import("../src/lib/media/layout.ts");

export function envValue(name) {
  const raw = readFileSync(".env.local", "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

const accountIdEnv = envValue("R2_ACCOUNT_ID");
const accessKeyId = envValue("R2_ACCESS_KEY_ID");
const secretAccessKey = envValue("R2_SECRET_ACCESS_KEY");

export const bucket = envValue("R2_BUCKET") || "crmbr-media";
export const publicBase = (envValue("MEDIA_PUBLIC_BASE_URL") || "").replace(/\/$/, "");

export const hasCredentials = Boolean(accountIdEnv && accessKeyId && secretAccessKey);

const client = new AwsClient({
  accessKeyId,
  secretAccessKey,
  region: "auto",
  service: "s3",
});

/** O cliente assinado — quem escreve no bucket usa este. */
export function r2Client() {
  return client;
}

export const endpoint = `https://${accountIdEnv}.r2.cloudflarestorage.com/${bucket}`;

export async function listObjects() {
  const objects = [];
  let token = null;
  do {
    const url = new URL(endpoint);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);
    const res = await client.fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`listagem falhou: ${res.status}`);
    const xml = await res.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) objects.push(match[1]);
    token = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? null;
  } while (token);
  return objects;
}

export async function headObject(key) {
  const res = await client.fetch(`${endpoint}/${key}`, { method: "HEAD" });
  if (!res.ok) throw new Error(`HEAD falhou para ${key}: ${res.status}`);
  return {
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    contentLength: Number(res.headers.get("content-length") ?? "0"),
    lastModified: res.headers.get("last-modified"),
  };
}

export function publicUrlOf(key) {
  return `${publicBase}/${encodeObjectPath(key)}`;
}

// --- banco --------------------------------------------------------------

export const supabase = createClient(
  envValue("NEXT_PUBLIC_SUPABASE_URL"),
  envValue("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

/** Tabelas com uma coluna que aponta para um arquivo do bucket. */
const URL_COLUMNS = [
  { table: "messages", column: "media_url" },
  { table: "contacts", column: "avatar_url" },
  { table: "message_templates", column: "header_media_url" },
  { table: "profiles", column: "avatar_url" },
];

/**
 * O caminho novo de cada objeto com o caminho antigo, e as linhas do
 * banco que apontam para eles.
 *
 * A lista vem do próprio bucket — o que o script resolve, é o que ele
 * migra. Não há lista escrita à mão para desatualizar.
 */
export async function buildPlan() {
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, name");
  if (accountsError) throw new Error(`não consegui ler as contas: ${accountsError.message}`);
  const accountById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

  const objects = await listObjects();
  const oldObjects = objects.filter((key) => key.startsWith("account-"));

  const plan = [];

  for (const key of oldObjects) {
    const parts = key.split("/");
    const accountUuid = parts[0].replace("account-", "");
    const root = companyFolder(accountById.get(accountUuid) ?? null, accountUuid);

    const kind = parts[1] ?? "";
    const segments = parts.slice(2);
    const fileName = segments[segments.length - 1];

    const meta = await headObject(key);
    let folder = folderForFile(fileName, meta.contentType);
    let segment = null;
    let name = fileName;

    if (kind === "avatar" || kind === "avatars") {
      // A foto do contato: o nome já é o id dele, então não há pasta.
      folder = "avatar";
    } else if (kind === "inbound") {
      // `inbound/<media id>/<arquivo>` — o id do provedor é o que vira
      // a pasta, no app.
      segment = inboundSegment(segments[0] ?? "", meta.lastModified ?? undefined);
      folder = folderForFile(fileName, meta.contentType);
    } else {
      // `account-<uuid>/<epoch-ms>-<nome>.<ext>` — a subida antiga.
      const stamp = /^(\d{10,13})-(.+)$/.exec(fileName);
      if (stamp) {
        const millis = Number(stamp[1]) >= 1e12 ? Number(stamp[1]) : Number(stamp[1]) * 1000;
        name = stamp[2];
        segment = inboundSegment(key, millis);
      }
      folder = folderForFile(name, meta.contentType);
    }

    plan.push({ key, newKey: mediaPath({ root, folder, fileName: name, segment }) });
  }

  const updates = [];

  for (const { table, column } of URL_COLUMNS) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .not(column, "is", null);
    if (error) {
      console.log(`pulei ${table}.${column}: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const value = row[column];
      if (typeof value !== "string" || !value) continue;
      for (const item of plan) {
        const oldUrl = publicUrlOf(item.key);
        const oldEncoded = encodeObjectPath(item.key);
        if (!value.includes(oldUrl) && !value.includes(oldEncoded)) continue;
        updates.push({ table, column, id: row.id, new: publicUrlOf(item.newKey) });
      }
    }
  }

  return { objects, plan, updates };
}

/** Quantas linhas mudam em cada tabela — o suficiente para o terminal. */
export function countByTable(updates) {
  const byTable = new Map();
  for (const item of updates) {
    const key = `${item.table}.${item.column}`;
    byTable.set(key, (byTable.get(key) ?? 0) + 1);
  }
  return [...byTable].sort();
}
