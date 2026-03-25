import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export async function POST(req: Request) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
    }

    const transcript = await YoutubeTranscript.fetchTranscript(videoUrl);
    
    // Combine all transcript parts into a single text block
    const text = transcript.map(t => t.text).join(' ');

    return NextResponse.json({ text });

  } catch (error: any) {
    console.error(`Error fetching transcript for ${req.url}:`, error);
    return NextResponse.json({ error: error.message || 'Failed to fetch transcript' }, { status: 500 });
  }
}
