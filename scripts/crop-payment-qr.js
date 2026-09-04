const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const assets = 'C:/Users/Intel/.cursor/projects/c-Users-Intel-OneDrive-RESTO-FADEY-POS/assets';
const outDir = path.join(__dirname, '..', 'client', 'public', 'payment-qr');
fs.mkdirSync(outDir, { recursive: true });

const map = {
  plin: 'c__Users_Intel_AppData_Roaming_Cursor_User_workspaceStorage_57ce5a0a47522458c5a103eba050b823_images_image-7a03be8d-d071-4ab2-a496-c497e78ee2ac.png',
  dale: 'c__Users_Intel_AppData_Roaming_Cursor_User_workspaceStorage_57ce5a0a47522458c5a103eba050b823_images_image-13f217b6-8e98-4c02-817e-1ee4a1ae4e03.png',
  yape: 'c__Users_Intel_AppData_Roaming_Cursor_User_workspaceStorage_57ce5a0a47522458c5a103eba050b823_images_image-c2fa6435-2b33-4bd3-8cb6-3a4ac9bd4053.png',
};

(async () => {
  const read = typeof Jimp.read === 'function' ? Jimp.read.bind(Jimp) : Jimp.default?.read?.bind(Jimp.default);
  if (!read) throw new Error('Jimp.read not found');
  for (const [name, file] of Object.entries(map)) {
    const img = await read(path.join(assets, file));
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    console.log(name, w, 'x', h);

    const writeFn = img.writeAsync ? 'writeAsync' : 'write';
    await img.clone()[writeFn](path.join(outDir, `${name}-full.png`));

    let x;
    let y;
    let size;
    if (name === 'plin') {
      size = Math.floor(Math.min(w, h) * 0.72);
      x = Math.floor((w - size) / 2);
      y = Math.floor(h * 0.32);
    } else if (name === 'dale') {
      size = Math.floor(Math.min(w, h) * 0.48);
      x = Math.floor((w - size) / 2);
      y = Math.floor(h * 0.22);
    } else {
      size = Math.floor(Math.min(w, h) * 0.62);
      x = Math.floor((w - size) / 2);
      y = Math.floor(h * 0.18);
    }
    size = Math.min(size, w - x, h - y);
    const cropped = img.clone().crop(x, y, size, size);
    await cropped[writeFn](path.join(outDir, `${name}.png`));
    console.log('wrote', name, size);
  }
  console.log('out', fs.readdirSync(outDir));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
