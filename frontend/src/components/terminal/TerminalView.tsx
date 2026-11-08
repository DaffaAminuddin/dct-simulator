/**
 * xterm.js view over the shared terminal store. The view owns only line
 * editing (cursor, history browsing, completion); the transcript, the
 * session and command execution live in the store, so several views can be
 * open at once and stay in sync.
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useTerminalStore } from '@/stores/terminalStore';
import { cn } from '@/utils/cn';

const THEME = {
  background: '#16151c',
  foreground: '#e7e6ea',
  cursor: '#4cc38a',
  cursorAccent: '#16151c',
  selectionBackground: '#4cc38a55',
  black: '#2a2931',
  red: '#ee7f6d',
  green: '#4cc38a',
  yellow: '#f2c66d',
  blue: '#8ab4f8',
  magenta: '#c9a6f5',
  cyan: '#7fd1c7',
  white: '#e7e6ea',
  brightBlack: '#6b6a74',
  brightRed: '#f6a6a2',
  brightGreen: '#7ee0ad',
  brightYellow: '#f7d88f',
  brightBlue: '#adc8fb',
  brightMagenta: '#dcc3f9',
  brightCyan: '#a6e3dc',
  brightWhite: '#ffffff',
};

// eslint-disable-next-line no-control-regex
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

const nextFrame = (cb: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : window.setTimeout(cb, 16));
const cancelFrame = (id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : window.clearTimeout(id));

/** Create the xterm instance and line editor in `el`; returns the teardown. */
function mountTerminal(el: HTMLDivElement, autoFocus: boolean): () => void {
  const term = new Terminal({
    theme: THEME,
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', 'SF Mono', ui-monospace, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    convertEol: false,
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  const doFit = () => {
    try {
      if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
    } catch {
      /* element not measurable yet */
    }
  };
  doFit();

  // ---- line editor state ------------------------------------------------
  let buffer = '';
  let cursor = 0;
  let rowOffset = 0;
  let histIdx = -1;
  let draft = '';
  let lastId = 0;

  const prompt = () => useTerminalStore.getState().prompt();

  /** Move to the start of the input area and erase it. */
  const eraseInput = () => {
    term.write(`\r${rowOffset > 0 ? `\x1b[${rowOffset}A` : ''}\x1b[J`);
    rowOffset = 0;
  };

  const render = () => {
    const p = prompt();
    const cols = Math.max(1, term.cols);
    const pl = visible(p);
    let seq = `\r${rowOffset > 0 ? `\x1b[${rowOffset}A` : ''}\x1b[J${p}${buffer}`;
    const total = pl + buffer.length;
    if (total > 0 && total % cols === 0) seq += ' \b';
    const endRow = Math.floor(total / cols);
    const target = pl + cursor;
    const tRow = Math.floor(target / cols);
    const tCol = target % cols;
    if (endRow > tRow) seq += `\x1b[${endRow - tRow}A`;
    seq += `\x1b[${tCol + 1}G`;
    rowOffset = tRow;
    term.write(seq);
  };

  /** Write transcript chunks the view has not shown yet, keeping the input line below them. */
  const flush = () => {
    const { chunks } = useTerminalStore.getState();
    const fresh = chunks.filter((c) => c.id > lastId);
    if (!fresh.length) return;
    eraseInput();
    term.write(fresh.map((c) => c.text).join(''));
    lastId = fresh[fresh.length - 1].id;
    render();
  };

  // Initial paint: whole transcript, then the prompt.
  const st = useTerminalStore.getState();
  term.write(st.chunks.map((c) => c.text).join(''));
  lastId = st.chunks.at(-1)?.id ?? 0;
  render();
  let clearSeq = st.clearSeq;

  const unsub = useTerminalStore.subscribe((s, prev) => {
    if (s.clearSeq !== clearSeq) {
      clearSeq = s.clearSeq;
      term.reset();
      rowOffset = 0;
      lastId = 0;
      term.write(s.chunks.map((c) => c.text).join(''));
      lastId = s.chunks.at(-1)?.id ?? 0;
      render();
      return;
    }
    if (s.chunks !== prev.chunks) flush();
    else if (s.session !== prev.session) render();
  });

  const setLine = (text: string, at = text.length) => {
    buffer = text;
    cursor = at;
    render();
  };

  const submit = () => {
    const line = buffer;
    buffer = '';
    cursor = 0;
    histIdx = -1;
    draft = '';
    eraseInput();
    // The store echoes "prompt + line" into the transcript; flush() paints it.
    useTerminalStore.getState().submit(line);
    flush();
    render();
  };

  const history = () => useTerminalStore.getState().session.history;

  const onKey = term.onData((data) => {
    // Paste of several lines: run each complete line.
    if (data.length > 1 && /[\r\n]/.test(data) && !data.startsWith('\x1b')) {
      const parts = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      parts.forEach((part, i) => {
        if (i < parts.length - 1) {
          buffer = buffer.slice(0, cursor) + part + buffer.slice(cursor);
          cursor = buffer.length;
          submit();
        } else if (part) setLine(buffer.slice(0, cursor) + part + buffer.slice(cursor), cursor + part.length);
      });
      return;
    }
    switch (data) {
      case '\r':
        submit();
        return;
      case '\x7f': // Backspace
      case '\b':
        if (cursor > 0) setLine(buffer.slice(0, cursor - 1) + buffer.slice(cursor), cursor - 1);
        return;
      case '\x1b[3~': // Delete
        if (cursor < buffer.length) setLine(buffer.slice(0, cursor) + buffer.slice(cursor + 1), cursor);
        return;
      case '\x1b[D':
        if (cursor > 0) setLine(buffer, cursor - 1);
        return;
      case '\x1b[C':
        if (cursor < buffer.length) setLine(buffer, cursor + 1);
        return;
      case '\x1b[H':
      case '\x1bOH':
      case '\x01': // Ctrl+A
        setLine(buffer, 0);
        return;
      case '\x1b[F':
      case '\x1bOF':
      case '\x05': // Ctrl+E
        setLine(buffer, buffer.length);
        return;
      case '\x1b[A': {
        const h = history();
        if (!h.length) return;
        if (histIdx === -1) {
          draft = buffer;
          histIdx = h.length - 1;
        } else if (histIdx > 0) histIdx--;
        setLine(h[histIdx]);
        return;
      }
      case '\x1b[B': {
        const h = history();
        if (histIdx === -1) return;
        if (histIdx < h.length - 1) {
          histIdx++;
          setLine(h[histIdx]);
        } else {
          histIdx = -1;
          setLine(draft);
        }
        return;
      }
      case '\x03': // Ctrl+C
        setLine(buffer, buffer.length);
        term.write('^C\r\n');
        buffer = '';
        cursor = 0;
        rowOffset = 0;
        histIdx = -1;
        render();
        return;
      case '\x0c': // Ctrl+L
        useTerminalStore.getState().clear();
        return;
      case '\x15': // Ctrl+U
        setLine(buffer.slice(cursor), 0);
        return;
      case '\x0b': // Ctrl+K
        setLine(buffer.slice(0, cursor), cursor);
        return;
      case '\x17': {
        // Ctrl+W: delete the previous word
        const left = buffer.slice(0, cursor).replace(/\S+\s*$/, '');
        setLine(left + buffer.slice(cursor), left.length);
        return;
      }
      case '\x04': // Ctrl+D on an empty line = exit
        if (!buffer) {
          buffer = 'exit';
          submit();
        }
        return;
      case '\t': {
        if (cursor !== buffer.length) return;
        const r = useTerminalStore.getState().complete(buffer);
        if (r.options.length) {
          eraseInput();
          term.write(`${prompt()}${buffer}\r\n`);
          const width = Math.max(...r.options.map((o) => o.length)) + 2;
          const perRow = Math.max(1, Math.floor(term.cols / width));
          for (let i = 0; i < r.options.length; i += perRow)
            term.write(
              `${r.options
                .slice(i, i + perRow)
                .map((o) => o.padEnd(width))
                .join('')
                .trimEnd()}\r\n`,
            );
          render();
        } else if (r.line !== buffer) setLine(r.line);
        return;
      }
      default:
        if (data.startsWith('\x1b')) return; // other escape sequences
        if (data < ' ' && data !== '\t') return; // other control characters
        setLine(buffer.slice(0, cursor) + data + buffer.slice(cursor), cursor + data.length);
    }
  });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => doFit()) : null;
  ro?.observe(el);
  if (autoFocus) term.focus();

  return () => {
    ro?.disconnect();
    onKey.dispose();
    unsub();
    // xterm schedules viewport syncs on animation frames; let them run before disposing.
    nextFrame(() => nextFrame(() => term.dispose()));
  };
}

export default function TerminalView({ className, autoFocus = true }: { className?: string; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Open on the next frame so a StrictMode mount/unmount pair never creates a terminal.
    let teardown: (() => void) | null = null;
    const id = nextFrame(() => {
      teardown = mountTerminal(el, autoFocus);
    });
    return () => {
      cancelFrame(id);
      teardown?.();
    };
  }, [autoFocus]);

  return <div ref={host} className={cn('h-full min-h-0 w-full overflow-hidden', className)} data-testid="terminal" />;
}
