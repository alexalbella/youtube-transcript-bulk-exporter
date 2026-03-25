'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Download, Play, Loader2, AlertCircle, CheckCircle2, FileText, Youtube, Settings } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

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

interface TranscriptResult {
  video: Video;
  text: string;
  isAIGenerated: boolean;
  error?: string;
}

export default function Home() {
  const [channelUrl, setChannelUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<TranscriptResult[]>([]);
  
  // New options
  const [exportFormat, setExportFormat] = useState<'txt' | 'json' | 'ndjson' | 'zip'>('txt');
  const [preferredLanguage, setPreferredLanguage] = useState<'es' | 'en' | 'auto'>('auto');
  
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
    setResults([]);
    setProgress({ current: 0, total: 0 });

    try {
      addLog(`Analizando canal: ${channelUrl}`, 'info');
      
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

      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const currentResults: TranscriptResult[] = [];

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
              body: JSON.stringify({ videoUrl: video.url, preferredLanguage })
            });

            const transcriptData = await transcriptRes.json();

            if (!transcriptRes.ok) {
              throw new Error(transcriptData.error || 'Error desconocido');
            }

            currentResults.push({
              video,
              text: transcriptData.text,
              isAIGenerated: transcriptData.isAIGenerated || false
            });

            if (transcriptData.isAIGenerated) {
              addLog(`✓ Transcripción generada por IA para el video ${i + 1} ✨`, 'success');
            } else {
              addLog(`✓ Transcripción obtenida para el video ${i + 1}`, 'success');
            }
            success = true;
            
            const waitTime = Math.floor(Math.random() * 3000) + 2000;
            if (i < videos.length - 1) {
              await delay(waitTime);
            }

          } catch (err: any) {
            retries++;
            const isRateLimit = err.message.includes('too many requests') || err.message.includes('captcha');
            
            if (isRateLimit && retries < maxRetries) {
              const backoffTime = retries * 10000;
              addLog(`⚠️ Rate Limit. Esperando ${backoffTime/1000}s... (Intento ${retries}/${maxRetries})`, 'warning');
              await delay(backoffTime);
            } else {
              addLog(`✗ Error en video ${i + 1} (${video.url}): ${err.message}`, 'error');
              currentResults.push({
                video,
                text: '',
                isAIGenerated: false,
                error: err.message
              });
              break;
            }
          }
        }

        setProgress({ current: i + 1, total: videos.length });
        setResults([...currentResults]); // Update state progressively
      }

      addLog('¡Proceso completado! El archivo está listo para descargar.', 'success');

    } catch (error: any) {
      addLog(`Error crítico: ${error.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (results.length === 0) return;
    
    const timestamp = new Date().getTime();
    const baseFilename = `transcripciones_${timestamp}`;

    if (exportFormat === 'txt') {
      let combinedText = `=== TRANSCRIPCIONES ===\nGenerado el: ${new Date().toLocaleString()}\n========================================================\n\n`;
      results.forEach((res, i) => {
        combinedText += `--- VIDEO ${i + 1} ---\n`;
        combinedText += `Título: ${res.video.title}\n`;
        combinedText += `URL: ${res.video.url}\n`;
        if (res.error) {
          combinedText += `[ERROR: ${res.error}]\n\n`;
        } else {
          if (res.isAIGenerated) combinedText += `[NOTA: Transcripción generada por IA]\n`;
          combinedText += `Transcripción:\n${res.text}\n\n`;
        }
        combinedText += `--------------------------------------------------------\n\n`;
      });
      const blob = new Blob([combinedText], { type: 'text/plain;charset=utf-8' });
      saveAs(blob, `${baseFilename}.txt`);
    } 
    else if (exportFormat === 'json') {
      const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json;charset=utf-8' });
      saveAs(blob, `${baseFilename}.json`);
    }
    else if (exportFormat === 'ndjson') {
      const ndjson = results.map(r => JSON.stringify(r)).join('\n');
      const blob = new Blob([ndjson], { type: 'application/x-ndjson;charset=utf-8' });
      saveAs(blob, `${baseFilename}.ndjson`);
    }
    else if (exportFormat === 'zip') {
      const zip = new JSZip();
      results.forEach((res, i) => {
        const safeTitle = res.video.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `${String(i + 1).padStart(3, '0')}_${safeTitle}.txt`;
        
        let content = `Título: ${res.video.title}\nURL: ${res.video.url}\n\n`;
        if (res.error) {
          content += `ERROR: ${res.error}`;
        } else {
          if (res.isAIGenerated) content += `[Generado por IA]\n\n`;
          content += res.text;
        }
        zip.file(filename, content);
      });
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${baseFilename}.zip`);
    }
  };

  // Summary stats
  const totalVideos = results.length;
  const okVideos = results.filter(r => !r.error).length;
  const failedVideos = results.filter(r => r.error).length;
  const aiGenerated = results.filter(r => r.isAIGenerated).length;
  // Cost estimation: Gemini 3.1 Flash is ~$0.075 per 1M tokens. 
  // Let's assume ~150 tokens per minute of audio, but we don't have duration.
  // We'll just do a very rough estimate based on text length (1 token ~ 4 chars).
  const totalAIChars = results.filter(r => r.isAIGenerated).reduce((acc, r) => acc + r.text.length, 0);
  const estimatedTokens = Math.ceil(totalAIChars / 4);
  const estimatedCost = (estimatedTokens / 1000000) * 0.075;

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
            Extrae automáticamente las transcripciones de todos los videos de un canal.
          </p>
        </header>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-sm border border-zinc-200 overflow-hidden mb-8">
          <div className="p-8 border-b border-zinc-100">
            <div className="mb-6">
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
            </div>

            {/* Options */}
            <div className="flex flex-col sm:flex-row gap-6 p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Settings size={14} /> Idioma Preferido
                </label>
                <select 
                  value={preferredLanguage} 
                  onChange={(e) => setPreferredLanguage(e.target.value as any)}
                  disabled={isProcessing}
                  className="w-full bg-white border border-zinc-300 text-zinc-700 text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block p-2.5 outline-none"
                >
                  <option value="auto">Automático (Original)</option>
                  <option value="es">Español</option>
                  <option value="en">Inglés</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <FileText size={14} /> Formato de Exportación
                </label>
                <select 
                  value={exportFormat} 
                  onChange={(e) => setExportFormat(e.target.value as any)}
                  className="w-full bg-white border border-zinc-300 text-zinc-700 text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block p-2.5 outline-none"
                >
                  <option value="txt">Texto Plano (.txt)</option>
                  <option value="json">JSON (.json)</option>
                  <option value="ndjson">NDJSON (.ndjson)</option>
                  <option value="zip">Archivo ZIP (1 txt por video)</option>
                </select>
              </div>
            </div>
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
            </div>
          )}
        </div>

        {/* Summary & Download Section */}
        {results.length > 0 && !isProcessing && (
          <div className="bg-white rounded-3xl shadow-sm border border-zinc-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-8">
              <h2 className="text-2xl font-bold text-zinc-900 mb-6">Resumen del Proceso</h2>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-1">Total</p>
                  <p className="text-3xl font-bold text-zinc-900">{totalVideos}</p>
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                  <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wider mb-1">Éxito</p>
                  <p className="text-3xl font-bold text-emerald-700">{okVideos}</p>
                </div>
                <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100">
                  <p className="text-xs text-rose-600 font-semibold uppercase tracking-wider mb-1">Fallidos</p>
                  <p className="text-3xl font-bold text-rose-700">{failedVideos}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-2xl border border-purple-100">
                  <p className="text-xs text-purple-600 font-semibold uppercase tracking-wider mb-1">Por IA</p>
                  <p className="text-3xl font-bold text-purple-700">{aiGenerated}</p>
                </div>
              </div>

              {aiGenerated > 0 && (
                <div className="mb-8 p-4 bg-amber-50 rounded-2xl border border-amber-100 text-amber-800 text-sm">
                  <strong>Coste estimado de IA (Gemini):</strong> ~${estimatedCost.toFixed(4)} USD 
                  <span className="text-amber-600/80 ml-2">(Basado en ~{estimatedTokens.toLocaleString()} tokens de texto generado)</span>
                </div>
              )}

              <div className="flex justify-center">
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center justify-center px-8 py-4 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 focus:ring-4 focus:ring-zinc-200 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                >
                  <Download className="mr-2" size={24} />
                  Descargar Resultados (.{exportFormat})
                </button>
              </div>
            </div>
          </div>
        )}
        
      </main>
    </div>
  );
}
