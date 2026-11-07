const fetch = require('node-fetch');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const API_KEY = process.env.CURRENTS_API_KEY;

async function fetchNews() {
  try {
    const res = await fetch(`https://api.currentsapi.services/v1/latest-news?language=en,ml&country=IN`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    const data = await res.json();
    
    if (data.status !== 'ok' || !data.news) return;
    
    let count = 0;
    for (const article of data.news) {
      const existing = await db.collection('news').where('sourceUrl', '==', article.url).limit(1).get();
      if (!existing.empty) continue;

      let category = 'national';
      const text = (article.title + ' ' + (article.description || '')).toLowerCase();
      if (text.includes('kozhikode') || text.includes('calicut')) category = 'kozhikode';
      else if (text.includes('kerala')) category = 'kerala';

      await db.collection('news').add({
        title: article.title,
        shortDescription: article.description || '',
        content: article.description || '',
        imageUrl: article.image || '',
        source: article.author || 'Currents API',
        sourceUrl: article.url,
        category: category,
        language: article.language || 'en',
        isPublished: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      count++;
    }
    console.log(`Saved ${count} new articles.`);
  } catch (error) {
    console.error('Error fetching news:', error);
  }
}
fetchNews();
