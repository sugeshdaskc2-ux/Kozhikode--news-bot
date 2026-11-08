'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');

// Firebase Connection
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT Secret missing!');
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// 📌 നിങ്ങളുടെ Currents API Key (GitHub Secrets-ൽ നിന്ന് എടുക്കുന്നു)
const API_KEY = process.env.CURRENTS_API_KEY;

async function fetchNews() {
  console.log('Fetching news from Currents API...');

  // കോഴിക്കോട്, മലയാളം വാർത്തകൾക്കായുള്ള ലിങ്ക്
  const url = `https://api.currentsapi.services/v1/latest-news?language=ml&country=IN&page_size=10`;

  try {
    const response = await fetch(url, {
      headers: { 
        'Authorization': `Bearer ${API_KEY}` 
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status !== 'ok' || !data.news) {
      console.log('No news found in the API response.');
      return;
    }

    let saved = 0;
    let skipped = 0;
    
    // 48 മണിക്കൂർ മുൻപുള്ള സമയം
    const fortyEightHoursAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));

    for (const article of data.news) {
      const title = article.title;
      const articleUrl = article.url;
      const pubDate = article.published; // Currents API-യിലെ തീയതി ഫീൽഡ്

      if (!title || !articleUrl || !pubDate) {
        skipped++;
        continue;
      }

      // RSS-ൽ നിന്ന് വ്യത്യസ്തമായി, API-യിൽ തീയതി ISO ഫോർമാറ്റിൽ ആയിരിക്കും
      const date = new Date(pubDate.replace(" ", "T")); // Format fix
      
      // 48 മണിക്കൂറിൽ പഴയ വാർത്തകൾ ഒഴിവാക്കുക
      if (isNaN(date.getTime()) || date < fortyEightHoursAgo) {
        skipped++;
        continue; 
      }

      const id = crypto.createHash('sha256').update(articleUrl).digest('hex');
      
      // Currents API-യിൽ ഇമേജ് ഫീൽഡ് 'image' അല്ലെങ്കിൽ 'image_url' എന്നായിരിക്കും
      const image = article.image || article.image_url || '';

      const newsData = {
        title,
        description: article.description || '',
        source: article.author || 'Currents News',
        url: articleUrl,
        image,
        district: 'Kozhikode',
        language: article.language || 'ml',
        category: 'local', 
        isPublished: true, // ആപ്പിൽ കാണാൻ നിർബന്ധം
        isDeleted: false,
        publishedAt: admin.firestore.Timestamp.fromDate(date),
        fetchedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const docRef = db.collection('news').doc(id);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        newsData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }

      await docRef.set(newsData, { merge: true });
      saved++;
    }

    console.log(`Saved: ${saved}, Skipped (Old/Invalid): ${skipped}`);
    
  } catch (error) {
    console.error('Error fetching news:', error.message);
  }
}

fetchNews();
