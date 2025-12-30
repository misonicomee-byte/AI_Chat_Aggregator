// バックグラウンドサービスワーカー

// 拡張機能インストール時
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Chat Aggregator がインストールされました');

  // 初期ストレージ設定
  chrome.storage.local.set({
    'lastUsedAI': 'chatgpt',
    'theme': 'dark'
  });
});

// メッセージリスナー（将来の拡張用）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCalendarToken') {
    chrome.storage.local.get(['calendarToken'], (result) => {
      sendResponse({ token: result.calendarToken });
    });
    return true;
  }
});
