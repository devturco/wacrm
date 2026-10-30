// Mostra COMO o bucket do R2 ficaria depois da reorganização — sem
// escrever, sem apagar, sem tocar no banco.
//
//   node scripts/plan-r2-media-layout.mjs
//
// Para cada objeto com o caminho antigo (`account-<uuid>/...`) o script
// diz o caminho novo (`<empresa>-<id8>/avatar|midias|documentos/...`) e
// conta quantas linhas do banco apontam para ele.
//
// Para EXECUTAR a mudança: `node scripts/migrate-r2-media-layout.mjs --apply`.

import { buildPlan, countByTable, hasCredentials } from "./r2-media-layout.mjs";

if (!hasCredentials) {
  console.log("Credenciais do R2 não estão em .env.local — nada a listar.");
  process.exit(0);
}

const { objects, plan, updates } = await buildPlan();

console.log(`objetos no bucket: ${objects.length} (com o caminho antigo: ${plan.length})\n`);

for (const item of plan) {
  console.log(`${item.key}\n  -> ${item.newKey}\n`);
}

console.log("linhas do banco a atualizar:");
const byTable = countByTable(updates);
for (const [table, count] of byTable) console.log(` - ${table}: ${count}`);
if (byTable.length === 0) console.log(" (nenhuma)");
