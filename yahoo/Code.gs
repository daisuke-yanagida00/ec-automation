// ============================================================
// Yahoo!ショッピング 注文統合書き込み
// 関数名・変数名は _yInt 接尾辞でコード.js との衝突を回避
// トークン取得を含め自己完結
// ============================================================

var YINT_SHEET_NAME = '注文統合';

var YINT_HEADER = [
  '注文日時', 'モール', '注文ID', '顧客名', '商品名', 'SKU',
  '数量', '売上金額', '送料', '注文ステータス', '配送先都道府県', '取得日時'
];

// 列インデックス（0始まり）
var YINT_COL = {
  ORDER_DATE:  0,
  MALL:        1,
  ORDER_ID:    2,
  CUSTOMER:    3,
  ITEM_NAME:   4,
  SKU:         5,
  QTY:         6,
  PRICE:       7,
  POSTAGE:     8,
  STATUS:      9,
  PREFECTURE:  10,
  FETCHED_AT:  11
};

var YINT_STATUS = {
  1: '予約中',
  2: '処理中',
  3: '保留',
  4: '完了',
  8: 'キャンセル待ち',
  9: 'キャンセル',
  10: '返品'
};

var YINT_ORDER_API = 'https://circus.shopping.yahooapis.jp/ShoppingWebService/V1/orderList';

// ================================================================
// メイン：直近24時間の注文を取得して注文統合シートへ書き込む
// ================================================================
function integrateYahooOrders() {
  var props    = PropertiesService.getScriptProperties();
  var sellerId = (props.getProperty('SELLER_ID') || '').trim();
  if (!sellerId) {
    Logger.log('Yahoo統合: SELLER_ID が未設定です');
    return;
  }

  var token = getYIntAccessToken_();
  if (!token) {
    Logger.log('Yahoo統合: アクセストークン取得失敗');
    return;
  }

  var sheet     = getYIntSheet_();
  var existsSet = loadYIntOrderIds_(sheet);

  var from = formatYIntDate_(new Date(Date.now() - 24 * 3600 * 1000));
  var to   = formatYIntDate_(new Date());

  var orders  = [];
  var offset  = 1;
  var limit   = 2000;

  while (true) {
    var result = fetchYIntOrderPage_(token, sellerId, from, to, offset, limit);
    if (!result || result.orders.length === 0) break;
    result.orders.forEach(function(o) { orders.push(o); });
    if (result.orders.length < limit) break;
    offset += limit;
  }

  if (orders.length === 0) {
    Logger.log('Yahoo統合: 対象注文なし');
    return;
  }
  Logger.log('Yahoo統合: ' + orders.length + '件の注文を取得');

  var newRows   = [];
  var fetchedAt = new Date();

  orders.forEach(function(order) {
    if (existsSet[order.orderId]) return;  // 注文単位で重複チェック
    buildYIntRows_(order, fetchedAt).forEach(function(row) { newRows.push(row); });
    existsSet[order.orderId] = true;
  });

  if (newRows.length === 0) {
    Logger.log('Yahoo統合: 新規注文なし（全件重複）');
    return;
  }

  appendYIntRows_(sheet, newRows);
  Logger.log('Yahoo統合: ' + newRows.length + '行を書き込みました');
}

// ================================================================
// orderList API を1ページ分呼び出して注文オブジェクト配列を返す
// ================================================================
function fetchYIntOrderPage_(token, sellerId, fromDate, toDate, offset, limit) {
  var xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Req>' +
    '<SellerId>' + sellerId + '</SellerId>' +
    '<Search>' +
    '<Condition>' +
    '<OrderTimeFrom>' + fromDate + '</OrderTimeFrom>' +
    '<OrderTimeTo>'   + toDate   + '</OrderTimeTo>' +
    '</Condition>' +
    '<Field>OrderId,OrderTime,OrderStatus,TotalPrice,PostCharge,' +
    'BuyerInfo,ShipInfo,Detail</Field>' +
    '<Result>' +
    '<Offset>' + offset + '</Offset>' +
    '<Limit>'  + limit  + '</Limit>' +
    '</Result>' +
    '</Search>' +
    '</Req>';

  try {
    var res = UrlFetchApp.fetch(YINT_ORDER_API, {
      method:  'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/xml'
      },
      payload:            xml,
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      Logger.log('Yahoo統合 orderList エラー ' + res.getResponseCode() +
                 ': ' + res.getContentText());
      return null;
    }

    return parseYIntOrdersXml_(res.getContentText());

  } catch(e) {
    Logger.log('Yahoo統合 fetchYIntOrderPage_ 例外: ' + e.message);
    return null;
  }
}

// ================================================================
// XML レスポンスを注文オブジェクト配列に変換
// parseOrderXml（コード.js）と名前が異なるため衝突なし
// ================================================================
function parseYIntOrdersXml_(xmlText) {
  var orders = [];
  try {
    var root = XmlService.parse(xmlText).getRootElement();
    var ns   = root.getNamespace();

    var gc = function(el, name) {
      return ns ? el.getChild(name, ns) : el.getChild(name);
    };
    var gt = function(el, name) {
      var c = gc(el, name);
      return c ? c.getText().trim() : '';
    };
    var gcs = function(el, name) {
      return ns ? el.getChildren(name, ns) : el.getChildren(name);
    };

    gcs(root, 'Result').forEach(function(result) {
      gcs(result, 'OrderInfo').forEach(function(info) {
        var orderId    = gt(info, 'OrderId');
        var orderTime  = gt(info, 'OrderTime');
        var statusCode = parseInt(gt(info, 'OrderStatus')) || 0;
        var totalPrice = parseFloat(gt(info, 'TotalPrice')) || 0;
        var postCharge = parseFloat(gt(info, 'PostCharge')) || 0;

        // 購入者情報
        var buyerInfo = gc(info, 'BuyerInfo');
        var buyerName = buyerInfo ? gt(buyerInfo, 'BuyerName') : '';

        // 配送先情報
        var prefecture = '';
        var shipName   = '';
        var shipInfo   = gc(info, 'ShipInfo');
        if (shipInfo) {
          shipName = gt(shipInfo, 'ShipName');
          var addr = gc(shipInfo, 'ShipAddress');
          if (addr) prefecture = gt(addr, 'Prefecture');
          if (!prefecture) prefecture = gt(shipInfo, 'ShipPrefecture');
        }

        // 商品明細
        var items = [];
        var detail = gc(info, 'Detail');
        if (detail) {
          gcs(detail, 'Item').forEach(function(itemEl) {
            items.push({
              itemName:  gt(itemEl, 'Title'),
              sku:       gt(itemEl, 'ItemId'),
              qty:       parseInt(gt(itemEl, 'Quantity'))    || 1,
              unitPrice: parseFloat(gt(itemEl, 'UnitPrice')) || 0
            });
          });
        }

        if (orderId) {
          orders.push({
            orderId:    orderId,
            orderTime:  orderTime,
            statusCode: statusCode,
            totalPrice: totalPrice,
            postCharge: postCharge,
            customer:   shipName || buyerName,
            prefecture: prefecture,
            items:      items
          });
        }
      });
    });

  } catch(e) {
    Logger.log('Yahoo統合 XML解析エラー: ' + e.message);
  }

  return { orders: orders };
}

// ================================================================
// 注文オブジェクト → シート行（商品単位で1行ずつ展開）
// buildRows_（コード.js にはない）
// ================================================================
function buildYIntRows_(order, fetchedAt) {
  var status = YINT_STATUS[order.statusCode] || String(order.statusCode);
  var rows   = [];

  if (order.items.length > 0) {
    order.items.forEach(function(item) {
      rows.push([
        order.orderTime,   // 注文日時
        'Yahoo',           // モール
        order.orderId,     // 注文ID
        order.customer,    // 顧客名
        item.itemName,     // 商品名
        item.sku,          // SKU
        item.qty,          // 数量
        order.totalPrice,  // 売上金額（注文単位）
        order.postCharge,  // 送料（注文単位）
        status,            // 注文ステータス
        order.prefecture,  // 配送先都道府県
        fetchedAt          // 取得日時
      ]);
    });
  } else {
    // 商品明細が取得できなかった場合は注文単位で1行
    rows.push([
      order.orderTime, 'Yahoo', order.orderId, order.customer,
      '', '', 0, order.totalPrice, order.postCharge,
      status, order.prefecture, fetchedAt
    ]);
  }

  return rows;
}

// ================================================================
// スプレッドシート操作
// ================================================================

function getYIntSheet_() {
  var id = (PropertiesService.getScriptProperties()
              .getProperty('SPREADSHEET_ID') || '').trim();
  var ss    = SpreadsheetApp.openById(id);
  var sheet = ss.getSheetByName(YINT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(YINT_SHEET_NAME);
    sheet.appendRow(YINT_HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function loadYIntOrderIds_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};
  var col    = YINT_COL.ORDER_ID + 1;  // getRange は1始まり
  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  var set    = {};
  values.forEach(function(row) { if (row[0]) set[row[0]] = true; });
  return set;
}

function appendYIntRows_(sheet, rows) {
  var last = sheet.getLastRow();
  sheet.getRange(last + 1, 1, rows.length, YINT_HEADER.length).setValues(rows);
}

// ================================================================
// ユーティリティ
// formatYahooDate（コード.js）は (date, h, m, s) 形式のため別名で定義
// ================================================================

// Yahoo API の日時フォーマット: yyyyMMddHHmmss
function formatYIntDate_(date) {
  var f = function(n) { return ('0' + n).slice(-2); };
  return '' + date.getFullYear() + f(date.getMonth() + 1) + f(date.getDate()) +
         f(date.getHours()) + f(date.getMinutes()) + f(date.getSeconds());
}

// ================================================================
// Yahoo OAuth2 アクセストークン取得（リフレッシュトークン自動更新）
// getAccessToken（コード.js）と名前が異なるため衝突なし
// ================================================================
function getYIntAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var cid   = (props.getProperty('CLIENT_ID')     || '').trim();
  var cs    = (props.getProperty('CLIENT_SECRET') || '').trim();
  var rt    = (props.getProperty('REFRESH_TOKEN') || '').trim();

  if (!cid || !cs || !rt) {
    Logger.log('Yahoo統合: CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN が未設定です');
    return null;
  }

  try {
    var res = UrlFetchApp.fetch('https://auth.login.yahoo.co.jp/yconnect/v2/token', {
      method: 'post',
      payload: {
        grant_type:    'refresh_token',
        refresh_token: rt,
        client_id:     cid,
        client_secret: cs
      },
      muteHttpExceptions: true
    });

    var json = JSON.parse(res.getContentText());
    if (json.error) {
      Logger.log('Yahoo統合 トークンエラー: ' + json.error + ' / ' + json.error_description);
      return null;
    }

    // リフレッシュトークンが更新された場合は保存
    if (json.refresh_token) props.setProperty('REFRESH_TOKEN', json.refresh_token);

    return json.access_token || null;

  } catch(e) {
    Logger.log('Yahoo統合 トークン取得例外: ' + e.message);
    return null;
  }
}
