import { open, realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import { TELEGRAM_MAX_DOWNLOAD_BYTES } from './telegram-bot-client'

const EXPORT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.pdf',
  '.docx',
  '.xlsx',
  '.csv',
  '.pptx',
  '.zip',
  '.html',
  '.txt',
  '.md'
])

export async function readTelegramOutputFiles(
  items: AgentJournalRenderItem[],
  workspace: string
): Promise<{ name: string; bytes: Buffer }[]> {
  const root = await realpath(workspace)
  const paths = new Set<string>()
  for (const item of items) {
    if (item.body.kind !== 'message' || item.body.role !== 'assistant') {
      continue
    }
    for (const block of item.body.blocks) {
      if (block.type === 'image-ref' && block.path) {
        paths.add(block.path)
      }
      if (block.type !== 'text') {
        continue
      }
      for (const match of block.text.matchAll(/\[[^\]\n]*\]\(<?([^\s)>]+)>?\)/g)) {
        if (match[1]) {
          paths.add(match[1])
        }
      }
    }
  }
  const results: { name: string; bytes: Buffer }[] = []
  for (const candidate of paths) {
    if (results.length >= 8) {
      break
    }
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      const decoded = candidate.startsWith('file:')
        ? fileURLToPath(candidate)
        : decodeURIComponent(candidate)
      if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !isAbsolute(decoded)) {
        continue
      }
      const path = await realpath(resolve(root, decoded))
      const within = relative(root, path)
      if (
        within.startsWith('..') ||
        isAbsolute(within) ||
        !EXPORT_EXTENSIONS.has(extname(path).toLowerCase())
      ) {
        continue
      }
      file = await open(path, 'r')
      const info = await file.stat()
      if (!info.isFile() || info.size > TELEGRAM_MAX_DOWNLOAD_BYTES) {
        continue
      }
      // Bound the read even when an agent grows the file after stat.
      const bytes = Buffer.alloc(Math.min(info.size + 1, TELEGRAM_MAX_DOWNLOAD_BYTES + 1))
      let length = 0
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length)
        if (!bytesRead) {
          break
        }
        length += bytesRead
      }
      if (length <= info.size && length <= TELEGRAM_MAX_DOWNLOAD_BYTES) {
        results.push({ name: basename(path), bytes: bytes.subarray(0, length) })
      }
    } catch {
      /* A removed or inaccessible artifact stays linked in the answer. */
    } finally {
      await file?.close()
    }
  }
  return results
}
