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
 * `push` therefore reads the live spec first and carries its SECRET values
 * across. DigitalOcean returns them as `EV[1:...]` ciphertext, which it
 * accepts back verbatim, so this never handles a plaintext credential and
 * nothing has to be stored on disk.
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

function secretsFromLive(spec) {
  const found = new Map();

  for (const { scope, envs } of envLists(spec)) {
    for (const env of envs) {
      if (env.type === "SECRET" && env.value) found.set(`${scope}:${env.key}`, env.value);
    }
  }

  return found;
}

/**
 * Splices the live ciphertext into the committed spec, and refuses rather than
 * submitting a secret with no value -- an empty SECRET is accepted by the API
 * and silently unsets the variable.
 */
function withLiveSecrets(committed, live) {
  const available = secretsFromLive(live);
  const missing = [];
  const carried = [];

  for (const { scope, envs } of envLists(committed)) {
    for (const env of envs) {
      if (env.type !== "SECRET") continue;

      const value = available.get(`${scope}:${env.key}`);
      if (value) {
        env.value = value;
        carried.push(env.key);
      } else if (!env.value) {
        missing.push(env.key);
      }
    }
  }

  return { spec: committed, carried, missing };
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
  const { spec, carried, missing } = withLiveSecrets(committed, liveSpec(id));

  if (missing.length > 0) {
    console.error(`[spec] ${missing.length} secret(s) have no value, in the panel or in the file:`);
    for (const key of missing) console.error(`         ${key}`);
    console.error("[spec] set them under Settings -> App-Level Environment Variables, then retry.");
    console.error("[spec] refusing to submit: an empty SECRET unsets the variable.");
    process.exitCode = 1;
    return;
  }

  console.error(`[spec] app ${id}`);
  console.error(`[spec] carrying ${carried.length} secret(s) over from the panel: ${carried.join(", ")}`);

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
