// ============================================================
// 楽天市場 注文データ取得・処理
// ============================================================

var RAKUTEN_CONFIG = {
  SERVICE_SECRET: PropertiesService.getScriptProperties().getProperty('RAKUTEN_SERVICE_SECRET'),
  LICENSE_KEY:    PropertiesService.getScriptProperties().getProperty('RAKUTEN_LICENSE_KEY'),
  SHOP_URL:       PropertiesService.getScriptProperties().getProperty('RAKUTEN_SHOP_URL'),
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
  SHEET_NAME:     '楽天注文'
};

var RAKUTEN_API_BASE = 'https://api.rms.rakuten.co.jp/es/2.0/order/';

// ----------------------------------------------------------------
// メイン：新規注文を取得してスプレッドシートに書き込む
// ----------------------------------------------------------------
function fetchRakutenOrders() {
  var orders = getRakutenNewOrders_();
  if (!orders || orders.length === 0) {
    Logger.log('楽天: 新規注文なし');
    return;
  }
  writeOrdersToSheet_(orders);
  Logger.log('楽天: ' + orders.length + '件の注文を記録しました');
}

// ----------------------------------------------------------------
// 楽天 RMS API で未処理注文番号一覧を取得
// ----------------------------------------------------------------
function getRakutenNewOrders_() {
  var endpoint = RAKUTEN_API_BASE + 'searchOrder/';
  var payload = JSON.stringify({
    orderProgressList: [100, 200],  // 100=注文確認待ち, 200=楽天処理中
    dateType: 0,
    startDatetime: getYesterdayIso_(),
    endDatetime:   getTodayIso_()
  });

  var options = {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'ESA ' + buildRakutenToken_() },
    payload: payload,
    muteHttpExceptions: true
  };

  var res = UrlFetchApp.fetch(endpoint, options);
  if (res.getResponseCode() !== 200) {
    Logger.log('楽天API エラー: ' + res.getContentText());
    return [];
  }

  var json = JSON.parse(res.getContentText());
  return json.orderNumberList || [];
}

// ----------------------------------------------------------------
// スプレッドシートへ書き込み
// ----------------------------------------------------------------
function writeOrdersToSheet_(orders) {
  var ss    = SpreadsheetApp.openById(RAKUTEN_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(RAKUTEN_CONFIG.SHEET_NAME)
              || ss.insertSheet(RAKUTEN_CONFIG.SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['注文番号', '取得日時', 'モール', 'ステータス']);
  }

  var now = new Date();
  orders.forEach(function(orderNo) {
    sheet.appendRow([orderNo, now, '楽天', '未処理']);
  });
}

// ----------------------------------------------------------------
// ユーティリティ
// ----------------------------------------------------------------
function buildRakutenToken_() {
  var raw = RAKUTEN_CONFIG.SERVICE_SECRET + ':' + RAKUTEN_CONFIG.LICENSE_KEY;
  return Utilities.base64Encode(raw);
}

function getYesterdayIso_() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss'+0900'");
}

function getTodayIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss'+0900'");
}
