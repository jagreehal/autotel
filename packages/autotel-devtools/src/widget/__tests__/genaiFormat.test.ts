import { describe, it, expect } from 'vitest'
import {
  formatInputTokens,
  formatOutputTokens,
  summarizeToolCalls,
} from '../utils/genaiFormat'

describe('formatInputTokens', () => {
  it('shows the bare total when nothing is cached', () => {
    expect(formatInputTokens(176)).toBe('176')
    expect(formatInputTokens(176, 0)).toBe('176')
  })
  it('calls out the cached share', () => {
    expect(formatInputTokens(4456, 4100)).toBe('4456 (4100 cached)')
  })
  it('returns — when unknown', () => {
    expect(formatInputTokens(undefined)).toBe('—')
  })
})

describe('formatOutputTokens', () => {
  it('shows the bare total when there is no reasoning', () => {
    expect(formatOutputTokens(90)).toBe('90')
    expect(formatOutputTokens(90, 0)).toBe('90')
  })
  it('calls out the reasoning share', () => {
    expect(formatOutputTokens(1262, 320)).toBe('1262 (320 reasoning)')
  })
  it('returns — when unknown', () => {
    expect(formatOutputTokens(undefined)).toBe('—')
  })
})

describe('summarizeToolCalls', () => {
  it('is empty for no calls', () => {
    expect(summarizeToolCalls([])).toEqual({ label: '', details: '' })
  })
  it('shows a single tool name', () => {
    expect(summarizeToolCalls(['getWeather'])).toEqual({
      label: 'getWeather',
      details: '',
    })
  })
  it('collapses repeats into (xN)', () => {
    expect(summarizeToolCalls(['getWeather', 'getWeather', 'getWeather'])).toEqual({
      label: 'getWeather (x3)',
      details: '',
    })
  })
  it('lists two tools fully', () => {
    expect(summarizeToolCalls(['a', 'b'])).toEqual({
      label: 'a, b',
      details: 'a, b',
    })
  })
  it('truncates three or more with the full list in details', () => {
    const r = summarizeToolCalls(['a', 'b', 'c', 'a'])
    expect(r.label).toBe('a (x2), b, …')
    expect(r.details).toBe('a (x2), b, c')
  })
})
