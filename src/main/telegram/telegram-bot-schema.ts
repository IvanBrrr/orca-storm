import { z } from 'zod'

const Id = z.number().int().safe()
export const TelegramBot = z.object({
  id: Id.positive(),
  is_bot: z.literal(true),
  username: z.string().regex(/^[A-Za-z0-9_]+$/),
  has_topics_enabled: z.boolean().optional()
})
export const TelegramFile = z.object({
  file_id: z.string(),
  file_size: z.number().nonnegative().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional()
})
const Chat = z.object({ id: Id, type: z.string() })
export const TelegramMessage = z.object({
  message_id: Id,
  date: z.number(),
  chat: Chat,
  from: z.object({ id: Id, is_bot: z.boolean() }).optional(),
  message_thread_id: Id.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(TelegramFile).optional(),
  document: TelegramFile.optional(),
  voice: TelegramFile.extend({ duration: z.number() }).optional(),
  reply_to_message: z.object({ message_id: Id }).optional()
})
export const TelegramUpdate = z.object({
  update_id: Id.nonnegative(),
  message: TelegramMessage.optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: z.object({ id: Id, is_bot: z.boolean() }),
      message: TelegramMessage.optional(),
      data: z.string().optional()
    })
    .optional()
})
export type TelegramMessage = z.infer<typeof TelegramMessage>
export type TelegramUpdate = z.infer<typeof TelegramUpdate>
export type TelegramFile = z.infer<typeof TelegramFile>
export type TelegramKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] }
export type TelegramReplyMarkup =
  | TelegramKeyboard
  | { force_reply: true; input_field_placeholder?: string }
