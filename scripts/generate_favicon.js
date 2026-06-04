const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// SVGをバッファとして読み込む
const svgPath = path.join(__dirname, '../src/app/icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

async function main() {
  // SVG → PNG 変換（32x32）
  const png32 = await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toBuffer();

  // SVG → PNG 変換（16x16）
  const png16 = await sharp(svgBuffer)
    .resize(16, 16)
    .png()
    .toBuffer();

  // ICOファイルの構造を手動で構築
  // ICOヘッダー: ICONDIR
  const numImages = 2;
  const headerSize = 6; // ICONDIR
  const entrySize = 16; // ICONDIRENTRY × 2
  const dataOffset = headerSize + entrySize * numImages;

  // PNG32 は32x32、PNG16 は16x16
  const buf = Buffer.alloc(dataOffset + png32.length + png16.length);

  // ICONDIR
  buf.writeUInt16LE(0, 0);       // Reserved
  buf.writeUInt16LE(1, 2);       // Type: 1=ICO
  buf.writeUInt16LE(numImages, 4); // Count

  // ICONDIRENTRY for 16x16
  buf.writeUInt8(16, 6);         // Width
  buf.writeUInt8(16, 7);         // Height
  buf.writeUInt8(0, 8);          // ColorCount (0 = no palette)
  buf.writeUInt8(0, 9);          // Reserved
  buf.writeUInt16LE(1, 10);      // Planes
  buf.writeUInt16LE(32, 12);     // BitCount
  buf.writeUInt32LE(png16.length, 14); // SizeInBytes
  buf.writeUInt32LE(dataOffset + png32.length, 18); // FileOffset

  // ICONDIRENTRY for 32x32
  buf.writeUInt8(32, 22);        // Width
  buf.writeUInt8(32, 23);        // Height
  buf.writeUInt8(0, 24);         // ColorCount
  buf.writeUInt8(0, 25);         // Reserved
  buf.writeUInt16LE(1, 26);      // Planes
  buf.writeUInt16LE(32, 28);     // BitCount
  buf.writeUInt32LE(png32.length, 30); // SizeInBytes
  buf.writeUInt32LE(dataOffset, 34);   // FileOffset

  // PNG データ
  png32.copy(buf, dataOffset);
  png16.copy(buf, dataOffset + png32.length);

  const icoPath = path.join(__dirname, '../src/app/favicon.ico');
  fs.writeFileSync(icoPath, buf);
  console.log('favicon.ico generated:', icoPath, buf.length, 'bytes');

  // icon.png も生成（Next.js App Router 用）
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(__dirname, '../src/app/icon.png'));
  console.log('icon.png generated');
}

main().catch(console.error);
