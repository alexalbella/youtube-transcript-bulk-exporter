import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenAI } from '@google/genai';

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

// AI Fallback function
async function transcribeWithAI(videoUrl: string): Promise<string> {
  console.log(`[AI Fallback] Starting AI transcription for ${videoUrl}`);
  
  // 1. Get audio URL from Cobalt
  const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://cobalt.tools',
      'Referer': 'https://cobalt.tools/'
    },
    body: JSON.stringify({
      url: videoUrl,
      isAudioOnly: true,
      aFormat: 'opus'
    })
  });

  if (!cobaltRes.ok) {
    throw new Error('No se pudo obtener el audio del video para la IA.');
  }

  const cobaltData = await cobaltRes.json();
  const audioUrl = cobaltData.url;

  if (!audioUrl) {
    throw new Error('La API de audio no devolvió una URL válida.');
  }

  console.log(`[AI Fallback] Downloading audio from ${audioUrl.substring(0, 50)}...`);

  // 2. Fetch the audio file
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error('Falló la descarga del archivo de audio.');
  }

  // Check size (Gemini inline limit is ~20MB)
  const contentLength = audioRes.headers.get('content-length');
  const MAX_SIZE = 19 * 1024 * 1024; // 19MB to be safe
  if (contentLength && parseInt(contentLength) > MAX_SIZE) {
    throw new Error('El video es demasiado largo para la transcripción por IA (límite de ~40 minutos).');
  }

  const arrayBuffer = await audioRes.arrayBuffer();
  
  if (arrayBuffer.byteLength > MAX_SIZE) {
    throw new Error('El video es demasiado largo para la transcripción por IA (límite de ~40 minutos).');
  }

  const base64Audio = Buffer.from(arrayBuffer).toString('base64');
  console.log(`[AI Fallback] Audio downloaded, size: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB. Sending to Gemini...`);

  // 3. Send to Gemini
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('API Key de Gemini no configurada.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Transcribe el siguiente audio con la mayor precisión posible en el idioma original en el que se habla. Devuelve ÚNICAMENTE el texto de la transcripción, sin ningún otro comentario, formato markdown o introducción.' },
          {
            inlineData: {
              mimeType: 'audio/ogg',
              data: base64Audio
            }
          }
        ]
      }
    ]
  });

  if (!response.text) {
    throw new Error('Gemini no devolvió ninguna transcripción.');
  }

  console.log(`[AI Fallback] Transcription successful!`);
  return response.text.trim();
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

    // Strategy 2: Piped API (Multiple Public Instances)
    const pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.lunar.icu',
      'https://pipedapi.in.projectsegfau.lt',
      'https://piped-api.garudalinux.org'
    ];

    for (const instance of pipedInstances) {
      try {
        const pipedRes = await fetch(`${instance}/streams/${videoId}`, {
          signal: AbortSignal.timeout(6000) // 6 second timeout per instance
        });
        
        // Check if response is OK and is actually JSON
        const contentType = pipedRes.headers.get('content-type');
        if (pipedRes.ok && contentType && contentType.includes('application/json')) {
          const pipedData = await pipedRes.json();
          
          if (pipedData.subtitles && pipedData.subtitles.length > 0) {
            // Prefer Spanish, then English, then any non-auto-generated, then the first one
            const sub = pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('spanish') || s.name.toLowerCase().includes('español')) || 
                        pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('english')) || 
                        pipedData.subtitles.find((s: any) => s.autoGenerated === false) ||
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
        console.warn(`Piped instance ${instance} failed:`, e instanceof Error ? e.message : 'Unknown error');
      }
    }

    // Strategy 3: Cobalt API (Alternative to Piped)
    try {
      const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: videoUrl,
          vCodec: 'none',
          aFormat: 'best',
          isAudioOnly: true
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (cobaltRes.ok) {
        // Cobalt doesn't directly return subtitles, but it's a good fallback to check if the video is accessible.
        // If we get here, we might want to try another subtitle-specific API if we had one.
        // For now, we'll just log it.
        console.log("Cobalt API reached successfully, but subtitle extraction is not supported directly via Cobalt.");
      }
    } catch (e) {
      console.warn("Strategy 3 (Cobalt) failed:", e instanceof Error ? e.message : 'Unknown error');
    }

    // Strategy 4: Fallback to youtube-transcript library
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoUrl);
      const text = transcript.map(t => t.text).join(' ');
      return NextResponse.json({ text });
    } catch (e: any) {
      console.warn("Strategy 4 (youtube-transcript) failed:", e.message);
      
      // If the error is about transcript being disabled, try AI Fallback
      if (e.message && e.message.includes('Transcript is disabled')) {
        console.log("Transcript disabled natively. Attempting AI Fallback...");
        try {
          const aiText = await transcribeWithAI(videoUrl);
          return NextResponse.json({ text: aiText, isAIGenerated: true });
        } catch (aiError: any) {
          console.error("AI Fallback failed:", aiError.message);
          throw new Error(`Los subtítulos están desactivados y la IA falló: ${aiError.message}`);
        }
      }
      
      throw e; // Throw the last error if all strategies fail
    }

  } catch (error: any) {
    console.error(`All strategies failed for ${req.url}:`, error.message);
    return NextResponse.json({ error: error.message || 'Failed to fetch transcript after multiple attempts' }, { status: 500 });
  }
}
