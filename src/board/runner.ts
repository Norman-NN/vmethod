import { randomUUID } from 'node:crypto';
import { compatibility, readState, writeState } from './readme.js';
import { validateMigrations } from './migrations.js';
import type {
  BoardIO,
  BoardState,
  BoardStatus,
  Field,
  Migration,
  MigrationResult,
  Operation,
  Snapshot,
} from './types.js';

const lockName = 'vmethod-migration-lock';
const minute = 60000;
const batchSize = 25;
class BudgetPause extends Error {}

function drift(snapshot: Snapshot, migration?: Migration): string[] {
  if (!migration) return [];
  const output: string[] = [];
  for (const [name, expected] of Object.entries(migration.expect.fields)) {
    const fields = snapshot.fields.filter((field) => field.name === name);
    const field = fields[0];
    if (fields.length !== 1 || field.type !== expected.type)
      output.push(`${name}: expected ${expected.type}`);
    else if (
      expected.options &&
      JSON.stringify(field.options.map((option) => option.name)) !==
        JSON.stringify(expected.options)
    )
      output.push(`${name}: expected options ${expected.options.join(', ')}`);
  }
  return output;
}

function holderTime(lock?: string): number {
  return lock ? Date.parse(lock.split(' since ')[1] ?? '') : NaN;
}

export class MigrationRunner {
  private run = randomUUID();
  private lockId?: string;
  private initialAppend = false;
  private position = '';
  constructor(
    private io: BoardIO,
    private migrations: Migration[],
    private boardVersion: number,
    private packageVersion: string,
  ) {
    validateMigrations(migrations);
    if (migrations.at(-1)?.version !== boardVersion)
      throw new Error('Package boardVersion does not match migrations');
  }

  async status(): Promise<BoardStatus> {
    const snapshot = await this.io.snapshot();
    const state = readState(snapshot.readme);
    return {
      state,
      pending: this.migrations.filter(
        (migration) => migration.version > state.version,
      ),
      drift: drift(
        snapshot,
        this.migrations[Math.min(state.version || 1, this.boardVersion) - 1],
      ),
    };
  }

  private async held(): Promise<{ snapshot: Snapshot; state: BoardState }> {
    const snapshot = await this.io.snapshot();
    const state = readState(snapshot.readme);
    if (
      !snapshot.fields.some(
        (field) => field.id === this.lockId && field.name === lockName,
      ) ||
      !state.lock?.startsWith(`${this.run} `)
    )
      throw new Error('Migration lock lost');
    return { snapshot, state };
  }

  private async update(change: (state: BoardState) => void): Promise<void> {
    const { snapshot, state } = await this.held();
    change(state);
    await this.io.readme(snapshot.id, writeState(snapshot.readme, state));
  }

  private async acquire(steal: boolean, login: string): Promise<void> {
    let snapshot = await this.io.snapshot();
    const state = readState(snapshot.readme);
    this.initialAppend = !snapshot.readme.includes('<!-- vmethod-board -->');
    const lock = snapshot.fields.find((field) => field.name === lockName);
    if (lock) {
      const since = holderTime(state.lock);
      const age = this.io.now() - since;
      const orphan = !Number.isFinite(since);
      if (!steal || (!orphan && age <= 60 * minute))
        throw new Error(
          orphan
            ? 'LOCK ORPHANED (no holder); use --steal'
            : 'Migration lock held; stale locks require --steal',
        );
      await this.io.deleteField(lock.id);
    }
    try {
      this.lockId = await this.io.createField(snapshot.id, lockName, {
        type: 'text',
      });
    } catch {
      snapshot = await this.io.snapshot();
      const current = readState(snapshot.readme);
      const age = this.io.now() - holderTime(current.lock);
      if (
        snapshot.fields.some((field) => field.name === lockName) &&
        (!Number.isFinite(age) || age > minute)
      )
        throw new Error('LOCK ORPHANED (no holder); use --steal');
      throw new Error('Migration lock not acquired');
    }
    // Re-read immediately before the first holder write too.
    snapshot = await this.io.snapshot();
    const current = readState(snapshot.readme);
    if (!snapshot.fields.some((field) => field.id === this.lockId))
      throw new Error('Migration lock lost');
    current.lock = `${this.run} ${login} since ${new Date(this.io.now()).toISOString()}`;
    await this.io.readme(
      snapshot.id,
      writeState(snapshot.readme, current, this.initialAppend),
    );
  }

  private async release(paused?: string): Promise<void> {
    await this.update((state) => {
      state.paused = paused;
      state.migrating = undefined;
    });
    await this.held();
    await this.io.deleteField(this.lockId!);
    // Retain the holder until deletion succeeds. A deletion failure must not
    // disguise a still-held lock as an orphan.
    const snapshot = await this.io.snapshot();
    const state = readState(snapshot.readme);
    if (snapshot.fields.some((field) => field.name === lockName)) return;
    if (state.lock?.startsWith(`${this.run} `)) {
      state.lock = undefined;
      await this.io.readme(snapshot.id, writeState(snapshot.readme, state));
    }
  }

  async migrate({
    dryRun = false,
    steal = false,
  }: {
    dryRun?: boolean;
    steal?: boolean;
  }): Promise<MigrationResult> {
    const initial = await this.status();
    if (dryRun) {
      const touchesStatus = initial.pending.some((migration) =>
        migration.up.some((op) => 'field' in op && op.field === 'Status'),
      );
      return {
        ...initial,
        dryRun,
        workflows: touchesStatus
          ? await this.io.workflows((await this.io.snapshot()).id)
          : [],
        message: 'Dry run: no changes',
      };
    }
    compatibility(initial.state, this.boardVersion, this.io.report);
    if (!initial.pending.length)
      return {
        ...initial,
        dryRun,
        message: 'Board is up to date; never downgrade',
      };
    const login = await this.io.login();
    await this.acquire(steal, login);
    const { state } = await this.held();
    const from = state.version;
    await this.update((current) => {
      current.migrating = `${from}→${this.boardVersion} by ${login} since ${new Date(this.io.now()).toISOString()}`;
      current.paused = undefined;
    });
    await this.io.announce(
      `[vmethod] board migration ${from}→${this.boardVersion}`,
    );
    try {
      for (const migration of this.migrations.filter(
        (entry) => entry.version > from,
      )) {
        await this.held();
        if (migration.requires) {
          try {
            await this.io.adoption(migration.requires);
          } catch (error) {
            await this.release();
            throw error;
          }
        }
        for (const [index, op] of migration.up.entries()) {
          this.position = `${migration.version}/${index + 1}`;
          if (this.io.budgetStopped())
            throw new BudgetPause('0 cards left (operation pending)');
          await this.apply(op);
        }
        if (this.io.budgetStopped())
          throw new BudgetPause('0 cards left (verification pending)');
        const { snapshot, state: verified } = await this.held();
        const differences = drift(snapshot, migration);
        if (differences.length)
          throw new Error(
            `Migration ${migration.version} expect failed: ${differences.join('; ')}`,
          );
        if (verified.version >= migration.version)
          throw new Error('Board version changed during migration');
        await this.update((current) => {
          current.version = migration.version;
          if (migration.requires) current.minCompatible = migration.version;
          current.migrated = `${new Date(this.io.now()).toISOString()} by ${login} (vmethod v${this.packageVersion})`;
        });
      }
    } catch (error) {
      if (!(error instanceof BudgetPause)) throw error;
      return this.io.cleanup(async () => {
        await this.release(this.position);
        return {
          ...(await this.status()),
          dryRun,
          message: `BUDGET: ${error.message}; paused at ${this.position}`,
        };
      });
    }
    await this.release();
    return {
      ...(await this.status()),
      dryRun,
      message: `Migrated ${from}→${this.boardVersion}`,
    };
  }

  private field(snapshot: Snapshot, name: string): Field {
    const field = snapshot.fields.find((entry) => entry.name === name);
    if (!field) throw new Error(`Missing board field ${name}`);
    return field;
  }

  private async move(
    field: Field,
    from: string,
    to: string,
    rewrite = false,
  ): Promise<void> {
    const { snapshot } = await this.held();
    const cards = (await this.io.cards(snapshot.id)).flatMap((card) => {
      const value = card.values[field.name];
      if (
        typeof value !== 'string' ||
        (rewrite
          ? !value.startsWith(from) ||
            !/^(?:\s|🔁|🔴|$)/u.test(value.slice(from.length)) ||
            from === to
          : value !== from)
      )
        return [];
      return [
        { id: card.id, value: rewrite ? to + value.slice(from.length) : to },
      ];
    });
    for (let index = 0; index < cards.length; index += batchSize) {
      if (this.io.budgetStopped())
        throw new BudgetPause(`${cards.length - index} cards left`);
      await this.held();
      if (this.io.budgetStopped())
        throw new BudgetPause(`${cards.length - index} cards left`);
      await this.io.setCards(
        snapshot.id,
        field,
        cards.slice(index, index + batchSize),
      );
    }
  }

  private async apply(op: Operation): Promise<void> {
    const { snapshot, state } = await this.held();
    if (op.op === 'add_progress_alias') {
      await this.update((current) => {
        current.aliases[op.from] = op.to;
      });
      return;
    }
    if (op.op === 'rewrite_progress') {
      if (state.aliases[op.from] !== op.to)
        throw new Error('Missing live Progress alias');
      await this.move(this.field(snapshot, 'Progress'), op.from, op.to, true);
      return;
    }
    if (op.op === 'add_field') {
      const existing = snapshot.fields.find((field) => field.name === op.field);
      if (!existing) await this.io.createField(snapshot.id, op.field, op);
      else if (existing.type !== op.type)
        throw new Error(`Field type conflict: ${op.field}`);
      return;
    }
    const field = snapshot.fields.find((entry) => entry.name === op.field);
    if (!field && op.op === 'remove_field') return;
    if (!field) throw new Error(`Missing board field ${op.field}`);
    if (op.op === 'remove_field') {
      await this.io.deleteField(field.id);
      return;
    }
    if (field.type !== 'single_select')
      throw new Error('Option operation requires single_select');
    const options = field.options.map(({ name, color, description }) => ({
      name,
      color,
      description,
    }));
    if (op.op === 'rename_option') {
      if (!options.some((option) => option.name === op.to)) {
        options.push({ name: op.to, color: 'GRAY', description: '' });
        await this.io.options(field, options);
      }
      const live = this.field((await this.held()).snapshot, op.field);
      await this.move(live, op.from, op.to);
    } else if (op.op === 'remove_option') {
      if (!options.some((option) => option.name === op.option)) return;
      if (
        (await this.io.cards(snapshot.id)).some(
          (card) => card.values[op.field] === op.option,
        )
      )
        throw new Error(`Cannot remove occupied option ${op.option}`);
      await this.io.options(
        field,
        options.filter((option) => option.name !== op.option),
      );
    } else {
      const option = options.find((entry) => entry.name === op.option);
      if (option) {
        if (op.op === 'add_option') return;
        option.color = op.color ?? option.color;
        option.description = op.description ?? option.description;
      } else if (op.op === 'set_option_meta')
        throw new Error(`Missing option ${op.option}`);
      else
        options.push({
          name: op.option,
          color: op.color ?? 'GRAY',
          description: op.description ?? '',
        });
      if (
        JSON.stringify(options) !==
        JSON.stringify(
          field.options.map(({ name, color, description }) => ({
            name,
            color,
            description,
          })),
        )
      )
        await this.io.options(field, options);
    }
  }
}
