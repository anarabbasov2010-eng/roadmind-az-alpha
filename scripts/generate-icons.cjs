const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const svg = path.join(root, 'public', 'roadmind-icon.svg');
const out = path.join(root, 'electron', 'roadmind.ico');

async function main() {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const png = await sharp(svg).resize(256, 256).png().toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.writeFileSync(out, Buffer.concat([header, png]));
  console.log('Generated Windows icon:', out);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });