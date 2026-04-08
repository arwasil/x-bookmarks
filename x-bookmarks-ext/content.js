// X Bookmarks Sync — Chrome Extension Content Script
// Runs on x.com, adds a floating button to sync bookmarks
// Supports incremental sync (recent only) and full sync

(function () {
  'use strict';
  if (document.getElementById('xbk-fab')) return;

  // ====== CONFIG ======
  const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const GQL_ID = 'YCrjINs3IPbkSl5FQf_tpA';
  const FEATURES = {"rweb_video_screen_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":false,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"responsive_web_grok_share_attachment_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"responsive_web_grok_analysis_button_from_backend":true,"creator_subscriptions_quote_tweet_preview_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"rweb_video_timestamps_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_enhance_cards_enabled":false};
  const STORAGE_KEY = 'xbk_synced_ids';

  let syncing = false;
  let stopRequested = false;
  let newBookmarks = [];

  // ====== Load known IDs from localStorage ======
  function getKnownIds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  }
  function saveKnownIds(ids) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids])); } catch {}
  }

  const knownIds = getKnownIds();
  const hasExistingData = knownIds.size > 0;

  // ====== UI: Floating Action Button ======
  const fab = document.createElement('button');
  fab.id = 'xbk-fab';
  fab.title = 'Sync X Bookmarks';
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 2h14a2 2 0 012 2v18l-8-4-8 4V4a2 2 0 012-2z"/></svg>';
  document.body.appendChild(fab);

  // ====== UI: Panel ======
  const panel = document.createElement('div');
  panel.id = 'xbk-panel';
  panel.innerHTML = `
    <h3>
      <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#1d9bf0"><path d="M4 2h14a2 2 0 012 2v18l-8-4-8 4V4a2 2 0 012-2z"/></svg>
      X Bookmarks Sync
      <span style="margin-left:auto;font-size:10px;font-weight:400;color:rgba(255,255,255,0.3)">v1.2.0</span>
    </h3>
    <div class="xbk-sub" id="xbk-sub">${hasExistingData ? knownIds.size.toLocaleString() + ' bookmarks cached' : 'Ready to sync'}</div>
    <div class="xbk-status" id="xbk-status">Ready</div>
    <div id="xbk-progress-bar"><div id="xbk-progress-fill"></div></div>
    <div class="xbk-count" id="xbk-count" style="display:none">0</div>
    <div class="xbk-count-label" id="xbk-count-label" style="display:none">new bookmarks</div>
    <button class="xbk-btn xbk-btn-primary" id="xbk-sync-btn">Quick Sync (48h)</button>
    <button class="xbk-btn xbk-btn-secondary" id="xbk-full-btn">Full Sync (All)</button>
    <button class="xbk-btn xbk-btn-stop" id="xbk-stop-btn" style="display:none">Stop Syncing</button>
    <button class="xbk-btn xbk-btn-secondary" id="xbk-download-btn" style="display:none">Download JSON</button>
  `;
  document.body.appendChild(panel);

  // ====== Toggle Panel ======
  fab.addEventListener('click', () => panel.classList.toggle('show'));
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== fab && !fab.contains(e.target)) {
      panel.classList.remove('show');
    }
  });

  // ====== Elements ======
  const statusEl = document.getElementById('xbk-status');
  const progressFill = document.getElementById('xbk-progress-fill');
  const countEl = document.getElementById('xbk-count');
  const countLabel = document.getElementById('xbk-count-label');
  const syncBtn = document.getElementById('xbk-sync-btn');
  const fullBtn = document.getElementById('xbk-full-btn');
  const stopBtn = document.getElementById('xbk-stop-btn');
  const downloadBtn = document.getElementById('xbk-download-btn');

  function setStatus(msg) { statusEl.textContent = msg; }
  function setProgress(pct) { progressFill.style.width = pct + '%'; }
  function setCount(n) {
    countEl.style.display = '';
    countLabel.style.display = '';
    countEl.textContent = n.toLocaleString();
  }

  // ====== Get CSRF Token ======
  function getCsrf() {
    const m = document.cookie.match(/ct0=([^;]+)/);
    return m ? m[1] : null;
  }

  // ====== Fetch one page ======
  async function fetchPage(cursor) {
    const csrf = getCsrf();
    if (!csrf) throw new Error('Not logged in — sign into X first');

    const vars = { count: 20 };
    if (cursor) vars.cursor = cursor;

    const url = `https://x.com/i/api/graphql/${GQL_ID}/Bookmarks?variables=${encodeURIComponent(JSON.stringify(vars))}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;

    const resp = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + BEARER,
        'x-csrf-token': csrf,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (resp.status === 429) {
      setStatus('Rate limited — waiting 60s...');
      await new Promise(r => setTimeout(r, 60000));
      return fetchPage(cursor);
    }
    if (!resp.ok) throw new Error(`API error ${resp.status}: ${resp.statusText}`);
    return resp.json();
  }

  // ====== Parse tweet ======
  function parseTweet(result) {
    if (!result) return null;
    const tweet = result.tweet || result;
    const legacy = tweet.legacy;
    if (!legacy) return null;

    const userResult = tweet.core?.user_results?.result;
    const userLegacy = userResult?.legacy || {};
    const handle = userLegacy.screen_name || userResult?.core?.screen_name || '';
    const name = userLegacy.name || userResult?.core?.name || '';
    const verified = userResult?.is_blue_verified || userLegacy.verified || false;

    const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
    const md = mediaEntities.map(m => {
      const type = m.type || 'photo';
      const imgUrl = m.media_url_https || '';
      let videoUrl = null;
      if (type === 'video' || type === 'animated_gif') {
        const variants = (m.video_info?.variants || []).filter(v => v.content_type === 'video/mp4');
        variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        videoUrl = variants[0]?.url || null;
      }
      return { t: type, u: imgUrl, w: m.original_info?.width || 0, h: m.original_info?.height || 0, vu: videoUrl };
    });

    const urls = (legacy.entities?.urls || []).map(u => u.expanded_url).filter(Boolean);

    return {
      i: legacy.id_str || tweet.rest_id,
      x: legacy.full_text || '',
      h: handle,
      n: name,
      v: verified ? 1 : 0,
      d: legacy.created_at || '',
      g: legacy.lang || 'und',
      m: {
        r: legacy.reply_count || 0,
        rt: legacy.retweet_count || 0,
        l: legacy.favorite_count || 0,
        b: legacy.bookmark_count || 0,
        v: tweet.views?.count ? parseInt(tweet.views.count) : 0,
      },
      md: md,
      u: urls,
    };
  }

  // ====== Sync (incremental or full) ======
  async function sync(incremental) {
    if (syncing) return;
    syncing = true;
    stopRequested = false;
    newBookmarks = [];
    fab.classList.add('spinning');
    syncBtn.style.display = 'none';
    fullBtn.style.display = 'none';
    stopBtn.style.display = '';
    downloadBtn.style.display = 'none';
    setProgress(0);

    const mode = incremental ? 'Quick sync' : 'Full sync';
    const cutoffMs = incremental ? 48 * 60 * 60 * 1000 : 0; // 48h for quick sync
    const cutoffDate = incremental ? new Date(Date.now() - cutoffMs) : null;
    setStatus(`${mode} — starting...`);
    countLabel.textContent = incremental ? 'new bookmarks' : 'bookmarks fetched';

    let cursor = null;
    let page = 0;
    let hitCutoff = false;
    let consecutiveExisting = 0;

    try {
      while (true) {
        if (stopRequested) {
          setStatus(`Stopped at page ${page}. ${newBookmarks.length} bookmarks fetched.`);
          break;
        }

        page++;
        setStatus(`${mode} — page ${page}...`);

        const data = await fetchPage(cursor);
        const timeline = data?.data?.bookmark_timeline_v2?.timeline;
        const entries = timeline?.instructions?.[0]?.entries || timeline?.instructions?.find(i => i.type === 'TimelineAddEntries')?.entries || [];

        let nextCursor = null;
        let pageCount = 0;

        for (const entry of entries) {
          if (entry.entryId?.startsWith('cursor-bottom')) {
            nextCursor = entry.content?.value;
            continue;
          }
          if (!entry.entryId?.startsWith('tweet-')) continue;

          const result = entry.content?.itemContent?.tweet_results?.result;
          if (!result) continue;

          const parsed = parseTweet(result);
          if (!parsed) continue;

          pageCount++;

          // Time-based cutoff for quick sync: stop if tweet is older than 48h
          if (incremental && cutoffDate && parsed.d) {
            const tweetDate = new Date(parsed.d);
            if (tweetDate < cutoffDate) {
              hitCutoff = true;
              break;
            }
          }

          // ID-based cutoff: stop if we see 3 consecutive known IDs
          if (incremental && knownIds.has(parsed.i)) {
            consecutiveExisting++;
            if (consecutiveExisting >= 3) {
              hitCutoff = true;
              break;
            }
            continue;
          }

          consecutiveExisting = 0;
          newBookmarks.push(parsed);
        }

        setCount(newBookmarks.length);

        if (incremental) {
          setProgress(hitCutoff ? 100 : Math.min(90, page * 15));
        } else {
          setProgress(Math.min(95, (newBookmarks.length / 4200) * 100));
        }

        if (hitCutoff || stopRequested || !nextCursor || pageCount === 0) break;
        cursor = nextCursor;

        await new Promise(r => setTimeout(r, 800));
      }

      // Update known IDs
      newBookmarks.forEach(b => knownIds.add(b.i));
      saveKnownIds(knownIds);

      setProgress(100);
      if (newBookmarks.length === 0 && !stopRequested) {
        setStatus('Already up to date — no new bookmarks!');
        finishSync();
        return;
      }

      if (!stopRequested) {
        setStatus(`Done! ${newBookmarks.length} ${incremental ? 'new' : ''} bookmarks fetched.`);
      }

      if (newBookmarks.length > 0) {
        downloadBtn.style.display = '';
        downloadJSON(incremental);
      }

    } catch (err) {
      setStatus('Error: ' + err.message);
    }

    finishSync();
  }

  function finishSync() {
    fab.classList.remove('spinning');
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop Syncing';
    syncBtn.style.display = '';
    syncBtn.disabled = false;
    fullBtn.style.display = '';
    fullBtn.disabled = false;
    syncing = false;
    stopRequested = false;
  }

  // ====== Download JSON ======
  function downloadJSON(isIncremental) {
    const now = new Date();
    const ds = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const prefix = isIncremental ? 'x-bookmarks-sync' : 'x-bookmarks-full';
    const filename = `${prefix}-${ds}-${newBookmarks.length}items.json`;
    const blob = new Blob([JSON.stringify(newBookmarks)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(`Downloaded ${filename}`);
  }

  // ====== Event Listeners ======
  syncBtn.addEventListener('click', () => sync(true));
  fullBtn.addEventListener('click', () => sync(false));
  stopBtn.addEventListener('click', () => { stopRequested = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping...'; });
  downloadBtn.addEventListener('click', () => downloadJSON(hasExistingData));

  // ====== Spinning animation for FAB ======
  const style = document.createElement('style');
  style.textContent = `
    @keyframes xbk-spin { to { transform: rotate(360deg); } }
    #xbk-fab.spinning { animation: xbk-spin 1.2s linear infinite; }
    #xbk-fab.spinning svg { fill: #6366f1; }
  `;
  document.head.appendChild(style);

})();
