const axios = require("axios");
const { incrementStat, saveLog, saveUrlCache } = require("../db");

async function downloadFromFacebook(url) {
  try {
    // Deteksi Facebook Story
    if (url.includes('/story') || url.includes('/stories/') || url.includes('story_fbid')) {
      throw new Error("❌ Tidak support story Facebook!");
    }

    const apiEndpoint = `https://fb.bdbots.xyz/dl?url=${encodeURIComponent(url)}`;
    const res = await axios.get(apiEndpoint, {
      timeout: 30000, // 30 detik timeout
      validateStatus: function (status) {
        // Terima status 200-299 dan 400-499 untuk handling manual
        return status >= 200 && status < 500;
      }
    });

    const data = res.data;

    // Cek response status dari API
    if (res.status === 400 || !data || data.status !== "success") {
      throw new Error("❌ Link tidak valid atau video tidak tersedia.");
    }

    if (!Array.isArray(data.downloads) || data.downloads.length === 0) {
      throw new Error("❌ Tidak ada video yang dapat diunduh.");
    }

    // Ambil list video dengan URL yang valid
    const availableVideos = data.downloads.filter(v => v.url && v.url.startsWith('http'));
    if (availableVideos.length === 0) {
      throw new Error("❌ Tidak ada video dengan URL yang tersedia.");
    }

    // Pilih kualitas terbaik: HD > SD > lainnya
    const preferredOrder = ["HD", "SD"];
    const selectedVideo =
      preferredOrder
        .map(q => availableVideos.find(v => v.quality === q && v.url))
        .find(Boolean) || availableVideos[0];

    // Simpan ke database
    const caption = "Diunduh melalui: @iniuntukdonlotvidiotiktokbot";
    incrementStat("facebook");
    saveLog("facebook", url);
    saveUrlCache(url, "facebook", selectedVideo.url, null, caption);

    // Kembalikan hasil
    return {
      video: selectedVideo.url,
      title: data.title || "Video Facebook"
    };

  } catch (err) {
    const status = err?.response?.status;

    // Handle story Facebook
    if (err.message.includes("story Facebook")) {
      throw err; // Re-throw custom story error
    }

    if (status === 400) {
      throw new Error("❌ Link tidak valid atau video tidak tersedia.");
    }

    if (status === 403) {
      throw new Error("❌ Video private atau tidak dapat diakses.");
    }

    if (status === 429) {
      throw new Error("❌ Terlalu banyak request. Coba lagi nanti.");
    }

    if (status === 503 || status === 502) {
      throw new Error("❌ Server Facebook API sedang sibuk. Coba lagi nanti.");
    }

    if (err.code === 'ECONNABORTED') {
      throw new Error("❌ Request timeout. Server terlalu lama merespons.");
    }

    throw new Error("❌ Tidak support story Facebook!.");
  }
}

module.exports = { downloadFromFacebook };
