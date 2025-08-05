require("dotenv").config();

// Pastikan BOT_TOKEN ada sebelum membuat instance bot
if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN tidak ditemukan di file .env!");
  console.error("Pastikan file .env ada di folder yang sama dengan main.js");
  process.exit(1);
}

const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const { saveAudio, getAudio, saveUrlCache, getUrlCache } = require("./db");
const { downloadFromIgPost } = require("./handlers/igpost");
const { downloadFromIgReels } = require("./handlers/igreels");
const { downloadFromTikwm } = require("./handlers/tiktok");
const { downloadFromFacebook } = require("./handlers/facebook");
const { init, saveUser, getAllUsers } = require("./userdb");
const { initLog, logRequest, countRequestsLast7Days } = require("./logdb");
const { promisify } = require("util");
const countLast7Days = promisify(countRequestsLast7Days);
const userdb = require('./userdb');  // Import userdb.js untuk mengambil data pengguna

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_IDS = (process.env.ADMIN_ID || "").split(",");

init();
initLog();
console.log("✅ Bot Telegram aktif...");

function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

let startTime = Date.now();
const adminSession = new Map();

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}


bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  saveUser(chatId);

  if (ADMIN_IDS.includes(chatId.toString()) && adminSession.has(chatId)) {
    const state = adminSession.get(chatId);
    if (text && text.toLowerCase() === "/cancel") {
      adminSession.delete(chatId);

      setTimeout(() => {
        bot.deleteMessage(chatId, msg.message_id).catch(() => {});
      }, 4000);

      return bot.sendMessage(chatId, "❌ Broadcast dibatalkan.").then(sent => {
        setTimeout(() => {
          bot.deleteMessage(chatId, sent.message_id).catch(() => {});
        }, 4000);
      });
    }

    if (state === "AWAITING_BROADCAST") {
      getAllUsers(async (err, userIds) => {
        if (err) {
          adminSession.delete(chatId);
          return bot.sendMessage(chatId, "❌ Gagal ambil daftar user.");
        }

        for (const id of userIds) {
          try {
  let sent;
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1].file_id;
    sent = await bot.sendPhoto(id, photo, { caption: msg.caption || "" });
  } else if (msg.video) {
    sent = await bot.sendVideo(id, msg.video.file_id, { caption: msg.caption || "" });
  } else if (msg.document) {
    sent = await bot.sendDocument(id, msg.document.file_id, { caption: msg.caption || "" });
  } else if (msg.audio) {
    sent = await bot.sendAudio(id, msg.audio.file_id, { caption: msg.caption || "" });
  } else if (msg.voice) {
    sent = await bot.sendVoice(id, msg.voice.file_id, { caption: msg.caption || "" });
  } else if (msg.text) {
    sent = await bot.sendMessage(id, msg.text);
  }

  // Pastikan sent tidak undefined atau null sebelum mengakses message_id
  if (sent && sent.message_id) {
    await bot.pinChatMessage(id, sent.message_id).catch(() => {});
  }
} catch (err) {
  console.error("Error sending broadcast:", err);
}
        }

        adminSession.delete(chatId);
      });
      return;
    }
  }


  if (!text || !text.startsWith("http")) {
    const menuMsg = await bot.sendMessage(chatId, `*_✨ BOT ONLINE ✨\n✨SILAHKAN DIGUNAKAN✨\n
      ✅ Tiktok
      ✅ Facebook
      ✅ Instagram_*`, {
      parse_mode: "MarkdownV2",
    });

    setTimeout(() => {
      bot.deleteMessage(chatId, menuMsg.message_id).catch(() => {});
      bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }, 4000);
    return;
  }

  const waitingMsg = await bot.sendMessage(chatId, "*_⏳ Sedang diproses, tunggu sebentar ⏳_ *", {
    parse_mode: "MarkdownV2"
  });

  try {
    const url = text;
    getUrlCache(url, async (err, cached) => {
      if (err) {
        await bot.sendMessage(chatId, "❌ Gagal memeriksa cache.");
        return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
      }

      const caption = escapeMarkdown("Diunduh melalui: @iniuntukdonlotvidiotiktokbot");
      const audioKey = `audio-${msg.message_id}`;

      if (cached) {
        const videoMsg = await bot.sendVideo(chatId, cached.video_url, {
          caption: escapeMarkdown(cached.caption || caption),
          parse_mode: "MarkdownV2",
          reply_markup: cached.audio_url ? {
            inline_keyboard: [[{ text: "MUSIK", callback_data: audioKey }]]
          } : undefined
        });

        if (cached.audio_url) {
          saveAudio(audioKey, cached.audio_url, chatId, videoMsg.message_id);
        }

        return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
      }

      if (/instagram\.com/.test(url)) {
        logRequest("instagram");

        if (/\/reel\//.test(url)) {
          const result = await downloadFromIgReels(url);
          const videoBuffer = await axios.get(result.url, { responseType: "arraybuffer" });
          await bot.sendVideo(chatId, Buffer.from(videoBuffer.data), { caption, parse_mode: "MarkdownV2" });
          saveUrlCache(url, "instagram", result.url, null, caption);
        } else {
          const mediaList = await downloadFromIgPost(url);
          const photoGroup = [];

          for (let i = 0; i < mediaList.length; i++) {
            const item = mediaList[i];
            const mediaBuffer = await axios.get(item.url, { responseType: "arraybuffer" });

            if (item.type === "image") {
              photoGroup.push({
                type: "photo",
                media: Buffer.from(mediaBuffer.data),
                ...(photoGroup.length === 0 ? { caption, parse_mode: "MarkdownV2" } : {})
              });
            } else if (item.type === "video") {
              await bot.sendVideo(chatId, Buffer.from(mediaBuffer.data), {
                caption: (i === 0 && photoGroup.length === 0) ? caption : undefined,
                parse_mode: "MarkdownV2",
              });
              if (mediaList.length === 1) {
                saveUrlCache(url, "instagram", item.url, null, caption);
              }
            }
          }

          if (photoGroup.length > 0) {
            await bot.sendMediaGroup(chatId, photoGroup);
            if (mediaList.length === photoGroup.length) {
              saveUrlCache(url, "instagram", null, null, caption);
            }
          }
        }

        return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
      }

      if (/facebook\.com|fb\.watch|fb\.com/.test(url)) {
        logRequest("facebook");

        try {
          const result = await downloadFromFacebook(url);
          const videoMsg = await bot.sendVideo(chatId, result.video, {
            caption,
            parse_mode: "MarkdownV2"
          });

          saveUrlCache(url, "facebook", result.video, null, caption);
          return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
        } catch (fbError) {
          // Handle Facebook-specific errors
          await bot.sendMessage(chatId, escapeMarkdown(fbError.message));
          return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
        }
      }

      // Perbaikan hanya bagian TikTok saja
// tanpa mengubah struktur, chunk array, atau logika lain

if (/tiktok\.com/.test(url)) {
  try {
    const result = await downloadFromTikwm(url);
    logRequest("tiktok");

    if (result.type === "slide") {
      const chunks = chunkArray(result.images, 10); // Telegram: max 10 media per album

      for (let i = 0; i < chunks.length; i++) {
        const group = chunks[i];

        await bot.sendMediaGroup(chatId, group.map((item, index) => ({
          type: item.type,
          media: item.media,
          ...(i === 0 && index === 0 ? { caption: escapeMarkdown(result.caption), parse_mode: "MarkdownV2" } : {})
        })));
      }

      return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
    }

    const videoMsg = await bot.sendVideo(chatId, result.video, {
      caption,
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [[{ text: "MUSIK", callback_data: audioKey }]]
      }
    });

    saveAudio(audioKey, result.audioUrl, chatId, videoMsg.message_id);
    saveUrlCache(url, "tiktok", result.video, result.audioUrl, caption);

    return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
  } catch (e) {
    await bot.sendMessage(chatId, "GAGAL ❌: belum support download story tiktok 😁🗿.");
    return await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
  }
      }

      throw new Error("❌ Link tidak dikenali. Hanya mendukung TikTok, Facebook, dan Instagram.");
    });
  } catch (err) {
    await bot.sendMessage(chatId, escapeMarkdown(`⚠️ Error: ${err.message}`), {
      parse_mode: "MarkdownV2"
    });
    await bot.deleteMessage(chatId, waitingMsg.message_id).catch(() => {});
  }
});

bot.on("callback_query", async (query) => {
  const key = query.data;
  getAudio(key, async (err, row) => {
    if (err || !row) {
      return bot.answerCallbackQuery(query.id, {
        text: "❌ Audio tidak ditemukan.",
        show_alert: true,
      });
    }

    try {
      const audioMsg = await bot.sendAudio(row.chat_id, row.audio_url, {
        caption: "Diunduh melalui: @iniuntukdonlotvidiotiktokbot",
        parse_mode: "MarkdownV2"
      });

      await bot.deleteMessage(row.chat_id, row.video_msg_id).catch(() => {});
      await bot.editMessageReplyMarkup({
        inline_keyboard: [[{ text: "LINK MUSIK", url: row.audio_url }]]
      }, {
        chat_id: row.chat_id,
        message_id: audioMsg.message_id
      });

      bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error("Gagal kirim audio:", error);
      await bot.sendMessage(row.chat_id, "❌ Gagal memproses file.");
      bot.answerCallbackQuery(query.id, {
        text: "❌ Terjadi kesalahan.",
        show_alert: true,
      });
    }
  });
});

bot.onText(/^\/(broadcast|stats|cancel)$/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(chatId)) {
    return bot.sendMessage(chatId, "ngapain bang?, ini fitur khusus admin🗿");
  }
});

bot.onText(/^\/broadcast$/, (msg) => {
  const senderId = msg.chat.id.toString();
  if (!ADMIN_IDS.includes(senderId)) return;

  adminSession.set(msg.chat.id, "AWAITING_BROADCAST");

  bot.sendMessage(msg.chat.id, "📢 Masukkan isi pengumuman (bisa teks atau media):\nKetik /cancel untuk membatalkan.")
    .then(sent => {
      // Hapus pesan prompt setelah 4 detik
      setTimeout(() => {
        bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {});
      }, 4000);
    });
});


bot.onText(/^\/stats$/, (msg) => {
  if (!ADMIN_IDS.includes(msg.chat.id.toString())) return;

  getAllUsers((err, userIds) => {
    if (err) return bot.sendMessage(msg.chat.id, "❌ Gagal mengambil user.");

    Promise.all([
      countLast7Days("tiktok"),
      countLast7Days("facebook"),
      countLast7Days("instagram")
    ]).then(([tiktokCount, fbCount, igCount]) => {
      const uptimeMs = Date.now() - startTime;
      const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
      const uptimeH = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
      const uptimeM = Math.floor((uptimeMs / (1000 * 60)) % 60);
      const uptimeStr = `${uptimeDays} hari ${uptimeH} jam ${uptimeM} menit`;

      const statMsg = [
        '`✨ DETAIL STATS BOT ✨`',
        '',
        '`🧮 Total User        : ' + userIds.length.toString().padStart(1) + '`',
        '`💌 Request TikTok    : ' + tiktokCount.toString().padStart(1) + '`',
        '`💌 Request Facebook  : ' + fbCount.toString().padStart(1) + '`',
        '`💌 Request Instagram : ' + igCount.toString().padStart(1) + '`',
        '`⌚️ Uptime            : ' + uptimeStr + '`'
      ].join('\n');

      bot.sendMessage(msg.chat.id, statMsg, { parse_mode: "MarkdownV2" }).then(sentMsg => {
        setTimeout(() => {
          bot.deleteMessage(msg.chat.id, sentMsg.message_id).catch(() => {});
        }, 4000); // hapus setelah 4 detik
      });
    }).catch(() => {
      bot.sendMessage(msg.chat.id, "❌ Gagal mengambil statistik.");
    });
  });
});

bot.onText(/^\/showalluser$/, (msg) => {
  if (!ADMIN_IDS.includes(msg.chat.id.toString())) return;

  // Ambil semua pengguna dari database
  userdb.getAllUsers((err, users) => {
    if (err) return bot.sendMessage(msg.chat.id, "❌ Gagal mengambil daftar pengguna.");

    if (users.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ Tidak ada pengguna terdaftar.");
    }

    let userList = '';

    // Mengambil data pengguna dan username untuk setiap user
    let promises = users.map(async (chatId) => {
      try {
        const user = await bot.getChat(chatId); // Mengambil informasi chat pengguna
        userList += `@${user.username} - ${user.id}\n`; // Format output: @username - chat_id
      } catch (err) {
        console.error('❌ Gagal mengambil informasi pengguna:', err);
      }
    });

    // Tunggu hingga semua informasi pengguna diambil
    Promise.all(promises).then(() => {
      if (userList === '') {
        return bot.sendMessage(msg.chat.id, "❌ Tidak ada pengguna terdaftar.");
      }

      // Menyiapkan pesan yang akan dikirim
      const statMsg = [
        '✨ DETAIL USER BOT ✨',
        '',
        userList
      ].join('\n');

      // Mengirim pesan
      bot.sendMessage(msg.chat.id, statMsg).then(sentMsg => {
        // Menghapus pesan setelah 1 menit (60 detik)
        setTimeout(() => {
          bot.deleteMessage(msg.chat.id, sentMsg.message_id).catch(() => {});
        }, 60000); // 60000 ms = 1 menit
      });
    });
  });
});