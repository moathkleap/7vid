import { describe, expect, it } from 'vitest';
import { formatAssTime, formatMs, formatSrtTime, formatTimecode, FPS_29_97, FPS_30, msToFrame, normalizeDigits, parseFps, parseTimeExpression, snapToFrame } from './time';

describe('time', () => {
  it('parses time expressions in many formats', () => {
    expect(parseTimeExpression('90')).toBe(90_000);
    expect(parseTimeExpression('1:30')).toBe(90_000);
    expect(parseTimeExpression('01:30.5')).toBe(90_500);
    expect(parseTimeExpression('1:02:03')).toBe(3_723_000);
    expect(parseTimeExpression('1:02:03,250')).toBe(3_723_250);
    expect(parseTimeExpression('1h2m3s')).toBe(3_723_000);
    expect(parseTimeExpression('2m')).toBe(120_000);
    expect(parseTimeExpression('45s')).toBe(45_000);
    expect(parseTimeExpression('1.5s')).toBe(1_500);
    expect(parseTimeExpression('500ms')).toBe(500);
    expect(parseTimeExpression('abc')).toBeNull();
  });
  it('normalizes Arabic-Indic digits', () => {
    expect(normalizeDigits('٢:١٠')).toBe('2:10');
    expect(normalizeDigits('۲۰')).toBe('20');
    expect(parseTimeExpression('٢:١٠')).toBe(130_000);
  });
  it('formats times', () => {
    expect(formatMs(90_500)).toBe('01:30.500');
    expect(formatMs(3_723_250)).toBe('01:02:03.250');
    expect(formatSrtTime(1_500)).toBe('00:00:01,500');
    expect(formatAssTime(1_500)).toBe('0:00:01.50');
    expect(formatTimecode(1_500, FPS_30)).toBe('00:00:01:15');
  });
  it('handles frames and fps parsing', () => {
    expect(parseFps('30000/1001')).toEqual(FPS_29_97);
    expect(parseFps(30)).toEqual(FPS_30);
    expect(parseFps('29.97')).toEqual(FPS_29_97);
    expect(msToFrame(1000, FPS_30)).toBe(30);
    expect(snapToFrame(1005, FPS_30)).toBe(1000);
  });
});
