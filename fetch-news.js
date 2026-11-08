'use strict';

const admin = require('firebase-admin');
const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

// Firebase Connection
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT Secret missing!');
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// RSS Feeds (Manorama & Mathrubhumi)
const FEEDS = [
  { name: 'Manorama Online', url: 'https://www.manoramaonline.com/rss/latest-news.xml' },
  { name: 'Mathrubhumi', url: 'https://www.mathrubhumi.com/rss/news/kerala' }
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

// HTML ടാഗുകൾ നീക്കം ചെയ്യാനും ടെക്സ്റ്റ് വൃത്തിയാക്കാനും
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
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(20000) // 20 സെക്കൻഡ് ടൈം ഔട്ട്
    });

    if (!response.ok) {
       console.log(`Failed to fetch ${feed.name}, HTTP Status: ${response.status}`);
       return;
    }

    const xml = await response.text();
    const data = parser.parse(xml);
    const items = getItems(data);

    let saved = 0;
    let skipped = 0;
    
    // 📌 48 മണിക്കൂർ മുൻപുള്ള സമയം
    const fortyEightHoursAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));

    for (const item of items) {
      const title = cleanText(item.title);
      const url = cleanText(item.link);
      
      // ടൈറ്റിലോ ലിങ്കോ ഇല്ലെങ്കിൽ ഒഴിവാക്കുക
      if (!title || !url.startsWith('https://')) continue;

      // 📌 FIX 2: pubDate ഇല്ലാത്ത വാർത്തകൾ ഒഴിവാക്കുക (പഴയ വാർത്ത പുതിയതായി വരാതിരിക്കാൻ)
      if (!item.pubDate) {
        skipped++;
        continue;
      }

      const date = new Date(item.pubDate);
      
      // 📌 FIX 2: തീയതി ശരിയല്ലെങ്കിലോ 48 മണിക്കൂറിൽ പഴയതാണെങ്കിലോ ഒഴിവാക്കുക
      if (isNaN(date.getTime()) || date < fortyEightHoursAgo) {
        skipped++;
        continue; 
      }

      // യുണീക്ക് ഐഡി ഉണ്ടാക്കാൻ (Duplicate വരാതിരിക്കാൻ)
      const id = crypto.createHash('sha256').update(url).digest('hex');
      
      const image = item.enclosure?.['@_url'] || item['media:content']?.['@_url'] || '';
      
      // 📌 FIX 1: fromDateTime() അല്ല, fromDate() ആണ് ശരിയായത്
      const publishedAt = admin.firestore.Timestamp.fromDate(date);

      // 📌 FIX 3: createdAt ഒഴിവാക്കി, fetchedAt മാത്രം അപ്ഡേറ്റ് ചെയ്യുന്നു (merge: true ഉപയോഗിച്ചതിനാൽ)
      const newsData = {
        title,
        description: cleanText(item.description),
        source: feed.name,
        url,
        image,
        district: 'Kozhikode',
        language: 'ml',
        category: 'local', 
        isPublished: true, // ആപ്പിൽ കാണാൻ ഇത് നിർബന്ധമാണ്
        isDeleted: false,
        publishedAt,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // പുതിയ വാർത്തയാണെങ്കിൽ മാത്രം createdAt ചേർക്കുക
      const docRef = db.collection('news').doc(id);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        newsData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }

      await docRef.set(newsData, { merge: true });

      saved++;
    }

    console.log(`${feed.name} - Saved: ${saved}, Skipped (Old/Invalid): ${skipped}`);
    
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
