import { execSync } from "node:child_process";
import chokidar from "chokidar";

const FILE = "my-website/public/data/odds.json"; // <-- update to your JSON path
let timer = null;

function sh(cmd) {
  execSync(cmd, { stdio: "inherit", shell: true });
}

function commitAndPush() {
  try {
    sh(`git add "${FILE}"`);
    // Commit only if there are staged changes
    sh(`git diff --cached --quiet || git commit -m "chore(odds): auto-update ${new Date().toISOString()}"`);
    sh("git push");
    console.log("Auto-commit & push complete.");
  } catch (e) {
    console.log("No changes to commit or push failed.");
  }
}

chokidar.watch(FILE, { ignoreInitial: true }).on("change", () => {
  clearTimeout(timer);
  // Debounce rapid writes
  timer = setTimeout(commitAndPush, 1500);
});

console.log(`Watching ${FILE} for changes...`);