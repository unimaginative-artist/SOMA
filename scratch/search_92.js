
const fs = require("fs");
const path = require("path");

function walk(dir, regex) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (file !== "node_modules" && file !== "vendor" && file !== ".git") walk(full, regex);
    } else if (full.endsWith(".js") || full.endsWith(".cjs") || full.endsWith(".mjs")) {
      const content = fs.readFileSync(full, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          console.log(`${full}:${i+1}: ${lines[i].trim()}`);
        }
      }
    }
  }
}

walk(process.cwd(), /\b92\b|\.92\b/);

