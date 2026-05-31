import { describe, it, expect } from 'vitest';
import { extractDbInfo, highlightSql } from '../utils/dbInfo';

describe('extractDbInfo', () => {
  it('extracts system + statement from db.* attributes', () => {
    const info = extractDbInfo({
      'db.system': 'postgresql',
      'db.statement': 'SELECT * FROM users WHERE id = $1',
    });
    expect(info).not.toBeNull();
    expect(info!.system).toBe('postgresql');
    expect(info!.statement).toBe('SELECT * FROM users WHERE id = $1');
  });

  it('returns null for spans with no database attributes', () => {
    expect(extractDbInfo({ 'http.method': 'GET' })).toBeNull();
    expect(extractDbInfo({})).toBeNull();
  });

  it('accepts the newer OTel semconv keys', () => {
    const info = extractDbInfo({
      'db.system.name': 'mysql',
      'db.query.text': 'SELECT 1',
      'db.operation.name': 'SELECT',
      'db.namespace': 'shop',
      'db.collection.name': 'orders',
    });
    expect(info!.system).toBe('mysql');
    expect(info!.statement).toBe('SELECT 1');
    expect(info!.operation).toBe('SELECT');
    expect(info!.dbName).toBe('shop');
    expect(info!.table).toBe('orders');
  });

  it('extracts operation, table, db name and row counts from legacy keys', () => {
    const info = extractDbInfo({
      'db.system': 'postgresql',
      'db.statement': 'UPDATE users SET name = $1',
      'db.operation': 'UPDATE',
      'db.sql.table': 'users',
      'db.name': 'app',
      'db.response.returned_rows': 3,
    });
    expect(info!.operation).toBe('UPDATE');
    expect(info!.table).toBe('users');
    expect(info!.dbName).toBe('app');
    expect(info!.rowCount).toBe(3);
  });

  it('detects a db span from the statement alone (no system attribute)', () => {
    const info = extractDbInfo({ 'db.statement': 'SELECT 1' });
    expect(info).not.toBeNull();
    expect(info!.system).toBeUndefined();
    expect(info!.statement).toBe('SELECT 1');
  });
});

describe('highlightSql', () => {
  it('tags SQL keywords as keyword segments, preserving original casing', () => {
    const tokens = highlightSql('select id from users');
    const keywords = tokens.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['select', 'from']);
    // Reassembling the tokens reproduces the original string exactly.
    expect(tokens.map((t) => t.text).join('')).toBe('select id from users');
  });

  it('tags single-quoted string literals', () => {
    const tokens = highlightSql("SELECT * FROM t WHERE name = 'bob'");
    expect(tokens.some((t) => t.kind === 'string' && t.text === "'bob'")).toBe(
      true,
    );
    expect(tokens.map((t) => t.text).join('')).toBe(
      "SELECT * FROM t WHERE name = 'bob'",
    );
  });

  it('does not treat substrings of identifiers as keywords', () => {
    const tokens = highlightSql('SELECT format FROM t');
    // "format" contains "for"/"from"-like fragments but must stay plain text.
    expect(tokens.some((t) => t.kind === 'keyword' && t.text === 'format')).toBe(
      false,
    );
  });
});
