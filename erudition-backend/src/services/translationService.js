// Translation Service
// Handles DeepL API integration with caching

import prisma from '../config/database.js';

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_URL = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';

// Language code mapping
const LANGUAGE_MAP = {
  'en': 'EN',
  'zh-TW': 'ZH',
  'zh': 'ZH'
};

/**
 * Translate text using DeepL API
 */
export const translateText = async (text, sourceLang, targetLang) => {
  // Skip if same language
  if (sourceLang === targetLang) {
    return text;
  }

  // Skip if empty
  if (!text || text.trim() === '') {
    return text;
  }

  // Check cache first
  const cached = await getFromCache(text, sourceLang, targetLang);
  if (cached) {
    return cached;
  }

  // Call DeepL API
  try {
    const response = await fetch(DEEPL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: [text],
        source_lang: LANGUAGE_MAP[sourceLang] || sourceLang.toUpperCase(),
        target_lang: LANGUAGE_MAP[targetLang] || targetLang.toUpperCase()
      })
    });

    if (!response.ok) {
      console.error('DeepL API error:', await response.text());
      // Return original text if translation fails
      return text;
    }

    const data = await response.json();
    const translatedText = data.translations[0].text;

    // Cache the result
    await saveToCache(text, sourceLang, targetLang, translatedText);

    return translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    return text; // Return original on error
  }
};

/**
 * Batch translate multiple texts
 */
export const translateBatch = async (texts, sourceLang, targetLang) => {
  if (sourceLang === targetLang) {
    return texts;
  }

  const results = [];
  const uncachedTexts = [];
  const uncachedIndices = [];

  // Check cache for each text
  for (let i = 0; i < texts.length; i++) {
    const cached = await getFromCache(texts[i], sourceLang, targetLang);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedTexts.push(texts[i]);
      uncachedIndices.push(i);
    }
  }

  // If all cached, return early
  if (uncachedTexts.length === 0) {
    return results;
  }

  // Call DeepL API for uncached texts
  try {
    const response = await fetch(DEEPL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: uncachedTexts,
        source_lang: LANGUAGE_MAP[sourceLang] || sourceLang.toUpperCase(),
        target_lang: LANGUAGE_MAP[targetLang] || targetLang.toUpperCase()
      })
    });

    if (!response.ok) {
      // Return original texts on error
      uncachedIndices.forEach((idx, i) => {
        results[idx] = texts[idx];
      });
      return results;
    }

    const data = await response.json();
    
    // Map translations back and cache them
    for (let i = 0; i < data.translations.length; i++) {
      const idx = uncachedIndices[i];
      const translatedText = data.translations[i].text;
      results[idx] = translatedText;
      
      // Cache in background
      saveToCache(texts[idx], sourceLang, targetLang, translatedText);
    }

    return results;
  } catch (error) {
    console.error('Batch translation error:', error);
    // Return original texts on error
    uncachedIndices.forEach((idx) => {
      results[idx] = texts[idx];
    });
    return results;
  }
};

/**
 * Detect language of text (simple heuristic)
 */
export const detectLanguage = (text) => {
  // Check for Chinese characters
  const chineseRegex = /[\u4e00-\u9fff]/;
  if (chineseRegex.test(text)) {
    return 'zh-TW';
  }
  
  // Default to English
  return 'en';
};

/**
 * Get translation from cache
 */
const getFromCache = async (text, sourceLang, targetLang) => {
  try {
    const cached = await prisma.translationCache.findUnique({
      where: {
        sourceText_sourceLang_targetLang: {
          sourceText: text,
          sourceLang: sourceLang,
          targetLang: targetLang
        }
      }
    });

    if (cached) {
      // Update usage count in background
      prisma.translationCache.update({
        where: { id: cached.id },
        data: { usageCount: { increment: 1 } }
      }).catch(() => {}); // Ignore errors

      return cached.translatedText;
    }

    return null;
  } catch (error) {
    console.error('Cache read error:', error);
    return null;
  }
};

/**
 * Save translation to cache
 */
const saveToCache = async (sourceText, sourceLang, targetLang, translatedText) => {
  try {
    await prisma.translationCache.upsert({
      where: {
        sourceText_sourceLang_targetLang: {
          sourceText: sourceText,
          sourceLang: sourceLang,
          targetLang: targetLang
        }
      },
      update: {
        translatedText: translatedText,
        usageCount: { increment: 1 }
      },
      create: {
        sourceText: sourceText,
        sourceLang: sourceLang,
        targetLang: targetLang,
        translatedText: translatedText,
        engine: 'deepl'
      }
    });
  } catch (error) {
    console.error('Cache write error:', error);
  }
};

/**
 * Clear old cache entries
 */
export const cleanupCache = async (maxAgeDays = 30) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  try {
    const result = await prisma.translationCache.deleteMany({
      where: {
        updatedAt: { lt: cutoffDate },
        usageCount: { lt: 5 } // Only delete rarely used
      }
    });

    return result.count;
  } catch (error) {
    console.error('Cache cleanup error:', error);
    return 0;
  }
};

export default {
  translateText,
  translateBatch,
  detectLanguage,
  cleanupCache
};
