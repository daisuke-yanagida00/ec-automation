// ============================================================
// 全モール統合 注文書き込み
// ============================================================

var PROPS = PropertiesService.getScriptProperties();

var CONFIG = {
  SPREADSHEET_ID: PROPS.getProperty('SPREADSHEET_ID'),
  SHEET_NAME:     '注文統合',
  RAKUTEN: {
    SERVICE_SECRET: PROPS.getProperty('RAKUTEN_SERVICE_SECRET'),
    LICENSE_KEY:    PROPS.getProperty('RAKUTEN_LICENSE_KEY')
  }
};

// 注文統合シートの列定義（0始まり）
var COL = {
  ORDER_DATE:   0,  // 注文日時
  MALL:         1,  // モール
  ORDER_ID:     2,  // 注文ID  ← 重複チェックキー
  CUSTOMER:     3,  // 顧客名
  ITEM_NAME:    4,  // 商品名
  SKU:          5,  // SKU
  QTY:          6,  // 数量
  PRICE:        7,  // 売上金額
  POSTAGE:      8,  // 送料
  STATUS:       9,  // 注文ステータス
  PREFECTURE:   10, // 配送先都道府県
  FETCHED_AT:   11  // 取得日時
};

var HEADER = [
  '注文日時', 'モール', '注文ID', '顧客名', '商品名', 'SKU',
  '数量', '売上金額', '送料', '注文ステータス', '配送先都道府県', '取得日時'
];

var RAKUTEN_API = 'https://api.rms.rakuten.co.jp/es/2.0/order/';

// 注文進捗コード → 日本語
var RAKUTEN_STATUS = {
  100: '注文確認待ち',
  200: '楽天処理中',
  300: '発送待ち',
  400: '変更確定待ち',
  500: '発送済み',
  600: '支払い手続き中',
  700: '支払い手続き済み',
  800: 'キャンセル確定待ち',
  900: 'キャンセル確定'
};

// ================================================================
// メイン：楽天注文を取得して注文統合シートへ書き込む
// ================================================================
function integrateRakutenOrders() {
  var sheet     = getOrCreateSheet_();
  var existsSet = loadExistingOrderIds_(sheet);

  var orderNumbers = searchRakutenOrders_();
  if (orderNumbers.length === 0) {
    Logger.log('楽天: 対象注文なし');
    return;
  }
  Logger.log('楽天: ' + orderNumbers.length + '件の注文番号を取得');

  // getOrder は1回最大100件
  var newRows   = [];
  var fetchedAt = new Date();
  var chunks    = chunkArray_(orderNumbers, 100);
  var detailCount = 0;
  var dupCount    = 0;

  chunks.forEach(function(chunk) {
    var details = getRakutenOrderDetails_(chunk);
    Logger.log('楽天: getOrder ' + chunk.length + '件送信 → ' + details.length + '件取得');
    detailCount += details.length;

    details.forEach(function(orderModel) {
      var rows    = buildRows_(orderModel, fetchedAt);
      var orderId = rows.length > 0 ? rows[0][COL.ORDER_ID] : '';

      // 重複チェックは注文単位で実施（行単位にすると同一注文の2品目以降が偽重複になる）
      if (existsSet[orderId]) {
        dupCount++;
        return;
      }
      rows.forEach(function(row) { newRows.push(row); });
      existsSet[orderId] = true;
    });
  });

  Logger.log('楽天: 詳細取得 ' + detailCount + '件 / 重複スキップ ' + dupCount + '件 / 新規 ' + newRows.length + '行');

  if (newRows.length === 0) {
    if (detailCount === 0) {
      Logger.log('楽天: 注文詳細が取得できませんでした（getOrder の応答を確認してください）');
    } else {
      Logger.log('楽天: 新規注文なし（全件重複）');
    }
    return;
  }

  appendRows_(sheet, newRows);
  Logger.log('楽天: ' + newRows.length + '行を注文統合シートに書き込みました');
}

// ================================================================
// 楽天 RMS API
// ================================================================

// searchOrder で直近24時間の注文番号一覧を返す
function searchRakutenOrders_() {
  var body = JSON.stringify({
    dateType:          1,
    startDatetime:     getIsoHoursAgo_(24),
    endDatetime:       getIsoNow_(),
    orderProgressList: [100, 200, 300, 400, 500]
  });

  var res = rakutenPost_('searchOrder', body);
  if (!res) return [];

  return res.orderNumberList || [];
}

// getOrder で注文詳細を取得し OrderModel の配列を返す
function getRakutenOrderDetails_(orderNumbers) {
  var body = JSON.stringify({
    orderNumberList: orderNumbers,
    version:         6
  });

  var res = rakutenPost_('getOrder', body);
  if (!res || !res.OrderModelList) return [];

  return res.OrderModelList;
}

// 楽天 RMS API への POST 共通処理
function rakutenPost_(endpoint, jsonBody) {
  var token = Utilities.base64Encode(
    CONFIG.RAKUTEN.SERVICE_SECRET + ':' + CONFIG.RAKUTEN.LICENSE_KEY
  );

  var res = UrlFetchApp.fetch(RAKUTEN_API + endpoint + '/', {
    method:          'post',
    contentType:     'application/json; charset=utf-8',
    headers:         { Authorization: 'ESA ' + token },
    payload:         jsonBody,
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('楽天API [' + endpoint + '] エラー ' + code + ': ' + res.getContentText());
    return null;
  }

  return JSON.parse(res.getContentText());
}

// ================================================================
// OrderModel → シート行への変換（商品単位で1行）
// ================================================================
function buildRows_(orderModel, fetchedAt) {
  var orderDate  = orderModel.orderDatetime
    ? Utilities.parseDate(orderModel.orderDatetime.slice(0, 19), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss")
    : '';
  var orderNo    = orderModel.orderNumber || '';
  var totalPrice = orderModel.totalPrice || 0;
  var postage    = orderModel.postagePrice || 0;
  var statusCode = orderModel.orderProgress;
  var status     = RAKUTEN_STATUS[statusCode] || String(statusCode);

  // 顧客名：注文者姓名を連結
  var orderer  = orderModel.OrdererModel || {};
  var customer = (orderer.familyName || '') + ' ' + (orderer.firstName || '');
  customer = customer.trim();

  var rows = [];

  var packages = orderModel.PackageModelList || [];
  packages.forEach(function(pkg) {
    var sender     = pkg.SenderModel || {};
    var prefecture = sender.prefecture || '';
    var items      = pkg.ItemModelList || [];

    items.forEach(function(item) {
      rows.push([
        orderDate,                        // 注文日時
        '楽天',                           // モール
        orderNo,                          // 注文ID
        customer,                         // 顧客名
        item.itemName      || '',         // 商品名
        item.manageNumber  || '',         // SKU
        item.units         || 0,          // 数量
        totalPrice,                       // 売上金額（注文単位）
        postage,                          // 送料（注文単位）
        status,                           // 注文ステータス
        prefecture,                       // 配送先都道府県
        fetchedAt                         // 取得日時
      ]);
    });
  });

  // 商品明細が空の注文でも1行残す
  if (rows.length === 0) {
    rows.push([
      orderDate, '楽天', orderNo, customer, '', '', 0,
      totalPrice, postage, status, '', fetchedAt
    ]);
  }

  return rows;
}


// ================================================================
// スプレッドシート操作
// ================================================================

function getOrCreateSheet_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 既存の注文IDをオブジェクト（ハッシュセット）として返す
function loadExistingOrderIds_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};

  var orderIdCol = COL.ORDER_ID + 1; // getRange は1始まり
  var values = sheet.getRange(2, orderIdCol, lastRow - 1, 1).getValues();

  var set = {};
  values.forEach(function(row) {
    if (row[0]) set[row[0]] = true;
  });
  return set;
}

// 新規行をまとめて末尾に追加（1行ずつ appendRow より高速）
function appendRows_(sheet, rows) {
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, HEADER.length).setValues(rows);
}

// ================================================================
// ユーティリティ
// ================================================================

function getIsoNow_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss'+0900'");
}

function getIsoHoursAgo_(hours) {
  var d = new Date(Date.now() - hours * 60 * 60 * 1000);
  return Utilities.formatDate(d, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss'+0900'");
}

function chunkArray_(arr, size) {
  var chunks = [];
  for (var i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ================================================================
// Amazon SP-API 注文統合
// ================================================================

var AMAZON_SP = {
  TOKEN_URL:  'https://api.amazon.com/auth/o2/token',
  BASE_URL:   'https://sellingpartnerapi-fe.amazon.com',
  MARKET_ID:  'A1VC38T7YXB528'
};

var AMAZON_ORDER_STATUS = {
  'Pending':          '入金待ち',
  'Unshipped':        '未発送',
  'PartiallyShipped': '一部発送済み',
  'Shipped':          '発送済み',
  'Canceled':         'キャンセル',
  'Unfulfillable':    '出荷不可'
};

// メイン：昨日（JST）の注文を取得して注文統合シートへ書き込む
function integrateAmazonOrders() {
  var token = getAmazonAccessToken_();
  if (!token) return;

  var sheet     = getOrCreateSheet_();
  var existsSet = loadExistingOrderIds_(sheet);
  var range     = getYesterdayJstRange_();

  var orders = fetchAllAmazonOrders_(token, range.from, range.to);
  if (orders.length === 0) {
    Logger.log('Amazon: 昨日の注文なし');
    return;
  }
  Logger.log('Amazon: ' + orders.length + '件の注文を取得');

  var newRows   = [];
  var fetchedAt = new Date();

  orders.forEach(function(order) {
    var orderId = order.AmazonOrderId;
    if (existsSet[orderId]) return;

    var items = fetchAmazonOrderItems_(token, orderId);
    buildAmazonRows_(order, items, fetchedAt).forEach(function(row) {
      newRows.push(row);
    });
    existsSet[orderId] = true;
  });

  if (newRows.length === 0) {
    Logger.log('Amazon: 新規注文なし（全件重複）');
    return;
  }

  appendRows_(sheet, newRows);
  Logger.log('Amazon: ' + newRows.length + '行を注文統合シートに書き込みました');
}

// LWA アクセストークン取得
function getAmazonAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var clientId     = props.getProperty('AMAZON_CLIENT_ID');
  var clientSecret = props.getProperty('AMAZON_CLIENT_SECRET');
  var refreshToken = props.getProperty('AMAZON_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    Logger.log('Amazon: AMAZON_CLIENT_ID / AMAZON_CLIENT_SECRET / AMAZON_REFRESH_TOKEN が未設定です');
    return null;
  }

  var res = UrlFetchApp.fetch(AMAZON_SP.TOKEN_URL, {
    method: 'post',
    payload: {
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Amazon トークン取得失敗: ' + res.getContentText());
    return null;
  }

  return JSON.parse(res.getContentText()).access_token || null;
}

// NextToken でページネーションしながら全注文を取得
function fetchAllAmazonOrders_(token, createdAfter, createdBefore) {
  var orders    = [];
  var nextToken = null;

  do {
    var page = fetchAmazonOrderPage_(token, createdAfter, createdBefore, nextToken);
    if (!page) break;
    (page.Orders || []).forEach(function(o) { orders.push(o); });
    nextToken = page.NextToken || null;
  } while (nextToken);

  return orders;
}

// 1ページ分の注文を取得（NextToken がある場合は日付パラメータ不要）
function fetchAmazonOrderPage_(token, createdAfter, createdBefore, nextToken) {
  var url = AMAZON_SP.BASE_URL + '/orders/v0/orders'
          + '?MarketplaceIds=' + AMAZON_SP.MARKET_ID;

  if (nextToken) {
    url += '&NextToken=' + encodeURIComponent(nextToken);
  } else {
    url += '&CreatedAfter='  + encodeURIComponent(createdAfter)
        +  '&CreatedBefore=' + encodeURIComponent(createdBefore)
        +  '&MaxResultsPerPage=100';
  }

  var res = UrlFetchApp.fetch(url, {
    method:  'get',
    headers: { 'x-amz-access-token': token },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Amazon orders API エラー ' + res.getResponseCode()
               + ': ' + res.getContentText());
    return null;
  }

  var json = JSON.parse(res.getContentText());
  return json.payload || null;
}

// 注文明細（商品リスト）を取得
function fetchAmazonOrderItems_(token, orderId) {
  Utilities.sleep(300);  // SP-API レート制限 0.5 req/s 対策

  var url = AMAZON_SP.BASE_URL + '/orders/v0/orders/' + orderId + '/orderItems';
  var res = UrlFetchApp.fetch(url, {
    method:  'get',
    headers: { 'x-amz-access-token': token },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Amazon orderItems エラー [' + orderId + ']: ' + res.getContentText());
    return [];
  }

  var json = JSON.parse(res.getContentText());
  return (json.payload && json.payload.OrderItems) ? json.payload.OrderItems : [];
}

// 注文 + 商品リスト → シート行（商品単位で1行）
function buildAmazonRows_(order, items, fetchedAt) {
  var orderId    = order.AmazonOrderId;
  var orderDate  = order.PurchaseDate  || '';
  var status     = AMAZON_ORDER_STATUS[order.OrderStatus] || order.OrderStatus || '';
  var orderTotal = (order.OrderTotal && order.OrderTotal.Amount)
                   ? parseFloat(order.OrderTotal.Amount) : 0;

  var buyerName  = (order.BuyerInfo      && order.BuyerInfo.BuyerName)            || '';
  var prefecture = (order.ShippingAddress && order.ShippingAddress.StateOrRegion) || '';

  var rows = [];

  if (items.length > 0) {
    items.forEach(function(item) {
      // 商品単位の金額（ItemPrice）を優先、なければ注文合計を按分せず0
      var itemPrice = (item.ItemPrice && item.ItemPrice.Amount)
                      ? parseFloat(item.ItemPrice.Amount) : 0;
      var shipPrice = (item.ShippingPrice && item.ShippingPrice.Amount)
                      ? parseFloat(item.ShippingPrice.Amount) : 0;
      rows.push([
        orderDate,
        'Amazon',
        orderId,
        buyerName,
        item.Title           || '',
        item.SellerSKU       || '',
        item.QuantityOrdered || 0,
        itemPrice,   // 商品単位の売上金額
        shipPrice,
        status,
        prefecture,
        fetchedAt
      ]);
    });
  } else {
    rows.push([
      orderDate, 'Amazon', orderId, buyerName,
      '', '', 0, orderTotal, 0, status, prefecture, fetchedAt
    ]);
  }

  return rows;
}

// 昨日の JST 日付範囲を UTC の ISO 8601 文字列で返す
function getYesterdayJstRange_() {
  var jstOffset = 9 * 60 * 60 * 1000;
  var nowJst    = new Date(Date.now() + jstOffset);

  var startJst = new Date(Date.UTC(
    nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate() - 1,
    0, 0, 0
  ));
  var endJst = new Date(Date.UTC(
    nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate() - 1,
    23, 59, 59
  ));

  return {
    from: new Date(startJst.getTime() - jstOffset).toISOString(),
    to:   new Date(endJst.getTime()   - jstOffset).toISOString()
  };
}

// ================================================================
// 楽天 週次売上レポート
// ================================================================
function weeklyRakutenReport() {
  var ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var srcSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!srcSheet) {
    Logger.log('週次レポート: 注文統合シートが存在しません');
    return;
  }

  var lastRow = srcSheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('週次レポート: データがありません');
    return;
  }

  var data = srcSheet.getRange(2, 1, lastRow - 1, HEADER.length).getValues();

  // 直近7日（今日を含む）の楽天データを抽出
  var weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  var rows = data.filter(function(row) {
    if (row[COL.MALL] !== '楽天') return false;
    var d = new Date(row[COL.ORDER_DATE]);
    return !isNaN(d.getTime()) && d >= weekStart;
  });

  // 日別集計：売上金額は注文単位の値が商品行ごとに繰り返されるため ORDER_ID で重複排除
  var dayMap      = {};  // dateStr → { sales: number, orderIds: {} }
  var addedOrders = {};  // "dateStr\x00orderId" → true

  rows.forEach(function(row) {
    var d       = new Date(row[COL.ORDER_DATE]);
    var dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
    var orderId = String(row[COL.ORDER_ID]);
    var key     = dateStr + '\x00' + orderId;

    if (!dayMap[dateStr]) dayMap[dateStr] = { sales: 0, orderIds: {} };
    if (!addedOrders[key]) {
      dayMap[dateStr].sales += Number(row[COL.PRICE]) || 0;
      dayMap[dateStr].orderIds[orderId] = true;
      addedOrders[key] = true;
    }
  });

  var sortedDates = Object.keys(dayMap).sort();

  // 商品別集計：アイテム単価が存在しないため数量（QTY）で集計
  var itemMap = {};
  rows.forEach(function(row) {
    var name = String(row[COL.ITEM_NAME]) || '（商品名なし）';
    if (!itemMap[name]) itemMap[name] = 0;
    itemMap[name] += Number(row[COL.QTY]) || 0;
  });

  var top10 = Object.keys(itemMap)
    .map(function(n)    { return [n, itemMap[n]]; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 10);

  // レポートシート初期化
  var report = ss.getSheetByName('週次レポート') || ss.insertSheet('週次レポート');
  report.clearContents();
  report.clearFormats();

  var startLabel = Utilities.formatDate(weekStart, 'Asia/Tokyo', 'yyyy/MM/dd');
  var endLabel   = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  var out = [];

  // タイトル
  out.push(['楽天市場 週次売上レポート', startLabel + ' 〜 ' + endLabel, '']);
  out.push(['', '', '']);

  // 日別集計セクション
  var dailySectionRow = out.length + 1;
  out.push(['【日別集計】', '', '']);
  var dailyHeaderRow = out.length + 1;
  out.push(['日付', '売上金額（円）', '注文件数']);

  var sumSales = 0, sumOrders = 0;
  sortedDates.forEach(function(d) {
    var cnt = Object.keys(dayMap[d].orderIds).length;
    out.push([d, dayMap[d].sales, cnt]);
    sumSales  += dayMap[d].sales;
    sumOrders += cnt;
  });
  var totalRow = out.length + 1;
  out.push(['合計', sumSales, sumOrders]);
  out.push(['', '', '']);

  // 商品別ランキングセクション
  var rankSectionRow = out.length + 1;
  out.push(['【商品別販売数ランキング Top10】', '', '']);
  var rankHeaderRow = out.length + 1;
  out.push(['順位', '商品名', '販売数量（個）']);
  top10.forEach(function(item, i) {
    out.push([i + 1, item[0], item[1]]);
  });

  report.getRange(1, 1, out.length, 3).setValues(out);

  // 書式設定
  report.getRange(1, 1, 1, 2).setFontSize(14).setFontWeight('bold');
  report.getRange(dailySectionRow, 1).setFontWeight('bold');
  report.getRange(dailyHeaderRow, 1, 1, 3).setFontWeight('bold').setBackground('#d9ead3');
  report.getRange(totalRow, 1, 1, 3).setFontWeight('bold').setBackground('#f3f3f3');
  report.getRange(rankSectionRow, 1).setFontWeight('bold');
  report.getRange(rankHeaderRow, 1, 1, 3).setFontWeight('bold').setBackground('#cfe2f3');
  if (sortedDates.length > 0) {
    report.getRange(dailyHeaderRow + 1, 2, sortedDates.length + 1, 1).setNumberFormat('#,##0');
  }
  report.autoResizeColumn(1);
  report.autoResizeColumn(2);
  report.autoResizeColumn(3);

  Logger.log('週次レポート: 完了 (' + startLabel + ' 〜 ' + endLabel
    + ') 売上合計 ' + sumSales + '円 / ' + sumOrders + '件');
}

// ================================================================
// 日次トリガー設定（初回のみ手動実行）
// ================================================================
function setupDailyTrigger() {
  var targets = ['integrateRakutenOrders', 'integrateAmazonOrders'];

  // 対象関数の既存トリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (targets.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 各関数を毎朝8時に実行するトリガーを登録
  targets.forEach(function(funcName) {
    ScriptApp.newTrigger(funcName)
      .timeBased()
      .everyDays(1)
      .atHour(8)
      .create();
  });

  Logger.log('日次トリガーを設定しました（毎朝8時）: ' + targets.join(', '));
}
