const axios = require("axios");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadFromTikwm(url) {
  // Smart API selection berdasarkan content type
  const apiStrategies = {
    // Video & Musik: Tiklydown (apitiktok) lebih unggul
    video: [
      process.env.apitiktok,
      process.env.apitiktok2,
      process.env.apitiktok3
    ],
    // Gambar/Slide: Tikwm (apitiktok2) lebih unggul
    slide: [
      process.env.apitiktok2,
      process.env.apitiktok,
      process.env.apitiktok3
    ],
    // Story TikTok: Vishavideo (apitiktok3) lebih unggul
    story: [
      process.env.apitiktok3,
      process.env.apitiktok,
      process.env.apitiktok2
    ]
  };

  // Deteksi jenis konten dari URL (heuristic)
  const contentType = detectContentType(url);
  const apis = apiStrategies[contentType].filter(Boolean);

  let lastError;
  for (const api of apis) {
    try {
      // Setup request berdasarkan API
      const requestConfig = buildRequestConfig(api, url);
      const res = await axios(requestConfig);
      const data = res.data;

      // Parsing berdasarkan API yang digunakan
      const result = await parseApiResponse(api, data);
      if (result) {
        await delay(2000);
        return result;
      }

    } catch (err) {
      lastError = err;
      continue;
    }
  }

  // Jika semua API gagal
  console.error("Error TikTok (all apis):", lastError?.message || lastError);
  throw new Error("❌ Gagal mendapatkan data dari TikTok. Semua API gagal.");
}

function buildRequestConfig(api, url) {
  // Tiklydown (apitiktok) - menggunakan apikey sebagai query parameter
  if (api === process.env.apitiktok) {
    // Format: https://api.tiklydown.eu.org/api/download?url=ENCODED_URL&apikey=YOUR_API_KEY
    const apiUrl = `${api}${encodeURIComponent(url)}&apikey=${process.env.apikeytiklydown}`;
    
    return {
      method: 'GET',
      url: apiUrl,
      headers: {
        'accept': 'application/json'
      }
    };
  }
  
  // API lain (Tikwm & Vishavideo) - public GET request
  return {
    method: 'GET',
    url: api + encodeURIComponent(url)
  };
}

function detectContentType(url) {
  // Heuristic detection berdasarkan URL pattern
  if (url.includes('/story/') || url.includes('story')) {
    return 'story';
  }
  // Default ke video untuk konten umum, slide detection dilakukan di parsing
  return 'video';
}

function getApiName(api) {
  if (api === process.env.apitiktok) return 'Tiklydown';
  if (api === process.env.apitiktok2) return 'Tikwm';
  if (api === process.env.apitiktok3) return 'Vishavideo';
  return 'Unknown';
}

async function parseApiResponse(api, data) {
  // Tiklydown (apitiktok) - parsing dengan struktur response baru [SUDAH BENAR 100%]
  if (api === process.env.apitiktok && data && data.video) {
    // Cek jika ada images (slide)
    if (data.images && Array.isArray(data.images) && data.images.length > 0) {
      const images = data.images.map(img => ({
        type: "photo",
        media: img.url || img
      }));

      return {
        type: "slide",
        images,
        caption: "Diunduh melalui: @iniuntukdonlotvidiotiktokbot",
        audioUrl: data.music?.play_url || null,
      };
    }

    // Video single
    const videoUrl = data.video?.noWatermark || data.video?.watermark;
    if (videoUrl) {
      return {
        type: "video",
        video: videoUrl,
        audioUrl: data.music?.play_url || null,
      };
    }
  }

  // Tikwm (apitiktok2) - PERBAIKAN PARSING untuk slide detection
  if (api === process.env.apitiktok2 && data && typeof data.code !== "undefined" && data.code === 0 && data.data) {
    const d = data.data;

    // PRIORITAS 1: Cek jika ada images array (slide/foto)
    if (d.images && Array.isArray(d.images) && d.images.length > 0) {
      // Filter hanya URL yang valid
      const validImages = d.images.filter(img => img && typeof img === 'string' && img.startsWith('http'));
      
      if (validImages.length > 0) {
        const images = validImages.map(img => ({
          type: "photo",
          media: img
        }));

        return {
          type: "slide",
          images,
          caption: "Diunduh melalui: @iniuntukdonlotvidiotiktokbot",
          audioUrl: d.music || d.music_info?.play || null,
        };
      }
    }

    // PRIORITAS 2: Deteksi slide berdasarkan duration = 0 dan ada cover
    if (d.duration === 0 && d.cover && !d.play) {
      // Ini kemungkinan slide dengan hanya 1 gambar
      const images = [{
        type: "photo",
        media: d.cover
      }];

      return {
        type: "slide",
        images,
        caption: "Diunduh melalui: @iniuntukdonlotvidiotiktokbot",
        audioUrl: d.music || d.music_info?.play || null,
      };
    }

    // PRIORITAS 3: Video single (jika ada play URL dan duration > 0)
    if (d.play && d.duration > 0) {
      return {
        type: "video",
        video: d.play,
        audioUrl: d.music || d.music_info?.play || null,
      };
    }

    // PRIORITAS 4: Fallback video dengan wmplay
    if (d.wmplay && d.duration > 0) {
      return {
        type: "video",
        video: d.wmplay,
        audioUrl: d.music || d.music_info?.play || null,
      };
    }
  }

  // Vishavideo (apitiktok3) - parsing href [TETAP SAMA]
  if (api === process.env.apitiktok3 && data && data.code === 200 && Array.isArray(data.data)) {
    const slideObjs = data.data.filter(item =>
      item.title && item.title.toLowerCase().includes("slide") && item.href
    );
    const audioObj = data.data.find(item =>
      item.title && item.title.toLowerCase().includes("mp3")
    );

    if (slideObjs.length > 1) {
      const images = slideObjs.map(obj => ({
        type: "photo",
        media: obj.href
      }));
      return {
        type: "slide",
        images,
        caption: "Diunduh melalui: @iniuntukdonlotvidiotiktokbot",
        audioUrl: audioObj?.href || null,
      };
    } else if (slideObjs.length === 1) {
      return {
        type: "video",
        video: slideObjs[0].href,
        audioUrl: audioObj?.href || null,
      };
    }

    const videoObj = data.data.find(item =>
      item.title && item.title.toLowerCase().includes("video") && item.href
    ) || data.data[0];

    if (videoObj && videoObj.href) {
      return {
        type: "video",
        video: videoObj.href,
        audioUrl: audioObj?.href || null,
      };
    }
  }

  // Generic array parsing fallback
  if (Array.isArray(data.data)) {
    const videoObj = data.data.find(item =>
      item.title && item.title.toLowerCase().includes("slide")
    ) || data.data[0];
    const audioObj = data.data.find(item =>
      item.title && item.title.toLowerCase().includes("mp3")
    );

    if (videoObj && videoObj.href) {
      return {
        type: "video",
        video: videoObj.href,
        audioUrl: audioObj?.href || null,
      };
    }
  }

  return null;
}

module.exports = { downloadFromTikwm };