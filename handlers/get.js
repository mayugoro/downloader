// handlers/get.js
const getHandler = (ctx) => {
  const userId = ctx.message.text.split(' ')[1]; // Ambil ID pengguna dari perintah
  const user = ctx.message.from; // Mendapatkan informasi pengguna yang mengirimkan perintah
  
  if (!userId) {
    return ctx.reply('Mohon masukkan ID pengguna setelah perintah /get');
  }

  // Format output
  const message = `
✨DETAIL PENGGUNA✨
ID: ${userId}
USERNAME: ${user.username || 'Tidak ada username'}
LINK: tg://openmessage?user_id=${userId}
  `;
  
  return ctx.reply(message);
};

module.exports = getHandler;
