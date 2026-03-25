import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenAI } from '@google/genai';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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
    .map(line => line.replace(/<[^>]+>/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// AI Fallback function using youtube-dl-exec and Gemini Files API
async function transcribeWithAI(videoUrl: string): Promise<string> {
  console.log(`[AI Fallback] Starting AI transcription for ${videoUrl}`);
  
  const videoId = extractVideoId(videoUrl) || 'audio';
  const tmpFilePath = path.join(os.tmpdir(), `${videoId}.mp3`);

  try {
    console.log(`[AI Fallback] Downloading audio using youtube-dl-exec to ${tmpFilePath}...`);
    
    await youtubedl(videoUrl, {
      extractAudio: true,
      audioFormat: 'mp3',
      output: tmpFilePath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });

    const stats = await fs.stat(tmpFilePath);
    console.log(`[AI Fallback] Audio downloaded, size: ${(stats.size / 1024 / 1024).toFixed(2)} MB. Uploading to Gemini Files API...`);

    // We must use NEXT_PUBLIC_GEMINI_API_KEY as per the environment constraints
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;  
    if (!apiKey) {
      throw new Error('API Key de Gemini no configurada.');
    }

    const ai = new GoogleGenAI({ apiKey });

    // Upload to Gemini Files API
    const uploadResult = await ai.files.upload({
      file: tmpFilePath,
      config: {
        mimeType: 'audio/mp3',
      }
    });

    console.log(`[AI Fallback] Uploaded to Gemini as ${uploadResult.name}. Generating content...`);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Transcribe el siguiente audio con la mayor precisión posible en el idioma original en el que se habla. Devuelve ÚNICAMENTE el texto de la transcripción, sin ningún otro comentario, formato markdown o introducción.' },
            {
              fileData: {
                fileUri: uploadResult.uri,
                mimeType: uploadResult.mimeType
              }
            }
          ]
        }
      ]
    });

    if (!response.text) {
      throw new Error('Gemini no devolvió ninguna transcripción.');
    }

    console.log(`[AI Fallback] Transcription successful! Cleaning up...`);
    
    // Cleanup file from Gemini
    if (uploadResult.name) {
      try {
        await ai.files.delete({ name: uploadResult.name });
      } catch (cleanupErr) {
        console.warn(`[AI Fallback] Could not delete file from Gemini:`, cleanupErr);
      }
    }

    return response.text.trim();
  } finally {
    // Cleanup local file
    try {
      await fs.unlink(tmpFilePath);
    } catch (e) {
      // Ignore if file doesn't exist
    }
  }
}

export async function POST(req: Request) {
  try {
    const { videoUrl, preferredLanguage = 'auto' } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid Video URL' }, { status: 400 });
    }

    let transcriptText = null;

    // Strategy 1: Custom fetch with CONSENT cookie
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
            let track;
            if (preferredLanguage !== 'auto') {
              track = captionTracks.find((t: any) => t.languageCode === preferredLanguage);
            }
            if (!track) {
              track = captionTracks.find((t: any) => t.languageCode === 'es') || 
                      captionTracks.find((t: any) => t.languageCode === 'en') || 
                      captionTracks[0];
            }

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
              transcriptText = text.trim();
            }
          }
        }
      }
    } catch (e) {
      console.warn("Strategy 1 failed", e);
    }

    if (transcriptText) return NextResponse.json({ text: transcriptText });

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
          signal: AbortSignal.timeout(6000)
        });
        
        const contentType = pipedRes.headers.get('content-type');
        if (pipedRes.ok && contentType && contentType.includes('application/json')) {
          const pipedData = await pipedRes.json();
          
          if (pipedData.subtitles && pipedData.subtitles.length > 0) {
            let sub;
            if (preferredLanguage === 'es') {
              sub = pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('spanish') || s.name.toLowerCase().includes('español'));
            } else if (preferredLanguage === 'en') {
              sub = pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('english'));
            }
            
            if (!sub) {
              sub = pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('spanish') || s.name.toLowerCase().includes('español')) || 
                    pipedData.subtitles.find((s: any) => s.name.toLowerCase().includes('english')) || 
                    pipedData.subtitles.find((s: any) => s.autoGenerated === false) ||
                    pipedData.subtitles[0];
            }
                        
            const subRes = await fetch(sub.url);
            const subText = await subRes.text();
            const parsedText = parseVtt(subText);
            
            if (parsedText) {
              transcriptText = parsedText;
              break;
            }
          }
        }
      } catch (e) {
        console.warn(`Piped instance ${instance} failed:`, e instanceof Error ? e.message : 'Unknown error');
      }
    }

    if (transcriptText) return NextResponse.json({ text: transcriptText });

    // Strategy 3: Fallback to youtube-transcript library
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoUrl, { lang: preferredLanguage !== 'auto' ? preferredLanguage : undefined });
      transcriptText = transcript.map(t => t.text).join(' ');
    } catch (e: any) {
      console.warn("Strategy 3 (youtube-transcript) failed:", e.message);
    }

    if (transcriptText) return NextResponse.json({ text: transcriptText });

    // Strategy 4: AI Fallback (If all previous strategies failed)
    console.log("All subtitle strategies failed. Attempting AI Fallback...");
    try {
      const aiText = await transcribeWithAI(videoUrl);
      return NextResponse.json({ text: aiText, isAIGenerated: true });
    } catch (aiError: any) {
      console.error("AI Fallback failed:", aiError.message);
      throw new Error(`No se pudieron obtener los subtítulos y la IA falló: ${aiError.message}`);
    }

  } catch (error: any) {
    console.error(`All strategies failed for ${req.url}:`, error.message);
    return NextResponse.json({ error: error.message || 'Failed to fetch transcript after multiple attempts' }, { status: 500 });
  }
}
