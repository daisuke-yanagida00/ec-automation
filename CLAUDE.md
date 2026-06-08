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

### 方針変更
- Yahoo 注文API申請 → **取り下げ・手動CSVダウンロード運用に変更**（2026-05-25）

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

## 2026-05-25 作業記録

### 完了（Claude.aiウェブチャットで実施・Claude Codeセッション外）
- **補助金・助成金リサーチ**：該当する公的支援制度の調査・整理
- **メルマガ配信改善**：配信内容・運用フローの見直し・改善実施
- **楽天 新商品リサーチ**：楽天市場での新規取り扱い商品候補のリサーチ実施
- **週次ダッシュボード自動更新システム構築**：Claude APIでサマリー生成・HTML更新・git push・Chatwork通知

## 2026-06-08 作業記録

### 完了
- **エージェント経営コンテンツ作成**：`docs/agent-management.html` 新規作成。8つのAIエージェント・フロー図・Before/After比較・Phase 1-4ロードマップ付き
- **月次経営レポート分析**：添付Excelファイルを解析し、各部署（営業・マーケ・EC・管理）の課題と提案を出力
- **売上目標トラッカー新規作成**：`docs/sales-tracker.html` を新規作成（ダークテーマ、neogate-dashboardスタイル合わせ）
- **6月目標プリセット設定**：楽天¥274万・Amazon¥420万・Yahoo!¥90万・合計¥784万
- **GAS Web App連携実装**：`integration/Code.gs` に `doGet()` + `getSalesSummary_()` 関数追加、売上トラッカーからAPIで自動取得
- **昨日の売上表示追加**：GASが毎朝8時に前日分を取得するため、各モールカードに「昨日」「今日」を並列表示
- **楽天CTR改善サムネイルガイド作成**：`docs/thumbnail-guide.html` 新規作成
  - 対象3商品：枕（ライフスタイル型）・電位治療掛け布団（テクノロジー型）・そば殻角枕（白背景プロダクト型）
  - CSSビジュアルモックアップ・DO/DON'Tルール・チェックリスト（localStorage状態保持）付き
  - 目標CTR：0.06% → 0.12〜0.15%

### 決定事項
- GAS Web App URL：`https://script.google.com/macros/s/AKfycbwNT5hZvahJlfK949MLCxmyIz3oZDutOJDseRNA0Qkkk-9zM8okA5M4o13MOxTnWGkcSA/exec`
- Rakuten注文の売上集計：totalPriceはORDER_IDで重複排除（1注文1回カウント）
- Amazon注文：itemPriceを直接合算
- 売上トラッカーはGitHub Pages（`https://daisuke-yanagida00.github.io/ec-automation/sales-tracker.html`）で公開

### システム構成変更
- `integration/Code.gs` にWebアプリ関数追加（doGet・getSalesSummary_）
- GitHub Pages公開ページ：agent-management.html / sales-tracker.html / thumbnail-guide.html

## 運用ルール
**このプロジェクトのセッション終了時は必ずCLAUDE.mdを更新すること。**
- セッション終了前に「今日の作業内容をCLAUDE.mdに追記してgit pushして」を実行
- 記録内容：完了タスク・決定事項・システム構成の変更点
- Claude.aiウェブチャットで実施した作業も必ずこのファイルに手動で追記する

