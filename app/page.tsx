'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Download, Play, Loader2, AlertCircle, CheckCircle2, FileText, Youtube } from 'lucide-react';

interface Video {
  title: string;
  url: string;
  id: string;
}

interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: Date;
}

export default function Home() {
  const [channelUrl, setChannelUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [finalText, setFinalText] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { id: Math.random().toString(36).substring(7), message, type, timestamp: new Date() }]);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleStart = async () => {
    if (!channelUrl.trim()) {
      addLog('Por favor, introduce una URL válida.', 'error');
      return;
    }

    setIsProcessing(true);
    setLogs([]);
    setFinalText(null);
    setProgress({ current: 0, total: 0 });

    try {
      addLog(`Analizando canal: ${channelUrl}`, 'info');
      
      // 1. Fetch all videos from the channel
      const videosRes = await fetch('/api/get-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelUrl })
      });

      const videosData = await videosRes.json();

      if (!videosRes.ok) {
        throw new Error(videosData.error || 'Error al obtener los videos del canal');
      }

      const videos: Video[] = videosData.videos;
      const channelTitle = videosData.channelTitle || 'Canal';
      
      if (!videos || videos.length === 0) {
        throw new Error('No se encontraron videos en este canal.');
      }

      addLog(`¡Éxito! Se encontraron ${videos.length} videos en "${channelTitle}".`, 'success');
      setProgress({ current: 0, total: videos.length });

      let combinedText = `=== TRANSCRIPCIONES DEL CANAL: ${channelTitle} ===\n`;
      combinedText += `URL del Canal: ${channelUrl}\n`;
      combinedText += `Total de videos: ${videos.length}\n`;
      combinedText += `Generado el: ${new Date().toLocaleString()}\n\n`;
      combinedText += `========================================================\n\n`;

      // Helper function to add a delay
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // 2. Fetch transcript for each video sequentially to avoid rate limits/timeouts
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        addLog(`[${i + 1}/${videos.length}] Obteniendo: ${video.title}`, 'info');
        
        let success = false;
        let retries = 0;
        const maxRetries = 3;

        while (!success && retries < maxRetries) {
          try {
            const transcriptRes = await fetch('/api/get-transcript', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoUrl: video.url })
            });

            const transcriptData = await transcriptRes.json();

            if (!transcriptRes.ok) {
              throw new Error(transcriptData.error || 'Error desconocido');
            }

            combinedText += `--- VIDEO ${i + 1} ---\n`;
            combinedText += `Título: ${video.title}\n`;
            combinedText += `URL: ${video.url}\n`;
            combinedText += `Transcripción:\n${transcriptData.text}\n\n`;
            combinedText += `--------------------------------------------------------\n\n`;

            addLog(`✓ Transcripción obtenida para el video ${i + 1}`, 'success');
            success = true;
            
            // Add a random delay between 2 and 5 seconds to avoid rate limiting
            const waitTime = Math.floor(Math.random() * 3000) + 2000;
            if (i < videos.length - 1) {
              await delay(waitTime);
            }

          } catch (err: any) {
            retries++;
            const isRateLimit = err.message.includes('too many requests') || err.message.includes('captcha');
            
            if (isRateLimit && retries < maxRetries) {
              const backoffTime = retries * 10000; // 10s, 20s, 30s
              addLog(`⚠️ YouTube ha bloqueado temporalmente la IP (Rate Limit). Esperando ${backoffTime/1000}s antes de reintentar... (Intento ${retries}/${maxRetries})`, 'warning');
              await delay(backoffTime);
            } else {
              addLog(`✗ Error en video ${i + 1} (${video.url}): ${err.message}`, 'error');
              combinedText += `--- VIDEO ${i + 1} ---\n`;
              combinedText += `Título: ${video.title}\n`;
              combinedText += `URL: ${video.url}\n`;
              combinedText += `[ERROR: No se pudo obtener la transcripción. ${err.message}]\n\n`;
              combinedText += `--------------------------------------------------------\n\n`;
              break; // Break the retry loop on non-rate-limit errors or max retries
            }
          }
        }

        setProgress({ current: i + 1, total: videos.length });
      }

      setFinalText(combinedText);
      addLog('¡Proceso completado! El archivo está listo para descargar.', 'success');

    } catch (error: any) {
      addLog(`Error crítico: ${error.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!finalText) return;
    
    const blob = new Blob([finalText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripciones_youtube_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-red-200">
      <main className="max-w-4xl mx-auto p-6 py-12">
        {/* Header */}
        <header className="mb-10 text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-red-100 text-red-600 rounded-2xl mb-2">
            <Youtube size={32} strokeWidth={1.5} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900">
            YouTube Channel Scraper
          </h1>
          <p className="text-zinc-500 max-w-xl mx-auto text-lg">
            Extrae automáticamente las transcripciones de todos los videos de un canal y descárgalas en un único archivo de texto.
          </p>
        </header>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="p-8 border-b border-zinc-100">
            <label htmlFor="channel-url" className="block text-sm font-medium text-zinc-700 mb-2">
              URL del Canal de YouTube
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                id="channel-url"
                type="url"
                placeholder="Ej: https://www.youtube.com/@midudev"
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 rounded-xl border border-zinc-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500"
              />
              <button
                onClick={handleStart}
                disabled={isProcessing || !channelUrl}
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 focus:ring-4 focus:ring-red-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={20} />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Play className="mr-2" size={20} />
                    Iniciar Scraping
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-3">
              Soporta URLs con @handle, /c/nombre, o /channel/UC...
            </p>
          </div>

          {/* Progress Section */}
          {(isProcessing || logs.length > 0) && (
            <div className="p-8 bg-zinc-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">
                  Registro de Actividad
                </h3>
                {progress.total > 0 && (
                  <span className="text-sm font-medium text-zinc-600 bg-zinc-200 px-3 py-1 rounded-full">
                    {progress.current} / {progress.total} videos
                  </span>
                )}
              </div>

              {/* Progress Bar */}
              {progress.total > 0 && (
                <div className="w-full bg-zinc-200 rounded-full h-2.5 mb-6 overflow-hidden">
                  <div 
                    className="bg-red-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  ></div>
                </div>
              )}

              {/* Terminal Logs */}
              <div className="bg-zinc-900 rounded-xl p-4 h-64 overflow-y-auto font-mono text-sm shadow-inner">
                {logs.length === 0 ? (
                  <p className="text-zinc-500 italic">Esperando para iniciar...</p>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2">
                        <span className="text-zinc-500 shrink-0">
                          [{log.timestamp.toLocaleTimeString()}]
                        </span>
                        <span className={`
                          ${log.type === 'info' ? 'text-blue-400' : ''}
                          ${log.type === 'success' ? 'text-emerald-400' : ''}
                          ${log.type === 'error' ? 'text-rose-400' : ''}
                          ${log.type === 'warning' ? 'text-amber-400' : ''}
                        `}>
                          {log.message}
                        </span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>

              {/* Download Action */}
              {finalText && !isProcessing && (
                <div className="mt-6 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <button
                    onClick={handleDownload}
                    className="inline-flex items-center justify-center px-8 py-4 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 focus:ring-4 focus:ring-zinc-200 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                  >
                    <Download className="mr-2" size={24} />
                    Descargar Transcripciones (.txt)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Info Note */}
        <div className="mt-8 flex items-start gap-3 p-4 bg-blue-50 text-blue-800 rounded-2xl text-sm">
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <p>
            <strong>Nota importante:</strong> El proceso puede tardar varios minutos dependiendo de la cantidad de videos del canal. 
            Algunos videos pueden no tener transcripción disponible (por ejemplo, si el creador las ha desactivado o si son videos musicales sin letra). 
            Estos videos se indicarán con un error en el archivo final, pero el proceso continuará con el resto.
          </p>
        </div>
      </main>
    </div>
  );
}
