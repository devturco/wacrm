import { TRACK_SCRIPT } from '@/lib/leads/track-script';

/**
 * The tracking script, served as a static file.
 *
 * The client pastes one `<script>` tag on their own site; the file
 * is plain JS with no dependency, so it is served as-is instead of
 * going through the bundler.
 */
export function GET() {
  return new Response(TRACK_SCRIPT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
