import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { expect, test } from "vitest";
import { loadYaml } from "../src/config.js";
import { validProject } from "./helpers.js";

test("model configuration accepts ordered fallback and refuses unknown families and ambiguous gates", () => {
  const root = validProject();
  const glm = {
    family: "glm",
    model: "fake/glm",
    kind: "opencode",
    gate: "none",
    fallback: ["sol"],
  };
  const sol = { family: "sol", model: "fake/sol", kind: "opencode", gate: "owner" };
  writeFileSync(join(root, "models.yaml"), stringify([glm, sol]));
  expect(loadYaml(root, "models")).toEqual([glm, sol]);
  for (const models of [
    [{ ...glm, fallback: ["not-configured"] }, sol],
    [glm, { ...sol, model: "fake/glm" }],
    [glm, { ...sol, family: "glm" }],
  ]) {
    writeFileSync(join(root, "models.yaml"), stringify(models));
    expect(() => loadYaml(root, "models")).toThrow(/models.yaml:\d+:/);
  }
});
