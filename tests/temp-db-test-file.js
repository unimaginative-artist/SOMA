
      import sqlite3 from 'better-sqlite3';
      
      export function getUserById(dbPath, userId) {
          const db = new sqlite3(dbPath);
          const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
          db.close();
          return row;
      }
    