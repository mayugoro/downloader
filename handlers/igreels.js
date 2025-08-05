const axios = require("axios");
const { incrementStat, saveLog, saveUrlCache } = require("../db");

async function downloadFromIgReels(url) {
  try {
    const apiEndpoint = process.env.igreels + encodeURIComponent(url);
    const res = await axios.get(apiEndpoint);
    const media = res.data?.data?.media;

    if (!media || media.length === 0) {
      throw new Error("❌ Tidak ada video ditemukan.");
    }

    const videoItem = media.find(item => item.type === "video");
    if (!videoItem) {
      throw new Error("❌ Reels tidak berisi video.");
    }

    // 📦 Log, statistik, dan simpan cache
    const caption = "Diunduh melalui: @iniuntukdonlotvidiotiktokbot";
    incrementStat("instagram");
    saveLog("instagram", url);
    saveUrlCache(url, "instagram", videoItem.url, null, caption);

    return { url: videoItem.url };

  } catch (err) {
    const status = err?.response?.status;

    if (status === 400) {
      throw new Error("❌ Link tidak valid atau tidak ada video.");
    }

    if (status === 503) {
      throw new Error("❌ Server Instagram API sedang sibuk. Coba lagi nanti.");
    }

    throw new Error("❌ Gagal mengambil data Reels Instagram.");
  }
}

module.exports = { downloadFromIgReels };