// ===== ユーティリティ関数 =====
function updateTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('timeDisplay').textContent = `${hours}:${minutes}`;
}

// 時刻を毎分更新
setInterval(updateTime, 60000);
updateTime();

// ===== 壁紙機能 =====
const UNSPLASH_ACCESS_KEY = 'YOUR_UNSPLASH_ACCESS_KEY'; // デモ用。本番では自分のAPIキーを設定

// 壁紙を取得・表示
async function loadWallpaper() {
  const backgroundEl = document.querySelector('.background');

  try {
    // ストレージから保存済み壁紙をチェック
    const stored = await new Promise(resolve => {
      chrome.storage.local.get(['wallpaper', 'wallpaperTime'], resolve);
    });

    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // 1時間以内の壁紙があれば再利用
    if (stored.wallpaper && stored.wallpaperTime && (now - stored.wallpaperTime) < oneHour) {
      applyWallpaper(stored.wallpaper);
      return;
    }

    // Unsplash Source API（APIキー不要の簡易版）を使用
    // 風景・自然のカテゴリから1920x1080の画像を取得
    const imageUrl = `https://source.unsplash.com/1920x1080/?landscape,nature,scenery&t=${now}`;

    // 画像をプリロード
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = async () => {
      // 画像をBase64に変換して保存（オフライン対応）
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

        // ストレージに保存
        chrome.storage.local.set({
          wallpaper: dataUrl,
          wallpaperTime: now
        });

        applyWallpaper(dataUrl);
      } catch (e) {
        // CORS制限の場合はURLをそのまま使用
        applyWallpaper(imageUrl);
      }
    };

    img.onerror = () => {
      console.log('壁紙読み込み失敗、フォールバック使用');
      // フォールバック: Picsum Photos（別の無料画像API）
      const fallbackUrl = `https://picsum.photos/1920/1080?random=${now}`;
      applyWallpaper(fallbackUrl);
    };

    img.src = imageUrl;

  } catch (error) {
    console.error('壁紙取得エラー:', error);
  }
}

function applyWallpaper(imageUrl) {
  const backgroundEl = document.querySelector('.background');
  backgroundEl.style.backgroundImage = `url(${imageUrl})`;
  backgroundEl.style.backgroundSize = 'cover';
  backgroundEl.style.backgroundPosition = 'center';
  backgroundEl.style.opacity = '1';
}

// ===== 認証状態管理 =====
let isAuthenticated = false;

// Chrome Identity APIでトークン取得
async function getAccessToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        console.log('認証エラー:', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}

// ログイン処理
async function login() {
  const loginBtn = document.getElementById('loginBtn');
  loginBtn.textContent = '認証中...';
  loginBtn.disabled = true;

  try {
    const token = await getAccessToken(true);
    if (token) {
      isAuthenticated = true;
      updateAuthUI();
      await getCalendarEvents();
    } else {
      alert('Google認証に失敗しました。再度お試しください。');
    }
  } catch (error) {
    console.error('ログインエラー:', error);
    alert('認証エラーが発生しました。');
  } finally {
    loginBtn.textContent = 'Googleカレンダー連携';
    loginBtn.disabled = false;
  }
}

// ログアウト処理
async function logout() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        // トークンを無効化
        chrome.identity.removeCachedAuthToken({ token }, () => {
          // Googleのトークンも無効化
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
            .finally(() => {
              isAuthenticated = false;
              updateAuthUI();
              showNotConnected();
              resolve();
            });
        });
      } else {
        isAuthenticated = false;
        updateAuthUI();
        showNotConnected();
        resolve();
      }
    });
  });
}

// 認証UI更新
function updateAuthUI() {
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (isAuthenticated) {
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
  } else {
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
  }
}

// 未接続表示
function showNotConnected() {
  document.getElementById('todaySchedule').innerHTML =
    '<p class="not-connected">Googleカレンダーに接続してください</p>';
  document.getElementById('tomorrowSchedule').innerHTML =
    '<p class="not-connected">Googleカレンダーに接続してください</p>';
}

// ===== Google Calendar API 連携 =====
async function getCalendarEvents() {
  try {
    // サイレントにトークン取得を試行
    const token = await getAccessToken(false);

    if (!token) {
      console.log('Calendar API認証なし');
      isAuthenticated = false;
      updateAuthUI();
      showNotConnected();
      return;
    }

    isAuthenticated = true;
    updateAuthUI();

    // ローディング表示
    document.getElementById('todaySchedule').innerHTML = '<p class="loading">読み込み中...</p>';
    document.getElementById('tomorrowSchedule').innerHTML = '<p class="loading">読み込み中...</p>';

    // 全カレンダーリストを取得
    const calendars = await fetchCalendarList(token);

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayEvents = await fetchEventsFromAllCalendars(token, calendars, today);
    const tomorrowEvents = await fetchEventsFromAllCalendars(token, calendars, tomorrow);

    displaySchedule('todaySchedule', todayEvents);
    displaySchedule('tomorrowSchedule', tomorrowEvents);
  } catch (error) {
    console.error('カレンダー読み込みエラー:', error);
    showNotConnected();
  }
}

// カレンダーリストを取得
async function fetchCalendarList(token) {
  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`CalendarList API Error: ${response.status}`);
    }

    const data = await response.json();
    // 表示可能なカレンダーのみ（削除済みや非表示を除外）
    return (data.items || []).filter(cal => !cal.deleted && cal.selected !== false);
  } catch (error) {
    console.error('カレンダーリスト取得エラー:', error);
    // フォールバック: プライマリカレンダーのみ
    return [{ id: 'primary', summary: 'Primary' }];
  }
}

// 全カレンダーからイベントを取得
async function fetchEventsFromAllCalendars(token, calendars, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // 全カレンダーから並列でイベント取得
  const eventPromises = calendars.map(cal =>
    fetchEventsFromCalendar(token, cal.id, startOfDay, endOfDay, cal.backgroundColor)
  );

  const results = await Promise.all(eventPromises);

  // 全イベントを結合してソート
  const allEvents = results.flat();
  allEvents.sort((a, b) => {
    const aTime = a.start.dateTime || a.start.date;
    const bTime = b.start.dateTime || b.start.date;
    return new Date(aTime) - new Date(bTime);
  });

  return allEvents;
}

async function fetchEventsFromCalendar(token, calendarId, startOfDay, endOfDay, calendarColor) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
      `timeMin=${startOfDay.toISOString()}&` +
      `timeMax=${endOfDay.toISOString()}&` +
      `singleEvents=true&` +
      `orderBy=startTime`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.status === 401) {
      // トークン期限切れ - キャッシュクリアして再試行
      chrome.identity.removeCachedAuthToken({ token }, () => {});
      throw new Error('Token expired');
    }

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    // カレンダーの色情報を各イベントに付与
    return (data.items || []).map(event => ({
      ...event,
      calendarColor: calendarColor || '#4285f4'
    }));
  } catch (error) {
    console.error(`イベント取得エラー (${calendarId}):`, error);
    return [];
  }
}

function displaySchedule(elementId, events) {
  const container = document.getElementById(elementId);

  if (events.length === 0) {
    container.innerHTML = '<p class="no-events">予定なし</p>';
    return;
  }

  const html = events.map(event => {
    let timeStr = '終日';

    if (event.start.dateTime) {
      const startTime = new Date(event.start.dateTime);
      timeStr = startTime.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    // カレンダーの色を左ボーダーに適用
    const borderColor = event.calendarColor || '#4CAF50';

    return `
      <div class="schedule-item" style="border-left-color: ${borderColor};">
        <div class="time">${timeStr}</div>
        <div class="event-name">${event.summary || '（タイトルなし）'}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// ===== AI履歴機能 =====
const AI_SERVICES = [
  {
    id: 'chatgpt',
    domains: ['chatgpt.com', 'chat.openai.com'],
    name: 'ChatGPT',
    containerId: 'chatgptHistory'
  },
  {
    id: 'claude',
    domains: ['claude.ai'],
    name: 'Claude',
    containerId: 'claudeHistory'
  },
  {
    id: 'gemini',
    domains: ['gemini.google.com'],
    name: 'Gemini',
    containerId: 'geminiHistory'
  }
];

async function getAIHistory() {
  try {
    // 過去7日間の履歴を取得
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    const historyItems = await new Promise((resolve) => {
      chrome.history.search({
        text: '',
        startTime: oneWeekAgo,
        maxResults: 1000
      }, resolve);
    });

    // 各AIサービスごとに履歴を分類
    for (const service of AI_SERVICES) {
      const container = document.getElementById(service.containerId);
      if (!container) continue;

      // このサービスの履歴をフィルタリング
      const serviceHistory = historyItems.filter(item => {
        return service.domains.some(domain => item.url.includes(domain));
      });

      // 重複を除去
      const uniqueHistory = [];
      const seenUrls = new Set();

      for (const item of serviceHistory) {
        try {
          const url = new URL(item.url);
          const baseUrl = url.origin + url.pathname;

          // ホームページやログインページを除外
          if (baseUrl.endsWith('/') ||
              baseUrl.includes('/login') ||
              baseUrl.includes('/auth') ||
              baseUrl.includes('/settings') ||
              baseUrl.includes('/recents')) {
            continue;
          }

          if (!seenUrls.has(baseUrl)) {
            seenUrls.add(baseUrl);
            uniqueHistory.push({
              ...item,
              url: baseUrl
            });
          }
        } catch (e) {
          // URL解析エラーは無視
        }
      }

      // 最新30件に制限
      const recentHistory = uniqueHistory.slice(0, 30);

      if (recentHistory.length === 0) {
        container.innerHTML = '<p class="no-history">履歴なし</p>';
        continue;
      }

      const html = recentHistory.map(item => {
        const date = new Date(item.lastVisitTime);
        const timeStr = date.toLocaleDateString('ja-JP', {
          month: 'short',
          day: 'numeric'
        });

        // タイトルを整形
        let title = item.title || 'タイトルなし';
        // サービス名を除去
        title = title.replace(/- ChatGPT$/, '').replace(/Claude$/, '').replace(/ - Gemini$/, '').trim();
        // 長いタイトルを省略
        if (title.length > 35) {
          title = title.substring(0, 35) + '...';
        }

        return `
          <a href="${item.url}" target="_blank" class="ai-history-item">
            <span class="ai-history-title">${title}</span>
            <span class="ai-history-time">${timeStr}</span>
          </a>
        `;
      }).join('');

      container.innerHTML = html;
    }
  } catch (error) {
    console.error('履歴取得エラー:', error);
    for (const service of AI_SERVICES) {
      const container = document.getElementById(service.containerId);
      if (container) {
        container.innerHTML = '<p class="no-history">読み込みエラー</p>';
      }
    }
  }
}

// ===== 天気機能 =====
const WEATHER_ICONS = {
  '01d': '☀️', '01n': '🌙',
  '02d': '⛅', '02n': '☁️',
  '03d': '☁️', '03n': '☁️',
  '04d': '☁️', '04n': '☁️',
  '09d': '🌧️', '09n': '🌧️',
  '10d': '🌦️', '10n': '🌧️',
  '11d': '⛈️', '11n': '⛈️',
  '13d': '❄️', '13n': '❄️',
  '50d': '🌫️', '50n': '🌫️'
};

async function getWeather() {
  try {
    // 名古屋の緯度経度
    const lat = 35.1815;
    const lon = 136.9066;

    // Open-Meteo API（無料、APIキー不要）- 今日の最高・最低気温と降水確率も取得
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Tokyo&forecast_days=1`
    );

    if (!response.ok) throw new Error('Weather API error');

    const data = await response.json();
    const temp = Math.round(data.current.temperature_2m);
    const weatherCode = data.current.weather_code;

    // 今日の最高・最低気温、降水確率
    const tempMax = Math.round(data.daily.temperature_2m_max[0]);
    const tempMin = Math.round(data.daily.temperature_2m_min[0]);
    const precipitation = data.daily.precipitation_probability_max[0];

    // 天気コードをアイコンに変換
    const icon = getWeatherIcon(weatherCode);

    document.querySelector('.weather-icon').textContent = icon;
    document.querySelector('.weather-temp').textContent = `${temp}°C`;
    document.querySelector('.weather-high').textContent = `${tempMax}°`;
    document.querySelector('.weather-low').textContent = `${tempMin}°`;
    document.querySelector('.weather-rain').textContent = `${precipitation}%`;
  } catch (error) {
    console.error('天気取得エラー:', error);
    document.querySelector('.weather-icon').textContent = '🌡️';
    document.querySelector('.weather-temp').textContent = '--°C';
    document.querySelector('.weather-high').textContent = '--°';
    document.querySelector('.weather-low').textContent = '--°';
    document.querySelector('.weather-rain').textContent = '--%';
  }
}

function getWeatherIcon(code) {
  // WMO Weather interpretation codes
  if (code === 0) return '☀️';
  if (code === 1 || code === 2 || code === 3) return '⛅';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌧️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95 && code <= 99) return '⛈️';
  return '🌡️';
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  // ボタンイベント設定
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (loginBtn) {
    loginBtn.addEventListener('click', login);
  }
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  // 壁紙読み込み
  loadWallpaper();

  // カレンダー取得（サイレント）
  getCalendarEvents();

  // AI履歴取得
  getAIHistory();

  // 天気取得
  getWeather();
});

// 定期的にカレンダーを更新（5分ごと）
setInterval(() => {
  if (isAuthenticated) {
    getCalendarEvents();
  }
}, 5 * 60 * 1000);

// 定期的に履歴を更新（1分ごと）
setInterval(getAIHistory, 60 * 1000);

// 定期的に天気を更新（30分ごと）
setInterval(getWeather, 30 * 60 * 1000);

// 定期的に壁紙を更新（1時間ごと）
setInterval(loadWallpaper, 60 * 60 * 1000);
