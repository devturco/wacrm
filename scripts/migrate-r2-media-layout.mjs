// Executa a reorganização do bucket do R2 para a árvore nova:
//
//   <empresa>-<id8>/avatar/...
//   <empresa>-<id8>/midias/...
//   <empresa>-<id8>/documentos/...
//
// A ordem é o que segura a mudança:
//   1. COPIA o objeto para o caminho novo e confere o tamanho;
//   2. aponta as linhas do banco para a URL nova;
//   3. só então apaga o objeto antigo.
//
// Um passo que falha interrompe a sequência — o objeto antigo fica
// intacto, e a URL antiga continua valendo.
//
//   node scripts/migrate-r2-media-layout.mjs           # só o plano
//   node scripts/migrate-r2-media-layout.mjs --apply   # executa
//
// O plano (e as regras de nome) vem de `scripts/r2-media-layout.mjs`.

import {
  buildPlan,
  countByTable,
  endpoint,
  hasCredentials,
  publicUrlOf,
  r2Client,
  supabase,
} from "./r2-media-layout.mjs";

const APPLY = process.argv.includes("--apply");

if (!hasCredentials) {
  console.log("Credenciais do R2 não estão em .env.local — nada a fazer.");
  process.exit(0);
}

const { objects, plan, updates } = await buildPlan();

console.log(`objetos no bucket: ${objects.length} (com o caminho antigo: ${plan.length})\n`);
for (const item of plan) console.log(`${item.key}\n  -> ${item.newKey}\n`);

console.log("linhas do banco a atualizar:");
const byTable = countByTable(updates);
for (const [table, count] of byTable) console.log(` - ${table}: ${count}`);
if (byTable.length === 0) console.log(" (nenhuma)");

if (!APPLY) {
  console.log("\nDry-run. Rode com --apply para executar.");
  process.exit(0);
}

console.log("\n--- aplicando ---");

const client = r2Client();

// 1. copiar
for (const item of plan) {
  const res = await client.fetch(`${endpoint}/${item.key}`, { method: "GET" });
  if (!res.ok) throw new Error(`GET falhou para ${item.key}: ${res.status}`);
  const body = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";

  const put = await client.fetch(`${endpoint}/${item.newKey}`, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
    },
  });
  if (!put.ok) throw new Error(`PUT falhou para ${item.newKey}: ${put.status}`);

  const head = await client.fetch(`${endpoint}/${item.newKey}`, { method: "HEAD" });
  const size = Number(head.headers.get("content-length") ?? "0");
  if (size !== body.byteLength) {
    throw new Error(`tamanho diferente em ${item.newKey}: ${size} != ${body.byteLength}`);
  }
  console.log(`copiado ${item.key} -> ${item.newKey} (${size} bytes)`);
}

// 2. apontar o banco para a URL nova
for (const item of updates) {
  const { error } = await supabase
    .from(item.table)
    .update({ [item.column]: item.new })
    .eq("id", item.id);
  if (error) throw new Error(`${item.table}.${item.column}: ${error.message}`);
  console.log(`atualizado ${item.table}.${item.column}`);
}

// 3. a URL nova tem de responder antes de o objeto antigo sair
for (const item of plan) {
  const res = await fetch(publicUrlOf(item.newKey), { method: "HEAD" });
  if (!res.ok) {
    throw new Error(`a URL nova não respondeu (${res.status}): ${publicUrlOf(item.newKey)}`);
  }
  console.log(`no ar: ${publicUrlOf(item.newKey)}`);
}

// 4. agora sim, o objeto antigo sai
for (const item of plan) {
  const res = await client.fetch(`${endpoint}/${item.key}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE falhou para ${item.key}: ${res.status}`);
  console.log(`removido o objeto antigo ${item.key}`);
}

console.log("\nfeito.");
