// ============================================================
// 全モール統合 注文書き込み
// Last updated: 2026-06-10
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

// searchOrder で直近48時間の注文番号一覧を返す（24hだと早朝注文が翌日8時実行で取りこぼす）
// dateType:1（注文確定日）が実績あり。dateType:0は取得不可のため使用しない
function searchRakutenOrders_() {
  var body = JSON.stringify({
    dateType:          1,
    startDatetime:     getIsoHoursAgo_(48),
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
    if (code === 401) {
      notifyRakutenKeyExpired_();
    }
    return null;
  }

  return JSON.parse(res.getContentText());
}

// 楽天APIキー失効をメールで通知（1日1回まで）
function notifyRakutenKeyExpired_() {
  var props    = PropertiesService.getScriptProperties();
  var lastSent = props.getProperty('RAKUTEN_401_LAST_NOTIFIED') || '';
  var today    = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  if (lastSent === today) return; // 同日は1通のみ

  var email   = Session.getActiveUser().getEmail();
  var subject = '【要対応】楽天APIキーが失効しました（EC注文統合）';
  var body    = [
    '楽天RMS APIへの接続が401エラーで失敗しました。',
    '',
    '■ 原因',
    'ライセンスキーの有効期限が切れた可能性があります。',
    '楽天RMSのAPIキーは約3ヶ月ごとに自動失効します。',
    '',
    '■ 対処手順',
    '1. 楽天RMS WEB SERVICE (webservice.rms.rakuten.co.jp) にログイン',
    '2. 利用設定 → 2-1 アプリ一覧 → 対象アプリ',
    '3. 新しいライセンスキーを確認（「利用中」のもの）',
    '4. GAS Script Propertiesを更新:',
    '   - EC注文統合: https://script.google.com/d/1JY-l8MYvPa1d0DEvbVcbJqfKz5gSEQWuDH1mAif-z6I1vq8uQQHNNT3X/edit',
    '   - 楽天GAS:    https://script.google.com/d/10h7vJgq-3P3PohO6U26xrOpEDL3FnVohZZb6EuborOPlOm5qMA6fRYVg/edit',
    '   - プロパティ名: RAKUTEN_LICENSE_KEY / RAKUTEN_SERVICE_SECRET',
    '',
    '■ 次回期限',
    '更新後、RMSで表示される有効期限（約3ヶ月後）をご確認ください。',
  ].join('\n');

  try {
    GmailApp.sendEmail(email, subject, body);
    props.setProperty('RAKUTEN_401_LAST_NOTIFIED', today);
    Logger.log('楽天APIキー失効通知メールを送信しました: ' + email);
  } catch(e) {
    Logger.log('メール送信失敗: ' + e);
  }
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
    url += '&CreatedAfter='    + encodeURIComponent(createdAfter)
        +  '&CreatedBefore='   + encodeURIComponent(createdBefore)
        +  '&OrderStatuses=Pending,Unshipped,PartiallyShipped,Shipped'  // SC売上に合わせて未発送含む全注文を集計
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
  var orderDate  = order.PurchaseDate ? new Date(order.PurchaseDate) : '';
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
// 手動売上ログ（Amazon SC値・Yahoo!日次 → スプレッドシートに永続保存）
// シート名: '手動売上ログ'  列: 日付(YYYY-MM-DD) | モール | 売上金額 | 登録日時
// ================================================================
var MANUAL_SHEET = '手動売上ログ';

function ensureManualSheet_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(MANUAL_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MANUAL_SHEET);
    sheet.appendRow(['日付', 'モール', '売上金額', '登録日時']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  return sheet;
}

// 手動ログを読み込む → { 'YYYY-MM-DD': { amazon: 0, yahoo: 0 } }
function getManualLog_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(MANUAL_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return {};
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  var log  = {};
  data.forEach(function(row) {
    var date   = String(row[0]).trim();
    var mall   = String(row[1]).trim();
    var amount = Number(row[2]) || 0;
    if (!date || !amount) return;
    if (!log[date]) log[date] = { amazon: 0, yahoo: 0 };
    if (mall === 'Amazon') log[date].amazon = amount;
    if (mall === 'Yahoo')  log[date].yahoo  = amount;
  });
  return log;
}

// 1日分の売上を保存/更新/削除 (amount=0 → 削除)
function saveDailyEntry_(mall, dateStr, amount) {
  if (!mall || !dateStr) return { ok: false, error: 'パラメータ不足' };
  var sheet   = ensureManualSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === dateStr && String(rows[i][1]) === mall) {
        if (amount > 0) {
          sheet.getRange(i + 2, 3, 1, 2).setValues([[amount, new Date()]]);
          return { ok: true, action: 'updated', date: dateStr, mall: mall, amount: amount };
        } else {
          sheet.deleteRow(i + 2);
          return { ok: true, action: 'deleted', date: dateStr, mall: mall };
        }
      }
    }
  }
  if (amount > 0) {
    sheet.appendRow([dateStr, mall, amount, new Date()]);
    return { ok: true, action: 'inserted', date: dateStr, mall: mall, amount: amount };
  }
  return { ok: true, action: 'noop' };
}

// ================================================================
// Web App：売上サマリーを JSON で返す & 手動ログ保存を受け付ける
// デプロイ方法: GASエディタ → デプロイを管理 → 鉛筆 → 新しいバージョン → デプロイ
//   実行ユーザー: 自分、アクセス: 全員
// ================================================================
function doGet(e) {
  var p        = e && e.parameter ? e.parameter : {};
  var callback = p.callback || null;
  var result;

  // action=save: Amazon/Yahoo!の日次売上をスプレッドシートに保存
  if (p.action === 'save') {
    result = saveDailyEntry_(p.mall || '', p.date || '', Number(p.amount) || 0);
  } else if (p.type === 'weekly') {
    result = getWeeklyReport_();
  } else {
    result = getSalesSummary_();
  }

  var json = JSON.stringify(result);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ================================================================
// 楽天 週次データを JSON で返す（?type=weekly）
// メルマガ作成・分析用：直近28日の日別・週次・商品ランキング
// ================================================================
function getWeeklyReport_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return { error: 'シートが存在しません' };

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { daily: [], weeks: [], topItems: [] };

  var data = sheet.getRange(2, 1, lastRow - 1, HEADER.length).getValues();
  var now  = new Date();

  // 直近28日の楽天行を抽出
  var cutoff = new Date(now.getTime() - 27 * 24 * 60 * 60 * 1000);
  cutoff.setHours(0, 0, 0, 0);

  var rows = data.filter(function(row) {
    if (String(row[COL.MALL]) !== '楽天') return false;
    var d = new Date(row[COL.ORDER_DATE]);
    return !isNaN(d.getTime()) && d >= cutoff;
  });

  // 日別集計（ORDER_IDで重複排除）
  var dayMap = {}, addedOrders = {};
  rows.forEach(function(row) {
    var d       = new Date(row[COL.ORDER_DATE]);
    var dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
    var orderId = String(row[COL.ORDER_ID]);
    var key     = dateStr + '\x00' + orderId;
    if (!dayMap[dateStr]) dayMap[dateStr] = { sales: 0, orders: {} };
    if (!addedOrders[key]) {
      dayMap[dateStr].sales += Number(row[COL.PRICE]) || 0;
      dayMap[dateStr].orders[orderId] = true;
      addedOrders[key] = true;
    }
  });

  // 週次集計（week0=直近7日, week1=前週, week2=2週前, week3=3週前）
  var weekTotals = [
    { label: '直近7日',  sales: 0, orderCount: 0 },
    { label: '前週',     sales: 0, orderCount: 0 },
    { label: '2週前',    sales: 0, orderCount: 0 },
    { label: '3週前',    sales: 0, orderCount: 0 }
  ];
  Object.keys(dayMap).forEach(function(dateStr) {
    var d       = new Date(dateStr);
    var daysAgo = Math.floor((now - d) / (24 * 60 * 60 * 1000));
    var idx     = Math.min(3, Math.floor(daysAgo / 7));
    weekTotals[idx].sales      += dayMap[dateStr].sales;
    weekTotals[idx].orderCount += Object.keys(dayMap[dateStr].orders).length;
  });

  // 直近7日の商品別販売数ランキング
  var itemMap = {};
  rows.forEach(function(row) {
    var d       = new Date(row[COL.ORDER_DATE]);
    var daysAgo = Math.floor((now - d) / (24 * 60 * 60 * 1000));
    if (daysAgo > 6) return;
    var name = String(row[COL.ITEM_NAME]) || '（商品名なし）';
    if (!itemMap[name]) itemMap[name] = 0;
    itemMap[name] += Number(row[COL.QTY]) || 0;
  });
  var topItems = Object.keys(itemMap)
    .map(function(n) { return { name: n, qty: itemMap[n] }; })
    .sort(function(a, b) { return b.qty - a.qty; })
    .slice(0, 10);

  // 直近7日の日別配列
  var daily = [];
  for (var i = 6; i >= 0; i--) {
    var d    = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    var dStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
    daily.push({
      date:       dStr.slice(5),
      sales:      dayMap[dStr] ? dayMap[dStr].sales : 0,
      orderCount: dayMap[dStr] ? Object.keys(dayMap[dStr].orders).length : 0
    });
  }

  return {
    generatedAt: Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
    daily:    daily,
    weeks:    weekTotals,
    topItems: topItems
  };
}

function getSalesSummary_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return { error: 'シートが存在しません' };

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { date: '', today: {}, yesterday: {}, monthly: {}, daily: [] };

  var data = sheet.getRange(2, 1, lastRow - 1, HEADER.length).getValues();

  var now         = new Date();
  // ISO形式 YYYY-MM-DD に統一（手動ログと一致させるため）
  var today       = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  var monthPrefix = today.slice(0, 7); // 'YYYY-MM'
  var yd          = new Date(now.getTime() - 86400000);
  var yesterday   = Utilities.formatDate(yd, 'Asia/Tokyo', 'yyyy-MM-dd');
  // 3ヶ月前の1日（過去データを全部チャートに返す）
  var pastStart   = Utilities.formatDate(
    new Date(now.getFullYear(), now.getMonth() - 2, 1), 'Asia/Tokyo', 'yyyy-MM-dd');

  var dailyMap = {}, r_daily = {};

  data.forEach(function(row) {
    var orderDate = row[COL.ORDER_DATE];
    if (!orderDate) return;
    var d       = new Date(orderDate);
    var dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
    var mall    = String(row[COL.MALL]);
    var orderId = String(row[COL.ORDER_ID]);
    var price   = Number(row[COL.PRICE]) || 0;

    // 過去3ヶ月分を日別集計
    if (dateStr >= pastStart) {
      if (!dailyMap[dateStr]) dailyMap[dateStr] = { r: 0, a: 0, y: 0 };
      if (mall === '楽天') {
        if (!r_daily[dateStr]) r_daily[dateStr] = {};
        if (!r_daily[dateStr][orderId]) { r_daily[dateStr][orderId] = true; dailyMap[dateStr].r += price; }
      } else if (mall === 'Amazon') {
        dailyMap[dateStr].a += price;
      } else if (mall === 'Yahoo') {
        dailyMap[dateStr].y += price;
      }
    }
  });

  // 手動ログ（Amazon SC値・Yahoo!手動入力）でSP-API値を上書き
  var manualLog = getManualLog_();
  Object.keys(manualLog).forEach(function(date) {
    if (date < pastStart) return;
    if (!dailyMap[date]) dailyMap[date] = { r: 0, a: 0, y: 0 };
    var ml = manualLog[date];
    if (ml.amazon) dailyMap[date].a = ml.amazon;
    if (ml.yahoo)  dailyMap[date].y = ml.yahoo;
  });

  // dailyMap から各集計を再計算（手動ログ反映後の正確な値）
  var todayM     = { total: 0, rakuten: 0, amazon: 0, yahoo: 0 };
  var yesterdayM = { total: 0, rakuten: 0, amazon: 0, yahoo: 0 };
  var monthlyM   = { total: 0, rakuten: 0, amazon: 0, yahoo: 0 };

  Object.keys(dailyMap).forEach(function(date) {
    var v = dailyMap[date];
    var r = Math.round(v.r), a = Math.round(v.a), y = Math.round(v.y);
    var t = r + a + y;
    if (date === today)    { todayM     = { total: t, rakuten: r, amazon: a, yahoo: y }; }
    if (date === yesterday){ yesterdayM = { total: t, rakuten: r, amazon: a, yahoo: y }; }
    if (date.slice(0, 7) === monthPrefix) {
      monthlyM.rakuten += r; monthlyM.amazon += a;
      monthlyM.yahoo   += y; monthlyM.total  += t;
    }
  });

  // daily 配列：YYYY-MM-DD 形式で全期間を返す（チャートが月別にキャッシュ）
  var daily = Object.keys(dailyMap).sort().map(function(d) {
    var v = dailyMap[d];
    return { date: d, r: Math.round(v.r), a: Math.round(v.a), y: Math.round(v.y) };
  });

  return {
    date:       today,
    yesterday:  yesterday,
    today:      todayM,
    yesterdayS: yesterdayM,
    monthly:    monthlyM,
    daily:      daily
  };
}

// ================================================================
// Yahoo! Shopping 注文統合
// ================================================================
// 初期設定手順:
//   1. スクリプトプロパティに設定:
//      YAHOO_CLIENT_ID     : Client ID（デベロッパーネットワーク）
//      YAHOO_CLIENT_SECRET : Client Secret
//      YAHOO_STORE_ID      : ストアID（例: shingman2）
//   2. Yahoo!デベロッパーネットワークのアプリ設定で
//      コールバックURL に「https://localhost」を登録
//   3. GASエディタで getYahooAuthUrl() を実行 → ログのURLをブラウザで開く
//   4. Yahoo! IDでログイン→認証→localhost にリダイレクト
//      （画面はエラーでOK）URLバーの code= 以降の値をコピー
//   5. handleYahooCallback('コピーしたコード') を実行
//   6. 成功ログが出たら integrateYahooOrders() で動作確認
// ================================================================

function integrateYahooOrders() {
  var token = getYahooAccessToken_();
  if (!token) {
    Logger.log('Yahoo: 未認証。getYahooAuthUrl() でセットアップしてください。');
    return;
  }

  var storeId   = PROPS.getProperty('YAHOO_STORE_ID');
  var sheet     = getOrCreateSheet_();
  var existsSet = loadExistingOrderIds_(sheet);

  var now  = new Date();
  var from = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  var fromStr   = Utilities.formatDate(from, 'Asia/Tokyo', 'yyyyMMddHHmmss');
  var toStr     = Utilities.formatDate(now,  'Asia/Tokyo', 'yyyyMMddHHmmss');
  var fetchedAt = Utilities.formatDate(now,  'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

  var xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Req><Search>' +
      '<Result>100</Result><Start>1</Start>' +
      '<Sort>+order_time</Sort>' +
      '<Condition>' +
        '<OrderTimeFrom>' + fromStr + '</OrderTimeFrom>' +
        '<OrderTimeTo>'   + toStr   + '</OrderTimeTo>' +
      '</Condition>' +
    '</Search>' +
    '<SellerId>' + storeId + '</SellerId></Req>';

  var res = UrlFetchApp.fetch(
    'https://circus.shopping.yahooapis.jp/ShoppingWebService/V1/orderList',
    {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/xml' },
      payload: xml,
      muteHttpExceptions: true
    }
  );

  Logger.log('Yahoo API: ' + res.getResponseCode());
  if (res.getResponseCode() !== 200) {
    Logger.log(res.getContentText());
    return;
  }

  var doc         = XmlService.parse(res.getContentText());
  var root        = doc.getRootElement();
  var orderListEl = root.getChild('OrderList');
  if (!orderListEl) { Logger.log('Yahoo: 注文なし（期間内）'); return; }

  var orders  = orderListEl.getChildren('Order');
  var newRows = [];

  orders.forEach(function(order) {
    var orderId    = yahooXml_(order, 'OrderId');
    var orderTime  = yahooXml_(order, 'OrderTime');
    var status     = yahooXml_(order, 'OrderStatus');
    var lastName   = yahooXml_(order, 'ShipLastName');
    var firstName  = yahooXml_(order, 'ShipFirstName');
    var prefecture = yahooXml_(order, 'ShipPrefecture');
    var totalPrice = Number(yahooXml_(order, 'TotalPrice')) || 0;

    var ot        = orderTime;
    var orderDate = ot.slice(0,4)+'/'+ot.slice(4,6)+'/'+ot.slice(6,8)+' '+
                    ot.slice(8,10)+':'+ot.slice(10,12)+':'+ot.slice(12,14);

    var itemsEl = order.getChild('ItemList');
    var items   = itemsEl ? itemsEl.getChildren('Item') : [];

    if (items.length === 0) {
      if (existsSet[orderId]) return;
      newRows.push([orderDate, 'Yahoo', orderId, lastName+' '+firstName,
                    '', '', 0, totalPrice, 0, status, prefecture, fetchedAt]);
      existsSet[orderId] = true;
    } else {
      items.forEach(function(item) {
        var sku    = yahooXml_(item, 'ItemId');
        var rowKey = orderId + '_' + sku;
        if (existsSet[rowKey]) return;
        var qty   = Number(yahooXml_(item, 'Quantity'))  || 1;
        var unit  = Number(yahooXml_(item, 'UnitPrice')) || 0;
        newRows.push([
          orderDate, 'Yahoo', orderId, lastName+' '+firstName,
          yahooXml_(item, 'Title'), sku, qty, unit * qty,
          0, status, prefecture, fetchedAt
        ]);
        existsSet[rowKey] = true;
      });
    }
  });

  if (newRows.length === 0) { Logger.log('Yahoo: 新規注文なし'); return; }
  sheet.getRange(sheet.getLastRow()+1, 1, newRows.length, HEADER.length).setValues(newRows);
  Logger.log('Yahoo: ' + newRows.length + '行を注文統合シートに書き込みました');
}

function getYahooAuthUrl() {
  var clientId = PROPS.getProperty('YAHOO_CLIENT_ID');
  if (!clientId) { Logger.log('スクリプトプロパティに YAHOO_CLIENT_ID を設定してください'); return; }

  var state = Utilities.getUuid();
  PROPS.setProperty('YAHOO_OAUTH_STATE', state);

  var url = 'https://auth.login.yahoo.co.jp/yconnect/v2/authorization'
    + '?response_type=code'
    + '&client_id='    + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent('https://localhost')
    + '&scope='        + encodeURIComponent('openid')
    + '&state='        + encodeURIComponent(state)
    + '&bail=1';

  Logger.log('【Yahoo! 認証URL】\n' + url
    + '\n\n上記URLをブラウザで開いてYahoo! IDでログイン・許可してください。'
    + '\nlocalhost へリダイレクトされます（エラー画面でOK）。'
    + '\nURLバーの code= 以降の値をコピーして'
    + '\nhandleYahooCallback("コード") を実行してください。');
  return url;
}

function handleYahooCallback(code) {
  var clientId     = PROPS.getProperty('YAHOO_CLIENT_ID');
  var clientSecret = PROPS.getProperty('YAHOO_CLIENT_SECRET');

  var res = UrlFetchApp.fetch('https://auth.login.yahoo.co.jp/yconnect/v2/token', {
    method:  'POST',
    payload: {
      grant_type:    'authorization_code',
      code:          code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  'https://localhost'
    },
    muteHttpExceptions: true
  });

  var body = JSON.parse(res.getContentText());
  if (body.error) { Logger.log('Yahoo 認証エラー: ' + JSON.stringify(body)); return; }

  PROPS.setProperty('YAHOO_REFRESH_TOKEN', body.refresh_token || '');
  PROPS.setProperty('YAHOO_ACCESS_TOKEN',  body.access_token  || '');
  var expiry = Date.now() + ((body.expires_in || 3600) - 300) * 1000;
  PROPS.setProperty('YAHOO_ACCESS_TOKEN_EXPIRY', String(expiry));
  Logger.log('Yahoo: 認証成功！integrateYahooOrders() を実行して動作確認してください。');
}

// GASのドロップダウンから引数なしで実行できる認証コード交換ラッパー
// 事前にスクリプトプロパティ YAHOO_AUTH_CODE に code= の値を設定すること
function runYahooCallback() {
  var code = PROPS.getProperty('YAHOO_AUTH_CODE');
  if (!code) {
    Logger.log('【手順】\n'
      + '1. getYahooAuthUrl() を実行してURLをブラウザで開く\n'
      + '2. Yahoo! IDでログイン → 同意する\n'
      + '3. localhost へリダイレクト（エラー画面でOK）\n'
      + '4. URLバーの code= 以降の値をコピー（例: DtC4DKN3）\n'
      + '5. GASエディタ → プロジェクトの設定 → スクリプトプロパティ\n'
      + '   YAHOO_AUTH_CODE = コピーした値 を追加\n'
      + '6. この関数 runYahooCallback() を再実行');
    return;
  }
  handleYahooCallback(code);
  PROPS.deleteProperty('YAHOO_AUTH_CODE');
}

function getYahooAccessToken_() {
  // キャッシュ済みアクセストークンが有効なら再利用
  var cached = PROPS.getProperty('YAHOO_ACCESS_TOKEN');
  var expiry = Number(PROPS.getProperty('YAHOO_ACCESS_TOKEN_EXPIRY') || '0');
  if (cached && Date.now() < expiry) return cached;

  // リフレッシュトークンがあれば更新
  var refreshToken = PROPS.getProperty('YAHOO_REFRESH_TOKEN');
  var clientId     = PROPS.getProperty('YAHOO_CLIENT_ID');
  var clientSecret = PROPS.getProperty('YAHOO_CLIENT_SECRET');
  if (!refreshToken || !clientId) {
    // リフレッシュトークンなし・期限切れの場合でも一旦キャッシュ値を返す（再認証案内）
    if (cached) { Logger.log('Yahoo: アクセストークンが期限切れです。getYahooAuthUrl() で再認証してください。'); }
    return cached || null;
  }

  var res = UrlFetchApp.fetch('https://auth.login.yahoo.co.jp/yconnect/v2/token', {
    method:  'POST',
    payload: {
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret
    },
    muteHttpExceptions: true
  });

  var body = JSON.parse(res.getContentText());
  if (body.error) { Logger.log('Yahoo トークンリフレッシュエラー: ' + JSON.stringify(body)); return cached || null; }
  if (body.refresh_token) PROPS.setProperty('YAHOO_REFRESH_TOKEN', body.refresh_token);
  var newToken = body.access_token || null;
  if (newToken) {
    PROPS.setProperty('YAHOO_ACCESS_TOKEN', newToken);
    PROPS.setProperty('YAHOO_ACCESS_TOKEN_EXPIRY', String(Date.now() + ((body.expires_in || 3600) - 300) * 1000));
  }
  return newToken;
}

function yahooXml_(el, tag) {
  try { return el.getChild(tag).getText(); } catch(e) { return ''; }
}

// ================================================================
// Amazon バックフィル（欠損期間の注文を一括補完）
// ================================================================

// 指定した月の全注文を取得してシートに書き込む（重複は自動スキップ）
function integrateAmazonOrdersForMonth_(year, month) {
  var token = getAmazonAccessToken_();
  if (!token) { Logger.log('Amazon: トークン取得失敗'); return 0; }

  var sheet     = getOrCreateSheet_();
  var existsSet = loadExistingOrderIds_(sheet);

  var jstOffset   = 9 * 60 * 60 * 1000;
  var startUtc    = new Date(Date.UTC(year, month - 1, 1,  0,  0,  0) - jstOffset);
  var monthEndUtc = new Date(Date.UTC(year, month,     0, 23, 59, 59) - jstOffset);
  var nowMinus5   = new Date(Date.now() - 5 * 60 * 1000);
  // 月末が未来の場合（今月）は「現在-5分」を上限にする
  var endUtc = monthEndUtc < nowMinus5 ? monthEndUtc : nowMinus5;

  var orders = fetchAllAmazonOrders_(token, startUtc.toISOString(), endUtc.toISOString());
  Logger.log('Amazon ' + year + '/' + month + ': ' + orders.length + '件取得');
  if (orders.length === 0) return 0;

  var newRows = [], fetchedAt = new Date();
  orders.forEach(function(order) {
    var orderId = order.AmazonOrderId;
    if (existsSet[orderId]) return;
    var items = fetchAmazonOrderItems_(token, orderId);
    buildAmazonRows_(order, items, fetchedAt).forEach(function(row) { newRows.push(row); });
    existsSet[orderId] = true;
  });

  if (newRows.length > 0) {
    appendRows_(sheet, newRows);
    Logger.log('Amazon ' + year + '/' + month + ': ' + newRows.length + '行を追記しました');
  } else {
    Logger.log('Amazon ' + year + '/' + month + ': 新規なし（全件既存）');
  }
  return newRows.length;
}

// 2026年5月・6月の欠損データを一括補完
// GASエディタのドロップダウンから実行してください（5〜10分かかる場合あり）
function backfillAmazonMayJune() {
  Logger.log('=== Amazon バックフィル開始（2026年5月・6月）===');
  var cnt5 = integrateAmazonOrdersForMonth_(2026, 5);
  Logger.log('5月完了: ' + cnt5 + '行追記');
  var cnt6 = integrateAmazonOrdersForMonth_(2026, 6);
  Logger.log('6月完了: ' + cnt6 + '行追記');
  Logger.log('=== バックフィル完了: 合計 ' + (cnt5 + cnt6) + '行 ===');
}

// 6月のみ再実行用（5月は完了済み）
function backfillAmazonJune() {
  Logger.log('=== Amazon バックフィル開始（2026年6月）===');
  var cnt = integrateAmazonOrdersForMonth_(2026, 6);
  Logger.log('6月完了: ' + cnt + '行追記');
  Logger.log('=== バックフィル完了 ===');
}

// ================================================================
// 楽天 バックフィル（指定日の注文を補完）
// ================================================================

// 楽天の指定日の注文を取得してスプレッドシートに補完する
function backfillRakutenDate_(dateStr) {
  // dateStr: 'YYYY-MM-DD' 形式（例: '2026-07-22'）
  var startDt = dateStr + "T00:00:00+0900";
  var endDt   = dateStr + "T23:59:59+0900";

  // dateType 1=注文確定日で検索（dateType 0では取得できないケースあり）
  var body = JSON.stringify({
    dateType:          1,
    startDatetime:     startDt,
    endDatetime:       endDt,
    orderProgressList: [100, 200, 300, 400, 500, 600, 700, 800]
  });

  var res = rakutenPost_('searchOrder', body);
  if (!res) { Logger.log('楽天バックフィル: API応答なし'); return 0; }

  var orderNumbers = res.orderNumberList || [];
  Logger.log('楽天バックフィル ' + dateStr + ': ' + orderNumbers.length + '件の注文番号');
  if (orderNumbers.length === 0) return 0;

  var sheet     = getOrCreateSheet_();
  var existsSet = loadExistingOrderIds_(sheet);
  var newRows   = [];
  var fetchedAt = new Date();

  chunkArray_(orderNumbers, 100).forEach(function(chunk) {
    var details = getRakutenOrderDetails_(chunk);
    details.forEach(function(orderModel) {
      var rows    = buildRows_(orderModel, fetchedAt);
      var orderId = rows.length > 0 ? rows[0][COL.ORDER_ID] : '';
      if (existsSet[orderId]) return;
      rows.forEach(function(row) { newRows.push(row); });
      existsSet[orderId] = true;
    });
  });

  if (newRows.length > 0) appendRows_(sheet, newRows);
  Logger.log('楽天バックフィル ' + dateStr + ': ' + newRows.length + '行を追記');
  return newRows.length;
}

// 7/22分を補完（GASエディタから手動実行）
function backfillRakutenJul22() {
  Logger.log('=== 楽天バックフィル開始（2026/07/22）===');
  var cnt = backfillRakutenDate_('2026-07-22');
  Logger.log('=== 楽天バックフィル完了: ' + cnt + '行追記 ===');
}

// 7/22〜7/24の欠損分を一括補完（APIキー失効期間の補完用）
function backfillRakutenMissing() {
  Logger.log('=== 楽天バックフィル 7/22〜7/24 ===');
  var cnt22 = backfillRakutenDate_('2026-07-22');
  var cnt23 = backfillRakutenDate_('2026-07-23');
  var cnt24 = backfillRakutenDate_('2026-07-24');
  Logger.log('完了: 7/22=' + cnt22 + '行, 7/23=' + cnt23 + '行, 7/24=' + cnt24 + '行');
}

// ================================================================
// ダッシュボード localStorage 復元スクリプト生成
// 使い方:
//   GASエディタで generateRestoreScript() を実行 → 実行ログにスクリプトが出力される
//   コピーして sales-tracker.html ページの F12 コンソールに貼り付けて実行
// ================================================================
function generateRestoreScript() {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) { Logger.log('シートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) { Logger.log('データなし'); return; }

  var data     = sheet.getRange(2, 1, lastRow - 1, HEADER.length).getValues();
  var amazonLog = {};
  var r_dup     = {}; // 楽天注文重複排除

  data.forEach(function(row) {
    var orderDate = row[COL.ORDER_DATE];
    if (!orderDate) return;
    var d       = new Date(orderDate);
    var dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
    var mall    = String(row[COL.MALL]);
    var orderId = String(row[COL.ORDER_ID]);
    var price   = Number(row[COL.PRICE]) || 0;

    if (mall === 'Amazon') {
      amazonLog[dateStr] = (amazonLog[dateStr] || 0) + price;
    }
    // 楽天は getSalesSummary_ 経由でGASから自動取得するため除外
    // Yahoo! はスプレッドシートに蓄積されていないため除外
  });

  var aJson = JSON.stringify(amazonLog);

  var script = [
    '// ─── ダッシュボード localStorage 復元スクリプト ───',
    '// 生成日時: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    '// ※ Yahoo!売上は手動再入力が必要です',
    '',
    'localStorage.setItem("amazon_daily_log", \'' + aJson + '\');',
    'console.log("✓ Amazon売上ログを復元しました (" + Object.keys(' + aJson + ').length + "日分)");',
    '',
    '// 復元後にページをリロードしてください',
    'console.log("→ ページをリロードして売上を確認してください");'
  ].join('\n');

  Logger.log('=== 以下をブラウザコンソールに貼り付けて実行してください ===');
  Logger.log(script);
  Logger.log('=== ここまでコピー ===');

  return script;
}


