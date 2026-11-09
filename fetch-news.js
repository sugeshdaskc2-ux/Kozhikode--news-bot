'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT Secret missing!');
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// 📌 വാർത്തയുടെ വിഭാഗം സ്വയം കണ്ടെത്താനുള്ള ഫങ്ക്ഷൻ
function determineCategory(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('kozhikode') || text.includes('calicut') || text.includes('കോഴിക്കോട്')) return 'local';
  if (text.includes('kerala') || text.includes('കേരളം')) return 'kerala';
  if (text.includes('sports') || text.includes('കായികം') || text.includes('cricket')) return 'sports';
  if (text.includes('cinema') || text.includes('സിനിമ') || text.includes('movie')) return 'entertainment';
  return 'national'; // ഡിഫോൾട്ട്
}

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700);
}

// RSS Fetch
async function fetchFromRSS() {
  try {
    const response = await fetch('https://www.mathrubhumi.com/rss/district/kozhikode', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const data = parser.parse(xml);
    const items = data?.rss?.channel?.item || [];
    return (Array.isArray(items) ? items : [items]).map(item => ({
      title: cleanText(item.title), url: cleanText(item.link), pubDate: item.pubDate,
      image: item.enclosure?.['@_url'] || '', description: cleanText(item.description), source: 'Mathrubhumi'
    })).filter(n => n.title && n.url);
  } catch (e) { return []; }
}

// Currents API Fetch (ഉദാഹരണം)
async function fetchFromCurrents() {
    // ... (നിങ്ങളുടെ API കോഡ് ഇവിടെ)
    return []; 
}

async function main() {
  let allArticles = [];
  allArticles = allArticles.concat(await fetchFromRSS());
  // allArticles = allArticles.concat(await fetchFromCurrents());
  
  let saved = 0;
  const fortyEightHoursAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));

  for (const article of allArticles) {
    if (!article.title || !article.url || !article.pubDate) continue;
    
    const date = new Date(article.pubDate.replace(" ", "T"));
    if (isNaN(date.getTime()) || date < fortyEightHoursAgo) continue;

    const id = crypto.createHash('sha256').update(article.url).digest('hex');
    const docRef = db.collection('news').doc(id);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      const category = determineCategory(article.title, article.description);
      
      await docRef.set({
        title: article.title,
        description: article.description,
        source: article.source,
        url: article.url,
        image: article.image,
        district: 'Kozhikode',
        language: 'ml', // 📌 നിർബന്ധം
        category: category, // 📌 സ്വയം കണ്ടെത്തിയ വിഭാഗം
        isPublished: true, // 📌 നിർബന്ധം
        isDeleted: false,  // 📌 നിർബന്ധം
        publishedAt: admin.firestore.Timestamp.fromDate(date),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      saved++;
    }
  }
  console.log(`✅ Saved: ${saved} new articles.`);
}
main().catch(console.error);
