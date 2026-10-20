# instagram-public-feed

公開 Instagram 投稿の URL・本文・画像をローカル保存する、小さな TypeScript CLI です。Node.js 24 以上。非公式であり、継続動作を保証しません。デフォルトはブラウザを起動しない HTTP モードです。ログイン、Cookie 注入、既存ブラウザプロファイル、非公開 API、ステルス、プロキシ回転は使いません。

## サポート範囲

| モード | URL 発見 | 本文 | 画像 | 投稿日時 |
| --- | --- | --- | --- | --- |
| `http`（標準） | 既知の URL を指定。プロフィール HTML にリンクがなければ明確なエラー | 公開 Open Graph メタデータから分離。全文保証なし | 切り抜きプレビュー 1 枚のみ | `metadataDate` の日付のみ。`publishedAt: null` |
| `browser`（明示指定） | 表示済み公開リンク全件の正式時刻を比較し最大 3 件。スクロールして全履歴を探さない | 特定できる投稿の `h1`、未対応 DOM では HTTP メタデータ | 通常 UI の次へボタンで進める範囲。DOM 未対応では HTTP プレビュー 1 枚にフォールバック | 対象パーマリンク内の `time[datetime]` |

ブラウザ方式だけが可能という意味ではありません。既知 URL は HTTP で本文メタデータとプレビュー画像を取得できました。一方、ブラウザなしでアカウント配列から新着 URL を自動発見する機能は現状未達です。プロフィールの単純 GET は、実測では公開投稿リンクがありませんでした。

ブラウザ経路は Instagram の DOM 変更に弱い実験的対応です。投稿の特定が曖昧なら停止し、DOM 未対応とアクセス拒否を分けて報告します。画像 alt の日付やコメントの時刻を正式な投稿時刻には使いません。動画本体の保存には対応しません。

## 起動

```sh
npm ci
cp config.example.json config.json
npm start -- --config config.json --mode http --limit 3
```

上のコマンドで URL 発見ができなければエラーになります。既知 URL 1 件なら、アカウントを一つ設定したうえで次のように実行できます。`Synthetic1` は合成例なので実在の shortcode に置き換えてください。

```sh
npm start -- --config config.json --url https://www.instagram.com/ningyocho.news/p/Synthetic1/
```

複数アカウントと既知 URL はローカルの `config.json` に設定します。以下の `Synthetic1` は合成例なので実在の URL に置き換えてください。

```json
{
  "accounts": ["ningyocho.news", "another.example"],
  "postUrls": {
    "ningyocho.news": ["https://www.instagram.com/ningyocho.news/p/Synthetic1/"],
    "another.example": ["https://www.instagram.com/another.example/p/Synthetic2/"]
  }
}
```

`postUrls` は省略可能です。各アカウントの既知 URL は `--limit` 以下にしてください。既知 URL モードは指定分を処理するだけで、最新投稿の自動選定ではありません。

ブラウザで表示投稿から選定したい場合は、別途利用可能な Chromium を指定します。HTTP モードにブラウザのインストールは不要です。

```sh
npm start -- --config config.json --mode browser --browser /absolute/path/to/chromium --limit 3
# または CHROMIUM_PATH を指定。表示環境があれば --headed も可
```

OS のサンドボックスを有効にした一時ブラウザコンテキストを使います。OS のセキュリティ設定は変更しません。実行環境がブラウザ起動を制限する場合は、エラー原因を解消できる正規の環境で実行してください。任意の登録案内は、可視の「閉じる」ボタンのみで閉じます。ログイン要求や CAPTCHA を突破しません。

## 保存形式と再実行

```text
data/
  posts.json                         # 設定アカウント全体の保存済み一覧
  last-run.json                      # アカウント単位の成功・失敗・未着手
  ningyocho.news/
    <shortcode>/
      post.json                      # URL、本文、時刻の取得元、取得枚数、状態
      images/01.jpg
    .<shortcode>.stage/               # 失敗時の一時保存・failure.json
```

`--out /path/to/output` で保存先を変更できます。`posts.json` は既存成功分も含み、アカウントと shortcode の組で重複を防ぎます。HTTP は `status: "preview_only"`、`imagesComplete: false` を明記します。これは本文・全画像の完全取得を意味しません。`rawDescription` を常に保持し、認識できない形式では `text: null` にして失敗を報告します。本文の中の引用符と HTML エンティティを壊さず処理します。`captionStatus` はメタデータ本文の完全性が未検証であることを示します。

`metadataDate` はタイムゾーンの不明な表示日です。画像 alt、メタデータの日付、DOM の UTC 日時に差があり得るため、それぞれを混同しません。

画像は一時ファイルから rename し、投稿全体も一時ディレクトリで準備してから確定します。ファイル長と SHA-256 を照合して再実行時にスキップします。失敗・未完了は再試行対象で、HTTP プレビューは HTTP モードだけで取得済み扱いになります。中断時の `.previous` は次回復元します。取得途中の失敗でも以前の保存済みデータを保持します。ブラウザで本文・画像の範囲を安全に特定できなければ HTTP プレビューにフォールバックし、`mediaFallback` と不完全フラグを記録します。フォールバック時は保存分を保持したうえでブラウザ経路を未完了（終了コード 1）として報告します。全カルーセル取得は未検証です。二重起動をロックし、異常終了で `.lock` が残った場合は実行中プロセスがないことを確認して手動で除去してください。

各アカウント・投稿を逐次処理し、投稿間は数秒空けます。HTTP 401/403/429、ログイン遷移、CAPTCHA、アクセス制限を検出すると残りのアカウントも停止します。DOM 未対応などの個別失敗は記録し、ほかのアカウントの成功分を保持します。いずれか失敗・未完了なら終了コードは 1 です。全履歴収集・定期実行・通知・自動再試行はありません。

## 検証

```sh
npm test
npm run typecheck
```

テストは合成 fixture のみで、Instagram に接続しません。複数アカウントの逐次処理、同 shortcode の分離、固定投稿の時刻比較、HTTP 本文解析、重複防止、保存失敗・中断復旧、制限時の停止を検証します。

実投稿の本文・画像・ログ・Cookie・ブラウザプロファイル・個人設定はリポジトリに含めません。ローカル検証記録は `evidence/` と `data*/` にあり、公開対象外です。

## 利用上の注意

Instagram の利用規約・適用法・投稿の著作権とプライバシーを確認してください。公開投稿でも自動取得や再利用、再配布の権利が自動的に与えられるわけではありません。画像・本文の再公開には権利者の許諾などが必要になる場合があります。アクセス制限・仕様変更・地域差で、未ログインで読める範囲は変わります。継続取得の安定性や完全性は保証しません。ログイン回避は行いません。

公開するのはツールのコードと一般的な設定例・合成テストだけです。GitHub Actions による Instagram へのアクセス、収集画像の公開、成果物アップロード、Pages 配信は設定しません。
