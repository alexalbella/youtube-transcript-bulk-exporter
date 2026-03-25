import { NextResponse } from 'next/server';
import ytpl from 'ytpl';

export async function POST(req: Request) {
  try {
    const { channelUrl } = await req.json();

    if (!channelUrl) {
      return NextResponse.json({ error: 'Channel URL is required' }, { status: 400 });
    }

    let playlistId = channelUrl;
    let channelId = null;

    // If it's a handle or custom URL, we need to fetch the page to find the actual Channel ID
    if (channelUrl.includes('@') || channelUrl.includes('/c/') || channelUrl.includes('/user/')) {
      try {
        const response = await fetch(channelUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
          }
        });
        const html = await response.text();
        
        const patterns = [
          /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[^"]+)"/,
          /<meta itemprop="identifier" content="(UC[^"]+)"/,
          /"browseId":"(UC[^"]+)"/,
          /"channelId":"(UC[^"]+)"/
        ];
        
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            channelId = match[1];
            break;
          }
        }

        if (channelId) {
          playlistId = channelId.replace(/^UC/, 'UU');
        } else {
          try {
            playlistId = await ytpl.getPlaylistID(channelUrl);
          } catch (ytplErr) {
            return NextResponse.json({ error: 'Could not resolve channel ID from URL. Make sure the URL is correct.' }, { status: 400 });
          }
        }
      } catch (err) {
        return NextResponse.json({ error: 'Failed to fetch channel page to resolve ID.' }, { status: 500 });
      }
    } else if (channelUrl.includes('/channel/UC')) {
      const match = channelUrl.match(/channel\/(UC[^/?]+)/);
      if (match && match[1]) {
        channelId = match[1];
        playlistId = match[1].replace(/^UC/, 'UU');
      }
    }

    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

    // Strategy 1: YouTube Data API (Preferred)
    if (YOUTUBE_API_KEY && playlistId) {
      try {
        console.log(`[YouTube API] Fetching playlist ${playlistId}`);
        let videos: any[] = [];
        let nextPageToken = '';
        let channelTitle = 'Canal';

        do {
          const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`);
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error?.message || 'YouTube API error');
          }

          if (data.items && data.items.length > 0) {
            channelTitle = data.items[0].snippet.channelTitle;
            const pageVideos = data.items.map((item: any) => ({
              title: item.snippet.title,
              url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
              id: item.snippet.resourceId.videoId
            }));
            videos = [...videos, ...pageVideos];
          }

          nextPageToken = data.nextPageToken;
        } while (nextPageToken);

        if (videos.length > 0) {
          return NextResponse.json({ channelTitle, videos });
        }
      } catch (apiError: any) {
        console.warn('[YouTube API] Failed, falling back to ytpl:', apiError.message);
      }
    }

    // Strategy 2: Fallback to ytpl (Scraping)
    console.log(`[ytpl Fallback] Fetching playlist ${playlistId}`);
    const playlist = await ytpl(playlistId, { 
      limit: Infinity,
      requestOptions: {
        headers: {
          'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478'
        }
      }
    });
    
    const videos = playlist.items.map(item => ({
      title: item.title,
      url: item.shortUrl,
      id: item.id
    }));

    return NextResponse.json({ 
      channelTitle: playlist.author.name,
      videos 
    });

  } catch (error: any) {
    console.error('Error fetching channel videos:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch videos' }, { status: 500 });
  }
}
