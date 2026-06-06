/**
 * Web / Firecrawl Tool Handlers
 *
 * Handles: web_search, deep_scrape
 */

import { dbGet } from '../../database/connection.js';
import { aiLogger } from '../../utils/logger.js';
import { getSecret } from '../secrets/getSecret.js';

// Lazy-loaded Firecrawl client
let firecrawlApp = null;

/**
 * Get Firecrawl API key from database
 */
async function getFirecrawlApiKey(spaceId = null) {
  // Try space-specific key first, then global
  let keyRow = null;
  if (spaceId) {
    keyRow = await dbGet(`
      SELECT api_key FROM ai_api_keys
      WHERE provider = 'firecrawl' AND is_active = 1 AND space_id = ?
      LIMIT 1
    `, [spaceId]);
  }
  if (!keyRow) {
    keyRow = await dbGet(`
      SELECT api_key FROM ai_api_keys
      WHERE provider = 'firecrawl' AND is_active = 1 AND space_id IS NULL
      LIMIT 1
    `);
  }
  // ADR-0040: vault first, env fallback during transition.
  return keyRow?.api_key || (await getSecret('firecrawl_api_key', 'FIRECRAWL_API_KEY'));
}

/**
 * Initialize Firecrawl client lazily
 */
async function getFirecrawlClient(spaceId = null) {
  const apiKey = await getFirecrawlApiKey(spaceId);
  if (!apiKey) {
    throw new Error('Firecrawl API key not configured. Add it in AI Agents → API Keys.');
  }

  // Dynamic import to avoid issues if package not installed
  if (!firecrawlApp) {
    try {
      const { default: FirecrawlApp } = await import('@mendable/firecrawl-js');
      firecrawlApp = new FirecrawlApp({ apiKey });
    } catch (err) {
      throw new Error('Firecrawl package not installed. Run: npm install @mendable/firecrawl-js');
    }
  }
  return firecrawlApp;
}

/**
 * Web tool handlers
 */
export const webToolHandlers = {
  async web_search({ query, limit = 5, scrape_content = false, time_filter }, userId, context = {}) {
    try {
      const firecrawl = await getFirecrawlClient(context.spaceId);

      const searchOptions = {
        limit: Math.min(limit, 10),
        scrapeOptions: scrape_content ? { formats: ['markdown'] } : { formats: [] }
      };

      if (time_filter) {
        searchOptions.tbs = time_filter;
      }

      aiLogger.info({ query, options: searchOptions }, 'Executing web_search');

      const results = await firecrawl.search(query, searchOptions);

      if (!results?.data || results.data.length === 0) {
        return {
          success: true,
          query,
          results: [],
          message: 'No results found for this query.'
        };
      }

      const formattedResults = results.data.map((item, index) => ({
        index: index + 1,
        title: item.title || 'Untitled',
        url: item.url,
        description: item.description || '',
        ...(scrape_content && item.markdown ? { content: item.markdown.substring(0, 5000) } : {})
      }));

      return {
        success: true,
        query,
        results_count: formattedResults.length,
        results: formattedResults
      };
    } catch (error) {
      aiLogger.error({ err: error, query }, 'web_search error');
      return {
        error: error.message,
        hint: error.message.includes('API key')
          ? 'Add Firecrawl API key in AI Agents → API Keys (provider: firecrawl)'
          : 'Check Firecrawl service status'
      };
    }
  },

  async deep_scrape({ url, include_links = false }, userId, context = {}) {
    try {
      const firecrawl = await getFirecrawlClient(context.spaceId);

      aiLogger.info({ url, include_links }, 'Executing deep_scrape');

      const result = await firecrawl.scrapeUrl(url, {
        formats: ['markdown']
      });

      if (!result?.success && !result?.markdown) {
        return {
          error: 'Failed to scrape URL',
          url,
          status: result?.statusCode || 'unknown'
        };
      }

      const content = result.markdown || result.data?.markdown || '';
      const metadata = result.metadata || result.data?.metadata || {};

      const response = {
        success: true,
        url,
        title: metadata.title || 'Unknown',
        description: metadata.description || '',
        content: content.substring(0, 15000), // Limit content size
        content_length: content.length
      };

      if (include_links && (result.links || result.data?.links)) {
        response.links = (result.links || result.data?.links || []).slice(0, 20);
      }

      return response;
    } catch (error) {
      aiLogger.error({ err: error, url }, 'deep_scrape error');
      return {
        error: error.message,
        url,
        hint: 'URL may be blocked, require authentication, or be unavailable'
      };
    }
  }
};
