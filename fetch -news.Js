name: Fetch News
on:
  schedule:
    - cron: '0 */2 * * *' # ഓരോ 2 മണിക്കൂറിലും പ്രവർത്തിക്കും
  workflow_dispatch: # മാനുവലായി തുടങ്ങാനും സാധിക്കും

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22' # പഴയ 20-ന് പകരം പുതിയ 22 ഉപയോഗിക്കുന്നു
      - run: npm install firebase-admin node-fetch@2
      - run: node fetch-news.js
        env:
          CURRENTS_API_KEY: ${{ secrets.CURRENTS_API_KEY }}
          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
