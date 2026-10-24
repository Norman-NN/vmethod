import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Migration } from "./types.js";
import { Ajv } from "ajv";
import schema from "../../schema/board-migration.schema.json" with { type: "json" };

declare const __MIGRATIONS__: Migration[];
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);

export function loadMigrations(): Migration[] {
  // The CLI embeds the complete list at build time, keeping a running process
  // independent of a later npm install. Source tests read the shipped files.
  const migrations =
    typeof __MIGRATIONS__ !== "undefined"
      ? __MIGRATIONS__
      : (() => {
          const path = fileURLToPath(new URL("../../board/migrations/", import.meta.url));
          return readdirSync(path)
            .filter((name) => /^\d{4}-[a-z0-9-]+\.json$/.test(name))
            .sort()
            .map((name) => {
              const migration = JSON.parse(readFileSync(join(path, name), "utf8")) as Migration;
              if (migration.version !== Number(name.slice(0, 4))) {
                throw new Error("Migration filename/version mismatch");
              }
              return migration;
            });
        })();
  validateMigrations(migrations);
  return migrations;
}

export function validateMigrations(migrations: Migration[]): void {
  const aliases = new Map<string, string>();
  for (const [index, migration] of migrations.entries()) {
    if (!validate(migration)) {
      throw new Error(`Invalid migration: ${JSON.stringify(validate.errors)}`);
    }
    if (
      migration.version !== index + 1 ||
      !Array.isArray(migration.up) ||
      !migration.expect?.fields ||
      migration.expect.policy?.doneKeeps !== 6
    ) {
      throw new Error("Invalid ordered migration");
    }
    for (const op of migration.up) {
      if ("field" in op && op.field === "vmethod-migration-lock") {
        throw new Error("Migration cannot alter its own lock");
      }
      if (op.op === "add_field" && op.type === "single_select" && !op.options) {
        throw new Error("Single select field requires options");
      }
      if (op.op === "rename_option" && op.from === op.to) {
        throw new Error("Rename must change option");
      }
      if (
        ![
          "workflow_columns",
          "add_field",
          "add_option",
          "rename_option",
          "set_option_meta",
          "add_progress_alias",
          "rewrite_progress",
          "remove_option",
          "remove_field",
        ].includes(op.op)
      ) {
        throw new Error("Unknown migration operation");
      }
      if (
        ["workflow_columns", "remove_field", "remove_option", "rewrite_progress"].includes(op.op) &&
        !migration.requires
      ) {
        throw new Error("Contract operation requires a minimum vmethod version");
      }
      if (op.op === "rewrite_progress" && aliases.get(op.from) !== op.to) {
        throw new Error("Progress rewrite requires an earlier expand alias");
      }
    }
    // Aliases cannot be introduced and contracted in the same migration.
    for (const op of migration.up) {
      if (op.op === "add_progress_alias") {
        aliases.set(op.from, op.to);
      }
    }
  }
}
