import { execSync } from "node:child_process";
import chokidar from "chokidar";

const FILE = "my-website/public/data/odds.json"; // adjust if needed
let timer = null;

function sh(cmd) {
  execSync(cmd, { stdio: "inherit", shell: true });
}

function branch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  } catch {
    return "main";
  }
}

function commitAndPush() {
  try {
    const br = branch();
    // Rebase to avoid non-fast-forward errors if anything changed remotely
    try { sh(`git pull --rebase origin ${br}`); } catch {}
    sh(`git add "${FILE}"`);
    sh(`git diff --cached --quiet || git commit -m "chore(odds): auto-update ${new Date().toISOString()}"`);
    sh(`git push origin ${br}`);
    console.log("Auto-commit & push complete.");
  } catch (e) {
    console.log("No changes to commit or push failed.");
  }
}

chokidar.watch(FILE, { ignoreInitial: true }).on("change", () => {
  clearTimeout(timer);
  timer = setTimeout(commitAndPush, 1500);
});

console.log(`Watching ${FILE} for changes...`);