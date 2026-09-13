/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ModelHeader from '../components/genai/ModelHeader.svelte';
import { chatSpan } from '../components/__fixtures__/genai';

describe('ModelHeader — stats with no value are hidden, not dashed', () => {
  afterEach(cleanup);

  it('shows tokens and cost when known', () => {
    render(ModelHeader, { props: { span: chatSpan() } });
    expect(screen.getByTitle(/Tokens in/)).toBeTruthy();
    expect(screen.getByTitle(/cost/i)).toBeTruthy();
  });

  it('omits the token and cost stats when the span carries neither', () => {
    const span = { ...chatSpan(), usage: {}, cost: undefined };
    render(ModelHeader, { props: { span } });
    expect(screen.queryByTitle(/Tokens in/)).toBeNull();
    expect(screen.queryByTitle(/cost/i)).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });
});
