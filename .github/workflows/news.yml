name: Fetch News
on:
  schedule:
    - cron: '0 */2 * * *'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install firebase-admin node-fetch@2
      - run: node fetch-news.js
        env:
          CURRENTS_API_KEY: ${{ secrets.CURRENTS_API_KEY }}
          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
