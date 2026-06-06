/**
 * Telegram Tool Handlers
 *
 * Handles: send_telegram_message
 * Wraps TelegramService functions for agent/MCP use.
 */

import { sendChannelPost, sendChannelPostEN, sendToTopic, sendGroupMessage, getTopicMap } from '../TelegramService.js';
import { aiLogger } from '../../utils/logger.js';

/**
 * Telegram tool handlers
 */
export const telegramToolHandlers = {
  /**
   * Send a message to a Telegram destination (channel, topic, or group).
   */
  async send_telegram_message({ destination, text, parse_mode = 'Markdown' }) {
    if (!destination) return { error: 'destination is required (e.g. "channel", "group", or a topic key like "news", "notifications")' };
    if (!text) return { error: 'text is required' };

    const options = {};
    if (parse_mode) options.parse_mode = parse_mode;

    try {
      let result;

      if (destination === 'channel') {
        // Post to @godcrm channel (RU)
        result = await sendChannelPost(text, options);
      } else if (destination === 'channel_en') {
        // Post to @god_crm channel (EN)
        result = await sendChannelPostEN(text, options);
      } else if (destination === 'group') {
        // Post to group general topic
        result = await sendGroupMessage(text, options);
      } else {
        // Treat as a topic key
        const topics = getTopicMap();
        if (!topics[destination]) {
          const available = Object.keys(topics).join(', ');
          return { error: `Unknown topic "${destination}". Available: ${available}` };
        }
        result = await sendToTopic(destination, text, options);
      }

      if (!result.success) {
        // Retry without parse_mode if Markdown fails
        if (result.error && parse_mode) {
          aiLogger.warn({ destination, error: result.error }, 'Telegram: Markdown failed, retrying plain');
          result = destination === 'channel'
            ? await sendChannelPost(text, {})
            : destination === 'channel_en'
              ? await sendChannelPostEN(text, {})
              : destination === 'group'
                ? await sendGroupMessage(text, {})
                : await sendToTopic(destination, text, {});
        }
        if (!result.success) {
          return { error: result.error || 'Failed to send message' };
        }
      }

      return {
        success: true,
        message_id: result.messageId,
        destination,
        text_length: text.length
      };
    } catch (err) {
      aiLogger.error({ err, destination }, 'Telegram send_telegram_message error');
      return { error: err.message };
    }
  }
};
