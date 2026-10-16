import type { BoardState } from './types.js';

const start = '<!-- vmethod-board -->';
const end = '<!-- /vmethod-board -->';

function bounds(text: string): [number, number] | undefined {
  const starts = text.split(start).length - 1;
  const ends = text.split(end).length - 1;
  if (!starts && !ends) return undefined;
  const left = text.indexOf(start) + start.length;
  const right = text.indexOf(end);
  if (starts !== 1 || ends !== 1 || right < left)
    throw new Error('Invalid board README: missing or duplicated markers');
  return [left, right];
}

export function readState(text: string): BoardState {
  const range = bounds(text);
  if (!range) return { version: 0, minCompatible: 0, aliases: {} };
  const entries = new Map<string, string>();
  for (const line of text
    .slice(...range)
    .trim()
    .split('\n')) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match || entries.has(match[1]))
      throw new Error('Invalid board README block');
    entries.set(match[1], match[2]);
  }
  const version = entries.get('version');
  const minimum = entries.get('min_compatible');
  if (
    !version ||
    !minimum ||
    !/^\d+$/.test(version) ||
    !/^\d+$/.test(minimum) ||
    !Number.isSafeInteger(Number(version)) ||
    !Number.isSafeInteger(Number(minimum)) ||
    Number(minimum) > Number(version)
  )
    throw new Error('Invalid board version');
  const aliases: unknown = JSON.parse(entries.get('progress_aliases') ?? '{}');
  if (
    !aliases ||
    typeof aliases !== 'object' ||
    Array.isArray(aliases) ||
    Object.values(aliases).some((value) => typeof value !== 'string')
  )
    throw new Error('Invalid Progress aliases');
  return {
    version: Number(version),
    minCompatible: Number(minimum),
    migrated: entries.get('migrated'),
    lock: entries.get('lock'),
    paused: entries.get('paused at'),
    migrating: entries.get('migrating'),
    aliases: aliases as Record<string, string>,
  };
}

export function writeState(
  text: string,
  state: BoardState,
  firstAppend = false,
): string {
  const range = bounds(text);
  if (!range && !firstAppend)
    throw new Error('Invalid board README: missing markers');
  const lines = [
    `version: ${state.version}`,
    `min_compatible: ${state.minCompatible}`,
  ];
  for (const [key, value] of [
    ['migrated', state.migrated],
    ['lock', state.lock],
    ['paused at', state.paused],
    ['migrating', state.migrating],
  ] as const)
    if (value !== undefined) lines.push(`${key}: ${value}`);
  if (Object.keys(state.aliases).length)
    lines.push(`progress_aliases: ${JSON.stringify(state.aliases)}`);
  const block = `\n${lines.join('\n')}\n`;
  return range
    ? text.slice(0, range[0]) + block + text.slice(range[1])
    : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${start}${block}${end}\n`;
}

export function compatibility(
  state: BoardState,
  boardVersion: number,
  report: (message: string) => void,
): void {
  if (state.minCompatible > boardVersion)
    throw new Error(
      `BOARD INCOMPATIBLE: upgrade @vworlds/vmethod to board ≥ ${state.minCompatible}`,
    );
  if (state.version > boardVersion)
    report('BOARD AHEAD: upgrade @vworlds/vmethod');
}
