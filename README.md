# instagram-public-feed

公開 Instagram 投稿の URL 一覧を取得し、その一覧から本文と画像をローカルに保存する CLI です。

## 最初の準備

Node.js 24 以上、pnpm 12、Chromium または Google Chrome を使います。

```sh
pnpm install
cp config.example.json config.json
```

`config.json` に取得対象を設定します。初期値は `ningyocho.news` です。

```json
{
  "accounts": ["ningyocho.news"]
}
```

通常の操作はこの設定を自動で読みます。`config.json` は Git の管理対象外です。

複数アカウントは `accounts` に追加します。`pnpm urls` と `pnpm posts` の両方が、設定順に全アカウントを処理します。

```json
{
  "accounts": ["ningyocho.news", "another.account"]
}
```

## 使い方

### 1. 投稿 URL の一覧を保存

```sh
pnpm urls
```

各プロフィールに表示された公開投稿リンクを `data/<account>/post-links.json` に保存します。ブラウザは画面を出さずに起動し、PATH にある Chromium / Chrome を自動で探します。`CHROMIUM_PATH` で実行ファイルを指定することもできます。

標準では初期表示分だけを取得します。さらに通常のスクロールと「投稿をもっと見る」で追加読み込みを試す場合：

```sh
pnpm urls --scrolls 3
```

この例ではスクロール回数はアカウントごとに最大3回です（指定範囲は0〜50回）。リンクが増えない場合は早めに終了します。登録・ログイン案内が出た場合は、その前に確認できた URL を保存して停止し、後続アカウントも停止します。これは全履歴を保証する機能ではありません。保存順は発見順で、固定投稿などがあるため最新順とは限りません。実測では `ningyocho.news` で初期12件から24件に増やせました。

### 2. 一覧から URL・本文・画像を保存

```sh
pnpm posts
```

`config.json` の各アカウントについて `data/<account>/post-links.json` を読み、その一覧の全件を順番に処理します。プロフィールの再取得や最新順への選び直しは行いません。本文・画像はアカウント別のディレクトリに保存し、全アカウントの投稿を `data/posts.json` に集約します。同じ shortcode があっても、アカウントごとに区別します。

**標準ではブラウザの公開画面から本文と複数画像を取得します。** 通常の「次へ」操作で表示できる範囲が対象で、全文・全画像の取得を保証するものではありません。DOM 未対応の場合は HTTP プレビューにフォールバックし、未完了として終了コード1を返します。動画本体の保存には対応しません。

ブラウザを使わず軽量に取得したい場合は `pnpm posts --mode http` を指定します。この場合の本文は公開メタデータの範囲、画像はプレビュー1枚で、`status: "preview_only"` と `imagesComplete: false` を記録します。

取得済みの投稿は、保存ファイルの長さと SHA-256 を確認してスキップします。入力一覧は書き換えません。

### 3. 投稿一覧を1枚の HTML にまとめる

```sh
pnpm html
```

`data/posts.json` と保存済み画像から `data/gallery.html` を生成します。アカウントをまたいで投稿日の新しい順に並べ、本文・投稿へのリンク・保存済み画像を表示します。正式な投稿日時がない場合はメタデータの日付を参考にし、日付も不明な投稿は最後に表示します。参考日付が同じ投稿同士の正確な順序は分かりません。画像は HTML 内に埋め込むため、このファイル1つでオフラインでも閲覧できます。複数画像は「前へ」「次へ」ボタンで切り替えられます。Instagram への追加取得は行いません。

アカウントごとの絞り込みと本文のキーワード検索ができ、本文は「本文を読む」で展開します。検索は空白区切りで複数の語を指定でき、絞り込み条件は URL に反映されます。

各投稿の画像が1枚だけの場合は、以前の HTTP プレビューだけを保存している可能性があります。複数画像を取得し直して HTML に反映するには：

```sh
pnpm posts
pnpm html
```

ブラウザ方式は、対象投稿の本文と通常の「次へ」操作で取得できる画像を保存します。次の画像の先読みも考慮して送りを判定します。取得済みの完全な投稿はスキップし、HTTP プレビューは再取得します。動画や DOM 未対応では未完了になる場合があります。

### 4. 同じ LAN の端末でプレビュー

```sh
pnpm preview
```

ポート3000で起動し、同じ LAN から接続できる URL を実行結果の `urls` に表示します。スマートフォンなどを同じ LAN に接続して、`http://192.168.x.x:3000/` などの表示された URL を開いてください。接続できない場合は、端末間通信やポート3000の通信が許可されているか確認してください。終了は `Ctrl+C` です。

生成済み HTML だけを配信します。設定ファイルや `posts.json` などは配信しません。同じ LAN 上で閲覧できるプレビューで、認証はありません。`pnpm posts` の再実行後は `pnpm html` で再生成し、ブラウザを更新すると反映されます。

```sh
pnpm preview --port 8080       # ポートを変更
pnpm preview --host 127.0.0.1  # このPCだけで閲覧
```

データ保存先を変更した場合は `pnpm html --out ./output`、`pnpm preview --out ./output` のように、取得時と同じ `--out` を指定します。`pnpm --silent html`、`pnpm --silent preview` なら pnpm のコマンド表示を消せます。生成結果とプレビュー起動情報は JSON で出力します。

### 実行結果を JSON で受け取る

実行結果は標準出力に JSON で出力します。pnpm が表示する `$ node ...` は標準エラー出力です。画面上でも pnpm のコマンド表示を消すには、`--silent` をスクリプト名の前に付けます。

```sh
pnpm --silent posts
```

実行結果をファイルへ保存する場合：

```sh
pnpm --silent posts > result.json
```

`result.json` は実行日時・成功／失敗・保存／スキップ情報などの実行レポートです。取得した投稿の URL・本文・画像情報は `data/posts.json` に保存されます。処理中のログやエラーは標準エラー出力に出るため、JSON を保存するときは `2>&1` で混ぜないでください。設定不備など、処理開始前のエラーでは JSON が出力されない場合があります。

### 必要なときだけ付けるオプション

| 操作                         | コマンド                                                 |
| ---------------------------- | -------------------------------------------------------- |
| 一覧の先頭2件だけ処理        | `pnpm posts --limit 2`                                   |
| 設定中の1アカウントだけ処理  | `pnpm posts --account ningyocho.news`                    |
| 1アカウントの一覧だけ更新    | `pnpm urls --account ningyocho.news`                     |
| 別の一覧から取得             | `pnpm posts --from-list /path/to/post-links.json`        |
| 保存先を変更                 | `pnpm urls --out ./output` → `pnpm posts --out ./output` |
| プレビュー1枚だけ軽量に取得  | `pnpm posts --mode http --limit 2`                       |
| ブラウザの場所を指定         | `pnpm urls --browser /snap/bin/chromium`                 |
| デスクトップ環境で画面を表示 | `pnpm urls --headed`                                     |
| 別の設定ファイルを使用       | `pnpm posts --config another.json`                       |

`--limit` は**アカウントごと**に適用します。例えば2アカウントで `--limit 2` を指定すると、それぞれの一覧の先頭2件、合計最大4件が対象です。取得済みの投稿もその件数に含みます。省略時は各一覧の全件が対象です。URL 一覧の取得件数を制限する指定ではありません。`--out` を変えると既定の入力一覧もその保存先から読みます。

`--account` は `config.json` に設定したアカウントから1つを選びます。`--from-list` は指定ファイルの `account` に一致する設定済みアカウントだけを処理します。`--account` と併用する場合は、同じアカウントを指定してください。

一覧がない・壊れている場合は、そのアカウントを失敗として記録し、他のアカウントを続行します。アクセス制限を検出した場合は、後続のアカウントも停止します。失敗や未完了が1件でもあれば終了コード1を返し、成功した保存データは保持します。

ブラウザでの本文・複数画像の取得は実験的対応です。DOM が未対応の場合はプレビュー1枚にフォールバックし、未完了として終了コード1を返します。HTTP 方式で保存したプレビューも、ブラウザ方式では再取得の対象です。

## 保存されるファイル

```text
data/
  posts.json                      # 保存済み投稿の URL・本文・画像ファイル情報
  last-run.json                   # 最後の実行の成功・失敗と診断情報
  gallery.html                    # 本文・画像をまとめた単一HTML
  ningyocho.news/
    post-links.json               # プロフィールから取得した URL 一覧
    <shortcode>/
      post.json                   # その投稿の本文・取得状態・画像情報
      images/01.jpg               # 取得した画像
```

`posts.json` は `config.json` に設定した全アカウントの保存済み投稿を含めて更新します。`--account` や `--from-list` で処理対象を絞った場合や、一部アカウントが失敗した場合も、他の設定済みアカウントの保存済み投稿を残します。設定から削除したアカウントは集約対象から外れますが、個別の保存ファイルは削除しません。

各投稿の `account` と `shortcode`、`path` で保存元を特定できます。HTTP 方式の `publishedAt` は `null` で、メタデータの日付は `metadataDate` として分けて保存します。本文解析に失敗した場合は `text: null` と元の `rawDescription` を残します。

## 取得できないとき

| 状況                                        | 確認すること                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `config.json` がない                        | `cp config.example.json config.json` を実行                              |
| `post-links.json` がない                    | 先に `pnpm urls` を実行                                                  |
| ブラウザが見つからない                      | Chromium / Chrome を用意し、必要なら `--browser` で指定                  |
| `--headed` で起動できない                   | 画面表示のない環境では `--headed` を外す                                 |
| HTTP 401 / 403 / 429、ログイン要求、CAPTCHA | その実行を停止。`last-run.json` を確認し、連続実行を避ける               |
| 出力先がロックされている                    | 実行中プロセスがないことを確認してから、残った `data/.lock` を手動で削除 |

ブラウザ方式では、補助通信 `/ajax/bulk-route-definitions/` の XHR / fetch が返す429だけは警告として記録し、公開画面が読める場合に続行します。その他のアクセス制限では停止します。失敗した通信の接続先と種類は `last-run.json` の `restrictedResponses` に残ります。

ログイン、Cookie 注入、既存ブラウザプロファイルの利用、アクセス制限の回避は行いません。Instagram の仕様変更によって動かなくなる場合があります。投稿の再公開・再配布には利用規約、著作権、プライバシーへの配慮が必要です。

## 開発

```sh
pnpm fmt        # oxfmt で整形
pnpm lint       # oxlint で検査
pnpm lint:fix   # oxlint の自動修正
pnpm typecheck  # TypeScript の型チェック
pnpm test       # 合成データによるテスト。Instagram には接続しない
pnpm check      # 整形確認・lint・型チェック・テストをまとめて実行
```

ソースは役割ごとに分けています。既存のコマンドは `src/cli.ts` と `src/view.ts` を入口として実行します。

```text
src/
  cli.ts, view.ts  # コマンドの入口
  app/            # 設定、入力の選択、アカウントごとの実行制御
  collection/     # ブラウザ・HTTPでの投稿取得と解析
  posts/          # 投稿の識別、並び順、画像保存、一覧の集約
  gallery/        # HTML生成、CSS、ブラウザ操作、プレビュー配信
```

依存関係は `pnpm-lock.yaml` で固定します。`pnpm-workspace.yaml` の `minimumReleaseAge: 10080` により、[公開から7日以上経ったライブラリを使用](https://pnpm.io/settings#minimumreleaseage)します。例外パッケージは設定していません。[oxfmt](https://oxc.rs/docs/guide/usage/formatter/quickstart) と [oxlint](https://oxc.rs/docs/guide/usage/linter/quickstart) は開発依存に含まれます。

実投稿のデータ、画像、個人設定、Cookie、ブラウザプロファイルは Git の管理対象外です。定期実行・通知・自動再試行はありません。
