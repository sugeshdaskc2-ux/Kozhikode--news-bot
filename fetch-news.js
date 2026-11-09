'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const translate = require('@vitalets/google-translate-api');

// ============================================
// 1. FIREBASE CONNECTION
// ============================================

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT Secret missing!');
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const API_KEY = process.env.CURRENTS_API_KEY;

// ============================================
// 2. XML PARSER
// ============================================

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true
});

// ============================================
// 3. RSS FEEDS
// ============================================

const RSS_FEEDS = [
  {
    name: 'Mathrubhumi',
    url: 'https://www.mathrubhumi.com/rss/district/kozhikode'
  },
  {
    name: 'Asianet News',
    url: 'https://www.asianetnews.com/rss/malayalam/kerala'
  },
  {
    name: 'Kerala Kaumudi',
    url: 'https://www.keralakaumudi.com/rss/news'
  },
  {
    name: 'Oneindia Malayalam',
    url: 'https://malayalam.oneindia.com/rss/feeds/malayalam-news.xml'
  }
];

// ============================================
// 4. YOUTUBE CHANNELS
// ============================================

const YOUTUBE_CHANNELS = [
  {
    name: 'മനോരമ',
    id: 'UCP0uG-mcMImgKnJz-VjJZmQ'
  },
  {
    name: 'മാതൃഭൂമി',
    id: 'UCwXrBBZnIh2ER4lal6WbAHw'
  },
  {
    name: 'ഏഷ്യാനെറ്റ്',
    id: 'UCf8w5m0YsRa8MHQ5bwSGmbw'
  },
  {
    name: '24 News',
    id: 'UCup3etEdjyF1L3sRbU-rKLw'
  },
  {
    name: 'മറുനാടൻ മലയാളി',
    id: 'UCpp_oKgF30vkhF1WDcX64mg'
  },
  {
    name: 'MediaOne',
    id: 'UC-f7r46JhYv78q5pGrO6ivA'
  },
  {
    name: 'കേരള കൗമുദി',
    id: 'UCY18ujuIEIqOBywA0RfbINQ'
  }
];

// ============================================
// 5. COMMON HELPERS
// ============================================

function cleanText(value) {
  if (!value) return '';

  if (typeof value === 'object') {
    value = value['#text'] || '';
  }

  return String(value)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getText(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    return cleanText(value);
  }

  if (typeof value === 'object') {
    return cleanText(value['#text'] || '');
  }

  return cleanText(value);
}

function getLink(value) {
  if (!value) return '';

  const links = toArray(value);

  // Atom format
  const alternate = links.find(
    link => link?.['@_rel'] === 'alternate'
  );

  const selected = alternate || links[0];

  if (typeof selected === 'string') {
    return selected;
  }

  return selected?.['@_href'] || '';
}

function getImage(item) {
  if (!item) return '';

  // RSS enclosure
  if (item.enclosure?.['@_url']) {
    return item.enclosure['@_url'];
  }

  // Media RSS thumbnail
  const mediaGroup = item['media:group'];

  if (mediaGroup?.['media:thumbnail']) {
    const thumbnail = toArray(
      mediaGroup['media:thumbnail']
    )[0];

    if (thumbnail?.['@_url']) {
      return thumbnail['@_url'];
    }
  }

  // Direct media thumbnail
  if (item['media:thumbnail']?.['@_url']) {
    return item['media:thumbnail']['@_url'];
  }

  return '';
}

// ============================================
// 6. CATEGORY DETECTION
// ============================================

function determineCategory(title, description) {
  const text = (
    (title || '') + ' ' + (description || '')
  ).toLowerCase();

  // Kozhikode local news
  if (
    text.includes('kozhikode') ||
    text.includes('calicut') ||
    text.includes('കോഴിക്കോട്') ||
    text.includes('വടകര') ||
    text.includes('കൊയിലാണ്ടി') ||
    text.includes('ബേപ്പൂർ') ||
    text.includes('ഫറോക്ക്')
  ) {
    return 'local';
  }

  // Kerala news
  if (
    text.includes('kerala') ||
    text.includes('കേരളം') ||
    text.includes('തിരുവനന്തപുരം') ||
    text.includes('കൊച്ചി') ||
    text.includes('കണ്ണൂർ') ||
    text.includes('മലപ്പുറം') ||
    text.includes('തൃശൂർ')
  ) {
    return 'kerala';
  }

  // Sports
  if (
    text.includes('sports') ||
    text.includes('cricket') ||
    text.includes('football') ||
    text.includes('കായികം') ||
    text.includes('ക്രിക്കറ്റ്') ||
    text.includes('ഫുട്ബോൾ')
  ) {
    return 'sports';
  }

  // Entertainment
  if (
    text.includes('cinema') ||
    text.includes('movie') ||
    text.includes('entertainment') ||
    text.includes('സിനിമ') ||
    text.includes('ചലച്ചിത്രം')
  ) {
    return 'entertainment';
  }

  return 'national';
}

// ============================================
// 7. DATE PARSER
// ============================================

function parseArticleDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

// ============================================
// 8. NORMALIZE URL
// ============================================

function normalizeUrl(value) {
  if (!value) return '';

  try {
    const url = new URL(value);

    // YouTube video URL normalization
    if (
      url.hostname.includes('youtube.com') ||
      url.hostname.includes('youtu.be')
    ) {
      let videoId = '';

      if (url.hostname.includes('youtu.be')) {
        videoId = url.pathname.split('/')[1] || '';
      } else {
        videoId =
          url.searchParams.get('v') ||
          url.pathname.split('/').filter(Boolean).pop() ||
          '';
      }

      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    // Remove common tracking parameters
    [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid'
    ].forEach(key => url.searchParams.delete(key));

    url.hash = '';

    return url.toString();

  } catch (e) {
    return value.trim();
  }
}

// ============================================
// 9. FETCH HELPER
// ============================================

async function fetchXML(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
}

// ============================================
// 10. RSS + ATOM FETCH
// ============================================

async function fetchFromRSS() {
  let allNews = [];

  for (const feed of RSS_FEEDS) {
    try {
      console.log(`📡 Checking RSS: ${feed.name}`);

      const xml = await fetchXML(feed.url);
      const data = parser.parse(xml);

      let items = [];

      // Standard RSS
      if (data?.rss?.channel?.item) {
        items = toArray(data.rss.channel.item);
      }

      // Atom feed
      else if (data?.feed?.entry) {
        items = toArray(data.feed.entry);
      }

      if (!items.length) {
        console.log(`⚠️ No RSS items: ${feed.name}`);
        continue;
      }

      const list = items.map(item => {
        const title = getText(item.title);

        const link =
          item.link?.['@_href']
            ? getLink(item.link)
            : getText(item.link);

        const pubDate =
          item.pubDate ||
          item.published ||
          item.updated ||
          item['dc:date'] ||
          '';

        const description =
          getText(item.description) ||
          getText(item.summary) ||
          getText(item.content);

        return {
          title,
          url: link,
          pubDate,
          image: getImage(item),
          description,
          source: feed.name,
          isVideo: false
        };

      }).filter(item => item.title && item.url);

      console.log(
        `✅ ${feed.name}: ${list.length} articles`
      );

      allNews = allNews.concat(list);

    } catch (e) {
      console.log(
        `❌ RSS ${feed.name} error: ${e.message}`
      );
    }
  }

  return allNews;
}

// ============================================
// 11. YOUTUBE VIDEO FETCH
// ============================================

async function fetchFromYouTube() {
  let allVideos = [];

  for (const channel of YOUTUBE_CHANNELS) {
    try {
      console.log(
        `▶️ Checking YouTube: ${channel.name}`
      );

      const url =
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;

      const xml = await fetchXML(url);
      const data = parser.parse(xml);

      const entries = toArray(
        data?.feed?.entry
      );

      if (!entries.length) {
        console.log(
          `⚠️ No YouTube videos: ${channel.name}`
        );
        continue;
      }

      const list = entries.map(video => {
        return {
          title: getText(video.title),

          url: getLink(video.link),

          pubDate:
            video.published ||
            video.updated ||
            '',

          image: getImage(video),

          description: '',

          source: channel.name,

          isVideo: true
        };

      }).filter(video => video.title && video.url);

      console.log(
        `✅ ${channel.name}: ${list.length} videos`
      );

      allVideos = allVideos.concat(list);

    } catch (e) {
      console.log(
        `❌ YouTube ${channel.name} error: ${e.message}`
      );
    }
  }

  return allVideos;
}

// ============================================
// 12. CURRENTS API
// ============================================

async function fetchFromCurrents() {
  if (!API_KEY) {
    console.log('⚠️ Currents API key not configured');
    return [];
  }

  try {
    console.log('🌐 Checking Currents API');

    const url =
      'https://api.currentsapi.services/v1/latest-news?language=ml&country=IN&page_size=20';

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.log(
        `❌ Currents HTTP ${response.status}`
      );

      return [];
    }

    const data = await response.json();

    if (data.status !== 'ok' || !data.news) {
      console.log('⚠️ Currents returned no news');
      return [];
    }

    const list = data.news.map(article => ({
      title: cleanText(article.title),

      url: article.url,

      pubDate: article.published,

      image: article.image || '',

      description: cleanText(article.description || ''),

      source: article.author || 'Currents',

      isVideo: false

    })).filter(article => article.title && article.url);

    console.log(
      `✅ Currents: ${list.length} articles`
    );

    return list;

  } catch (e) {
    console.log(
      `❌ Currents error: ${e.message}`
    );

    return [];
  }
}

// ============================================
// 13. MALAYALAM TRANSLATION
// ============================================

function containsMalayalam(text) {
  return /[\u0D00-\u0D7F]/.test(text || '');
}

async function translateToMalayalam(text) {
  if (!text) return '';

  if (containsMalayalam(text)) {
    return text;
  }

  try {
    const result = await translate(text, {
      to: 'ml'
    });

    return result.text || text;

  } catch (e) {
    console.log(
      `⚠️ Translation failed: ${e.message}`
    );

    return text;
  }
}

// ============================================
// 14. MAIN PROCESS
// ============================================

async function main() {
  console.log('================================');
  console.log('🚀 NEWS FETCH STARTED');
  console.log('================================');

  let allArticles = [];

  // RSS
  const rssNews = await fetchFromRSS();
  allArticles = allArticles.concat(rssNews);

  // YouTube
  const youtubeNews = await fetchFromYouTube();
  allArticles = allArticles.concat(youtubeNews);

  // Currents
  const currentsNews = await fetchFromCurrents();
  allArticles = allArticles.concat(currentsNews);

  console.log('--------------------------------');
  console.log(`RSS: ${rssNews.length}`);
  console.log(`YouTube: ${youtubeNews.length}`);
  console.log(`Currents: ${currentsNews.length}`);
  console.log(`Total: ${allArticles.length}`);
  console.log('--------------------------------');

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  const fortyEightHoursAgo = new Date(
    Date.now() - 48 * 60 * 60 * 1000
  );

  for (const article of allArticles) {
    try {
      if (
        !article.title ||
        !article.url ||
        !article.pubDate
      ) {
        skipped++;
        continue;
      }

      const date = parseArticleDate(article.pubDate);

      if (!date || date < fortyEightHoursAgo) {
        skipped++;
        continue;
      }

      const normalizedUrl = normalizeUrl(article.url);

      if (!normalizedUrl) {
        skipped++;
        continue;
      }

      // Translate English title and description
      let finalTitle = article.title;
      let finalDesc = article.description || '';

      if (!containsMalayalam(finalTitle)) {
        finalTitle = await translateToMalayalam(finalTitle);
      }

      if (
        finalDesc &&
        !containsMalayalam(finalDesc)
      ) {
        finalDesc = await translateToMalayalam(finalDesc);
      }

      // Actual language detection
      const language = containsMalayalam(finalTitle)
        ? 'ml'
        : 'en';

      // URL-based duplicate protection
      const id = crypto
        .createHash('sha256')
        .update(normalizedUrl)
        .digest('hex');

      const docRef = db.collection('news').doc(id);

      const docSnap = await docRef.get();

      if (docSnap.exists) {
        skipped++;
        continue;
      }

      const category = determineCategory(
        finalTitle,
        finalDesc
      );

      await docRef.set({
        title: finalTitle,

        description: finalDesc,

        source: article.source,

        url: article.url,

        image: article.image || '',

        isVideo: Boolean(article.isVideo),

        district: 'Kozhikode',

        language: language,

        category: category,

        isPublished: true,

        isDeleted: false,

        publishedAt:
          admin.firestore.Timestamp.fromDate(date),

        createdAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      saved++;

      console.log(
        `✅ Saved: ${article.source} - ${finalTitle.slice(0, 60)}`
      );

    } catch (e) {
      failed++;

      console.log(
        `❌ Article save error: ${e.message}`
      );
    }
  }

  console.log('================================');
  console.log('🏁 NEWS FETCH COMPLETED');
  console.log(`✅ Saved: ${saved}`);
  console.log(`⏭️ Skipped: ${skipped}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('================================');
}

// ============================================
// 15. EXECUTION
// ============================================

main().catch(error => {
  console.error('🔥 FATAL NEWS FETCH ERROR:', error);
  process.exitCode = 1;
});
