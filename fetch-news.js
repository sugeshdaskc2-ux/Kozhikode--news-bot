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

const now = new Date();

const cutoffDate = new Date(
  now.getTime() - HOURS_LIMIT * 60 * 60 * 1000
);

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

// ============================================
// 6. DATE VALIDATION
// ============================================

function getValidDate(value) {

  if (!value) return null;

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return null;
  }

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
// 7. MALAYALAM NEWS CHECK
// ============================================

function isMalayalamNews(article) {

  const text =
    (article.title || '') + ' ' +
    (article.description || '');

  return /[\u0D00-\u0D7F]/.test(text);
}

// ============================================
// 8. KOZHIKODE NEWS CHECK
// ============================================

function isKozhikodeNews(article) {

  const text = (
    (article.title || '') + ' ' +
    (article.description || '')
  ).toLowerCase();

  return KOZHIKODE_KEYWORDS.some(keyword =>
    text.includes(keyword.toLowerCase())
  );
}

// ============================================
// 9. URL VALIDATION
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
// 10. CURRENTS API
// ============================================

async function fetchFromCurrentsAPI() {

  if (!API_KEY) {

    console.warn(
      'CURRENTS_API_KEY Secret missing. Skipping Currents API.'
    );

    return [];
  }

  console.log('Fetching from Currents API...');

  const keywords = [
    'കോഴിക്കോട്',
    'Kozhikode',
    'Kerala',
    'കേരളം'
  ];

  let results = [];

  for (const keyword of keywords) {

    try {

      const url = new URL(
        'https://api.currentsapi.services/v1/search'
      );

      url.searchParams.set('keywords', keyword);

      url.searchParams.set(
        'start_date',
        cutoffDate.toISOString()
      );

      url.searchParams.set(
        'end_date',
        now.toISOString()
      );

      url.searchParams.set('country', 'IN');

      url.searchParams.set('page_size', '20');

      const response = await fetch(url, {

        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json'
        },

        signal: AbortSignal.timeout(20000)

      });

      if (!response.ok) {

        throw new Error(
          `HTTP ${response.status}`
        );

      }

      const data = await response.json();

      if (
        data.status !== 'ok' ||
        !Array.isArray(data.news)
      ) {
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
        `Currents "${keyword}": ${articles.length} articles`
      );

    } catch (error) {

      console.error(
        `Currents Error (${keyword}):`,
        error.message
      );

    }
  }

  return results;
}

// ============================================
// 11. RSS FETCH
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

      throw new Error(
        `HTTP ${response.status}`
      );

    }

    const xml = await response.text();

    const data = parser.parse(xml);

    // RSS / Atom support

    let items =
      data?.rss?.channel?.item ||
      data?.feed?.entry ||
      [];

    if (!Array.isArray(items)) {

      items = items ? [items] : [];

    }

    return items.map(item => {

      let link = item.link;

      if (Array.isArray(link)) {
        link = link[0];
      }

      if (typeof link === 'object' && link !== null) {

        link =
          link['@_href'] ||
          link['#text'] ||
          '';

      }

      const enclosure = item.enclosure;

      return {

        title: cleanText(item.title),

        url: cleanText(link),

        pubDate:
          item.pubDate ||
          item.published ||
          item.updated ||
          item['dc:date'] ||
          '',

        image:
          enclosure?.['@_url'] ||
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
// 12. FILTER ALL NEWS
// ============================================

function filterArticles(allNews) {

  const unique = new Map();

  let oldCount = 0;
  let invalidCount = 0;
  let nonMalayalamCount = 0;

  for (const article of allNews) {

    if (!article.title || !article.url) {

      invalidCount++;

      continue;

    }

    if (!isValidUrl(article.url)) {

      invalidCount++;

      continue;

    }

    const date = getValidDate(article.pubDate);

    if (!date) {

      oldCount++;

      continue;

    }

    // മലയാളം വാർത്തകൾ മാത്രം
    if (!isMalayalamNews(article)) {

      nonMalayalamCount++;

      continue;

    }

    // കോഴിക്കോട് വാർത്തയാണോ?
    const isLocal = isKozhikodeNews(article);

    const id = crypto
      .createHash('sha256')
      .update(article.url)
      .digest('hex');

    if (!unique.has(id)) {

      unique.set(id, {

        ...article,

        publishedDate: date,

        isKozhikode: isLocal,

        id

      });

    }

  }

  const results = Array.from(unique.values());

  // കോഴിക്കോട് വാർത്തകൾ ആദ്യം
  // മറ്റു വാർത്തകൾ പ്രസിദ്ധീകരണ തീയതി അനുസരിച്ച്

  results.sort((a, b) => {

    if (a.isKozhikode && !b.isKozhikode) {
      return -1;
    }

    if (!a.isKozhikode && b.isKozhikode) {
      return 1;
    }

    return b.publishedDate - a.publishedDate;

  });

  console.log('----------------------------');

  console.log(`Old/Invalid date: ${oldCount}`);

  console.log(`Invalid articles: ${invalidCount}`);

  console.log(`Non-Malayalam: ${nonMalayalamCount}`);

  console.log(`Valid articles: ${results.length}`);

  console.log('----------------------------');

  return results.slice(0, MAX_ARTICLES);
}

// ============================================
// 13. SAVE TO FIREBASE
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

      image: article.image || '',

      // യഥാർത്ഥ വാർത്തയുടെ ജില്ല
      district: article.isKozhikode
        ? 'Kozhikode'
        : 'Other',

      language: 'ml',

      category: article.isKozhikode
        ? 'local'
        : 'general',

      isKozhikode: article.isKozhikode,

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

    await docRef.set(
      newsData,
      { merge: true }
    );

  }

  console.log('============================');

  console.log(`New articles: ${added}`);

  console.log(`Updated articles: ${updated}`);

  console.log('============================');
}

// ============================================
// 14. MAIN FUNCTION
// ============================================

async function main() {

  console.log('================================');

  console.log('KOZHIKODE MALAYALAM NEWS COLLECTOR');

  console.log('48 HOUR NEWS FILTER');

  console.log('================================');

  let combinedNews = [];

  // 1. Currents API

  const apiNews = await fetchFromCurrentsAPI();

  combinedNews = combinedNews.concat(apiNews);

  // 2. RSS Feeds

  for (const feed of FEEDS) {

    const rssNews = await fetchFromRSS(feed);

    combinedNews = combinedNews.concat(rssNews);

  }

  console.log(
    `Total fetched: ${combinedNews.length}`
  );

  // 3. Filter all news

  const filteredNews = filterArticles(combinedNews);

  console.log(
    `Final news count: ${filteredNews.length}`
  );

  // 4. Save to Firebase

  if (filteredNews.length > 0) {

    await saveToFirebase(filteredNews);

  } else {

    console.log(
      'No fresh Malayalam news found in the last 48 hours.'
    );

  }

  console.log('News collection completed.');

}

// ============================================
// 15. START
// ============================================

main().catch(error => {

  console.error('Fatal Error:', error);

  process.exitCode = 1;

});
