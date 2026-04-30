// ============================================================
// Amazon SP-API 注文データ取得・処理
// ============================================================

var AMAZON_CONFIG = {
  CLIENT_ID:      PropertiesService.getScriptProperties().getProperty('AMAZON_CLIENT_ID'),
  CLIENT_SECRET:  PropertiesService.getScriptProperties().getProperty('AMAZON_CLIENT_SECRET'),
  REFRESH_TOKEN:  PropertiesService.getScriptProperties().getProperty('AMAZON_REFRESH_TOKEN'),
  MARKETPLACE_ID: 'A1VC38T7YXB528',  // Amazon.co.jp
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
  SHEET_NAME:     'Amazon注文'
};

var AMAZON_API_BASE = 'https://sellingpartnerapi-fe.amazon.com';

// ----------------------------------------------------------------
// メイン：新規注文を取得してスプレッドシートに書き込む
// ----------------------------------------------------------------
function fetchAmazonOrders() {
  var token  = getAmazonAccessToken_();
  var orders = getAmazonNewOrders_(token);
  if (!orders || orders.length === 0) {
    Logger.log('Amazon: 新規注文なし');
    return;
  }
  writeOrdersToSheet_(orders);
  Logger.log('Amazon: ' + orders.length + '件の注文を記録しました');
}

// ----------------------------------------------------------------
// LWA アクセストークン取得
// ----------------------------------------------------------------
function getAmazonAccessToken_() {
  var res = UrlFetchApp.fetch('https://api.amazon.com/auth/o2/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type:    'refresh_token',
      refresh_token: AMAZON_CONFIG.REFRESH_TOKEN,
      client_id:     AMAZON_CONFIG.CLIENT_ID,
      client_secret: AMAZON_CONFIG.CLIENT_SECRET
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Amazon トークン取得失敗: ' + res.getContentText());
  }
  return JSON.parse(res.getContentText()).access_token;
}

// ----------------------------------------------------------------
// SP-API Orders API で直近24時間の注文を取得
// ----------------------------------------------------------------
function getAmazonNewOrders_(accessToken) {
  var createdAfter = getYesterdayIso_();
  var url = AMAZON_API_BASE + '/orders/v0/orders'
          + '?MarketplaceIds=' + AMAZON_CONFIG.MARKETPLACE_ID
          + '&CreatedAfter=' + encodeURIComponent(createdAfter)
          + '&OrderStatuses=Unshipped,PartiallyShipped';

  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Amazon API エラー: ' + res.getContentText());
    return [];
  }

  var json = JSON.parse(res.getContentText());
  return (json.payload && json.payload.Orders) ? json.payload.Orders : [];
}

// ----------------------------------------------------------------
// スプレッドシートへ書き込み
// ----------------------------------------------------------------
function writeOrdersToSheet_(orders) {
  var ss    = SpreadsheetApp.openById(AMAZON_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(AMAZON_CONFIG.SHEET_NAME)
              || ss.insertSheet(AMAZON_CONFIG.SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['注文番号', '注文日', '購入者名', '金額', '取得日時', 'モール', 'ステータス']);
  }

  var now = new Date();
  orders.forEach(function(order) {
    sheet.appendRow([
      order.AmazonOrderId,
      order.PurchaseDate,
      order.BuyerInfo ? order.BuyerInfo.BuyerName : '',
      order.OrderTotal ? order.OrderTotal.Amount : '',
      now,
      'Amazon',
      order.OrderStatus
    ]);
  });
}

// ----------------------------------------------------------------
// ユーティリティ
// ----------------------------------------------------------------
function getYesterdayIso_() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString();
}
