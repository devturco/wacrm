import { describe, expect, it } from 'vitest';

import {
  MAX_PROVIDER_NAME,
  buildProviderInstanceName,
  slugifyName,
  validateCustomerInstanceName,
  validateProviderInstanceName,
  withCollisionSuffix,
} from './naming';

describe('slugifyName', () => {
  it('lowercases and joins the words with an underscore', () => {
    expect(slugifyName('Studio Bella')).toBe('studio_bella');
    expect(slugifyName('Atendimento 01')).toBe('atendimento_01');
  });

  it('strips the accents', () => {
    expect(slugifyName('Atendimênto Ação')).toBe('atendimento_acao');
  });

  it('collapses every other character into a single underscore', () => {
    expect(slugifyName('atendimento--01')).toBe('atendimento_01');
    expect(slugifyName(' (atendimento)  ')).toBe('atendimento');
  });

  it('returns an empty string when there is nothing to keep', () => {
    expect(slugifyName('   ')).toBe('');
    expect(slugifyName('!!!')).toBe('');
  });
});

describe('buildProviderInstanceName', () => {
  it('joins the company and the instance under a single name', () => {
    expect(buildProviderInstanceName('Studio Bella', 'Atendimento')).toBe(
      'studio_bella_atendimento',
    );
  });

  it('slugifies both parts', () => {
    expect(buildProviderInstanceName('Studio Bêlla', 'Atendimênto')).toBe(
      'studio_bella_atendimento',
    );
  });

  it('never exceeds the provider limit', () => {
    const name = buildProviderInstanceName(
      'Empresa Com Um Nome Bem Comprido DEMAIS',
      'Conexao Tambem Com Um Nome Bem Comprido',
    );
    expect(name.length).toBeLessThanOrEqual(MAX_PROVIDER_NAME);
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('falls back to the other part when one of them is empty', () => {
    expect(buildProviderInstanceName('', 'Atendimento')).toBe('atendimento');
    expect(buildProviderInstanceName('Studio Bella', '')).toBe('studio_bella');
    expect(buildProviderInstanceName('', '')).toBe('');
  });
});

describe('withCollisionSuffix', () => {
  it('appends the attempt number', () => {
    expect(withCollisionSuffix('studio_atendimento', 2)).toBe(
      'studio_atendimento_2',
    );
    expect(withCollisionSuffix('studio_atendimento', 3)).toBe(
      'studio_atendimento_3',
    );
  });

  it('shortens the base so the whole name still fits the provider limit', () => {
    const name = withCollisionSuffix('a'.repeat(MAX_PROVIDER_NAME), 2);
    expect(name.length).toBeLessThanOrEqual(MAX_PROVIDER_NAME);
    expect(name.endsWith('_2')).toBe(true);
  });
});

describe('validateCustomerInstanceName', () => {
  it('accepts the name the customer typed', () => {
    expect(validateCustomerInstanceName('Atendimento Principal')).toEqual({
      ok: true,
    });
    expect(validateCustomerInstanceName('a'.repeat(60))).toEqual({ ok: true });
  });

  it('rejects an empty name', () => {
    const result = validateCustomerInstanceName('   ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/required/i);
  });

  it('rejects a name longer than 60 characters', () => {
    const result = validateCustomerInstanceName('a'.repeat(61));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/60/);
  });

  it('accepts accents and spaces — the customer name never reaches the provider', () => {
    expect(validateCustomerInstanceName('Atendimento Ação').ok).toBe(true);
  });
});

describe('validateProviderInstanceName', () => {
  it('accepts the provider charset', () => {
    expect(validateProviderInstanceName('studio_bella.atendimento-01')).toEqual({
      ok: true,
    });
  });

  it('rejects accents and spaces', () => {
    expect(validateProviderInstanceName('studio bella').ok).toBe(false);
    expect(validateProviderInstanceName('atendimentoção').ok).toBe(false);
  });

  it('rejects a name longer than 40 characters', () => {
    const result = validateProviderInstanceName('a'.repeat(41));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/40/);
  });

  it('rejects a name with no letter or digit', () => {
    const result = validateProviderInstanceName('___');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/letter or digit/i);
  });

  it('rejects an empty name', () => {
    expect(validateProviderInstanceName('').ok).toBe(false);
  });
});
