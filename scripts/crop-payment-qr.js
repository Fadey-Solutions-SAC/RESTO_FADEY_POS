const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const assets = 'C:/Users/Intel/.cursor/projects/c-Users-Intel-OneDrive-RESTO-FADEY-POS/assets';
const outDir = path.join(__dirname, '..', 'client', 'public', 'payment-qr');
fs.mkdirSync(outDir, { recursive: true });

const files = {
  plin: 'c__Users_Intel_AppData_Roaming_Cursor_User_workspaceStorage_57ce5a0a47522458c5a103eba050b823_images_image-7a03be8d-d071-4ab2-a496-c497e78ee2ac.png',
  dale: 'c__Users_Intel_AppData_Roaming_Cursor_User_workspaceStorage_57ce5a0a47522458c5a103eba050b823_images_image-13f217b6-8e98-4c02-817e-1ee4a1ae4e03.png',
  yape: 'c__Users_Intel_AppData_Roaming_Cursor_User_workspaceStorage_57ce5a0a47522458c5a103eba050b823_images_image-c2fa6435-2b33-4bd3-8cb6-3a4ac9bd4053.png',
};

const crops = {
  // Solo el cuadrado del QR (sin logos ni textos)
  plin: (w, h) => {
    const size = Math.floor(Math.min(w, h) * 0.68);
    return { x: Math.floor((w - size) / 2), y: Math.floor(h * 0.34), size };
  },
  dale: (w, h) => {
    const size = Math.floor(Math.min(w * 0.88, h * 0.34));
    return { x: Math.floor((w - size) / 2), y: Math.floor(h * 0.22), size };
  },
  yape: (w, h) => {
    const size = Math.floor(Math.min(w, h) * 0.5);
    return { x: Math.floor((w - size) / 2), y: Math.floor(h * 0.23), size };
  },
};

(async () => {
  for (const [name, file] of Object.entries(files)) {
    const img = await Jimp.read(path.join(assets, file));
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    const { x, y, size } = crops[name](w, h);
    const s = Math.min(size, w - x, h - y);
    await img.clone().crop(x, y, s, s).writeAsync(path.join(outDir, `${name}.png`));
    console.log(name, s, 'at', x, y, 'from', w, 'x', h);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
