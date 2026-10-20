import { describe, expect, test } from 'vitest';
import { customBarSet, drawToCandles, parseCandles } from './customData';

const utc = (iso: string) => Date.parse(`${iso}Z`) / 1000;

describe('parseCandles', () => {
  test('reads a Yahoo Finance download, using Close rather than Adj Close', () => {
    const text = [
      'Date,Open,High,Low,Close,Adj Close,Volume',
      '2024-03-01,178.2,180.1,177.5,179.9,178.0,73488000',
      '2024-03-04,176.1,176.9,173.8,175.1,173.3,81510100',
    ].join('\n');

    const result = parseCandles(text);

    expect(result.dated).toBe(true);
    expect(result.candles).toEqual([
      { time: utc('2024-03-01T00:00:00'), open: 178.2, high: 180.1, low: 177.5, close: 179.9, volume: 73488000 },
      { time: utc('2024-03-04T00:00:00'), open: 176.1, high: 176.9, low: 173.8, close: 175.1, volume: 81510100 },
    ]);
  });

  test('reads tab-separated rows pasted from a spreadsheet without a header', () => {
    const text = '2024-03-01\t178.2\t180.1\t177.5\t179.9\n2024-03-04\t176.1\t176.9\t173.8\t175.1';

    const result = parseCandles(text);

    expect(result.candles.map((c) => [c.time, c.close])).toEqual([
      [utc('2024-03-01T00:00:00'), 179.9],
      [utc('2024-03-04T00:00:00'), 175.1],
    ]);
    expect(result.candles[0].volume).toBe(0);
  });

  test('reads a TradingView export with unix-second times', () => {
    const text = 'time,open,high,low,close,Volume\n1709251200,10,12,9,11,500\n1709254800,11,13,10,12,600';

    const result = parseCandles(text);

    expect(result.candles.map((c) => c.time)).toEqual([1709251200, 1709254800]);
    expect(result.interval).toBe('1h');
  });

  test('treats 13-digit times as milliseconds', () => {
    const result = parseCandles('1709251200000,10,12,9,11\n1709337600000,11,13,10,12');

    expect(result.candles.map((c) => c.time)).toEqual([1709251200, 1709337600]);
  });

  test('numbers undated rows one day apart and marks them undated', () => {
    const result = parseCandles('100,104,98,103\n103,107,102,106\n106,106,99,100');

    expect(result.dated).toBe(false);
    expect(result.candles.map((c) => c.close)).toEqual([103, 106, 100]);
    const t = result.candles.map((c) => c.time);
    expect([t[1] - t[0], t[2] - t[1]]).toEqual([86400, 86400]);
  });

  test('sorts rows into time order', () => {
    const result = parseCandles('2024-03-04,2,2,2,2\n2024-03-01,1,1,1,1');

    expect(result.candles.map((c) => c.close)).toEqual([1, 2]);
  });

  test('calls hourly stock data hourly despite the overnight gap', () => {
    const hours = ['09', '10', '11', '12', '13', '14', '15', '16'];
    const day1 = hours.map((h) => `2024-03-01T${h}:00:00`);
    const day2 = hours.map((h) => `2024-03-04T${h}:00:00`);
    const text = [...day1, ...day2].map((t) => `${t},1,1,1,1`).join('\n');

    expect(parseCandles(text).interval).toBe('1h');
  });

  test('skips rows it cannot read and reports their line numbers', () => {
    const text = 'Date,Open,High,Low,Close\n2024-03-01,1,2,0.5,1.5\n2024-03-02,abc,2,0.5,1.5\n\n2024-03-03,1.5,2,1,1.8';

    const result = parseCandles(text);

    expect(result.candles.map((c) => c.close)).toEqual([1.5, 1.8]);
    expect(result.skipped).toEqual([3]);
  });

  test('reads quoted numbers with thousands separators', () => {
    const result = parseCandles('"2024-03-01","1,234.5","1,240","1,230","1,238"');

    expect(result.candles[0]).toMatchObject({ open: 1234.5, high: 1240, low: 1230, close: 1238 });
  });

  test('keeps only the most recent 5000 candles', () => {
    const rows = Array.from({ length: 5003 }, (_, i) => `${i + 1},${i + 1},${i + 1},${i + 1}`);

    const result = parseCandles(rows.join('\n'));

    expect(result.candles).toHaveLength(5000);
    expect(result.candles[0].close).toBe(4);
    expect(result.truncated).toBe(true);
  });

  test('returns nothing for empty input', () => {
    expect(parseCandles('  \n ').candles).toEqual([]);
  });
});

describe('drawToCandles', () => {
  const rising = [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ];

  test('makes the requested number of candles', () => {
    expect(drawToCandles(rising, { count: 12, low: 90, high: 110 })).toHaveLength(12);
  });

  test('a line from bottom-left to top-right opens at the low price and closes at the high price', () => {
    const candles = drawToCandles(rising, { count: 10, low: 90, high: 110 });

    expect(candles[0].open).toBeCloseTo(90);
    expect(candles[9].close).toBeCloseTo(110);
    expect(candles[4].close).toBeCloseTo(100);
  });

  test('each candle opens where the previous one closed', () => {
    const candles = drawToCandles(rising, { count: 8, low: 90, high: 110 });

    expect(candles).toHaveLength(8);
    for (let i = 1; i < candles.length; i++) expect(candles[i].open).toBeCloseTo(candles[i - 1].close);
  });

  test('wicks always reach past the candle body', () => {
    const zigzag = [
      { x: 0, y: 0.5 },
      { x: 0.3, y: 0.1 },
      { x: 0.6, y: 0.9 },
      { x: 1, y: 0.4 },
    ];
    const candles = drawToCandles(zigzag, { count: 20, low: 50, high: 60 });

    expect(candles).toHaveLength(20);
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
  });

  test('a peak inside one candle shows up as its high', () => {
    const peak = [
      { x: 0, y: 1 },
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
    ];

    const [only] = drawToCandles(peak, { count: 1, low: 90, high: 110 });

    expect(only.open).toBeCloseTo(90);
    expect(only.close).toBeCloseTo(90);
    expect(only.high).toBeGreaterThanOrEqual(110);
  });

  test('a stroke that stops short of the edges is held flat to them', () => {
    const short = [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0 },
    ];

    const candles = drawToCandles(short, { count: 4, low: 0, high: 100 });

    expect(candles[0].open).toBeCloseTo(50);
    expect(candles[3].close).toBeCloseTo(100);
  });

  test('gives the same candles for the same stroke', () => {
    const first = drawToCandles(rising, { count: 5, low: 1, high: 2 });

    expect(first).toHaveLength(5);
    expect(drawToCandles(rising, { count: 5, low: 1, high: 2 })).toEqual(first);
  });
});

describe('customBarSet', () => {
  test('hides the candles after the frozen one', () => {
    const candles = [1, 2, 3, 4].map((n) => ({ time: n * 100, open: n, high: n, low: n, close: n, volume: 0 }));

    const set = customBarSet(candles, 200);

    expect(set.past.map((c) => c.close)).toEqual([1, 2]);
    expect(set.future.map((c) => c.close)).toEqual([3, 4]);
  });
});
