# EC自動化プロジェクト セットアップ手順

## フォルダ構成

```
ec-automation/
├── rakuten/     楽天市場 注文取得
├── amazon/      Amazon SP-API 注文取得
├── yahoo/       Yahoo!ショッピング 注文取得
├── jisya/       自社サイト 注文取得
├── gooslie/     Gooslie 注文取得
└── integration/ 全モール統合・集計
```

## 初期設定手順

### 1. clasp ログイン
```bash
clasp login
```

### 2. 各モールで GAS プロジェクトを新規作成してスクリプトIDを取得
GAS エディタ → プロジェクトの設定 → スクリプト ID をコピー

### 3. 各フォルダの .clasp.json にスクリプトIDを設定
例 (rakuten/.clasp.json):
```json
{
  "scriptId": "1BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxY",
  "rootDir": "."
}
```

### 4. 各フォルダからコードをプッシュ
```bash
cd rakuten && clasp push
cd ../amazon && clasp push
cd ../yahoo && clasp push
cd ../jisya && clasp push
cd ../gooslie && clasp push
cd ../integration && clasp push
```

### 5. GAS エディタでスクリプトプロパティを設定
各プロジェクトの「プロジェクトの設定」→「スクリプトプロパティ」で以下を登録:

| モール | プロパティキー | 説明 |
|--------|---------------|------|
| 共通 | SPREADSHEET_ID | 注文記録先のスプレッドシートID |
| 楽天 | RAKUTEN_SERVICE_SECRET | RMS APIサービスシークレット |
| 楽天 | RAKUTEN_LICENSE_KEY | RMS APIライセンスキー |
| 楽天 | RAKUTEN_SHOP_URL | ショップURL |
| Amazon | AMAZON_CLIENT_ID | SP-API クライアントID |
| Amazon | AMAZON_CLIENT_SECRET | SP-API クライアントシークレット |
| Amazon | AMAZON_REFRESH_TOKEN | SP-API リフレッシュトークン |
| Yahoo | YAHOO_CLIENT_ID | Yahoo APIクライアントID |
| Yahoo | YAHOO_CLIENT_SECRET | Yahoo APIクライアントシークレット |
| Yahoo | YAHOO_REFRESH_TOKEN | Yahoo リフレッシュトークン |
| Yahoo | YAHOO_SELLER_ID | Yahoo セラーID |
| 自社 | JISYA_API_BASE_URL | 自社APIのベースURL |
| 自社 | JISYA_API_KEY | 自社APIキー |
| Gooslie | GOOSLIE_API_BASE_URL | Gooslie APIのベースURL |
| Gooslie | GOOSLIE_API_KEY | Gooslie APIキー |
| Gooslie | GOOSLIE_SHOP_ID | GooslieショップID |

### 6. 日次トリガー設定
integration プロジェクトで `setupDailyTrigger()` を手動実行 → 毎朝8時に全モール取得が自動実行されます
