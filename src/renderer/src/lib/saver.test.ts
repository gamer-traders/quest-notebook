import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createSaver } from './saver';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('schedule saves once after the delay', () => {
  const save = vi.fn();
  const saver = createSaver(save, 300);
  saver.schedule();
  vi.advanceTimersByTime(200);
  saver.schedule();
  vi.advanceTimersByTime(299);
  expect(save).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(save).toHaveBeenCalledTimes(1);
});

test('flush saves a pending change at once and only once', () => {
  const save = vi.fn();
  const saver = createSaver(save, 300);
  saver.schedule();
  saver.flush();
  expect(save).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  saver.flush();
  expect(save).toHaveBeenCalledTimes(1);
});

test('flush with nothing pending does not save', () => {
  const save = vi.fn();
  const saver = createSaver(save, 300);
  saver.flush();
  saver.schedule();
  vi.advanceTimersByTime(300);
  saver.flush();
  expect(save).toHaveBeenCalledTimes(1);
});
