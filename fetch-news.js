'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

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
// 2. SETTINGS
// ============================================

const HOURS_LIMIT = 48;
const MAX_ARTICLES = 100;

const cutoffDate = new Date(
  Date.now() - HOURS_LIMIT * 60 * 60 * 1000
);

const now = new Date();

// ============================================
// 3. KOZHIKODE KEYWORDS
// ============================================

const KOZHIKODE_KEYWORDS = [
  'കോഴിക്കോട്',
  'കോഴിക്കോടൻ',
  'വടകര',
  'കൊയിലാണ്ടി',
  'പേരാമ്പ്ര',
  'ബാലുശ്ശേരി',
  'താമരശ്ശേരി',
  'കുന്ദമംഗലം',
  'ഫറോക്ക്',
  'ബേപ്പൂർ',
  'രാമനാട്ടുകര',
  'മാവൂർ',
  'കൊടുവള്ളി',
  'മുക്കം',
  'തിരുവമ്പാടി',
  'കക്കോടി',
  'ചേളന്നൂർ',
  'എലത്തൂർ',
  'നാദാപുരം',
  'കുറ്റ്യാടി',
  'പയ്യോളി',
  'ഉള്ളിയേരി',
  'മേപ്പയ്യൂർ',
  'ചാത്തമംഗലം',
  'ഒളവണ്ണ',
  'ചെറുവണ്ണൂർ',
  'പന്തീരാങ്കാവ്',
  'Kozhikode',
  'Calicut',
  'Vadakara',
  'Koyilandy',
  'Perambra',
  'Balussery',
  'Thamarassery',
  'Kunnamangalam',
  'Feroke',
  'Beypore',
  'Mavoor',
  'Koduvally',
  'Mukkam',
  'Thiruvambady',
  'Nadapuram',
  'Payyoli'
];

// ============================================
// 4. RSS SOURCES
// ============================================

const FEEDS = [
  {
    name: 'Manorama Online',
    url: 'https://www.manoramaonline.com/rss/latest-news.xml'
  },
  {
    name: 'Mathrubhumi',
    url: 'https://www.mathrubhumi.com/rss/news/kerala'
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true
});

// ============================================
// 5. TEXT CLEANING
// ============================================

function cleanText(value) {
  if (!value) return '';

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

// ============================================
// 6. DATE VALIDATION
// ============================================

function getValidDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (isNaN(date.getTime())) return null;

  // Future dates ഒഴിവാക്കുക
  if (date.getTime() > Date.now() + 5 * 60 * 1000) {
    return null;
  }

  // 48 മണിക്കൂറിൽ കൂടുതൽ പഴക്കമുള്ളത് ഒഴിവാക്കുക
  if (date < cutoffDate) {
    return null;
  }

  return date;
}

// ============================================
// 7. KOZHIKODE NEWS FILTER
// ============================================

function isKozhikodeNews(article) {
  const text = (
    (article.title || '') + ' ' +
    (article.description || '')
  ).toLowerCase();

  const hasMalayalam = /[\u0D00-\u0D7F]/.test(text);

  if (!hasMalayalam) return false;

  return KOZHIKODE_KEYWORDS.some(keyword =>
    text.includes(keyword.toLowerCase())
  );
}

// ============================================
// 8. URL VALIDATION
// ============================================

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ============================================
// 9. CURRENTS API
// ============================================

async function fetchFromCurrentsAPI() {

  if (!API_KEY) {
    console.warn('CURRENTS_API_KEY Secret missing!');
    return [];
  }

  console.log('Fetching from Currents API...');

  const keywords = [
    'കോഴിക്കോട്',
    'Kozhikode'
  ];

  let results = [];

  for (const keyword of keywords) {

    try {

      const url = new URL(
        'https://api.currentsapi.services/v1/search'
      );

      url.searchParams.set('keywords', keyword);
      url.searchParams.set('country', 'IN');
      url.searchParams.set('start_date', cutoffDate.toISOString());
      url.searchParams.set('end_date', now.toISOString());
      url.searchParams.set('page_size', '20');

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(20000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.status !== 'ok' || !Array.isArray(data.news)) {
        continue;
      }

      const articles = data.news.map(article => ({
        title: cleanText(article.title),
        url: article.url,
        pubDate: article.published,
        image: article.image || '',
        description: cleanText(article.description),
        source: article.author || 'Currents API'
      }));

      results = results.concat(articles);

      console.log(
        `Currents keyword "${keyword}": ${articles.length} articles`
      );

    } catch (error) {
      console.error(
        `Currents API Error (${keyword}):`,
        error.message
      );
    }
  }

  return results;
}

// ============================================
// 10. RSS FETCH
// ============================================

async function fetchFromRSS(feed) {

  console.log(`Fetching RSS: ${feed.name}`);

  try {

    const response = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 KozhikodeNewsBot/1.0'
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const data = parser.parse(xml);

    // RSS and Atom support
    let items =
      data?.rss?.channel?.item ||
      data?.feed?.entry ||
      [];

    if (!Array.isArray(items)) {
      items = items ? [items] : [];
    }

    return items.map(item => {

      let link = item.link;

      if (typeof link === 'object' && link !== null) {
        link = link['@_href'] || '';
      }

      return {
        title: cleanText(item.title),
        url: cleanText(link),
        pubDate:
          item.pubDate ||
          item.published ||
          item.updated ||
          '',
        image:
          item.enclosure?.['@_url'] ||
          item['media:content']?.['@_url'] ||
          '',
        description: cleanText(
          item.description ||
          item.summary ||
          item.content
        ),
        source: feed.name
      };

    }).filter(article =>
      article.title && article.url
    );

  } catch (error) {

    console.error(
      `${feed.name} Error:`,
      error.message
    );

    return [];
  }
}

// ============================================
// 11. FILTER ALL ARTICLES
// ============================================

function filterArticles(allNews) {

  const unique = new Map();

  for (const article of allNews) {

    if (!article.title || !article.url) continue;

    if (!isValidUrl(article.url)) continue;

    const date = getValidDate(article.pubDate);

    if (!date) continue;

    if (!isKozhikodeNews(article)) continue;

    const id = crypto
      .createHash('sha256')
      .update(article.url)
      .digest('hex');

    if (!unique.has(id)) {
      unique.set(id, {
        ...article,
        publishedDate: date,
        id
      });
    }
  }

  return Array.from(unique.values())
    .sort((a, b) =>
      b.publishedDate - a.publishedDate
    )
    .slice(0, MAX_ARTICLES);
}

// ============================================
// 12. SAVE TO FIREBASE
// ============================================

async function saveToFirebase(allNews) {

  let added = 0;
  let updated = 0;

  for (const article of allNews) {

    const docRef = db
      .collection('news')
      .doc(article.id);

    const docSnap = await docRef.get();

    const newsData = {

      title: article.title,

      description: article.description,

      source: article.source,

      url: article.url,

      image: article.image,

      district: 'Kozhikode',

      language: 'ml',

      category: 'local',

      isPublished: true,

      isDeleted: false,

      publishedAt:
        admin.firestore.Timestamp.fromDate(
          article.publishedDate
        ),

      fetchedAt:
        admin.firestore.FieldValue.serverTimestamp()
    };

    if (!docSnap.exists) {

      newsData.createdAt =
        admin.firestore.FieldValue.serverTimestamp();

      added++;

    } else {

      updated++;
    }

    await docRef.set(newsData, { merge: true });
  }

  console.log('----------------------------');
  console.log(`New articles: ${added}`);
  console.log(`Updated articles: ${updated}`);
  console.log('----------------------------');
}

// ============================================
// 13. MAIN
// ============================================

async function main() {

  console.log('================================');
  console.log('KOZHIKODE NEWS COLLECTOR');
  console.log('48 Hour News Filter');
  console.log('================================');

  let combinedNews = [];

  // Currents API
  const apiNews = await fetchFromCurrentsAPI();

  combinedNews = combinedNews.concat(apiNews);

  // RSS feeds
  for (const feed of FEEDS) {

    const rssNews = await fetchFromRSS(feed);

    combinedNews = combinedNews.concat(rssNews);
  }

  console.log(
    `Total fetched: ${combinedNews.length}`
  );

  // Filter
  const filteredNews = filterArticles(combinedNews);

  console.log(
    `Valid Kozhikode news (48h): ${filteredNews.length}`
  );

  if (filteredNews.length > 0) {

    await saveToFirebase(filteredNews);

  } else {

    console.log(
      'No fresh Malayalam Kozhikode news found.'
    );
  }

  console.log('News collection completed.');
}

main().catch(error => {

  console.error('Fatal Error:', error);

  process.exitCode = 1;
}
