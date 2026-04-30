# EC自動化プロジェクト（株式会社ネオ・ゲート）

## 目的

楽天・Amazon・Yahoo・自社ショップ・グースリー公式の注文データをGoogleスプレッドシートに毎朝自動統合し、委託先が分析・施策に集中できる環境を作る。

## スプレッドシート

- **ID**: `1Ziqy2ef7Msc3BB-YdnA48mS68_rNXZ_fAOn0Q3fBGtQ`
- **統合先シート名**: `注文統合`

## フォルダ構成

```
ec-automation/
├── rakuten/      # 楽天市場
├── amazon/       # Amazon
├── yahoo/        # Yahoo!ショッピング
├── jisya/        # 自社ショップ
├── gooslie/      # グースリー公式
└── integration/  # 統合処理
```

## GAS スクリプトID対応

| フォルダ | スクリプトID |
|---|---|
| integration | `1JY-l8MYvPa1d0DEvbVcbJqfKz5gSEQWuDH1mAif-z6I1vq8uQQHNNT3X` |
| rakuten | `10h7vJgq-3P3PohO6U26xrOpEDL3FnVohZZb6EuborOPlOm5qMA6fRYVg` |
| yahoo | `1RfbqLVTiniI_ZxOfUjWyvlE_T1a7Dbb1JIDzxX_Mkt7whipg-pd7_9WN` |

## 自動実行

毎朝 **8:00** に時間ベーストリガーで実行。

## 進捗状況

### 完了済み
- 楽天 注文自動取得・スプレッドシート書き込み
- Amazon 注文自動取得・スプレッドシート書き込み
- トリガー設定

### 申請中
- Yahoo IP制限解除申請（承認まで1〜2週間待ち）

### 未完了
- 自社ショップ CSVメール転送設定
- グースリー CSVメール転送設定

## 次のタスク

- 楽天週次レポートを ec-automation に統合
- 売上・広告レポート自動集計

## 使用ツール

- Google Apps Script (GAS)
- clasp
- Claude Code
