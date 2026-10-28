// ============================================================
// Naming rules for the instances we provision.
//
// The customer picks a name for their own connection ("Atendimento").
// On the provider side the instance is named `<company>_<instance>`:
// the company's slug plus the customer's slug.
//
// Why the prefix:
//   - two companies that pick the same name never collide — the
//     provider's account is shared by every subscriber, so a bare
//     "Atendimento" would be a cross-tenant collision waiting to
//     happen (and a collision means one company taking over the
//     other's WhatsApp number);
//   - the operator can tell, from the provider's own dashboard, which
//     company an instance belongs to.
//
// The customer never sees the provider name: the routes translate
// between the two. This module is dependency-free so the settings
// screen (a client component) can import it to preview the name.
// ============================================================

/** The provider refuses instance names longer than this. */
export const MAX_PROVIDER_NAME = 40;

/** How much of the name the company part may take. */
const MAX_COMPANY_PART = 20;

/** How much of the name the customer's part may take. */
const MAX_INSTANCE_PART = 19;

/** The provider's charset: unaccented letters, digits, dot, hyphen, underscore. */
const PROVIDER_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Turn a human name into a provider-safe slug: lowercase, no accents,
 * everything else collapsed into a single underscore.
 *
 * "Studio Bella" → "studio_bella"; "Atendimento 01" → "atendimento_01".
 */
export function slugifyName(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    // Strip the combining marks left behind by the decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The name the instance carries on the provider: `<company>_<instance>`.
 *
 * Both parts are truncated so the result never exceeds the provider's
 * 40-character limit. The company part is truncated first — the
 * customer's own name is the part they recognise.
 */
export function buildProviderInstanceName(
  companyName: string,
  instanceName: string,
): string {
  const company = slugifyName(companyName).slice(0, MAX_COMPANY_PART);
  const instance = slugifyName(instanceName).slice(0, MAX_INSTANCE_PART);
  if (!company) return instance.slice(0, MAX_PROVIDER_NAME);
  if (!instance) return company.slice(0, MAX_PROVIDER_NAME);
  return `${company}_${instance}`;
}

/**
 * The nth candidate for a name that is already taken: `empresa_x_2`,
 * `empresa_x_3`, …
 *
 * The suffix is what keeps two companies with the SAME name apart —
 * "Studio" and "Studio" both want "studio_atendimento", and the second
 * one gets "studio_atendimento_2".
 */
export function withCollisionSuffix(base: string, attempt: number): string {
  const suffix = `_${attempt}`;
  const room = MAX_PROVIDER_NAME - suffix.length;
  return `${base.slice(0, Math.max(room, 1))}${suffix}`;
}

/**
 * Validate the name the CUSTOMER gives their instance.
 *
 * The customer-facing name is theirs: it may carry accents and spaces
 * ("Atendimento Principal"). It never reaches the provider — the slug
 * does — so the only rules are "not empty" and "not absurdly long".
 */
export function validateCustomerInstanceName(
  name: string,
): { ok: true } | { ok: false; error: string } {
  const value = (name ?? '').trim();
  if (!value) {
    return { ok: false, error: 'The instance name is required.' };
  }
  if (value.length > 60) {
    return {
      ok: false,
      error: 'The instance name can be at most 60 characters long.',
    };
  }
  return { ok: true };
}

/**
 * Validate a name against the PROVIDER's rule: ≤ 40 characters, only
 * unaccented letters / digits / dot / hyphen / underscore, and at
 * least one letter or digit.
 *
 * Every provider call carries the name in its URL, so the rule is
 * checked locally before the request — the provider answers 400 for a
 * bad name, but naming the rule locally saves a round trip and gives
 * the UI a message it can show next to the field.
 */
export function validateProviderInstanceName(
  name: string,
): { ok: true } | { ok: false; error: string } {
  const value = (name ?? '').trim();
  if (!value) {
    return { ok: false, error: 'The instance name is required.' };
  }
  if (value.length > MAX_PROVIDER_NAME) {
    return {
      ok: false,
      error: `The instance name can be at most ${MAX_PROVIDER_NAME} characters long.`,
    };
  }
  if (!PROVIDER_NAME_RE.test(value)) {
    return {
      ok: false,
      error:
        'The instance name can only contain unaccented letters, numbers, dot, hyphen and underscore.',
    };
  }
  if (!/[A-Za-z0-9]/.test(value)) {
    return {
      ok: false,
      error: 'The instance name must contain at least one letter or digit.',
    };
  }
  return { ok: true };
}
