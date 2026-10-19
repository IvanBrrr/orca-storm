import type { TelegramSession, TelegramUserMessage } from './telegram-session-port'
import type { TelegramMessage } from './telegram-bot-schema'
import { TELEGRAM_MAX_DOWNLOAD_BYTES } from './telegram-bot-client'
import type { TelegramSessionContext } from './telegram-session-context'

export function telegramSendReceiptText(
  session: TelegramSession | undefined,
  queued: boolean
): string {
  if (session?.source === 'terminal' && queued) {
    return 'Ввод принят терминалом. Начало хода пока не подтверждено.'
  }
  return queued ? 'Сообщение в очереди.' : 'Сообщение принято Storca.'
}

export async function telegramMessageBody(
  ctx: TelegramSessionContext,
  sessionId: string,
  message: TelegramMessage
): Promise<{ body: TelegramUserMessage; confirm: boolean }> {
  const blocks: TelegramUserMessage['blocks'] = []
  const text = message.text ?? message.caption
  if (text) {
    blocks.push({ type: 'text', text })
  }
  const file = message.voice ?? message.document ?? message.photo?.at(-1)
  if (file) {
    if ((file.file_size ?? 0) > TELEGRAM_MAX_DOWNLOAD_BYTES) {
      throw new Error('Файл превышает 20 МБ.')
    }
    if (message.voice && message.voice.duration > 300) {
      throw new Error('Голосовое должно быть короче пяти минут.')
    }
    const bytes = await ctx.client.download(file.file_id, ctx.signal)
    if (message.voice) {
      const transcript = await ctx.port.transcribe(bytes, ctx.signal)
      if (!transcript.trim()) {
        throw new Error('Не удалось распознать речь. Попробуй отправить текст.')
      }
      blocks.push({ type: 'text', text: transcript })
      return { body: { kind: 'message', role: 'user', blocks }, confirm: true }
    }
    const name = file.file_name ?? (message.photo ? 'photo.jpg' : 'attachment')
    const path = await ctx.port.upload(sessionId, name, bytes)
    if (message.photo || file.mime_type?.startsWith('image/')) {
      blocks.push({ type: 'image-ref', path, alt: name })
    } else {
      blocks.push({
        type: 'text',
        text: `Прикреплён файл ${JSON.stringify(name)}. Путь на хосте сессии: ${JSON.stringify(path)}`
      })
    }
  }
  if (!blocks.length) {
    throw new Error('Поддерживаются текст, фотографии, файлы и голосовые сообщения.')
  }
  return { body: { kind: 'message', role: 'user', blocks }, confirm: false }
}

export async function confirmTelegramDraft(
  ctx: TelegramSessionContext,
  threadId: number,
  key: string,
  label: string
): Promise<void> {
  const stored = ctx.state.data.actions[key]
  if (!stored || stored.action.kind !== 'draft') {
    throw new Error('Черновик недоступен.')
  }
  const preview = stored.action.body.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const cancel = ctx.state.action({ kind: 'discard', target: key }, threadId, `cancel:${key}`)
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Отправить', callback_data: key },
        { text: 'Отменить', callback_data: cancel }
      ]
    ]
  }
  await ctx.state.save()
  await ctx.text(threadId, `${label}\n\n${preview}`, keyboard)
}
