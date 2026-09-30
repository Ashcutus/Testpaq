import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(args) {
  const child = spawnSync(npm, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (child.error || child.status !== 0) process.exit(child.status || 1);
}
const fingerprint = createHash("sha256").update(readFileSync("package-lock.json")).update(process.versions.modules).digest("hex");
const stamp = "node_modules/.testpaq-dependencies";
if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== fingerprint || !existsSync("node_modules/.bin/vite")) {
  run(["ci"]);
  writeFileSync(stamp, fingerprint);
}
run(["run", "build"]);
run(["start", "--", ...process.argv.slice(2)]);
