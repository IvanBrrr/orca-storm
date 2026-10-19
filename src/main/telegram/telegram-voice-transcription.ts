import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const Audio = z.object({ chunks: z.array(z.string().max(220_000)).max(61) })

export async function transcribeTelegramVoice(
  runtime: OrcaRuntimeService,
  bytes: Buffer,
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted()
  const audio = await decodeTelegramVoice(bytes, signal)
  const dictationId = `telegram-${randomUUID()}`
  const owner = { dictationId, clientId: 'telegram:owner', connectionId: 'telegram:voice' }
  let started = false
  try {
    await runtime.startMobileDictation(owner)
    started = true
    for (const audioBase64 of audio.chunks) {
      signal.throwIfAborted()
      runtime.feedMobileDictation({ ...owner, audioBase64, sampleRate: 16_000 })
    }
    const result = await runtime.finishMobileDictation(owner)
    return result.text
  } catch {
    throw new Error(
      'Не удалось распознать голосовое. Проверь модель в настройках голоса Storca и дождись завершения другой диктовки.'
    )
  } finally {
    if (started) {
      await runtime.cancelMobileDictation(owner)
    }
  }
}

export async function decodeTelegramVoice(bytes: Buffer, signal: AbortSignal) {
  const decoder = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false
    }
  })
  decoder.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  decoder.webContents.on('will-navigate', (event) => event.preventDefault())
  const abort = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  let rejectAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new Error('Распознавание голосового отменено.'))
    abort.addEventListener('abort', rejectAbort, { once: true })
    if (abort.aborted) {
      rejectAbort()
    }
  })
  try {
    const decode = async () => {
      await decoder.loadURL(
        'data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'
      )
      const result: unknown = await decoder.webContents.executeJavaScript(`(async () => {
        const raw = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0));
        const source = new AudioContext();
        try {
          const decoded = await source.decodeAudioData(raw.buffer);
          if (decoded.duration > 300) throw new Error('audio_too_long');
          const frames = Math.ceil(decoded.duration * 16000);
          if (frames < 1 || frames > 4800000) throw new Error('invalid_audio');
          const offline = new OfflineAudioContext(1, frames, 16000);
          const node = offline.createBufferSource();
          node.buffer = decoded; node.connect(offline.destination); node.start();
          const samples = (await offline.startRendering()).getChannelData(0);
          const chunks = [];
          for (let start = 0; start < samples.length; start += 80000) {
            const count = Math.min(80000, samples.length - start);
            const pcm = new Uint8Array(count * 2);
            const view = new DataView(pcm.buffer);
            for (let i = 0; i < count; i++) {
              const sample = Math.max(-1, Math.min(1, samples[start + i]));
              view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
            }
            let binary = '';
            for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
            chunks.push(btoa(binary));
          }
          return { chunks };
        } finally { await source.close(); }
      })()`)
      return Audio.parse(result)
    }
    return await Promise.race([decode(), cancelled])
  } finally {
    if (rejectAbort) {
      abort.removeEventListener('abort', rejectAbort)
    }
    if (!decoder.isDestroyed()) {
      decoder.destroy()
    }
  }
}
