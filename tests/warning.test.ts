import { describe, expect, test } from 'bun:test';
import {
  matchTyped,
  normalizeTyped,
  orderWarningActions,
  pickEnterAction,
  pickInitialFocus,
  warningFaults,
  warningWindow,
} from '../src/core/warning.ts';
import type { SystemAction, WarningInput } from '../src/core/warning.ts';

describe('warningWindow and action ordering', () => {
  test('orders every mix of primary, danger, plain, and cancel into primary -> danger -> plain -> cancel', () => {
    const input: SystemAction[] = [
      { label: 'Cancel', value: 'c', cancel: true },
      { label: 'Export backup', value: 'e' },
      { label: 'Take over here', value: 'd', danger: true },
      { label: 'Reload', value: 'p', primary: true },
    ];
    expect(orderWarningActions(input).map(a => a.label)).toEqual([
      'Reload',
      'Take over here',
      'Export backup',
      'Cancel',
    ]);
  });

  test('preserves relative order within the same bucket', () => {
    const input: SystemAction[] = [
      { label: 'Second plain', value: 2 },
      { label: 'Cancel', value: null, cancel: true },
      { label: 'First plain', value: 1 },
    ];
    expect(orderWarningActions(input).map(a => a.label)).toEqual([
      'Second plain',
      'First plain',
      'Cancel',
    ]);
  });

  test('defaults to kind warning and one Close button when omitted', () => {
    const spec = warningWindow({ tag: 'Import error', title: 'File too large', body: 'Save files over 5 MB are not accepted.' });
    expect(spec.kind).toBe('warning');
    expect(spec.body).toEqual(['Save files over 5 MB are not accepted.']);
    expect(spec.lines).toEqual([]);
    expect(spec.actions).toEqual([{ label: 'Close', value: null, cancel: true }]);
  });

  test('normalizes string[] body and strips blank paragraphs and lines', () => {
    const spec = warningWindow({
      tag: 'Penalty Zone',
      kind: 'penalty',
      title: 'Penalty',
      body: ['First paragraph.', '   ', 'Second paragraph.'],
      lines: ['Streak reset to 0', ''],
    });
    expect(spec.kind).toBe('penalty');
    expect(spec.body).toEqual(['First paragraph.', 'Second paragraph.']);
    expect(spec.lines).toEqual(['Streak reset to 0']);
  });
});

describe('focus and Enter selection', () => {
  test('pickInitialFocus prefers primary over everything else', () => {
    const actions: SystemAction[] = [
      { label: 'Cancel', value: false, cancel: true },
      { label: 'Take over here', value: 'take', danger: true },
      { label: 'Reload', value: 'reload', primary: true },
    ];
    expect(pickInitialFocus(actions)).toBe(2);
  });

  test('pickInitialFocus lands on Cancel on danger windows without a primary button', () => {
    const ordered = orderWarningActions([
      { label: 'Delete gate', value: true, danger: true },
      { label: 'Cancel', value: false, cancel: true },
    ]);
    expect(ordered[0]!.label).toBe('Delete gate');
    expect(pickInitialFocus(ordered)).toBe(1);
    expect(ordered[pickInitialFocus(ordered)]!.label).toBe('Cancel');
  });

  test('pickInitialFocus lands on Cancel on a blue window that has a danger button and no primary', () => {
    const actions: SystemAction[] = [
      { label: 'Cancel', value: null, cancel: true },
      { label: 'Add hunters to party', value: 'add' },
      { label: 'Replace campaign', value: 'replace', danger: true },
    ];
    expect(pickInitialFocus(actions)).toBe(0);
  });

  test('pickInitialFocus picks the single Close button on a single-action alert and -1 on empty', () => {
    expect(pickInitialFocus([{ label: 'Close', value: null, cancel: true }])).toBe(0);
    expect(pickInitialFocus([])).toBe(-1);
  });

  test('pickEnterAction picks primary, falls back to danger/plain, and never picks Cancel', () => {
    const dangerFirst: SystemAction[] = [
      { label: 'Delete hunter', value: true, danger: true },
      { label: 'Cancel', value: null, cancel: true },
    ];
    expect(pickEnterAction(dangerFirst)?.label).toBe('Delete hunter');

    const cancelFirst: SystemAction[] = [
      { label: 'Cancel', value: null, cancel: true },
      { label: 'Delete hunter', value: true, danger: true },
    ];
    expect(pickEnterAction(cancelFirst)?.label).toBe('Delete hunter');

    const withPrimary: SystemAction[] = [
      { label: 'Cancel', value: null, cancel: true },
      { label: 'Save name', value: true, primary: true },
    ];
    expect(pickEnterAction(withPrimary)?.label).toBe('Save name');

    expect(pickEnterAction([{ label: 'Cancel', value: null, cancel: true }])).toBeNull();
  });
});

describe('typed confirmation match', () => {
  test('matches RESET in any case and collapses extra whitespace', () => {
    expect(normalizeTyped('  Mira   Vale ')).toBe('mira vale');
    expect(matchTyped('RESET', { word: 'RESET' })).toBe(true);
    expect(matchTyped('reset', { word: 'RESET' })).toBe(true);
    expect(matchTyped('  ReSeT ', { word: 'RESET' })).toBe(true);
    expect(matchTyped('Mira   Vale', { word: 'Mira Vale' })).toBe(true);
    expect(matchTyped('mira vale', { word: 'Mira Vale' })).toBe(true);
    expect(matchTyped('Mira', { word: 'Mira Vale' })).toBe(false);
    expect(matchTyped('', { word: 'RESET' })).toBe(false);
  });
});

describe('warningFaults', () => {
  const clean: WarningInput = {
    tag: 'Warning',
    title: 'Delete Goblin Den?',
    body: 'You cannot undo deleting Goblin Den.',
    actions: [
      { label: 'Delete gate', value: true, danger: true },
      { label: 'Cancel', value: false, cancel: true },
    ],
  };

  test('accepts a clean Variant 1 warning and titles containing uppercase hunter names', () => {
    expect(warningFaults(clean)).toEqual([]);
    expect(warningFaults({ ...clean, title: 'Delete JIN-WOO?' })).toEqual([]);
    expect(warningFaults({ tag: 'Import error', title: 'Import failed', body: 'File was not valid JSON.' })).toEqual([]);
  });

  test('flags exclamation marks in tag and blank tag', () => {
    const bang = warningFaults({ ...clean, tag: '! Warning' });
    expect(bang.length).toBe(1);
    expect(bang[0]).toContain('!');
    const blank = warningFaults({ ...clean, tag: '   ' });
    expect(blank.length).toBe(1);
    expect(blank[0]).toContain('blank');
  });

  test('flags all-caps titles and blank titles', () => {
    const gate = warningFaults({ ...clean, title: 'GATE BREAK' });
    expect(gate.length).toBe(1);
    expect(gate[0]).toContain('sentence case');
    const pen = warningFaults({ ...clean, title: 'PENALTY' });
    expect(pen.length).toBe(1);
    expect(pen[0]).toContain('sentence case');
    const blank = warningFaults({ ...clean, title: '' });
    expect(blank.length).toBe(1);
    expect(blank[0]).toContain('blank');
  });

  test('SystemAction allows dynamic primary without danger, and rejects primary+danger at compile time', () => {
    const cond = Math.random() > 0.5;
    const okPrimary: SystemAction = { label: 'Pick target', value: 't1', primary: cond };
    const okDanger: SystemAction = { label: 'Delete gate', value: true, danger: true };
    // @ts-expect-error primary and danger cannot both be true on one SystemAction
    const bad: SystemAction = { label: 'Delete gate', value: true, primary: true, danger: true };
    expect([okPrimary.label, okDanger.label, bad.label].length).toBe(3);
  });

  test('flags bare labels, one-word danger labels, multiple primaries, and primary+danger', () => {
    const bare = warningFaults({ ...clean, actions: [{ label: 'Delete', value: true, danger: true }, { label: 'Cancel', value: false, cancel: true }] });
    expect(bare.length).toBe(1);
    expect(bare[0]).toContain('vague or bare');
    const oneWord = warningFaults({ ...clean, actions: [{ label: 'Purge', value: true, danger: true }, { label: 'Cancel', value: false, cancel: true }] });
    expect(oneWord.length).toBe(1);
    expect(oneWord[0]).toContain('at least two words');
    const okBare = warningFaults({ ...clean, actions: [{ label: 'OK', value: true }] });
    expect(okBare.length).toBe(1);
    expect(okBare[0]).toContain('vague or bare');
    const twoPrimaries = warningFaults({
      ...clean,
      actions: [
        { label: 'Do one', value: 1, primary: true },
        { label: 'Do two', value: 2, primary: true },
      ],
    });
    expect(twoPrimaries.length).toBe(1);
    expect(twoPrimaries[0]).toContain('2 primary');
    const badCombo = { label: 'Delete gate', value: true, primary: true, danger: true } as unknown as SystemAction;
    const combo = warningFaults({ ...clean, actions: [badCombo] });
    expect(combo.length).toBe(1);
    expect(combo[0]).toContain('both primary and danger');
  });
});
