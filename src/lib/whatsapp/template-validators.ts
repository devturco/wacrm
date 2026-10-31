/**
 * Pure validators for message templates, run BEFORE the Meta submit
 * call so a misconfigured template fails at save time (with a specific
 * field-level error) rather than at the Meta API boundary (where the
 * error is a generic 400 + opaque rejection_reason hours later).
 *
 * Every validator throws `Error(message)` — callers catch and surface
 * to the UI. Caps follow Meta's published limits for the Cloud API
 * template surface (v21.0):
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 *
 * Per-element button validation lives here rather than as a JSONB CHECK
 * because Postgres CHECK constraints can't contain subqueries, and
 * generic CHECK violations don't give users an actionable error
 * ("button #3 has no `text`" beats "constraint violated").
 */

import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types';
import { getT } from '@/lib/i18n/translate';

const t = getT('Validation.templates');

export const TEMPLATE_LIMITS = {
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
  buttonTextMaxLength: 25,
  maxButtonsTotal: 10,
  maxUrlButtons: 2,
  maxPhoneButtons: 1,
  maxCopyCodeButtons: 1,
  /** Meta: lowercase a-z, digits, underscore. Up to 512 chars. */
  nameRegex: /^[a-z0-9_]{1,512}$/,
} as const;

export interface TemplatePayload {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_type?: MessageTemplate['header_type'];
  header_content?: string;
  header_media_url?: string;
  header_handle?: string;
  body_text: string;
  footer_text?: string;
  buttons?: TemplateButton[];
  sample_values?: TemplateSampleValues;
}

export function validateTemplateName(name: string): void {
  if (!name) throw new Error(t('nameRequired'));
  if (!TEMPLATE_LIMITS.nameRegex.test(name)) {
    throw new Error(t('nameInvalid'));
  }
}

/**
 * Extract sorted, deduplicated {{N}} indices from a string. Returns
 * `[1, 2, 4]` for `"Hi {{1}} {{2}}, item {{4}}"`.
 */
export function extractVariableIndices(text: string): number[] {
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  const set = new Set<number>();
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The variable format a text uses. Meta supports two, and a template
 * uses one or the other — never both:
 *
 *   - `positional` — `{{1}}`, `{{2}}` (values matched by position)
 *   - `named`      — `{{customer_name}}` (values matched by key)
 *   - `mixed`      — both in the same text (Meta rejects it)
 */
export type VariableFormat = 'positional' | 'named' | 'mixed';

/**
 * Classify the variable format of a text. Returns `null` when the text
 * has no variables at all.
 */
export function variableFormat(text: string): VariableFormat | null {
  const keys = new Set<string>();
  for (const m of text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)) keys.add(m[1]);
  if (keys.size === 0) return null;
  const hasNumeric = [...keys].some((k) => /^\d+$/.test(k));
  const hasNamed = [...keys].some((k) => !/^\d+$/.test(k));
  if (hasNumeric && hasNamed) return 'mixed';
  return hasNumeric ? 'positional' : 'named';
}

/** True when a text mixes positional (`{{1}}`) and named variables. */
export function hasMixedVariableFormats(text: string): boolean {
  return variableFormat(text) === 'mixed';
}

/**
 * Variable keys a template text needs values for, in the order send-time
 * values are matched to them. Handles both of Meta's parameter formats:
 *
 *   - POSITIONAL `{{1}}`, `{{2}}` → `["1", "2"]` (numeric order)
 *   - NAMED `{{customer_name}}` → `["customer_name"]`. Meta's template
 *     editor creates these by default now. Sorted by name, matching how
 *     broadcasts and automations order their per-key values; Meta pairs
 *     named values by `parameter_name`, not position.
 *
 * A template uses one format or the other, never both — but if a text
 * DOES mix them (a template that reached us from outside), every key is
 * still returned: dropping the positional ones would leave `{{1}}`
 * unfilled in the rendered body. Positional keys come first (numeric
 * order), then named ones (alphabetical).
 */
export function extractTemplateVariables(text: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)) keys.add(m[1]);
  const all = [...keys];
  if (all.length === 0) return [];
  const named = all
    .filter((k) => isNamedVariable(k))
    .sort((a, b) => a.localeCompare(b));
  const positional = all.filter((k) => !isNamedVariable(k));
  if (positional.length === 0) return named;
  return [...extractVariableIndices(text).map(String), ...named];
}

/** True for a NAMED template variable key (`customer_name`, not `1`). */
export function isNamedVariable(key: string): boolean {
  return !/^\d+$/.test(key);
}

/** Reject a text that mixes the two variable formats. */
function assertSingleFormat(text: string): void {
  if (hasMixedVariableFormats(text)) {
    throw mixedFormatError();
  }
}

/**
 * The message for a mixed-format template. The literal `{{1}}` /
 * `{{name}}` are passed as VALUES — a catalogue message is ICU, and a
 * bare brace would be parsed as a placeholder.
 */
function mixedFormatError(): Error {
  return new Error(
    t('mixedVariableFormats', { positional: '{{1}}', named: '{{name}}' }),
  );
}

/**
 * Reject a template whose components disagree on the variable format.
 * Meta pairs a template's values by format across the WHOLE template —
 * a body with `{{1}}` next to a header with `{{name}}` is rejected.
 */
function assertSingleFormatAcrossTemplate(payload: TemplatePayload): void {
  const texts = [
    payload.body_text,
    payload.header_type === 'text' ? payload.header_content : undefined,
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);

  const formats = new Set(
    texts.map(variableFormat).filter((f): f is VariableFormat => f !== null),
  );
  if (formats.size > 1) {
    throw mixedFormatError();
  }
}

/**
 * Meta requires contiguous, 1-indexed variables. `{{1}} {{3}}` is
 * invalid — it must be `{{1}} {{2}}`.
 */
function assertBodyContiguous(indices: number[]): void {
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i + 1) {
      throw new Error(
        t('bodyNotContiguous', {
          first: '{{1}}',
          found: indices.map((n) => `{{${n}}}`).join(', '),
        }),
      );
    }
  }
}

/**
 * Validate the body and return the variable keys it needs values for
 * (positional `"1"` or named `"customer_name"`).
 */
export function validateBody(bodyText: string): string[] {
  if (!bodyText.trim()) throw new Error(t('bodyRequired'));
  if (bodyText.length > TEMPLATE_LIMITS.bodyMaxLength) {
    throw new Error(
      t('bodyTooLong', { max: TEMPLATE_LIMITS.bodyMaxLength, got: bodyText.length }),
    );
  }
  assertSingleFormat(bodyText);
  const keys = extractTemplateVariables(bodyText);
  // Contiguity is a POSITIONAL-format rule: Meta numbers {{1}}, {{2}}…
  // A named variable carries its own key, so `{{zeta}} {{alpha}}` is
  // perfectly fine — there's no position to keep contiguous.
  if (keys.length > 0 && !isNamedVariable(keys[0])) {
    assertBodyContiguous(extractVariableIndices(bodyText));
  }
  return keys;
}

export function validateFooter(footerText: string | undefined): void {
  if (!footerText) return;
  if (footerText.length > TEMPLATE_LIMITS.footerMaxLength) {
    throw new Error(
      t('footerTooLong', { max: TEMPLATE_LIMITS.footerMaxLength, got: footerText.length }),
    );
  }
  // A footer carries no variables at all — in EITHER format.
  if (extractTemplateVariables(footerText).length > 0) {
    throw new Error(t('footerNoVariables', { placeholder: '{{N}}' }));
  }
}

export interface HeaderValidationResult {
  /** number of variable placeholders in a TEXT header — 0 or 1. */
  variableCount: number;
}

export function validateHeader(
  payload: Pick<
    TemplatePayload,
    'header_type' | 'header_content' | 'header_media_url' | 'header_handle'
  >,
): HeaderValidationResult {
  const { header_type, header_content, header_media_url, header_handle } = payload;
  if (!header_type) return { variableCount: 0 };

  if (header_type === 'text') {
    if (!header_content || !header_content.trim()) {
      throw new Error(t('headerTextRequired'));
    }
    if (header_content.length > TEMPLATE_LIMITS.headerTextMaxLength) {
      throw new Error(
        t('headerTextTooLong', {
          max: TEMPLATE_LIMITS.headerTextMaxLength,
          got: header_content.length,
        }),
      );
    }
    assertSingleFormat(header_content);
    const keys = extractTemplateVariables(header_content);
    if (keys.length > 1) {
      throw new Error(
        t('headerTooManyVariables', { count: keys.length }),
      );
    }
    // "Must be {{1}}" only applies to the POSITIONAL format — a named
    // variable stands on its own.
    if (keys.length === 1 && !isNamedVariable(keys[0]) && keys[0] !== '1') {
      throw new Error(t('headerVariableMustBeFirst', { var: '{{1}}' }));
    }
    return { variableCount: keys.length };
  }

  // image / video / document need either a public URL or a Resumable
  // Upload handle. Either one — Meta accepts both example forms.
  if (!header_media_url && !header_handle) {
    throw new Error(
      t('mediaHeaderRequiresSource', { type: header_type }),
    );
  }
  if (header_media_url) {
    try {
      const u = new URL(header_media_url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error(t('headerMediaUrlScheme'));
      }
    } catch {
      throw new Error(t('headerMediaUrlInvalid'));
    }
  }
  return { variableCount: 0 };
}

function countButtonsByType(
  buttons: TemplateButton[],
): Record<TemplateButton['type'], number> {
  const counts: Record<TemplateButton['type'], number> = {
    QUICK_REPLY: 0,
    URL: 0,
    PHONE_NUMBER: 0,
    COPY_CODE: 0,
  };
  for (const b of buttons) counts[b.type]++;
  return counts;
}

export function validateButtons(buttons: TemplateButton[] | undefined): void {
  if (!buttons || buttons.length === 0) return;
  if (buttons.length > TEMPLATE_LIMITS.maxButtonsTotal) {
    throw new Error(
      t('tooManyButtons', { max: TEMPLATE_LIMITS.maxButtonsTotal, got: buttons.length }),
    );
  }

  const counts = countButtonsByType(buttons);
  if (counts.URL > TEMPLATE_LIMITS.maxUrlButtons) {
    throw new Error(
      t('tooManyUrlButtons', { max: TEMPLATE_LIMITS.maxUrlButtons, got: counts.URL }),
    );
  }
  if (counts.PHONE_NUMBER > TEMPLATE_LIMITS.maxPhoneButtons) {
    throw new Error(
      t('tooManyPhoneButtons', {
        max: TEMPLATE_LIMITS.maxPhoneButtons,
        got: counts.PHONE_NUMBER,
      }),
    );
  }
  if (counts.COPY_CODE > TEMPLATE_LIMITS.maxCopyCodeButtons) {
    throw new Error(
      t('tooManyCopyCodeButtons', {
        max: TEMPLATE_LIMITS.maxCopyCodeButtons,
        got: counts.COPY_CODE,
      }),
    );
  }

  // Meta rule: QUICK_REPLY buttons must be contiguous — they can't be
  // interleaved with CTA buttons. Easiest check: walk the array; once
  // we leave the QUICK_REPLY block, we must not see another.
  let sawNonQR = false;
  for (const b of buttons) {
    if (b.type === 'QUICK_REPLY') {
      if (sawNonQR) {
        throw new Error(
          t('quickReplyInterleaved'),
        );
      }
    } else {
      sawNonQR = true;
    }
  }

  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b.text?.trim()) {
      throw new Error(t('buttonMissingText', { n: i + 1, type: b.type }));
    }
    if (b.text.length > TEMPLATE_LIMITS.buttonTextMaxLength) {
      throw new Error(
        t('buttonTextTooLong', { n: i + 1, max: TEMPLATE_LIMITS.buttonTextMaxLength }),
      );
    }
    switch (b.type) {
      case 'URL': {
        if (!b.url?.trim()) {
          throw new Error(t('urlButtonMissingUrl', { n: i + 1 }));
        }
        try {
          new URL(b.url);
        } catch {
          throw new Error(t('urlButtonInvalidUrl', { n: i + 1 }));
        }
        const urlVars = extractTemplateVariables(b.url);
        if (urlVars.length > 1) {
          throw new Error(
            t('urlButtonTooManyVariables', { n: i + 1 }),
          );
        }
        if (urlVars.length === 1) {
          // Meta's dynamic-URL suffix is positional-only: the value is
          // appended by position, never by `parameter_name`.
          if (urlVars[0] !== '1') {
            throw new Error(
              t('urlButtonVariableMustBeFirst', { n: i + 1, var: '{{1}}' }),
            );
          }
          if (!b.example?.trim()) {
            throw new Error(
              t('urlButtonNeedsExample', { n: i + 1, var: '{{1}}' }),
            );
          }
        }
        break;
      }
      case 'PHONE_NUMBER':
        if (!b.phone_number?.trim()) {
          throw new Error(
            t('phoneButtonMissingNumber', { n: i + 1 }),
          );
        }
        break;
      case 'COPY_CODE':
        if (!b.example?.trim()) {
          throw new Error(
            t('copyCodeButtonMissingExample', { n: i + 1 }),
          );
        }
        break;
    }
  }
}

/**
 * Sample values must be supplied 1:1 with the variables in the body
 * (and header, if it has one). Meta uses these for human review.
 */
export function validateSampleValues(
  payload: TemplatePayload,
  bodyVarCount: number,
  headerVarCount: number,
): void {
  const samples = payload.sample_values ?? {};
  const body = samples.body ?? [];
  const header = samples.header ?? [];

  if (body.length !== bodyVarCount) {
    throw new Error(
      t('bodySampleCountMismatch', { count: bodyVarCount, got: body.length }),
    );
  }
  if (header.length !== headerVarCount) {
    throw new Error(
      t('headerSampleCountMismatch', { count: headerVarCount, got: header.length }),
    );
  }
  for (let i = 0; i < body.length; i++) {
    if (!body[i] || !body[i].trim()) {
      throw new Error(t('bodySampleEmpty', { n: i + 1 }));
    }
  }
  for (let i = 0; i < header.length; i++) {
    if (!header[i] || !header[i].trim()) {
      throw new Error(t('headerSampleEmpty', { n: i + 1 }));
    }
  }
}

/**
 * Run every validator. Throws on the first failure with a specific,
 * field-level message. Returns the variable counts so callers can
 * reuse them when building the Meta components payload.
 */
export function validateTemplatePayload(payload: TemplatePayload): {
  bodyVarCount: number;
  headerVarCount: number;
} {
  validateTemplateName(payload.name);
  if (!payload.language?.trim()) {
    throw new Error(t('languageRequired'));
  }
  assertSingleFormatAcrossTemplate(payload);
  const bodyVars = validateBody(payload.body_text);
  validateFooter(payload.footer_text);
  const headerResult = validateHeader(payload);
  validateButtons(payload.buttons);
  validateSampleValues(payload, bodyVars.length, headerResult.variableCount);
  return {
    bodyVarCount: bodyVars.length,
    headerVarCount: headerResult.variableCount,
  };
}
