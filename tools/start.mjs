// `npm start`: run the Python engine (WebSocket) and the UI dev server together,
// then open the app in your browser. Ctrl+C stops both.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const py = process.env.PYTHON || (win ? "python" : "python3");
const noOpen = process.argv.includes("--no-open");

if (!existsSync(path.join(root, "ui", "node_modules"))) {
  console.log("Installing UI dependencies (first run)...");
  const r = spawn(win ? "npm.cmd" : "npm", ["install", "--prefix", "ui"], { cwd: root, stdio: "inherit", shell: win });
  await new Promise((res, rej) => r.on("exit", (c) => (c === 0 ? res() : rej(new Error("npm install failed")))));
}

const kids = [
  spawn(py, ["engine/vsp_engine.py", "--ws", "8765"], { cwd: root, stdio: "inherit" }),
  spawn(win ? "npm.cmd" : "npm", ["--prefix", "ui", "run", "dev", "--", ...(noOpen ? [] : ["--open"])], { cwd: root, stdio: "inherit", shell: win }),
];
const stop = () => kids.forEach((k) => { try { k.kill(); } catch {} });
process.on("SIGINT", () => { stop(); process.exit(0); });
kids.forEach((k) => k.on("exit", () => { stop(); process.exit(0); }));
console.log("\nOpenVSP Studio -> http://localhost:5173  (engine on ws://127.0.0.1:8765)\n");
