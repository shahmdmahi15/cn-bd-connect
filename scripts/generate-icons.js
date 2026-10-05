const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sourceImage = '/home/shahmdmahi/.gemini/antigravity/brain/f0bd8cbf-e3cc-4e6b-aae2-4e6e048bb90a/.user_uploaded/media_1791209898244.jpg';
const publicDir = path.resolve(__dirname, '../apps/web/public');
const iconsDir = path.join(publicDir, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

async function generate() {
  console.log('Generating assets from:', sourceImage);

  // 1. Master logo files
  await sharp(sourceImage)
    .png({ quality: 100 })
    .toFile(path.join(publicDir, 'logo.png'));
  console.log('Generated logo.png');

  fs.copyFileSync(sourceImage, path.join(publicDir, 'logo.jpg'));
  console.log('Copied logo.jpg');

  // 2. Standard PWA icon sizes
  const sizes = [512, 384, 192, 144, 128, 96, 72, 48];
  for (const size of sizes) {
    await sharp(sourceImage)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(path.join(iconsDir, `icon-${size}x${size}.png`));
    console.log(`Generated icons/icon-${size}x${size}.png`);
  }

  // 3. Apple Touch Icon
  await sharp(sourceImage)
    .resize(180, 180, { fit: 'cover' })
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Generated apple-touch-icon.png');

  // 4. Favicons
  await sharp(sourceImage)
    .resize(32, 32, { fit: 'cover' })
    .png()
    .toFile(path.join(publicDir, 'favicon-32x32.png'));
  
  await sharp(sourceImage)
    .resize(16, 16, { fit: 'cover' })
    .png()
    .toFile(path.join(publicDir, 'favicon-16x16.png'));

  // Also write as favicon.ico (PNG 32x32 is accepted by modern browsers)
  await sharp(sourceImage)
    .resize(48, 48, { fit: 'cover' })
    .png()
    .toFile(path.join(publicDir, 'favicon.ico'));
  console.log('Generated favicons');

  // 5. OpenGraph / Twitter Card (1200x630 with dark background)
  const bg = await sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 4,
      background: { r: 2, g: 6, b: 23, alpha: 1 },
    },
  }).png().toBuffer();

  const centeredLogo = await sharp(sourceImage)
    .resize(550, 550, { fit: 'contain' })
    .png()
    .toBuffer();

  await sharp(bg)
    .composite([
      {
        input: centeredLogo,
        top: 40,
        left: 325,
      },
    ])
    .png()
    .toFile(path.join(publicDir, 'og-image.png'));
  console.log('Generated og-image.png');

  console.log('All assets successfully generated!');
}

generate().catch((err) => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
