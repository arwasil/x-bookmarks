#!/bin/bash
# Bundle bookmark data + starred and deploy to Vercel
# Usage: ./bundle.sh [path-to-json]
#
# Supports two formats:
#   1. Deploy export (from "Deploy" button): { bookmarks: [...], starred: [...] }
#   2. Plain bookmark array: [...]

cd "$(dirname "$0")"

JSON="${1:-$(ls -t ~/Downloads/x-bookmarks-deploy.json 2>/dev/null | head -1)}"
[ -z "$JSON" ] || [ ! -f "$JSON" ] && JSON="$(ls -t ~/Downloads/Bookmarks*.json ~/Downloads/x-bookmarks*.json ~/Downloads/X\ Bookmarks*.json 2>/dev/null | head -1)"

if [ -z "$JSON" ] || [ ! -f "$JSON" ]; then
  echo "No bookmark JSON found."
  echo "Click 'Deploy' button in x-bookmarks.html, then run this script again."
  exit 1
fi

echo "Using: $JSON"

python3 -c "
import json, sys

with open('$JSON') as f:
    raw = json.load(f)

# Detect format
if isinstance(raw, dict) and 'bookmarks' in raw:
    bookmarks = raw['bookmarks']
    starred = raw.get('starred', [])
    print(f'Deploy format: {len(bookmarks)} bookmarks, {len(starred)} starred')
elif isinstance(raw, list):
    bookmarks = raw
    starred = []
    print(f'Plain format: {len(bookmarks)} bookmarks')
else:
    print('Unknown format'); sys.exit(1)

with open('bookmarks-data.js', 'w') as f:
    f.write('window.__BUNDLED_BOOKMARKS=')
    f.write(json.dumps(bookmarks, separators=(',',':')))
    f.write(';')
    if starred:
        f.write('\nwindow.__BUNDLED_STARRED=')
        f.write(json.dumps(starred, separators=(',',':')))
        f.write(';')
"

echo "Created bookmarks-data.js ($(du -h bookmarks-data.js | cut -f1))"
echo "Deploying to Vercel..."
npx vercel --prod --yes
echo "Done!"
