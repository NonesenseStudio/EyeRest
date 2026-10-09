import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const electronViteCli = fileURLToPath(
  new URL("../node_modules/electron-vite/bin/electron-vite.js", import.meta.url),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [electronViteCli, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
