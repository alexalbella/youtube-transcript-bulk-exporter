# YouTube Transcript Bulk Exporter

![Hero Image](https://picsum.photos/seed/yt-exporter-hero/1200/400?blur=2)

A powerful, open-source tool built with Next.js to extract, process, and export transcripts from entire YouTube channels in bulk. When native subtitles are disabled or unavailable, it automatically falls back to **Google's Gemini 3.1 Flash AI** to transcribe the audio with high accuracy.

## 🚀 Features

- **Bulk Extraction**: Scrape an entire channel's videos and download all transcripts at once.
- **Multiple Export Formats**: Export as a single `.txt`, structured `.json`, `.ndjson` (for ML training), or a `.zip` file containing individual text files per video.
- **Language Preference**: Prioritize Spanish, English, or auto-detect the original language.
- **Smart Fallbacks**: 
  1. YouTube Native Captions (via `youtube-transcript`).
  2. Piped API (Alternative open-source frontends).
  3. **AI Fallback**: If no subtitles exist, it downloads the audio using `youtube-dl-exec` and transcribes it using the Gemini Files API.
- **Progressive Web App (PWA)**: Installable on desktop and mobile devices.
- **Cost Estimation**: Calculates an estimated cost of the Gemini API usage based on generated tokens.

## 🏗️ Architecture

The application is built on **Next.js 15 (App Router)** and uses **Tailwind CSS** for styling.

1. **Discovery (`/api/get-videos`)**: Resolves the channel URL (handles `@handles` and custom URLs) and fetches the video list using the official **YouTube Data API v3**. If the API key is missing or quota is exceeded, it falls back to scraping via `ytpl`.
2. **Extraction (`/api/get-transcript`)**: Processes each video sequentially to avoid rate limits. It attempts multiple strategies to find native captions.
3. **AI Transcription**: If native captions are missing, it uses `youtube-dl-exec` to extract an `mp3` to the local `/tmp` directory, uploads it to the **Gemini Files API**, prompts `gemini-3.1-flash-preview` for a raw transcription, and deletes the file from Google's servers.

## ⚠️ Known Limitations

- **Rate Limits (IP Bans)**: YouTube aggressively rate-limits bulk scraping. The app includes exponential backoff and random delays (2-5s) between requests, but scraping channels with 500+ videos from a single IP might still trigger temporary blocks or CAPTCHAs.
- **Long Videos & Livestreams**: The AI fallback downloads the entire audio file. Extremely long videos (e.g., 4-hour podcasts) might exceed the `/tmp` storage capacity of serverless environments (like Vercel or Cloud Run) or hit timeout limits (usually 10-60 seconds depending on the host).
- **Subtitles Disabled**: If a creator explicitly disables embedding and subtitles, the native extraction will fail, forcing the AI fallback.
- **Huge Channels**: Processing channels with thousands of videos can take a long time and should ideally be run locally rather than on a serverless edge function to avoid timeouts.

## 💰 Gemini API Costs

The AI fallback uses **Gemini 3.1 Flash Preview**. 
- **Cost**: ~$0.075 per 1 million tokens (input/output combined).
- **Estimation**: The app provides a rough cost estimate at the end of the process based on the character count of the generated text (assuming ~4 characters per token).
- **Free Tier**: Google AI Studio offers a generous free tier, but be aware of rate limits (RPM/TPM) if processing many videos simultaneously.

## ⚙️ Environment Variables

To run this project, you need to set up the following environment variables in your `.env.local` file:

```env
# Required for the AI Fallback transcription
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here

# Optional but highly recommended for reliable video discovery
YOUTUBE_API_KEY=your_youtube_data_api_key_here
```

## 🛠️ Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/youtube-transcript-bulk-exporter.git
   cd youtube-transcript-bulk-exporter
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your `.env.local` file with your API keys.

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🗺️ Roadmap

- [ ] Add support for downloading specific playlists instead of the whole channel.
- [ ] Implement WebSockets or Server-Sent Events (SSE) for real-time progress updates without polling.
- [ ] Add support for Whisper (OpenAI) or Groq as alternative AI fallbacks.
- [ ] Implement a queue system (e.g., BullMQ) for background processing of massive channels.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
