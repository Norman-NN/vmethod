import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { expect, test } from "vitest";
import { stateRoot } from "../src/gateway/digest.js";

test("global setup isolates explicit XDG state and empty-environment home fallbacks", () => {
  const home = process.env.HOME!;
  expect(home.startsWith(resolve(".tmp") + sep + "vitest-state-")).toBe(true);
  expect(process.env.XDG_STATE_HOME).toBe(join(home, "xdg"));
  expect(homedir()).toBe(home);
  expect(stateRoot(process.env, "test")).toBe(join(home, "xdg/vmethod/test"));
  expect(stateRoot({}, "test")).toBe(join(home, ".local/state/vmethod/test"));
});
