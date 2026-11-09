'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const translate = require('@vitalets/google-translate-api'); // ഇംഗ്ലീഷ് -> മലയാളം

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT Secret missing!');
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const API_KEY = process.env.CURRENTS_API_KEY; // Currents API Key

// 📌 പ്രവർത്തിക്കുന്ന RSS ഫീഡുകൾ
const RSS_FEEDS = [
  { name: 'Mathrubhumi', url: 'https://www.mathrubhumi.com/rss/district/kozhikode' },
  { name: 'Asianet News', url: 'https://www.asianetnews.com/rss/malayalam/kerala' },
  { name: 'Kerala Kaumudi', url: 'https://www.keralakaumudi.com/rss/news' },
  { name: 'Oneindia Malayalam', url: 'https://malayalam.oneindia.com/rss/feeds/malayalam-news.xml' }
];

// 📌 YouTube ചാനലുകളുടെ ID-കൾ (നിങ്ങൾക്ക് ഇഷ്ടമുള്ള ചാനലുകൾ ചേർക്കാം)
const YOUTUBE_CHANNELS = [
  { name: 'Mathrubhumi News', id: 'UCwV8jI7x5d1W4XW8b9e0b7w7' }, // ഉദാഹരണം
  { name: 'Asianet News', id: 'UCw8b9e0b7w7k1p2v3r4t5y6u' }     // ഉദാഹരണം
];

// 📌 വാർത്തയുടെ വിഭാഗം സ്വയം കണ്ടെത്താൻ
function determineCategory(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('kozhikode') || text.includes('calicut') || text.includes('കോഴിക്കോട്')) return 'local';
  if (text.includes('kerala') || text.includes('കേരളം')) return 'kerala';
  if (text.includes('sports') || text.includes('കായികം') || text.includes('cricket')) return 'sports';
  if (text.includes('cinema') || text.includes('സിനിമ') || text.includes('movie')) return 'entertainment';
  return 'national';
}

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700);
}

// 1️⃣ RSS ഫീഡുകളിൽ നിന്ന് വാർത്തകൾ എടുക്കൽ
async function fetchFromRSS() {
  let allNews = [];
  for (const feed of RSS_FEEDS) {
    try {
      const response = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const xml = await response.text();
      const data = parser.parse(xml);
      const items = data?.rss?.channel?.item || [];
      const list = (Array.isArray(items) ? items : [items]).map(item => ({
        title: cleanText(item.title), 
        url: cleanText(item.link), 
        pubDate: item.pubDate,
        image: item.enclosure?.['@_url'] || '', 
        description: cleanText(item.description), 
        source: feed.name,
        isVideo: false
      })).filter(n => n.title && n.url);
      allNews = allNews.concat(list);
    } catch (e) { console.log(`RSS ${feed.name} error`); }
  }
  return allNews;
}

// 2️⃣ YouTube വീഡിയോ വാർത്തകൾ എടുക്കൽ (API കീ ആവശ്യമില്ല)
async function fetchFromYouTube() {
  let allVideos = [];
  for (const channel of YOUTUBE_CHANNELS) {
    try {
      const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const xml = await response.text();
      const data = parser.parse(xml);
      const entries = data?.feed?.entry || [];
      const list = (Array.isArray(entries) ? entries : [entries]).map(v => ({
        title: cleanText(v.title), 
        url: v.link?.['@_href'], 
        pubDate: v.published,
        image: v['media:group']?.['media:thumbnail']?.['@_url'] || '', 
        description: '',
        source: channel.name,
        isVideo: true
      })).filter(v => v.title && v.url);
      allVideos = allVideos.concat(list);
    } catch (e) { console.log(`YouTube ${channel.name} error`); }
  }
  return allVideos;
}

// 3️⃣ Currents API-യിൽ നിന്ന് വാർത്തകൾ എടുക്കൽ
async function fetchFromCurrents() {
  if (!API_KEY) return [];
  try {
    const url = `https://api.currentsapi.services/v1/latest-news?language=ml&country=IN&page_size=20`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${API_KEY}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];
    const data = await response.json();
    if (data.status !== 'ok' || !data.news) return [];
    return data.news.map(a => ({
      title: a.title, 
      url: a.url, 
      pubDate: a.published, 
      image: a.image || '', 
      description: a.description || '', 
      source: a.author || 'Currents',
      isVideo: false
    }));
  } catch (e) { return []; }
}

// 📌 ഇംഗ്ലീഷ് വാർത്തയാണെങ്കിൽ മലയാളത്തിലേക്ക് മാറ്റുക
async function translateToMalayalam(text) {
  if (!text) return '';
  try {
    const res = await translate(text, { to: 'ml' });
    return res.text;
  } catch (e) {
    return text; // തർജ്ജമ പരാജയപ്പെട്ടാൽ യഥാർത്ഥ വാചകം തന്നെ നൽകുക
  }
}

async function main() {
  console.log('Fetching news from all sources...');
  let allArticles = [];
  
  // എല്ലാ സോഴ്സുകളിൽ നിന്നും എടുക്കുന്നു
  allArticles = allArticles.concat(await fetchFromRSS());
  allArticles = allArticles.concat(await fetchFromYouTube());
  allArticles = allArticles.concat(await fetchFromCurrents());
  
  console.log(`Total raw articles: ${allArticles.length}`);

  let saved = 0;
  const fortyEightHoursAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));

  for (const article of allArticles) {
    if (!article.title || !article.url || !article.pubDate) continue;
    
    const date = new Date(article.pubDate.replace(" ", "T"));
    if (isNaN(date.getTime()) || date < fortyEightHoursAgo) continue;

    // 📌 ഇംഗ്ലീഷ് ആണോ എന്ന് പരിശോധിക്കാൻ (മലയാളം അക്ഷരങ്ങൾ ഉണ്ടോ എന്ന്)
    const isEnglish = !/[\u0D00-\u0D7F]/.test(article.title);
    let finalTitle = article.title;
    let finalDesc = article.description;

    if (isEnglish) {
      finalTitle = await translateToMalayalam(article.title);
      if (article.description) {
        finalDesc = await translateToMalayalam(article.description);
      }
    }

    const id = crypto.createHash('sha256').update(article.url).digest('hex');
    const docRef = db.collection('news').doc(id);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      const category = determineCategory(finalTitle, finalDesc);
      
      await docRef.set({
        title: finalTitle,
        description: finalDesc,
        source: article.source,
        url: article.url,
        image: article.image,
        isVideo: article.isVideo, // വീഡിയോ ആണോ എന്ന് സേവ് ചെയ്യുന്നു
        district: 'Kozhikode',
        language: 'ml', 
        category: category, 
        isPublished: true, 
        isDeleted: false,  
        publishedAt: admin.firestore.Timestamp.fromDate(date),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      saved++;
    }
  }
  console.log(`✅ Saved: ${saved} new articles to Firebase.`);
}

main().catch(console.error);
