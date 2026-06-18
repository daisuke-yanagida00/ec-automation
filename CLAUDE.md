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

## 2026-06-09 作業記録

### 完了
- **売上ダッシュボード大幅改善**：`docs/sales-tracker.html` をデバッグ・機能追加
  - 金額表示を `¥1.56M` 形式 → `万円` 形式に変更（例：274万円）
  - 「今日」「昨日」の表示 → 実際の日付ラベル（例：6/9, 6/8）に変更
  - Yahoo! 売上をAPI（IP制限でブロック）から手動入力方式に変更（オレンジ枠のinputフィールド）
  - 日別売上棒グラフ追加：楽天（金）・Amazon（青）・Yahoo!（オレンジ）の積み上げバー、目標ライン（破線）付き
- **Amazon注文バックフィル実装**：5月9日〜6月のトリガー停止期間中の未取得注文を補完
  - `backfillAmazonMayJune()` 関数作成：5月551行・6月129行追加
  - Amazon SP-API の `CreatedBefore` は現在時刻より過去である必要があるため、`now - 5分` でキャップする修正
- **GAS `getSalesSummary_()` に日別データ追加**：`daily` 配列を返すよう拡張（棒グラフ用）
- **Yahoo! OAuth調査（結果：断念）**：GASサーバーIPがYahoo! Shopping Order APIでブロック（px-04306エラー）。手動入力に切り替え済み

### 決定事項
- **GAS Web App URL（更新版）**：`https://script.google.com/macros/s/AKfycbznYqQyYEvskbx2fQBVKllfA__C8OsDGrNkwVfp2sh6EQGpZKsKMavEtp9B422kq8XGiw/exec`
  - 旧URL（AKfycbwN...）は廃止、新URL（AKfycbzn...）を sales-tracker.html に設定済み
- **GASデプロイ運用ルール確定**：「新しいデプロイ」ではなく「デプロイを管理→鉛筆→新しいバージョン→デプロイ」でURLを維持しながら更新
- **Yahoo! Shopping Order API**：Googleサーバー（GAS）からのアクセスはIP制限により永続的にブロック。Yahoo! 売上は手動入力で運用
- **Amazon売上差異（~15-18%）**：SP-API（発送済みのみ）vs Seller Central（全ステータス）の仕様差として許容。ダッシュボードはSP-API基準

### システム構成変更
- `integration/Code.gs`：`getSalesSummary_()` に `daily` 配列追加、`backfillAmazonMayJune()` / `backfillAmazonJune()` 関数追加
- `docs/sales-tracker.html`：Yahoo!手動入力・日別棒グラフ・万円表示・日付ラベル対応
- GAS再デプロイ要（ユーザーが手動で「デプロイを管理→鉛筆→新しいバージョン→デプロイ」を実施）

## 2026-06-10 作業記録

### 完了
- **売上ダッシュボード追加改善**：`docs/sales-tracker.html`
  - Yahoo!手動入力値がリロード後に消える問題を修正（manual_sales復元をsetAutoSalesより先に実行）
  - 売上目標の手入力が反映・保存されない問題を修正（saveTargets()関数追加、earlyReturnバグ解消）
  - 合計カードの「累計（手動）」→「日次目標」表示に変更
  - 楽天・Amazon・Yahoo!カードも同様に変更（各モールの日次目標を自動計算表示）
  - 昨日・今日ラベルを「昨日 (6/9)」「今日 (6/10)」形式に変更
  - Yahoo!入力を「今月累計」→「昨日の売上」日次ログ式に変更（yahoo_daily_logで月次累計を自動加算）
- **売上集計精度改善**：`integration/Code.gs`
  - 楽天：totalPrice（税込）÷1.1 → 税抜き表示（RMSと合わせる）
  - Amazon：OrderStatuses に Pending/Unshipped を追加（SC売上と合わせる）
- **clasp 自動化設定**：GitHub Actions ワークフロー追加
  - `.github/workflows/clasp-push.yml` 作成
  - `integration/rakuten/yahoo` の .gs 変更時に自動で `clasp push` 実行
  - GitHub Secret `CLASPRC_JSON` に認証情報を登録済み
  - 動作確認済み（integration push に成功）

### 決定事項
- **GASデプロイ自動化**: git push → GitHub Actions → clasp push → GAS自動反映
  - ただし「デプロイを管理→新しいバージョン→デプロイ」はWeb App URL更新のため引き続き手動
- **楽天売上**: totalPrice（税込）÷1.1でRMS税抜き表示に統一
- **Amazon売上**: Pending/Unshipped含む全ステータスでSC売上に近似
- **Yahoo!売上**: 昨日の売上を毎日入力→yahoo_daily_logに日付キーで蓄積→当月合計を表示

### システム構成変更
- `docs/sales-tracker.html`：多数のUI修正・Yahoo!日次ログ方式
- `integration/Code.gs`：楽天税抜き変換・Amazon全ステータス対応
- `.github/workflows/clasp-push.yml`：GAS自動デプロイワークフロー追加

## 2026-06-18 作業記録

### 完了
- **インフルエンサー施策 履歴・分析レポート作成**：`docs/influencer-analysis.html` 新規作成
  - 10月〜4月の月別実績（流入数・購入者数）、4月急落（-83%、10件）の原因分析
  - ROI試算：コスト¥65,000/月 vs 売上貢献¥20,000/月 → -69%
  - 全部署共有・継続可否協議資料
- **インフルエンサー施策事例調査**（Deep Research実施）
  - VALX（プロテイン）：山本義徳×Leverage、10ヶ月で月商1億円突破、年商100億円規模
  - ReZARD（アパレル）：ヒカル、1週間6億円、3年累計70億円超
  - しまむら×プチプラのあや：第8弾まで継続（定番コラボ）
  - アストロ×MAYU：日用品コラボ定番商品化
  - 寝具特化の商品共同開発事例は未確認（ブルーオーシャンの可能性）
- **インフルエンサーコラボ商品開発 完全実行計画作成**：`docs/influencer-collab-plan.html` 新規作成
  - Phase 0〜5（約8ヶ月）の詳細タスク・担当部署・自動化方式
  - 自動化できる業務（GAS・Claude API活用）vs 手動必須業務の整理
  - 初期費用概算：¥51〜108万（現行施策¥52万/8ヶ月と同水準）
- **docs/index.html 更新**：インフルエンサー急落アラート追加、関連ドキュメントリンクセクション追加

### 決定事項
- **インフルエンサー施策の方向転換**：単純PR投稿 → コラボ商品開発（P2Cモデル）へ
- **現行Woomy施策**：継続可否の最終判断を経営で実施（廃止→予算をコラボ商品開発へ）
- **コラボ商品開発のKPI**：流入50件/月・購入5名/月・発売3ヶ月で損益分岐点

### 自動化設計（新規）
- GAS拡張：コラボ商品別売上集計 → 週次レポート自動生成 → Chatwork通知（Phase 5で実装予定）
- UTMリンク生成：GASでインフルエンサー別リンクを一括生成
- 文章生成：商品ページ説明・投稿文案・週次レポートサマリーをClaude APIで自動生成

### GitHub Pages公開ページ（追加）
- `docs/influencer-analysis.html`：インフルエンサー施策履歴・分析レポート（全部署共有）
- `docs/influencer-collab-plan.html`：コラボ商品開発完全実行計画（Phase 0〜5）

## 運用ルール
**このプロジェクトのセッション終了時は必ずCLAUDE.mdを更新すること。**
- セッション終了前に「今日の作業内容をCLAUDE.mdに追記してgit pushして」を実行
- 記録内容：完了タスク・決定事項・システム構成の変更点
- Claude.aiウェブチャットで実施した作業も必ずこのファイルに手動で追記する

