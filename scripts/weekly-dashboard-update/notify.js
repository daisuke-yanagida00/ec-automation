'use strict';

require('dotenv').config({ path: __dirname + '/.env', override: true });
const https = require('https');

const TOKEN = process.env.CHATWORK_API_TOKEN;
const ROOM_ID = process.env.CHATWORK_ROOM_ID;

function sendChatwork(body) {
  return new Promise((resolve, reject) => {
    const postData = `body=${encodeURIComponent(body)}`;
    const options = {
      hostname: 'api.chatwork.com',
      port: 443,
      path: `/v2/rooms/${ROOM_ID}/messages`,
      method: 'POST',
      headers: {
        'X-ChatWorkToken': TOKEN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`Chatwork API エラー: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function notify(weekOf, pushed) {
  if (!TOKEN || !ROOM_ID) {
    console.warn('[notify] CHATWORK_API_TOKEN または CHATWORK_ROOM_ID が未設定、通知スキップ');
    return;
  }

  const date = weekOf || new Date().toISOString().split('T')[0];
  const pushStatus = pushed ? 'GitHubにpush済み' : 'push不要（変更なし）';
  const dashboardUrl = 'https://daisuke-yanagida00.github.io/ec-automation/';

  const message = [
    `[info][title]✅ ダッシュボード週次更新完了（${date}）[/title]`,
    `更新日時: ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`,
    `ステータス: ${pushStatus}`,
    `ダッシュボード: ${dashboardUrl}`,
    '[/info]',
  ].join('\n');

  try {
    await sendChatwork(message);
    console.log('[notify] Chatwork通知送信完了');
  } catch (e) {
    console.error('[notify] 通知失敗:', e.message);
  }
}

module.exports = { notify };
