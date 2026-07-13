import { describe, expect, it } from 'vitest';
import { humanizeName } from './humanize';

describe('humanizeName', () => {
  it('title-cases camelCase', () => {
    expect(humanizeName('getBurnRate')).toBe('Get Burn Rate');
  });

  it('title-cases snake_case and kebab-case', () => {
    expect(humanizeName('get_user_data')).toBe('Get User Data');
    expect(humanizeName('fetch-weather-forecast')).toBe(
      'Fetch Weather Forecast',
    );
  });

  it('capitalises a single lowercase token', () => {
    expect(humanizeName('search')).toBe('Search');
  });

  it('preserves acronyms', () => {
    expect(humanizeName('parseHTMLResponse')).toBe('Parse HTML Response');
    expect(humanizeName('API')).toBe('API');
  });

  it('leaves prose-like / structured names untouched', () => {
    expect(humanizeName('POST /api/chat')).toBe('POST /api/chat');
    expect(humanizeName('db.query')).toBe('db.query');
    expect(humanizeName('Get Weather')).toBe('Get Weather');
  });

  it('handles empty / nullish input', () => {
    expect(humanizeName('')).toBe('');
    expect(humanizeName(undefined)).toBe('');
    expect(humanizeName(null)).toBe('');
  });
});
