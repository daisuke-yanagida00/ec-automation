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

## 2026-05-02 作業記録

### 完了
- 楽天 getOrder APIレスポンス構造修正（OrderModelList対応）
- 楽天 orderDatetime キー名修正（A列に注文日表示）
- Amazon 売上金額0円バグ修正
- Amazon セッション数：SP-API値（重複カウントあり）をそのまま使用と決定
  - Seller Centralとの差分約215セッション（約15%）は仕様差として許容
  - CVRもSP-API基準で統一（Seller Centralより約0.7pt低く出る）
- childAsin優先・parentAsinフォールバックのフィルター修正

### 決定事項
- EC注文統合GAS（integration）：全モール共通DBとして毎朝自動更新
- 楽天API連携GAS（rakuten）：週次レポートはCSV運用で継続
- 月次レポートは手動運用のまま継続
- 次タスク：integration/Code.gs に月次横断レポート関数を追加

### システム構成
- 楽天取得期間：24*7（デバッグ中）→ 完了後に24へ戻す

## 運用ルール
**このプロジェクトのセッション終了時は必ずCLAUDE.mdを更新すること。**
- セッション終了前に「今日の作業内容をCLAUDE.mdに追記してgit pushして」を実行
- 記録内容：完了タスク・決定事項・システム構成の変更点

