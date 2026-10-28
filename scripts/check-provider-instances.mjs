// Diagnóstico: lista os NOMES das instâncias que existem na conta do
// provedor. Não imprime a chave, a URL base nem nenhum dado de contato —
// só os nomes, que são da própria plataforma.
//
//   node scripts/check-provider-instances.mjs

import { readFileSync } from 'node:fs';

function envValue(name) {
  const raw = readFileSync('.env.local', 'utf8');
  const line = raw
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

const apiKey = envValue('WHATSMIAU_API_KEY');
const baseUrl = (envValue('WHATSMIAU_BASE_URL') || 'https://api.whatsmiau.dev/v2').replace(
  /\/+$/,
  '',
);

if (!apiKey) {
  console.log('WHATSMIAU_API_KEY não está em .env.local — nada a listar.');
  process.exit(0);
}

const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
  headers: { apikey: apiKey, 'Content-Type': 'application/json' },
});

const text = await res.text();
console.log('status:', res.status);

let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.log(text.slice(0, 500));
  process.exit(0);
}

const list = Array.isArray(payload)
  ? payload
  : (Array.isArray(payload?.instances)
      ? payload.instances
      : Array.isArray(payload?.data)
        ? payload.data
        : []);

console.log('instâncias na conta do provedor:', list.length);
for (const item of list) {
  const name = item?.name ?? item?.instanceName ?? item?.id ?? '(sem nome)';
  console.log(' -', name, '| state:', item?.state ?? item?.status ?? '?');
}
