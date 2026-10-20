// @vitest-environment jsdom
// MoveToDialog.tsx imports the store, which needs a localStorage.
import { describe, expect, test } from 'vitest';
import { enterChoice, matchingChoices, type Choice } from './MoveToDialog';

const choice = (key: string, path: string[]): Choice => ({ key, target: { spaceId: 's', parentId: null, index: 0 }, path });
const choices = [choice('space:j', ['Journal']), choice('p1', ['Journal', 'Old notes']), choice('space:m', ['Markets']), choice('p2', ['Markets', 'Weekly levels'])];

describe('Move to… search', () => {
  test('lists every choice until something is typed, then the ones whose name holds it', () => {
    expect(matchingChoices(choices, '')).toEqual(choices);
    expect(matchingChoices(choices, ' WEEK ').map((c) => c.key)).toEqual(['p2']);
  });

  test('Enter picks the first match once something is typed', () => {
    expect(enterChoice(choices, 'mark')?.key).toBe('space:m');
    expect(enterChoice(choices, 'levels')?.key).toBe('p2');
    expect(enterChoice(choices, 'nothing like it')).toBeNull();
  });

  test('Enter with nothing typed picks nothing, so the page is not moved to the first space', () => {
    expect(enterChoice(choices, '')).toBeNull();
    expect(enterChoice(choices, '   ')).toBeNull();
  });
});
