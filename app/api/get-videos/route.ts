import { NextResponse } from 'next/server';
import ytpl from 'ytpl';

export async function POST(req: Request) {
  try {
    const { channelUrl } = await req.json();

    if (!channelUrl) {
      return NextResponse.json({ error: 'Channel URL is required' }, { status: 400 });
    }

    let playlistId = channelUrl;

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
        
        let channelId = null;
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            channelId = match[1];
            break;
          }
        }

        if (channelId) {
          // Convert Channel ID (UC...) to Uploads Playlist ID (UU...)
          playlistId = channelId.replace(/^UC/, 'UU');
        } else {
          try {
            // Fallback to ytpl's own resolution if regex fails
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
        playlistId = match[1].replace(/^UC/, 'UU');
      }
    }

    // Fetch the playlist items (Uploads playlist contains all channel videos)
    // We limit to Infinity to get all videos, but ytpl batches them.
    // Note: For massive channels, this might take a few seconds.
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
