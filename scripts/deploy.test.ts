import { afterAll, beforeAll, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_readConfig } from "wrangler";
import { verifyDeploymentArtifact, verifyDeploymentReference } from "./deploy";

const directory = mkdtempSync(join(tmpdir(), "utxowear-release-verification-"));

function git(...arguments_: string[]): void {
  const result = spawnSync("git", arguments_, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}

beforeAll(() => {
  git("init", "--initial-branch=trunk");
  git("config", "user.email", "release@example.com");
  git("config", "user.name", "Release verification");
  git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial release");
  git("update-ref", "refs/remotes/origin/trunk", "HEAD");
  git("-c", "tag.gpgsign=false", "tag", "v1.2.3");
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("trunk deploys preview but cannot deploy production", () => {
  expect(verifyDeploymentReference("preview", "refs/heads/trunk", directory).version).toMatch(
    /^trunk-[0-9a-f]{12}$/,
  );
  expect(() => verifyDeploymentReference("production", "refs/heads/trunk", directory)).toThrow();
});

test("a release tag on trunk deploys production", () => {
  expect(verifyDeploymentReference("production", "refs/tags/v1.2.3", directory).version).toBe(
    "v1.2.3",
  );
});

test("branches, prereleases, and malformed versions cannot deploy production", () => {
  for (const reference of [
    "refs/heads/v1.2.3",
    "refs/tags/v1.2.3-rc.1",
    "refs/tags/v01.2.3",
    "refs/tags/v1.2",
  ]) {
    expect(() => verifyDeploymentReference("production", reference, directory)).toThrow();
  }
  expect(() => verifyDeploymentReference("preview", "refs/tags/v1.2.3", directory)).toThrow();
});

test("uncommitted files and tags outside trunk cannot deploy", () => {
  writeFileSync(join(directory, "release.txt"), "Unreleased change\n");
  expect(() => verifyDeploymentReference("production", "refs/tags/v1.2.3", directory)).toThrow(
    "clean working directory",
  );
  rmSync(join(directory, "release.txt"));
  git("switch", "--create", "release-verification");
  git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Unmerged change");
  git("-c", "tag.gpgsign=false", "tag", "v1.2.4");
  expect(() => verifyDeploymentReference("production", "refs/tags/v1.2.4", directory)).toThrow();
  expect(() => verifyDeploymentReference("production", "refs/tags/v1.2.3", directory)).toThrow(
    "current commit",
  );
  git("switch", "trunk");
});

test("deployment rejects a build for the other environment or an unprotected alternate URL", () => {
  const preview = unstable_readConfig({ config: "wrangler.jsonc", env: "preview" });
  const production = unstable_readConfig({ config: "wrangler.jsonc", env: "production" });
  expect(() => verifyDeploymentArtifact("preview", preview)).not.toThrow();
  expect(() => verifyDeploymentArtifact("production", production)).not.toThrow();
  expect(() => verifyDeploymentArtifact("preview", production)).toThrow();
  expect(() => verifyDeploymentArtifact("production", preview)).toThrow();
  expect(() => verifyDeploymentArtifact("preview", { ...preview, workers_dev: true })).toThrow();
  expect(() => verifyDeploymentArtifact("preview", { ...preview, preview_urls: true })).toThrow();
  expect(() =>
    verifyDeploymentArtifact("preview", {
      ...preview,
      vars: { ...preview.vars, CHECKOUT_ORIGIN: "https://utxowear.com" },
    }),
  ).toThrow();
});
