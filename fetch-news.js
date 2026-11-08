'use strict';

const admin = require('firebase-admin');
const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

// Firebase connection
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

// മലയാളം വാർത്തകൾക്കുള്ള RSS ലിങ്കുകൾ
const FEEDS = [
  {
    name: 'Mathrubhumi Kozhikode',
    url: 'https://www.mathrubhumi.com/rss/district/kozhikode'
  },
  {
    name: 'Asianet News',
    url: 'https://www.asianetnews.com/rss/malayalam/kerala'
  },
  {
    name: 'Oneindia Malayalam',
    url: 'https://malayalam.oneindia.com/rss/feeds/malayalam-kozhikode-fb.xml'
  }
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true
});

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

function getItems(data) {
  const items = data?.rss?.channel?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function fetchFeed(feed) {
  console.log('Fetching:', feed.name);

  try {
    const response = await fetch(feed.url, {
      headers: { 'User-Agent': 'KozhikodeNewsBot/1.0' },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`RSS error: HTTP ${response.status}`);
    }

    const xml = await response.text();
    const data = parser.parse(xml);
    const items = getItems(data);

    let saved = 0;
    let skipped = 0;
    
    // 📌 48 മണിക്കൂറിന് മുൻപുള്ള സമയം കണക്കാക്കുന്നു
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - (48 * 60 * 60 * 1000));

    for (const item of items) {
      const title = cleanText(item.title);
      const url = cleanText(item.link);

      if (!title || !url.startsWith('https://')) continue;

      // 📌 വാർത്തയുടെ തീയതി പരിശോധിക്കുന്നു
      const date = item.pubDate ? new Date(item.pubDate) : new Date();
      
      // പഴയ വാർത്തകളാണെങ്കിൽ (48 മണിക്കൂറിൽ കൂടുതൽ പഴക്കമുള്ളത്) ഒഴിവാക്കുക
      if (!isNaN(date.getTime()) && date < fortyEightHoursAgo) {
        skipped++;
        continue; 
      }

      const id = crypto
        .createHash('sha256')
        .update(url)
        .digest('hex');

      const image =
        item.enclosure?.['@_url'] ||
        item['media:content']?.['@_url'] ||
        '';

      const publishedAt = isNaN(date.getTime())
        ? admin.firestore.Timestamp.now()
        : admin.firestore.Timestamp.fromDate(date);

      await db.collection('news').doc(id).set({
        title,
        description: cleanText(item.description),
        source: feed.name,
        url,
        image,
        district: 'Kozhikode',
        language: 'ml',
        publishedAt,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      saved++;
    }

    console.log(`${feed.name} - Saved: ${saved}, Skipped (Old): ${skipped}`);
    
  } catch (error) {
    console.error(`Error fetching ${feed.name}:`, error.message);
  }
}

async function main() {
  for (const feed of FEEDS) {
    await fetchFeed(feed);
  }
  console.log('News collection completed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
    
