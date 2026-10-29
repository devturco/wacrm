// Diagnóstico: qual versão da rota está publicada, e qual nome de
// instância o provedor usa no envelope.
//
// NÃO imprime o webhook_secret — ele é lido do banco e usado só no
// cabeçalho Authorization. Também não imprime número de contato nem
// texto de mensagem.
//
//   node scripts/probe-webhook-deploy.mjs <url-do-webhook>
//
// O alvo é obrigatório: nada é enviado para lugar nenhum por padrão.

import { readFileSync } from 'node:fs';

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const raw = readFileSync('.env.local', 'utf8');
  const line = raw
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

const supabaseUrl = envValue('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
const target = process.argv[2] ?? envValue('PROBE_WEBHOOK_URL');

if (!target) {
  console.log('Informe o alvo: node scripts/probe-webhook-deploy.mjs <url-do-webhook>');
  process.exit(1);
}

if (!supabaseUrl || !serviceKey) {
  console.log('Faltam credenciais do Supabase em .env.local.');
  process.exit(1);
}

const res = await fetch(`${supabaseUrl}/rest/v1/whatsmiau_config?select=id,instance_name,provider_instance_name,status,is_active`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
const rows = await res.json();

if (!Array.isArray(rows) || rows.length === 0) {
  console.log('nenhuma linha em whatsmiau_config');
  process.exit(0);
}

for (const row of rows) {
  console.log(
    `conexão "${row.instance_name}" | provider="${row.provider_instance_name}" | status=${row.status} | active=${row.is_active}`,
  );
}

const row = rows.find((r) => r.is_active) ?? rows[0];
const canonical = row.provider_instance_name;
const alias = `${canonical}_4cca4ba2`;

const secretRes = await fetch(
  `${supabaseUrl}/rest/v1/whatsmiau_config?select=webhook_secret&id=eq.${row.id}`,
  { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
);
const secretRows = await secretRes.json();
const secret = secretRows?.[0]?.webhook_secret;
if (!secret) {
  console.log('não foi possível ler o webhook_secret');
  process.exit(1);
}

async function probe(label, body) {
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(`${label} -> ${response.status} ${text.slice(0, 160)}`);
}

console.log(`\nprobing ${target}\n`);

// O evento de status não grava nada: só atualiza uma mensagem que não
// existe. Serve para perguntar à rota se ela aceitou o envelope.
const base = { event: 'messages.update', data: { messageId: 'probe-sem-efeito', status: 'READ' } };

await probe('alias  ', { ...base, instance: alias });
await probe('canonico', { ...base, instance: canonical });
await probe('sem instance', { ...base, data: { ...base.data, instanceId: alias } });
await probe('instance desconhecido', { ...base, instance: 'outra_empresa_atendimento' });
