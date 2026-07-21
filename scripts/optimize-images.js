import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputDir = path.join(__dirname, '../src/assets/raw');
const outputDir = path.join(__dirname, '../public/images');

/**
 * Optimize images to AVIF, WebP, and JPG formats
 */
async function optimizeImages() {
  try {
    // Ensure directories exist
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    // Read all files from input directory
    const files = await fs.readdir(inputDir);

    if (files.length === 0) {
      console.log('ℹ️  No images found in src/assets/raw/');
      console.log('   Place your source images there to optimize them.');
      return;
    }

    console.log(`🖼️  Optimizing ${files.length} images...\n`);

    for (const file of files) {
      const inputPath = path.join(inputDir, file);
      const { name, ext } = path.parse(file);

      // Skip non-image files
      if (!['.jpg', '.jpeg', '.png', '.webp', '.tiff'].includes(ext.toLowerCase())) {
        console.log(`⏭️  Skipping ${file} (not an image)`);
        continue;
      }

      console.log(`📸 Processing ${file}...`);

      try {
        const image = sharp(inputPath);
        const metadata = await image.metadata();

        // Generate AVIF (primary - best compression)
        console.log(`   → AVIF...`);
        await image
          .clone()
          .avif({
            quality: 80,
            effort: 9 // Max compression effort
          })
          .toFile(path.join(outputDir, `${name}.avif`));

        // Generate WebP (fallback)
        console.log(`   → WebP...`);
        await image
          .clone()
          .webp({
            quality: 85,
            effort: 6
          })
          .toFile(path.join(outputDir, `${name}.webp`));

        // Generate optimized JPG (legacy fallback)
        console.log(`   → JPG...`);
        await image
          .clone()
          .jpeg({
            quality: 80,
            progressive: true,
            mozjpeg: true
          })
          .toFile(path.join(outputDir, `${name}.jpg`));

        // Generate blur placeholder (base64)
        console.log(`   → Blur placeholder...`);
        const buffer = await image
          .clone()
          .resize(20)
          .blur(10)
          .toBuffer();

        const base64 = buffer.toString('base64');
        const dataUri = `data:image/${metadata.format};base64,${base64}`;

        await fs.writeFile(
          path.join(outputDir, `${name}-placeholder.txt`),
          dataUri
        );

        // Get file sizes
        const avifSize = (await fs.stat(path.join(outputDir, `${name}.avif`))).size;
        const webpSize = (await fs.stat(path.join(outputDir, `${name}.webp`))).size;
        const jpgSize = (await fs.stat(path.join(outputDir, `${name}.jpg`))).size;

        const formatSize = (bytes) => {
          return bytes < 1024
            ? `${bytes}B`
            : bytes < 1024 * 1024
            ? `${(bytes / 1024).toFixed(1)}KB`
            : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
        };

        console.log(`   ✅ Done: AVIF ${formatSize(avifSize)} | WebP ${formatSize(webpSize)} | JPG ${formatSize(jpgSize)}`);
        console.log(`   📊 Savings: ${((1 - avifSize / webpSize) * 100).toFixed(0)}% (AVIF vs WebP)\n`);
      } catch (error) {
        console.error(`   ❌ Error processing ${file}:`, error.message);
      }
    }

    console.log('✨ Image optimization complete!\n');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

optimizeImages();
