import { describe, expect, it } from 'vitest';
import {
  LEAD_TOKEN_LENGTH,
  extractLeadToken,
  generateLeadToken,
  isLeadToken,
  normalizeLeadToken,
} from './token';

describe('generateLeadToken', () => {
  it('produces 8 characters from the base32 alphabet', () => {
    const token = generateLeadToken();
    expect(token).toHaveLength(LEAD_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('never produces an ambiguous character', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateLeadToken()).not.toMatch(/[IO01]/);
    }
  });

  it('is driven by the injected random source', () => {
    // 0 maps to the first letter of the alphabet, every time.
    expect(generateLeadToken(() => 0)).toBe('AAAAAAAA');
  });
});

describe('isLeadToken', () => {
  it('accepts an 8-char code from the alphabet', () => {
    expect(isLeadToken('A7X9K2M4')).toBe(true);
  });

  it('rejects a code with an ambiguous character', () => {
    expect(isLeadToken('A7X9K2MI')).toBe(false);
  });

  it('rejects a code of the wrong length', () => {
    expect(isLeadToken('A7X9K2M')).toBe(false);
    expect(isLeadToken('A7X9K2M44')).toBe(false);
  });
});

describe('normalizeLeadToken', () => {
  it('uppercases and trims', () => {
    expect(normalizeLeadToken('  a7x9k2m4 ')).toBe('A7X9K2M4');
  });
});

describe('extractLeadToken', () => {
  it('finds the code in a message and returns the clean text', () => {
    const result = extractLeadToken('Olá, quero saber mais ref A7X9K2M4');
    expect(result?.token).toBe('A7X9K2M4');
    expect(result?.text).toBe('Olá, quero saber mais');
  });

  it('finds the code at the end of the message', () => {
    const result = extractLeadToken('Olá ref A7X9K2M4');
    expect(result?.token).toBe('A7X9K2M4');
    expect(result?.text).toBe('Olá');
  });

  it('is case-insensitive', () => {
    expect(extractLeadToken('olá ref a7x9k2m4')?.token).toBe('A7X9K2M4');
  });

  it('ignores a word that merely starts with ref', () => {
    expect(extractLeadToken('reference A7X9K2M4')).toBeNull();
  });

  it('ignores a code with an ambiguous character', () => {
    expect(extractLeadToken('ref A7X9K2MI')).toBeNull();
  });

  it('returns null for a message without a code', () => {
    expect(extractLeadToken('Olá, quero saber mais')).toBeNull();
    expect(extractLeadToken(null)).toBeNull();
    expect(extractLeadToken(undefined)).toBeNull();
  });

  it('removes only the first occurrence', () => {
    const result = extractLeadToken('ref A7X9K2M4 e ref B7X9K2M4');
    expect(result?.text).toContain('ref B7X9K2M4');
  });
});
