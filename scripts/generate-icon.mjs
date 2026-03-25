#!/usr/bin/env node
/**
 * Multiterm Studio icon — geometric abstract.
 *
 * A single abstract mark: four rounded squares arranged
 * in a dynamic 2x2 formation with slight rotation and spacing,
 * forming a unified shape that suggests multiplicity and space.
 * Purple (#c678dd) gradient on deep dark background.
 *
 * The icon uses a macOS-standard squircle (continuous corner) mask
 * baked into the PNG alpha channel, matching the system icon shape.
 */

import sharp from 'sharp'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILD_DIR = join(__dirname, '..', 'build')
const SIZE = 1024

// macOS Big Sur squircle path for 1024x1024.
// This is the standard continuous-corner superellipse used by macOS app icons.
// Generated to match Apple's icon grid template.
const R = 228 // corner radius matching Apple's spec (~22.3% of size)
const SQUIRCLE = `
  M ${R},0
  H ${SIZE - R}
  C ${SIZE - R * 0.04},0 ${SIZE},${R * 0.04} ${SIZE},${R}
  V ${SIZE - R}
  C ${SIZE},${SIZE - R * 0.04} ${SIZE - R * 0.04},${SIZE} ${SIZE - R},${SIZE}
  H ${R}
  C ${R * 0.04},${SIZE} 0,${SIZE - R * 0.04} 0,${SIZE - R}
  V ${R}
  C 0,${R * 0.04} ${R * 0.04},0 ${R},0
  Z
`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%" stop-color="#2a2535"/>
      <stop offset="100%" stop-color="#1a1722"/>
    </linearGradient>

    <!-- Each quadrant gets a slightly different purple tone -->
    <linearGradient id="q1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#d899ec"/>
      <stop offset="100%" stop-color="#b35fd0"/>
    </linearGradient>
    <linearGradient id="q2" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c678dd"/>
      <stop offset="100%" stop-color="#a04fc4"/>
    </linearGradient>
    <linearGradient id="q3" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#b060cc"/>
      <stop offset="100%" stop-color="#9340b8"/>
    </linearGradient>
    <linearGradient id="q4" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#e0a8f0"/>
      <stop offset="100%" stop-color="#c070dd"/>
    </linearGradient>

    <clipPath id="squircle">
      <path d="${SQUIRCLE}"/>
    </clipPath>

    <filter id="glow-ambient" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="45"/>
    </filter>

    <filter id="glow-mark" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="0 0 0 0 0.78
                0 0 0 0 0.47
                0 0 0 0 0.87
                0 0 0 0.35 0" result="g"/>
      <feMerge>
        <feMergeNode in="g"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Everything clipped to squircle shape -->
  <g clip-path="url(#squircle)">
    <!-- Background -->
    <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>

    <!-- Subtle inner border for edge definition -->
    <path d="${SQUIRCLE}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>

    <ellipse cx="512" cy="512" rx="260" ry="240" fill="#c678dd" opacity="0.06" filter="url(#glow-ambient)"/>

    <!--
      Mark: four rounded squares in a 2x2 grid with a gap between them.
      Slightly rotated for dynamism.
    -->
    <g filter="url(#glow-mark)">
      <g transform="rotate(-6, 512, 512)">
        <!-- Top-left -->
        <rect x="303" y="303" width="185" height="185" rx="36"
              fill="url(#q1)" opacity="0.92"/>
        <!-- Top-right -->
        <rect x="512" y="303" width="185" height="185" rx="36"
              fill="url(#q2)" opacity="0.75"/>
        <!-- Bottom-left -->
        <rect x="303" y="512" width="185" height="185" rx="36"
              fill="url(#q3)" opacity="0.60"/>
        <!-- Bottom-right -->
        <rect x="512" y="512" width="185" height="185" rx="36"
              fill="url(#q4)" opacity="0.85"/>
      </g>
    </g>
  </g>
</svg>`

async function main() {
  console.log('Generating Multiterm Studio icon...')
  mkdirSync(BUILD_DIR, { recursive: true })

  const png = await sharp(Buffer.from(svg)).resize(1024, 1024).png({ quality: 100 }).toBuffer()

  await sharp(png).toFile(join(BUILD_DIR, 'icon.png'))
  console.log('  -> icon.png')

  await sharp(png).resize(256, 256).png().toFile(join(BUILD_DIR, 'icon.ico'))
  console.log('  -> icon.ico')

  // Generate macOS .iconset with all required sizes
  const iconsetDir = join(BUILD_DIR, 'icon.iconset')
  if (existsSync(iconsetDir)) rmSync(iconsetDir, { recursive: true })
  mkdirSync(iconsetDir, { recursive: true })

  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]

  for (const [size, name] of sizes) {
    await sharp(png).resize(size, size).png().toFile(join(iconsetDir, name))
  }
  console.log('  -> icon.iconset (10 sizes)')

  // Convert to .icns using macOS iconutil
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${join(BUILD_DIR, 'icon.icns')}"`)
    console.log('  -> icon.icns')
    rmSync(iconsetDir, { recursive: true })
  } catch (e) {
    console.warn('!! Failed to create .icns:', e.message)
  }

  console.log('\nDone!')
}

main().catch(console.error)
