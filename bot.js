import { ensureUser } from "./db/users.js";
import { saveMeal } from "./db/meals.js";
import { getMealTimeMSK, getMealTimeByTime } from "./utils/time.js";
import { db } from './db/index.js'
import schedule from 'node-schedule'
import FormData from "form-data";
import path from "path";
import "dotenv/config";

import { Bot, InlineKeyboard} from "grammy"
import fs from 'fs'
import fetch from 'node-fetch'

async function uploadToFreeimage(url) {
  const form = new FormData();
  form.append('key', process.env.FREEIMAGE_API_KEY);
  form.append('action', 'upload');
  form.append('source', url);

  const res = await fetch('https://freeimage.host/api/1/upload', {
    method: 'POST',
    body: form
  });

  const data = await res.json();

  if (!data.image || !data.image.url) {
    console.error('Freeimage.host upload failed', data);
    throw new Error('Ошибка загрузки на Freeimage.host');
  }

  return data.image.url; // прямой публичный URL
}

const bot = new Bot(process.env.BOT_TOKEN)

const startInline = [
    ["➕ Добавить прием пищи", "start_addPhoto"],
    ["⚙️ Изменить цель на день", "start_changeGoal"],
    ["📊 Статистика за сегодня", "start_history"],
    ["📊 Статистика за неделю", "start_historyWeek"]
]
const keyboardStartInline = InlineKeyboard.from(
    startInline.map(([label, data]) => [ InlineKeyboard.text(label, data) ])
);

const pendingPhotos = new Map()
const pendingGoal = new Map()
async function ChangeGoal(ctx) {
    const telegramID = ctx.from.id
    pendingGoal.set(telegramID, true)
    await ctx.reply("🎯 Введите желаемое количество калорий за день", {
            reply_markup: keyboardToStartInline,
            parse_mode: 'HTML'
    })
}
const pendingDelete = new Map() // ПАЛЕЗНО ТОЖЕ
async function DeleteSelect(ctx) {
    const telegramID = ctx.from.id;
    pendingDelete.set(telegramID, true)
    await ctx.reply("❌ Введите номер позиции для удаления")
}
const pendingFoodTitle = new Map()
async function setFoodByText(ctx) {
    const telegramID = ctx.from.id;
    pendingFoodTitle.set(telegramID, true)
    await ctx.reply("📸 Отправьте фото или введите название блюда и вес.")
}
let pendingFoodTime = []
async function setFoodTimeDB(telegramID, time, food_name, food_weight, food_calories) {
   db.prepare(`
          INSERT INTO meals (
            telegram_id,date,meal_time,name,weight_g,calories_kcal,image_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          telegramID,
          new Date().toISOString().slice(0, 10),
          getMealTimeByTime(time),
          food_name,
          food_weight,
          food_calories,
          'User entered the text'
  );
}

function resetPending(telegramID) {
      pendingGoal.delete(telegramID);
      pendingDelete.delete(telegramID);
      pendingFoodTitle.delete(telegramID);
      pendingPhotos.delete(telegramID);
      pendingFoodTime = []
}

async function setFoodTime(ctx, time) {
  if (time == 'morning') {
    setFoodTimeDB(ctx.from.id, 10, pendingFoodTime[1].name, pendingFoodTime[1].weight_g, pendingFoodTime[1].calories_kcal)
  } else if (time == 'day') {
    setFoodTimeDB(ctx.from.id, 12, pendingFoodTime[1].name, pendingFoodTime[1].weight_g, pendingFoodTime[1].calories_kcal)
  } else if (time == 'evening') {
    setFoodTimeDB(ctx.from.id, 19, pendingFoodTime[1].name, pendingFoodTime[1].weight_g, pendingFoodTime[1].calories_kcal)
  }

  toStartFunc(ctx)
}

async function toStartFunc (ctx) {
    const today = new Date().toISOString().slice(0,10);
    const telegramID = ctx.from.id
    db.prepare(`
        INSERT OR IGNORE INTO users (telegram_id)
        VALUES (?)
    `).run(telegramID);
    const mealsToday = db.prepare(`
      SELECT * FROM meals
      WHERE telegram_id = ? AND date = ?
      ORDER BY created_at ASC
    `).all(telegramID, today);
    const goalKcal = db.prepare(`
        SELECT * FROM goals
        WHERE telegram_id = ?
    `).all(telegramID)

    const totalCalories = mealsToday.reduce((sum, m) => sum + m.calories_kcal, 0);
    const dailyGoal = goalKcal[0]?.daily_calories ?? 2000;
    const remainingCalories = Math.max(0, dailyGoal - totalCalories);

    ctx.editMessageText(
        `🍭 <b>Главное меню</b>\n\n` +
        `🏅 Цель на день: <b>${dailyGoal}</b>\n\n` +
        `🍔 Калорий сегодня: <b>${totalCalories}</b>\n\n` +
        `🍏 Осталось до цели: <b>${remainingCalories}</b>`,
        {
            reply_markup: keyboardStartInline,
            parse_mode: 'HTML'
        }
    );

    resetPending(ctx.from.id)
}

bot.command("start", async (ctx) => {
    const today = new Date().toISOString().slice(0,10);
    const telegramID = ctx.from.id
    db.prepare(`
        INSERT OR IGNORE INTO users (telegram_id)
        VALUES (?)
    `).run(telegramID);
    const mealsToday = db.prepare(`
        SELECT * FROM meals
        WHERE telegram_id = ? AND date = ?
        ORDER BY created_at ASC
    `).all(telegramID, today);
    const goalKcal = db.prepare(`
        SELECT * FROM goals
        WHERE telegram_id = ?
    `).all(telegramID)  
    
    const totalCalories = mealsToday.reduce((sum, m) => sum + m.calories_kcal, 0);
    const dailyGoal = goalKcal[0]?.daily_calories ?? 2000;
    const remainingCalories = Math.max(0, dailyGoal - totalCalories);

    await ctx.reply(
        `🍭 <b>Главное меню</b>\n\n` +
        `🏅 Цель на день: <b>${dailyGoal}</b>\n\n` +
        `🍔 Калорий сегодня: <b>${totalCalories}</b>\n\n` +
        `🍏 Осталось до цели: <b>${remainingCalories}</b>`,
        {
            reply_markup: keyboardStartInline,
            parse_mode: 'HTML'
        }
    );

    resetPending(ctx.from.id)
})

await bot.api.setMyCommands([
    { command: 'start', description: 'Показать главное меню 🍭' },
]);

const breakfestJob = schedule.scheduleJob(
    { rule: '8 9 * * *', tz: 'Europe/Moscow' },
    async () => {
    const users = db.prepare('SELECT telegram_id from USERS').all()

    for (const user of users) {
        const today = new Date().toISOString().slice(0,10);
        const breakfast = db.prepare(`
            SELECT * FROM meals WHERE telegram_id = ? AND date = ? AND meal_time = 'morning'
        `).get(user.telegram_id, today);

        if (!breakfast) {
            await bot.api.sendMessage(user.telegram_id, '🥐 Не забудь добавить завтрак сегодня');
        }
    }
})

const lunchJob = schedule.scheduleJob(
    { rule: '8 13 * * *', tz: 'Europe/Moscow' },
    async () => {
    const users = db.prepare('SELECT telegram_id from USERS').all()

    for (const user of users) {
        const today = new Date().toISOString().slice(0,10);
        const lunch = db.prepare(`
            SELECT * FROM meals WHERE telegram_id = ? AND date = ? AND meal_time = 'day'
        `).get(user.telegram_id, today);

        if (!lunch) {
            await bot.api.sendMessage(user.telegram_id, '🍔 Самое время записать обед');
        }
    }
})

const dinnerJob = schedule.scheduleJob(
    { rule: '8 18 * * *', tz: 'Europe/Moscow' },
    async () => {
    const users = db.prepare('SELECT telegram_id from USERS').all()

    for (const user of users) {
        const today = new Date().toISOString().slice(0,10);
        const dinner = db.prepare(`
            SELECT * FROM meals WHERE telegram_id = ? AND date = ? AND meal_time = 'evening'
        `).get(user.telegram_id, today);

        if (!dinner) {
            await bot.api.sendMessage(user.telegram_id, '🍏 Добавь ужин и закрой день по питанию');
        }
    }
})

/// -------MAIN-------

const toStartInline = [
    ["⬅️ В главное меню", 'back_tostart']
]
const btnToStartInline = toStartInline.map(([label, data]) => InlineKeyboard.text(label, data))
const keyboardToStartInline = InlineKeyboard.from([btnToStartInline])
bot.on("callback_query:data", async (ctx) => {
    const callbackData = ctx.callbackQuery.data
    const msgID = ctx.callbackQuery.message.message_id

    let newText = ""
    if (callbackData == "start_addPhoto") {
        setFoodByText(ctx)
    } else if (callbackData == "back_tostart") {
        toStartFunc(ctx)
    } else if (callbackData == 'analyze_food') {
        AnalyzeFunc(ctx)
    } else if (callbackData == "start_history") {
        SeeHistory(ctx, "today")
    } else if (callbackData == "start_historyWeek") {
        SeeHistory(ctx, "week")
    } else if (callbackData == "delete_select") {
        DeleteSelect(ctx)
    } else if (callbackData == "start_changeGoal") {
        ChangeGoal(ctx)
    } else if (callbackData == "setMorning_time") {
        setFoodTime(ctx, 'morning')
    } else if (callbackData == "setDay_time") {
        setFoodTime(ctx, 'day')
    } else if (callbackData == "setEvening_time") {
        setFoodTime(ctx, 'evening')
    }
    if (newText) {
        await ctx.editMessageText(newText, {
            reply_markup: keyboardToStartInline
        })
        await ctx.answerCallbackQuery()
    }
})

const toAnalyze = [
    ['🔎 Распознать', 'analyze_food']
]
const btnToAnalyze = toAnalyze.map(([label, data]) => InlineKeyboard.text(label, data))
const keyboardToAnalyze = InlineKeyboard.from([btnToAnalyze])

bot.on("message:photo", async (ctx) => {
  try {
    const photo = ctx.msg.photo.at(-1);
    const file = await ctx.getFile();
    const imageURL = await uploadToFreeimage(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`);

    pendingPhotos.set(ctx.from.id, imageURL);

    await ctx.reply("✅ Фото получено и загружено", {
      reply_markup: keyboardToAnalyze
    });

    console.log('IMAGE URL:', imageURL);

  } catch (err) {
    console.error("Photo upload error:", err);
    await ctx.reply("❌ Не удалось обработать фото");
  }
});

async function AnalyzeFunc(ctx) {
  const telegramID = ctx.from.id;
  const imageURL = pendingPhotos.get(telegramID);

  if (!imageURL) {
    await ctx.reply("❌ Фото не найдено");
    return;
  }

  await ctx.reply("🕑 Анализирую фото…");

  let food;

  try {
    const response = await fetch("https://litellm.tokengate.ru/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.API_TOKEN}`
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-haiku",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Внимательно проанализируй фото еды.
На фото может быть одно или несколько блюд/ингредиентов.

Твоя задача:
- определить ВСЕ распознаваемые блюда на фото
- если блюд несколько — ОБЪЕДИНИ их в ОДНО название через запятую
  (пример: "Стейк с картошкой фри, Салат греческий, Смузи")

Верни СТРОГО валидный JSON без любого текста вне JSON.

Правила:
- "name": одно строковое название блюда ТОЛЬКО на русском языке, с большой буквы
- если блюда имеют английские названия — переведи их на русский:
  - одно блюдо → его название
  - несколько блюд → перечисление через запятую, каждое с большой буквы
- "weight_g": суммарный вес всех блюд в граммах (целое число)
- "calories_kcal": суммарная калорийность ВСЕХ блюд, рассчитанная по их весу, калорийность должна быть реалистичной и не заниженной.
- если вес неочевиден — используй типичные порции
- если ничего не удалось распознать — верни 0 во всех полях
- никаких дополнительных полей не добавляй

Формат ответа:
{"name":0,"weight_g":0,"calories_kcal":0}

Любой текст вне JSON считается ошибкой.
`
              },
              {
                type: "image_url",
                image_url: { url: imageURL }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("HTTP error:", response.status, errText);
      await ctx.reply(`❌ Ошибка API: ${response.status}`);
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      await ctx.reply("❌ Модель вернула пустой ответ");
      return;
    }

    try {
      food = JSON.parse(content);
    } catch (err) {
      console.error("JSON parse error:", content);
      await ctx.reply("❌ Не удалось разобрать JSON");
      return;
    }

  } catch (err) {
    console.error("AnalyzeFunc error:", err);
    await ctx.reply("❌ Ошибка при анализе фото");
    return;
  }

  // сохраняем в базу
  db.prepare(`
    INSERT INTO meals (
       telegram_id,date,meal_time,name,weight_g,calories_kcal,image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    telegramID,
    new Date().toISOString().slice(0, 10),
    getMealTimeMSK(),
    food.name,
    food.weight_g,
    food.calories_kcal,
    imageURL
  );

  await ctx.reply(
    `🍽 ${food.name}\n⚖️ ${food.weight_g} г\n🔥 ${food.calories_kcal} ккал`
  , {
            reply_markup: keyboardToStartInline
        });

  pendingPhotos.delete(telegramID);
}


const historyChangeInline = [
    ["Удалить позицию", "delete_select",],
    ["⬅️ В главное меню", 'back_tostart']
]
const historyChangeKeyboardInline = InlineKeyboard.from(
  historyChangeInline.map(([label, data]) => [ InlineKeyboard.text(label, data) ])
);
async function SeeHistory(ctx, period) {
    const telegramID = ctx.from.id;
    const today = new Date().toISOString().slice(0,10);

  if (period === "today") {
    const mealsToday = db.prepare(`
      SELECT * FROM meals
      WHERE telegram_id = ? AND date = ?
      ORDER BY created_at ASC
    `).all(telegramID, today);

    const totalCalories = mealsToday.reduce((sum, m) => sum + m.calories_kcal, 0);

    let text = mealsToday.map((m) => `${m.id}) ${((m.meal_time == 'night') ? "🌃" : (m.meal_time == 'morning') ? "🌅" : (m.meal_time == "day") ? "🏙️" : '🌆')} ${m.name} — ${m.weight_g} г — ${m.calories_kcal} ккал`).join("\n\n");
    ctx.editMessageText(text ? `${text}\n\nИтого калорий за день: <b>${totalCalories} ккал</b>` : "Приемов пищи за сегодня нет 😔", {
        reply_markup: historyChangeKeyboardInline,
        parse_mode: 'HTML'
    });
  }

  if (period === "week") {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startDate = sevenDaysAgo.toISOString().slice(0,10);

    const mealsWeek = db.prepare(`
      SELECT * FROM meals
      WHERE telegram_id = ? AND date BETWEEN ? AND ?
      ORDER BY date ASC, created_at ASC
    `).all(telegramID, startDate, today);

    const grouped = {};
    mealsWeek.forEach(m => {
      if (!grouped[m.date]) grouped[m.date] = [];
      grouped[m.date].push(m);
    });

    let text = Object.entries(grouped)
      .map(([date, meals]) => {
        const mealsText = meals.map((m) => `${m.id}) ${((m.meal_time == 'night') ? "🌃" : (m.meal_time == 'morning') ? "🌅" : (m.meal_time == "day") ? "🏙️" : '🌆')} ${m.name} — ${m.weight_g} г — ${m.calories_kcal} ккал`).join("\n\n");
        return `📅 ${date}:\n\n${mealsText}`;
      })
      .join("\n\n");

    ctx.editMessageText(text || "Приемов пищи за неделю нет 😔", {
            reply_markup: historyChangeKeyboardInline
        });
  }
}


const toSetTime = [
    ['🌅 На завтрак', 'setMorning_time'],
    ['🏙️ На обед', 'setDay_time'],
    ['🌆 На ужин', 'setEvening_time'],
]
const btnToSetTime = toSetTime.map(([label, data]) => InlineKeyboard.text(label, data))
const keyboardToSetTime = InlineKeyboard.from([btnToSetTime])
bot.on('message', async (ctx) => {
    const telegramID = ctx.from.id
    
    if (pendingGoal.has(telegramID)) {
        const goal = parseInt(ctx.message.text)
        if (isNaN(goal)) {
            await ctx.reply('Нужно ввести число')
            resetPending()
            return;
        }
        
        db.prepare(`
            INSERT OR REPLACE INTO goals (
            telegram_id, daily_calories
            ) VALUES (?, ?)
            `).run(telegramID, goal)
                
            ctx.reply(`✅ Установлена цель - <b>${goal}</b> калорий в день`, {
                reply_markup: keyboardToStartInline,
                parse_mode: 'HTML'
            })
        resetPending()
    } else if (pendingDelete.has(telegramID)) {
        const index = parseInt(ctx.message.text)
        if (isNaN(index)) {
            await ctx.reply('Нужно ввести число')
            return;    
        }

        const prepareDelete = db.prepare(`
            DELETE FROM meals
            WHERE telegram_id = ? AND id = ?
        `)
        const runDelete = prepareDelete.run(telegramID, index)

        if (runDelete.changes > 0) {
            await ctx.reply(`✅ Запись #${index} удалена`, {
                reply_markup: historyChangeKeyboardInline
            })
        } else {
            await ctx.reply(`❌ Запись #${index} не найдена`, {
                reply_markup: historyChangeKeyboardInline
            });
            
            pendingDelete.delete(telegramID)
          }
        } else if (pendingFoodTitle.has(telegramID)) {
            await ctx.reply("🕑 Анализирую блюдо")
          let food;

        try {
          const response = await fetch("https://litellm.tokengate.ru/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.API_TOKEN}`
            },
            body: JSON.stringify({
              model: "anthropic/claude-3-haiku",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Проанализируй блюдо: "${ctx.message.text}"

                      Верни СТРОГО валидный JSON, без пояснений и текста вне JSON.

                      Правила:
                      - "name": корректное название блюда на русском, с большой буквы (если блюд указано несколько то сгруппируй их название в одно)
                      - "weight_g":
                        - если пользователь указал вес — используй его (если блюд указано несколько то суммируй весь вес, но калории считай к каждому блюду отдельно)
                        - если вес не указан — определи типичный вес порции для этого блюда
                      - "calories_kcal":
                        - рассчитай калорийность ИСХОДЯ ИЗ УКАЗАННОГО ИЛИ ОПРЕДЕЛЁННОГО ВЕСА
                        - используй реалистичные значения ккал/100 г для этого блюда
                      - все числовые значения — целые числа
                      - если блюдо невозможно определить — верни 0 во всех полях

                      Формат ответа:
                      {"name":0,"weight_g":0,"calories_kcal":0}

                      Любой текст вне JSON считается ошибкой.`
                    }
                  ]
                }
              ]
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            console.error("HTTP error:", response.status, errText);
            await ctx.reply(`❌ Ошибка API: ${response.status}`);
            return;
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;

          if (!content) {
            await ctx.reply("❌ Модель вернула пустой ответ");
            return;
          }

          try {
            food = JSON.parse(content);
          } catch (err) {
            console.error("JSON parse error:", content);
            await ctx.reply("❌ Не удалось разобрать JSON");
            return;
          }

        } catch (err) {
          console.error("AnalyzeFunc error:", err);
          await ctx.reply("❌ Ошибка при анализе фото");
          return;
        }

        await ctx.reply(
          `🍽 ${food.name}\n⚖️ ${food.weight_g} г\n🔥 ${food.calories_kcal} ккал`
        , {
            reply_markup: keyboardToSetTime
        });

        // сохраняем в базу
        // db.prepare(`
        //   INSERT INTO meals (
        //     telegram_id,date,meal_time,name,weight_g,calories_kcal,image_url
        //   ) VALUES (?, ?, ?, ?, ?, ?, ?)
        // `).run(
        //   telegramID,
        //   new Date().toISOString().slice(0, 10),
        //   getMealTimeMSK(),
        //   food.name,
        //   food.weight_g,
        //   food.calories_kcal,
        //   'User entered the text'
        // );
        pendingFoodTime.push(telegramID, food)

            
        } else return })
          
bot.start()
