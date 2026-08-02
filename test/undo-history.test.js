const test = require('node:test');
const assert = require('node:assert/strict');
const { UndoHistory } = require('../src/undo-history');

function snapshot(value, start = value.length, end = start) {
  return {
    value,
    selectionStart: start,
    selectionEnd: end,
    selectionDirection: 'none'
  };
}

test('merges consecutive typing into one undo step', () => {
  const history = new UndoHistory();
  history.record(snapshot(''), snapshot('a'), 'insertText', 0);
  history.record(snapshot('a'), snapshot('ab'), 'insertText', 100);
  history.record(snapshot('ab'), snapshot('abc'), 'insertText', 200);

  assert.equal(history.undo('abc').value, '');
  assert.equal(history.redo('').value, 'abc');
});

test('starts a new typing group after a pause', () => {
  const history = new UndoHistory({ mergeDelay: 1000 });
  history.record(snapshot(''), snapshot('a'), 'insertText', 0);
  history.record(snapshot('a'), snapshot('ab'), 'insertText', 1500);

  assert.equal(history.undo('ab').value, 'a');
  assert.equal(history.undo('a').value, '');
});

test('starts a new group after cursor movement', () => {
  const history = new UndoHistory();
  history.record(snapshot('abc', 3), snapshot('abcd', 4), 'insertText', 0);
  history.breakGroup();
  history.record(snapshot('abcd', 0), snapshot('Xabcd', 1), 'insertText', 100);

  const firstUndo = history.undo('Xabcd');
  assert.equal(firstUndo.value, 'abcd');
  assert.deepEqual(firstUndo.selection, { start: 0, end: 0, direction: 'none' });
  assert.equal(history.undo('abcd').value, 'abc');
});

test('merges consecutive backward deletions', () => {
  const history = new UndoHistory();
  history.record(snapshot('abc', 3), snapshot('ab', 2), 'deleteContentBackward', 0);
  history.record(snapshot('ab', 2), snapshot('a', 1), 'deleteContentBackward', 100);

  assert.equal(history.undo('a').value, 'abc');
});

test('merges consecutive forward deletions', () => {
  const history = new UndoHistory();
  history.record(snapshot('abc', 0), snapshot('bc', 0), 'deleteContentForward', 0);
  history.record(snapshot('bc', 0), snapshot('c', 0), 'deleteContentForward', 100);

  assert.equal(history.undo('c').value, 'abc');
});

test('keeps paste separate from surrounding typing', () => {
  const history = new UndoHistory();
  history.record(snapshot(''), snapshot('a'), 'insertText', 0);
  history.record(snapshot('a'), snapshot('aXYZ'), 'insertFromPaste', 100);
  history.record(snapshot('aXYZ'), snapshot('aXYZb'), 'insertText', 200);

  assert.equal(history.undo('aXYZb').value, 'aXYZ');
  assert.equal(history.undo('aXYZ').value, 'a');
  assert.equal(history.undo('a').value, '');
});

test('tracks edits correctly when surrounding text repeats', () => {
  const history = new UndoHistory();
  history.record(snapshot('aaa', 0), snapshot('aaaa', 1), 'insertText', 0);

  const result = history.undo('aaaa');
  assert.equal(result.value, 'aaa');
  assert.deepEqual(result.selection, { start: 0, end: 0, direction: 'none' });
});

test('groups typing that starts by replacing a selection', () => {
  const history = new UndoHistory();
  history.record(snapshot('hello', 1, 4), snapshot('hXo', 2), 'insertText', 0);
  history.record(snapshot('hXo', 2), snapshot('hXYo', 3), 'insertText', 100);

  assert.equal(history.undo('hXYo').value, 'hello');
});

test('keeps an input method composition as one separate step', () => {
  const history = new UndoHistory();
  history.record(snapshot(''), snapshot('a'), 'insertText', 0);
  history.record(snapshot('a'), snapshot('a中文'), 'insertCompositionText', 100);

  assert.equal(history.undo('a中文').value, 'a');
  assert.equal(history.undo('a').value, '');
});

test('clears redo history after a new edit', () => {
  const history = new UndoHistory();
  history.record(snapshot(''), snapshot('a'), 'insertText', 0);
  assert.equal(history.undo('a').value, '');
  history.record(snapshot(''), snapshot('b'), 'insertText', 100);

  assert.equal(history.redo('b'), null);
});
