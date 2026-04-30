// ============================================================
// Gooslie 注文データ取得・処理
// ============================================================

var GOOSLIE_CONFIG = {
  API_BASE_URL:   PropertiesService.getScriptProperties().getProperty('GOOSLIE_API_BASE_URL'),
  API_KEY:        PropertiesService.getScriptProperties().getProperty('GOOSLIE_API_KEY'),
  SHOP_ID:        PropertiesService.getScriptProperties().getProperty('GOOSLIE_SHOP_ID'),
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
  SHEET_NAME:     'Gooslie注文'
};

// ----------------------------------------------------------------
// メイン：新規注文を取得してスプレッドシートに書き込む
// ----------------------------------------------------------------
function fetchGooslieOrders() {
  var orders = getGooslieNewOrders_();
  if (!orders || orders.length === 0) {
    Logger.log('Gooslie: 新規注文なし');
    return;
  }
  writeOrdersToSheet_(orders);
  Logger.log('Gooslie: ' + orders.length + '件の注文を記録しました');
}

// ----------------------------------------------------------------
// Gooslie API から未処理注文を取得
// ----------------------------------------------------------------
function getGooslieNewOrders_() {
  if (!GOOSLIE_CONFIG.API_BASE_URL) {
    Logger.log('Gooslie: API_BASE_URL が未設定です');
    return [];
  }

  var url = GOOSLIE_CONFIG.API_BASE_URL + '/shops/' + GOOSLIE_CONFIG.SHOP_ID + '/orders'
          + '?status=new&per_page=100';

  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + GOOSLIE_CONFIG.API_KEY,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Gooslie API エラー: ' + res.getContentText());
    return [];
  }

  var json = JSON.parse(res.getContentText());
  return json.orders || json.data || [];
}

// ----------------------------------------------------------------
// スプレッドシートへ書き込み
// ----------------------------------------------------------------
function writeOrdersToSheet_(orders) {
  var ss    = SpreadsheetApp.openById(GOOSLIE_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(GOOSLIE_CONFIG.SHEET_NAME)
              || ss.insertSheet(GOOSLIE_CONFIG.SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['注文番号', '注文日', '購入者名', '合計金額', '取得日時', 'モール', 'ステータス']);
  }

  var now = new Date();
  orders.forEach(function(order) {
    sheet.appendRow([
      order.order_id || order.id,
      order.ordered_at || order.created_at,
      order.buyer_name || order.customer_name,
      order.total_price || order.total_amount,
      now,
      'Gooslie',
      order.status || '未処理'
    ]);
  });
}
