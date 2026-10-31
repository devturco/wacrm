import type { MetadataRoute } from 'next'

// Makes the dashboard installable on a phone ("Add to Home screen"), which
// gives Android a proper app icon and makes push notifications more
// reliable. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'crmbr',
    short_name: 'crmbr',
    description: 'Shared WhatsApp inbox',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    // The app ships dark by default (see DEFAULT_MODE in src/lib/themes.ts),
    // so the splash screen follows the app's own browser theme colour —
    // a white splash would flash white before the dark UI paints.
    background_color: '#020617',
    theme_color: '#7c3aed',
    // Static files under /public (the Docker image ships /public), not a
    // generated route: the icons are the same crmbr mark as the favicon,
    // so the installed app and the browser tab show one brand.
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
