import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

// Helper to extract video ID
function extractVideoId(url: string) {
  const match = url.match(/(?:v=|youtu\.be\/|embed\/)([^&?]+)/);
  return match ? match[1] : null;
}

// Helper to parse VTT to plain text
function parseVtt(vtt: string) {
  return vtt
    .split('\n')
    .filter(line => 
      !line.includes('-->') && 
      !line.startsWith('WEBVTT') && 
      !line.startsWith('Kind:') &&
      !line.startsWith('Language:') &&
      line.trim() !== '' && 
      !/^\d+$/.test(line.trim())
    )
    .map(line => line.replace(/<[^>]+>/g, '')) // Remove tags like <c>
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: Request) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid Video URL' }, { status: 400 });
    }

    // Strategy 1: Custom fetch with CONSENT cookie (bypasses some EU blocks and avoids youtube-transcript's default headers)
    try {
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
        }
      });
      const html = await response.text();

      if (!html.includes('requires solving a captcha') && !html.includes('too many requests')) {
        const captionsMatch = html.match(/"captions":({.*?})},"videoDetails"/);
        if (captionsMatch) {
          const captionsJson = JSON.parse(captionsMatch[1]);
          const captionTracks = captionsJson?.playerCaptionsTracklistRenderer?.captionTracks;

          if (captionTracks && captionTracks.length > 0) {
            let track = captionTracks.find((t: any) => t.languageCode === 'es') || 
                        captionTracks.find((t: any) => t.languageCode === 'en') || 
                        captionTracks[0];

            const transcriptResponse = await fetch(track.baseUrl);
            const transcriptXml = await transcriptResponse.text();

            const textMatches = transcriptXml.matchAll(/<text[^>]*>(.*?)<\/text>/g);
            let text = '';
            for (const match of textMatches) {
              let decoded = match[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
              text += decoded + ' ';
            }
            if (text.trim()) {
              return NextResponse.json({ text: text.trim() });
            }
          }
        }
      }
    } catch (e) {
      console.warn("Strategy 1 failed", e);
    }

    // Strategy 2: Piped API (Public instance 1) - Uses a completely different IP
    try {
      const pipedRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
      if (pipedRes.ok) {
        const pipedData = await pipedRes.json();
        if (pipedData.subtitles && pipedData.subtitles.length > 0) {
          const sub = pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('spanish')) || 
                      pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('english')) || 
                      pipedData.subtitles[0];
          const subRes = await fetch(sub.url);
          const subText = await subRes.text();
          const parsedText = parseVtt(subText);
          if (parsedText) {
            return NextResponse.json({ text: parsedText });
          }
        }
      }
    } catch (e) {
      console.warn("Strategy 2 failed", e);
    }

    // Strategy 3: Piped API (Public instance 2)
    try {
      const pipedRes = await fetch(`https://pipedapi.tokhmi.xyz/streams/${videoId}`);
      if (pipedRes.ok) {
        const pipedData = await pipedRes.json();
        if (pipedData.subtitles && pipedData.subtitles.length > 0) {
          const sub = pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('spanish')) || 
                      pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('english')) || 
                      pipedData.subtitles[0];
          const subRes = await fetch(sub.url);
          const subText = await subRes.text();
          const parsedText = parseVtt(subText);
          if (parsedText) {
            return NextResponse.json({ text: parsedText });
          }
        }
      }
    } catch (e) {
      console.warn("Strategy 3 failed", e);
    }

    // Strategy 4: Fallback to youtube-transcript library
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoUrl);
      const text = transcript.map(t => t.text).join(' ');
      return NextResponse.json({ text });
    } catch (e: any) {
      console.warn("Strategy 4 failed", e);
      throw e; // Throw the last error if all strategies fail
    }

  } catch (error: any) {
    console.error(`All strategies failed for ${req.url}:`, error);
    return NextResponse.json({ error: error.message || 'Failed to fetch transcript after multiple attempts' }, { status: 500 });
  }
}
