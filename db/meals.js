import { db } from "./index.js";

export function saveMeal({
  telegram_id,
  date,
  meal_time,
  name,
  weight_g,
  calories_kcal,
  image_url
}) {
  db.prepare(`
    INSERT INTO meals
    (telegram_id, date, meal_time, name, weight_g, calories_kcal, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    telegram_id,
    date,
    meal_time,
    name,
    weight_g,
    calories_kcal,
    image_url
  );
}
