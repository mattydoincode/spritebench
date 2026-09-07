#!/usr/bin/env node
/**
 * Applies `infra/do-app.yaml` without disturbing the secrets held in the
 * DigitalOcean control panel.
 *
 *   node scripts/spec.mjs pull    # print the live spec
 *   node scripts/spec.mjs diff    # what push would change
 *   node scripts/spec.mjs push    # apply the committed spec
 *
 * App Platform has no secret store separate from the app: the control panel's
 * environment variable editor writes the same spec doctl submits, and a
 * submitted spec REPLACES the previous one. So applying the committed file
 * directly would erase every secret typed into the panel, and the app would
 * keep serving pages while no image could be read or written.
 *
 * `push` therefore reads the live spec first and carries every variable the
 * committed file does not mention back across. That is what lets the panel own
 * configuration outright: nothing has to be declared here to survive a push.
 * Secrets come back as `EV[1:...]` ciphertext, which DigitalOcean accepts
 * verbatim, so this never handles a plaintext credential.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";

const APP_NAME = "spritebench";
const SPEC_PATH = "infra/do-app.yaml";

function doctl(args, input) {
  return execFileSync("doctl", args, {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024
  });
}

/**
 * Resolved by name rather than kept in a file. One less id to paste, and it
 * cannot go stale if the app is recreated.
 */
function appId() {
  const apps = JSON.parse(doctl(["apps", "list", "-o", "json"]) || "[]");
  const matches = apps.filter((app) => app?.spec?.name === APP_NAME);

  if (matches.length === 0) {
    throw new Error(`no App Platform app named "${APP_NAME}". Create it first with:\n` + `  doctl apps create --spec ${SPEC_PATH}`);
  }
  if (matches.length > 1) {
    throw new Error(`${matches.length} apps are named "${APP_NAME}"; resolve that by hand`);
  }

  return matches[0].id;
}

function liveSpec(id) {
  return JSON.parse(doctl(["apps", "spec", "get", id, "--format", "json"]));
}

/**
 * Every `envs` array in the spec, paired with where it came from, so a
 * component-level secret is matched against that same component rather than
 * against the app-level list.
 */
function envLists(spec) {
  const lists = [];

  if (Array.isArray(spec.envs)) lists.push({ scope: "app", envs: spec.envs });

  for (const group of ["services", "workers", "jobs", "functions", "static_sites"]) {
    for (const component of spec[group] ?? []) {
      if (Array.isArray(component.envs)) {
        lists.push({ scope: `${group}/${component.name}`, envs: component.envs });
      }
    }
  }

  return lists;
}

function envsByScope(spec) {
  return new Map(envLists(spec).map(({ scope, envs }) => [scope, envs]));
}

/**
 * Adds back every live variable the committed spec does not declare, so what
 * was typed into the panel survives the push. A key present in both is the
 * file's to define -- that is how a value gets promoted out of the panel and
 * into version control.
 *
 * Empty SECRET values are dropped rather than submitted: the API accepts one
 * and silently unsets the variable.
 */
function withPanelEnvs(committed, live) {
  const target = envsByScope(committed);
  const carried = [];
  const dropped = [];

  for (const { scope, envs } of envLists(live)) {
    const existing = target.get(scope);
    if (!existing) continue;

    const declared = new Set(existing.map((env) => env.key));

    for (const env of envs) {
      if (declared.has(env.key)) continue;
      if (env.type === "SECRET" && !env.value) {
        dropped.push(env.key);
        continue;
      }

      existing.push(env);
      carried.push(env.key);
    }
  }

  return { spec: committed, carried, dropped };
}

function main() {
  const [command] = process.argv.slice(2);

  // Printed bare so it can be substituted into a doctl command.
  if (command === "id") {
    process.stdout.write(appId());
    return;
  }

  if (command === "pull") {
    process.stdout.write(doctl(["apps", "spec", "get", appId()]));
    return;
  }

  if (command !== "push" && command !== "diff") {
    console.error("usage: spec.mjs <id|pull|diff|push>");
    process.exitCode = 64;
    return;
  }

  const id = appId();
  const committed = parse(readFileSync(SPEC_PATH, "utf8"));
  const { spec, carried, dropped } = withPanelEnvs(committed, liveSpec(id));

  console.error(`[spec] app ${id}`);
  console.error(
    carried.length > 0
      ? `[spec] carrying ${carried.length} panel variable(s) over: ${carried.join(", ")}`
      : "[spec] the panel holds no variables beyond what the file declares"
  );
  for (const key of dropped) {
    console.error(`[spec] ${key} is an empty SECRET in the panel; leaving it out`);
  }

  if (command === "diff") {
    process.stdout.write(stringify(spec));
    console.error("[spec] the above is what `push` would submit (secrets shown as ciphertext)");
    return;
  }

  doctl(["apps", "update", id, "--spec", "-"], stringify(spec));
  console.error("[spec] submitted; a deploy is starting");
}

try {
  main();
} catch (error) {
  console.error(`[spec] ${error.message}`);
  process.exitCode = 1;
}
