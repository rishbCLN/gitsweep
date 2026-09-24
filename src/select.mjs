// Interactive multi-select checklist over readline in raw mode — no dependency.
//
// This module is intentionally kept free of any parsing/business logic (that all
// lives in pure functions in git.mjs). The CLI only ever calls selectBranches()
// when stdin/stdout are TTYs, so the test suite never touches raw mode.
import { emitKeypressEvents } from 'node:readline';

const HINT = 'space toggle \u00b7 \u2191/\u2193 move \u00b7 a all \u00b7 n none \u00b7 enter confirm \u00b7 q abort';

/**
 * Show a checklist and resolve with the names the user kept checked, or null if
 * they aborted (q / Esc / Ctrl-C).
 * @param {Array<{ name: string, label?: string, checked?: boolean }>} items
 * @param {{ input?: NodeJS.ReadStream, output?: NodeJS.WriteStream, styler?: any }} [opts]
 * @returns {Promise<string[]|null>}
 */
export function selectBranches(items, opts = {}) {
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const c = opts.styler || { cyan: (s) => s, dim: (s) => s, green: (s) => s, bold: (s) => s };
  if (!items || items.length === 0) return Promise.resolve([]);

  const state = items.map((it) => ({
    name: it.name,
    label: it.label ?? it.name,
    checked: Boolean(it.checked),
  }));
  let cursor = 0;
  let rendered = 0;

  return new Promise((resolve) => {
    emitKeypressEvents(input);
    const wasRaw = Boolean(input.isRaw);
    if (input.isTTY && input.setRawMode) input.setRawMode(true);

    const clear = () => {
      if (rendered > 0) output.write(`\x1b[${rendered}A`); // up to the first line
      output.write('\x1b[0J'); // clear to end of screen
    };

    const render = () => {
      clear();
      const lines = state.map((s, i) => {
        const box = s.checked ? c.green('[x]') : '[ ]';
        const pointer = i === cursor ? c.cyan('\u276f') : ' ';
        const label = i === cursor ? c.bold(s.label) : s.label;
        return `${pointer} ${box} ${label}`;
      });
      lines.push(c.dim(HINT));
      output.write(`${lines.join('\n')}\n`);
      rendered = lines.length;
    };

    const cleanup = () => {
      input.removeListener('keypress', onKey);
      if (input.isTTY && input.setRawMode) input.setRawMode(wasRaw);
      input.pause();
    };

    const finish = (result) => {
      cleanup();
      resolve(result);
    };

    const onKey = (str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') return finish(null);
      switch (key.name) {
        case 'up':
        case 'k':
          cursor = (cursor - 1 + state.length) % state.length;
          render();
          break;
        case 'down':
        case 'j':
          cursor = (cursor + 1) % state.length;
          render();
          break;
        case 'space':
          state[cursor].checked = !state[cursor].checked;
          render();
          break;
        case 'a':
          state.forEach((s) => { s.checked = true; });
          render();
          break;
        case 'n':
          state.forEach((s) => { s.checked = false; });
          render();
          break;
        case 'return':
        case 'enter':
          finish(state.filter((s) => s.checked).map((s) => s.name));
          break;
        case 'escape':
        case 'q':
          finish(null);
          break;
        default:
          break;
      }
    };

    input.resume();
    input.on('keypress', onKey);
    render();
  });
}
