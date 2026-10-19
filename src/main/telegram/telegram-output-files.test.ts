import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readTelegramOutputFiles } from './telegram-output-files'
import { telegramTestFixture, telegramTestItem } from './telegram-test-fixture'

it('sends linked artifacts but refuses parent paths and symlinks outside the execution workspace', async () => {
  const h = await telegramTestFixture()
  const workspace = join(h.root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'report.pdf'), 'report bytes')
  await writeFile(join(h.root, 'private.txt'), 'private')
  await symlink(join(h.root, 'private.txt'), join(workspace, 'linked.txt'))
  const item = telegramTestItem({
    kind: 'message',
    role: 'assistant',
    blocks: [
      {
        type: 'text',
        text: '[report](report.pdf) [parent](../private.txt) [symlink](linked.txt) [remote](https://example.com/file.pdf)'
      }
    ]
  })
  const files = await readTelegramOutputFiles([item], workspace)
  expect(files.map((file) => file.name)).toEqual(['report.pdf'])
  expect(files[0]?.bytes.toString()).toBe('report bytes')
})
