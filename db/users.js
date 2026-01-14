import { db } from "./index.js";

export function ensureUser(telegramId) {
  db.prepare(`
    INSERT OR IGNORE INTO users (telegram_id)
    VALUES (?)
  `).run(telegramId);
}
