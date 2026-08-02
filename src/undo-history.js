(function exposeUndoHistory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MoriUndoHistory = api.UndoHistory;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function copySelection(snapshot) {
    return {
      start: snapshot.selectionStart,
      end: snapshot.selectionEnd,
      direction: snapshot.selectionDirection || 'none'
    };
  }

  function selectionsEqual(left, right) {
    return left.start === right.start
      && left.end === right.end
      && left.direction === right.direction;
  }

  function computeChange(before, after) {
    if (before.value === after.value) return null;

    if (after.selectionStart === after.selectionEnd) {
      const start = Math.min(before.selectionStart, after.selectionStart);
      const insertedLength = after.selectionStart - start;
      const lengthDelta = after.value.length - before.value.length;
      const deletedLength = insertedLength - lengthDelta;
      if (
        insertedLength >= 0
        && deletedLength >= 0
        && start + deletedLength <= before.value.length
        && start + insertedLength <= after.value.length
      ) {
        return {
          start,
          deletedText: before.value.slice(start, start + deletedLength),
          insertedText: after.value.slice(start, start + insertedLength)
        };
      }
    }

    const prefixLimit = Math.min(before.selectionStart, after.selectionStart);
    let start = 0;
    while (start < prefixLimit && before.value[start] === after.value[start]) start += 1;

    let beforeEnd = before.value.length;
    let afterEnd = after.value.length;
    const beforeFloor = Math.max(start, before.selectionEnd);
    const afterFloor = Math.max(start, after.selectionEnd);
    while (
      beforeEnd > beforeFloor
      && afterEnd > afterFloor
      && before.value[beforeEnd - 1] === after.value[afterEnd - 1]
    ) {
      beforeEnd -= 1;
      afterEnd -= 1;
    }

    return {
      start,
      deletedText: before.value.slice(start, beforeEnd),
      insertedText: after.value.slice(start, afterEnd)
    };
  }

  function classifyInput(inputType, before) {
    if (inputType === 'insertText') return 'typing';
    if (before.selectionStart !== before.selectionEnd) return 'atomic';
    if (inputType === 'deleteContentBackward') return 'deleteBackward';
    if (inputType === 'deleteContentForward') return 'deleteForward';
    return 'atomic';
  }

  class UndoHistory {
    constructor(options = {}) {
      this.limit = options.limit || 200;
      this.mergeDelay = options.mergeDelay || 1000;
      this.reset();
    }

    reset() {
      this.undoStack = [];
      this.redoStack = [];
      this.boundary = 0;
    }

    breakGroup() {
      this.boundary += 1;
    }

    record(before, after, inputType, timestamp = Date.now()) {
      const change = computeChange(before, after);
      if (!change) return false;

      const entry = {
        ...change,
        beforeSelection: copySelection(before),
        afterSelection: copySelection(after),
        kind: classifyInput(inputType, before),
        timestamp,
        boundary: this.boundary
      };
      const previous = this.undoStack.at(-1);

      if (previous && this.canMerge(previous, entry)) {
        this.merge(previous, entry);
      } else {
        this.undoStack.push(entry);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
      }

      this.redoStack.length = 0;
      if (entry.kind === 'atomic') this.breakGroup();
      return true;
    }

    canMerge(previous, current) {
      if (previous.boundary !== current.boundary || previous.kind !== current.kind) return false;
      if (current.timestamp - previous.timestamp > this.mergeDelay) return false;
      if (current.timestamp < previous.timestamp) return false;
      if (!selectionsEqual(previous.afterSelection, current.beforeSelection)) return false;

      if (current.kind === 'typing') {
        return current.deletedText === ''
          && current.start === previous.start + previous.insertedText.length;
      }
      if (current.kind === 'deleteBackward') {
        return previous.insertedText === ''
          && current.insertedText === ''
          && current.start + current.deletedText.length === previous.start;
      }
      if (current.kind === 'deleteForward') {
        return previous.insertedText === ''
          && current.insertedText === ''
          && current.start === previous.start;
      }
      return false;
    }

    merge(previous, current) {
      if (current.kind === 'typing') {
        previous.insertedText += current.insertedText;
      } else if (current.kind === 'deleteBackward') {
        previous.start = current.start;
        previous.deletedText = current.deletedText + previous.deletedText;
      } else if (current.kind === 'deleteForward') {
        previous.deletedText += current.deletedText;
      }
      previous.afterSelection = current.afterSelection;
      previous.timestamp = current.timestamp;
    }

    undo(value) {
      this.breakGroup();
      const entry = this.undoStack.at(-1);
      if (!entry) return null;
      if (value.slice(entry.start, entry.start + entry.insertedText.length) !== entry.insertedText) {
        this.reset();
        return null;
      }

      this.undoStack.pop();
      this.redoStack.push(entry);
      return {
        value: value.slice(0, entry.start)
          + entry.deletedText
          + value.slice(entry.start + entry.insertedText.length),
        selection: entry.beforeSelection
      };
    }

    redo(value) {
      this.breakGroup();
      const entry = this.redoStack.at(-1);
      if (!entry) return null;
      if (value.slice(entry.start, entry.start + entry.deletedText.length) !== entry.deletedText) {
        this.reset();
        return null;
      }

      this.redoStack.pop();
      this.undoStack.push(entry);
      return {
        value: value.slice(0, entry.start)
          + entry.insertedText
          + value.slice(entry.start + entry.deletedText.length),
        selection: entry.afterSelection
      };
    }
  }

  return { UndoHistory, computeChange };
});
