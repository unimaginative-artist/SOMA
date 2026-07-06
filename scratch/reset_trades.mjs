import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "trading", "trades.db");
const db = new Database(dbPath);

console.log("Clearing old trades from SQLite database...");
const result = db.prepare("DELETE FROM trades").run();
console.log(`Deleted ${result.changes} corrupted cross-symbol trades.`);

