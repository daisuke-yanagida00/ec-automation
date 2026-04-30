// ============================================================
// 自社サイト 注文データ取得・処理
// ============================================================

var JISYA_CONFIG = {
  API_BASE_URL:   PropertiesService.getScriptProperties().getProperty('JISYA_API_BASE_URL'),
  API_KEY:        PropertiesService.getScriptProperties().getProperty('JISYA_API_KEY'),
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
  SHEET_NAME:     '自社注文'
};

// ----------------------------------------------------------------
// メイン：新規注文を取得してスプレッドシートに書き込む
// ----------------------------------------------------------------
function fetchJisyaOrders() {
  var orders = getJisyaNewOrders_();
  if (!orders || orders.length === 0) {
    Logger.log('自社: 新規注文なし');
    return;
  }
  writeOrdersToSheet_(orders);
  Logger.log('自社: ' + orders.length + '件の注文を記録しました');
}

// ----------------------------------------------------------------
// 自社API から未処理注文を取得
// ----------------------------------------------------------------
function getJisyaNewOrders_() {
  if (!JISYA_CONFIG.API_BASE_URL) {
    Logger.log('自社: API_BASE_URL が未設定です');
    return [];
  }

  var url = JISYA_CONFIG.API_BASE_URL + '/orders?status=new&limit=100';

  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'X-API-Key': JISYA_CONFIG.API_KEY,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('自社API エラー: ' + res.getContentText());
    return [];
  }

  var json = JSON.parse(res.getContentText());
  return json.orders || [];
}

// ----------------------------------------------------------------
// スプレッドシートへ書き込み
// ----------------------------------------------------------------
function writeOrdersToSheet_(orders) {
  var ss    = SpreadsheetApp.openById(JISYA_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(JISYA_CONFIG.SHEET_NAME)
              || ss.insertSheet(JISYA_CONFIG.SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['注文番号', '注文日', '購入者名', '合計金額', '商品数', '取得日時', 'モール', 'ステータス']);
  }

  var now = new Date();
  orders.forEach(function(order) {
    sheet.appendRow([
      order.order_id || order.id,
      order.created_at,
      order.customer_name,
      order.total_amount,
      order.item_count,
      now,
      '自社',
      order.status || '未処理'
    ]);
  });
}

// ----------------------------------------------------------------
// 注文ステータスを更新する
// ----------------------------------------------------------------
function updateJisyaOrderStatus(orderId, newStatus) {
  var url = JISYA_CONFIG.API_BASE_URL + '/orders/' + orderId + '/status';

  var res = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: {
      'X-API-Key': JISYA_CONFIG.API_KEY,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ status: newStatus }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('自社ステータス更新エラー [' + orderId + ']: ' + res.getContentText());
    return false;
  }
  return true;
}
